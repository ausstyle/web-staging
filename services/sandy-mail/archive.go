package mailstore

import (
	"archive/tar"
	"archive/zip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path"
	"strings"
	"time"
)

// Archive inspection is a bounded worker primitive, not a customer import job.
// The caller retains the immutable master archive and persists inventory before
// authorizing import. Nothing is extracted, rendered, executed or sent here.
const MaxArchiveBytes int64 = 100 << 20
const MaxArchiveEntries = 1000

type ArchiveItem struct {
	Path          string    `json:"path"`
	Folder        string    `json:"folder"`
	Size          int64     `json:"size"`
	SHA256        string    `json:"sha256"`
	SourceTime    time.Time `json:"source_time"`
	Flags         []string  `json:"flags"`
	UnmappedFlags string    `json:"unmapped_flags,omitempty"`
}
type ArchiveException struct {
	Path string `json:"path"`
	Code string `json:"code"`
}
type ArchivePreview struct {
	State             string             `json:"state"` // READY is inventory readiness, never import COMPLETE.
	Entries           int                `json:"entries"`
	StructuralEntries int                `json:"structural_entries"`
	Bytes             int64              `json:"bytes"`
	Items             []ArchiveItem      `json:"items"`
	Exceptions        []ArchiveException `json:"exceptions"`
	PortableMetadata  *ExportManifest    `json:"portable_metadata,omitempty"`
}
type archiveInspector struct {
	preview ArchivePreview
	seen    map[string]bool
	visit   func(ArchiveItem, []byte) error
}

func newInspector(visit func(ArchiveItem, []byte) error) *archiveInspector {
	return &archiveInspector{preview: ArchivePreview{State: "DISCOVERING", Items: []ArchiveItem{}, Exceptions: []ArchiveException{}}, seen: map[string]bool{}, visit: visit}
}
func (a *archiveInspector) exception(name, code string) {
	a.preview.Exceptions = append(a.preview.Exceptions, ArchiveException{name, code})
}
func safeArchivePath(name string) bool {
	return name != "" && !strings.ContainsAny(name, "\\\x00\r\n") && !strings.HasPrefix(name, "/") && name == path.Clean(name) && name != ".." && !strings.HasPrefix(name, "../") && len(name) <= 1024
}
func (a *archiveInspector) entry(name string, size int64, modified time.Time, directory, regular bool, r io.Reader) error {
	a.preview.Entries++
	if a.preview.Entries > MaxArchiveEntries {
		return fmt.Errorf("archive_entry_limit")
	}
	if directory {
		name = strings.TrimSuffix(name, "/")
	}
	if !safeArchivePath(name) || a.seen[name] {
		return fmt.Errorf("unsafe_or_duplicate_archive_path")
	}
	a.seen[name] = true
	if directory {
		a.preview.StructuralEntries++
		return nil
	}
	if !regular {
		a.exception(name, "unsupported_special_entry")
		return nil
	}
	if size < 0 || size > MaxMessageBytes || a.preview.Bytes+size > MaxArchiveBytes {
		return fmt.Errorf("archive_byte_limit")
	}
	a.preview.Bytes += size
	raw, err := io.ReadAll(io.LimitReader(r, size+1))
	if err != nil {
		if errors.Is(err, ErrImportSourceUnavailable) {
			return err
		}
		return fmt.Errorf("archive_read_failed")
	}
	if int64(len(raw)) != size {
		return fmt.Errorf("archive_truncated_or_size_mismatch")
	}
	if name == "manifest.json" {
		var manifest ExportManifest
		if err = json.Unmarshal(raw, &manifest); err != nil || manifest.Version != 1 {
			a.exception(name, "invalid_portable_manifest")
			return nil
		}
		a.preview.PortableMetadata = &manifest
		a.preview.StructuralEntries++
		return nil
	}
	item := ArchiveItem{Path: name, Folder: path.Dir(name), Size: size, SHA256: digest(raw), SourceTime: modified, Flags: []string{}}
	parent := path.Base(path.Dir(name))
	maildir := parent == "cur" || parent == "new"
	if parent == "tmp" {
		a.exception(name, "maildir_tmp_not_committed")
		return nil
	}
	if maildir {
		item.Folder = path.Dir(path.Dir(name))
		if _, flags, found := strings.Cut(path.Base(name), ":2,"); found {
			known := map[rune]string{'D': "draft", 'F': "flagged", 'P': "passed", 'R': "answered", 'S': "seen", 'T': "deleted"}
			used := map[rune]bool{}
			for _, f := range flags {
				if used[f] {
					continue
				}
				used[f] = true
				if value, ok := known[f]; ok {
					item.Flags = append(item.Flags, value)
				} else {
					item.UnmappedFlags += string(f)
				}
			}
		}
	} else if !strings.HasSuffix(strings.ToLower(name), ".eml") {
		a.exception(name, "unsupported_source_format")
		return nil
	}
	if _, err = Parse(raw); err != nil {
		a.exception(name, "malformed_mime_preserved_in_master")
		return nil
	}
	a.preview.Items = append(a.preview.Items, item)
	if a.visit != nil {
		if err = a.visit(item, raw); err != nil {
			return fmt.Errorf("archive_visitor_failed")
		}
	}
	return nil
}
func (a *archiveInspector) finish(err error) (ArchivePreview, error) {
	if err != nil {
		a.preview.State = "NEEDS_ACTION"
		return a.preview, err
	}
	if m := a.preview.PortableMetadata; m != nil {
		actual := map[string]ArchiveItem{}
		for _, i := range a.preview.Items {
			actual[i.Path] = i
		}
		matched := map[string]bool{}
		for _, i := range m.Messages {
			found, ok := actual[i.Path]
			if !ok || matched[i.Path] || found.SHA256 != i.Raw.SHA256 || found.Size != i.Raw.Size {
				a.exception(i.Path, "portable_manifest_integrity_mismatch")
			}
			matched[i.Path] = true
		}
		if len(m.Messages) != len(actual) {
			a.exception("manifest.json", "portable_manifest_count_mismatch")
		}
		if !m.Complete || m.PendingIngestions != 0 {
			a.exception("manifest.json", "source_export_incomplete_or_pending")
		}
	}
	a.preview.State = "READY"
	if len(a.preview.Exceptions) > 0 {
		a.preview.State = "NEEDS_ACTION"
	}
	return a.preview, nil
}

// InspectTAR streams entry bytes with bounded per-message memory. A visitor must
// not treat individual callbacks as an approved/complete import: the final
// inventory may contain exceptions or fail. Store checkpoints in the caller.
func InspectTAR(input io.Reader, visit func(ArchiveItem, []byte) error) (ArchivePreview, error) {
	a := newInspector(visit)
	lr := &io.LimitedReader{R: input, N: MaxArchiveBytes + (2 << 20) + 1}
	tr := tar.NewReader(lr)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			buf := make([]byte, 32768)
			for {
				n, e := lr.Read(buf)
				for _, b := range buf[:n] {
					if b != 0 {
						return a.finish(fmt.Errorf("tar_trailing_data"))
					}
				}
				if lr.N <= 0 {
					return a.finish(fmt.Errorf("archive_container_limit"))
				}
				if e == io.EOF {
					break
				}
				if e != nil {
					return a.finish(fmt.Errorf("archive_read_failed"))
				}
			}
			return a.finish(nil)
		}
		if err != nil {
			if errors.Is(err, ErrImportSourceUnavailable) {
				return a.finish(err)
			}
			return a.finish(fmt.Errorf("invalid_tar"))
		}
		if err = a.entry(h.Name, h.Size, h.ModTime, h.Typeflag == tar.TypeDir, h.Typeflag == tar.TypeReg || h.Typeflag == tar.TypeRegA, tr); err != nil {
			return a.finish(err)
		}
	}
}

// ZIP uses ReaderAt without unpacking paths. Declared and actual uncompressed
// sizes and CRC are checked; compressed/container size and entry count bounded.
func InspectZIP(input io.ReaderAt, size int64, visit func(ArchiveItem, []byte) error) (ArchivePreview, error) {
	a := newInspector(visit)
	if size < 0 || size > MaxArchiveBytes {
		return a.finish(fmt.Errorf("archive_container_limit"))
	}
	zr, err := zip.NewReader(input, size)
	if err != nil {
		if errors.Is(err, ErrImportSourceUnavailable) {
			return a.finish(err)
		}
		return a.finish(fmt.Errorf("invalid_zip"))
	}
	if len(zr.File) > MaxArchiveEntries {
		return a.finish(fmt.Errorf("archive_entry_limit"))
	}
	for _, f := range zr.File {
		if f.UncompressedSize64 > uint64(MaxMessageBytes) {
			return a.finish(fmt.Errorf("archive_byte_limit"))
		}
		reader, err := f.Open()
		if err != nil {
			return a.finish(fmt.Errorf("zip_entry_open_failed"))
		}
		err = a.entry(f.Name, int64(f.UncompressedSize64), f.Modified, f.FileInfo().IsDir(), f.Mode().IsRegular(), reader)
		reader.Close()
		if err != nil {
			return a.finish(err)
		}
	}
	return a.finish(nil)
}
