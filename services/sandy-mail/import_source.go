package mailstore

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"
)

var ErrImportSourceUnavailable = errors.New("import_source_chunk_unavailable_or_corrupt")

const ImportChunkBytes = 1 << 20

// Bounded initial worker contract. Larger archives require partitioned jobs;
// these limits are explicit rejection, never truncation or advertised scale.
const MaxImportItems = 100000

type ImportSpec struct {
	CollectionMap map[string]string `json:"collection_map,omitempty"` // canonical admission binds source IDs to existing destination IDs

	Key          string    `json:"key"`
	Format       string    `json:"format"` // explicitly mboxrd, eml-tar or eml-zip
	SourceSHA256 string    `json:"source_sha256"`
	SourceSize   int64     `json:"source_size"`
	Folder       string    `json:"folder"`
	Cutoff       time.Time `json:"cutoff"`
	MBOXTimezone string    `json:"mbox_timezone,omitempty"`
	AdmissionRef string    `json:"admission_ref"` // reference supplied by canonical admission; not self-authorization
}

func (s ImportSpec) valid() bool {
	if len(s.CollectionMap) > 200 {
		return false
	}
	used := map[string]bool{}
	for source, dest := range s.CollectionMap {
		if !idPattern.MatchString(source) || !idPattern.MatchString(dest) || used[dest] {
			return false
		}
		used[dest] = true
	}

	if s.Key == "" || len(s.Key) > 200 || len(s.AdmissionRef) == 0 || len(s.AdmissionRef) > 200 || s.SourceSize <= 0 || s.SourceSize > MaxArchiveBytes || len(s.SourceSHA256) != 64 || len(s.Folder) > 1024 || s.Cutoff.IsZero() {
		return false
	}
	if b, e := hex.DecodeString(s.SourceSHA256); e != nil || len(b) != 32 {
		return false
	}
	if s.Format == "mboxrd" {
		_, e := time.LoadLocation(s.MBOXTimezone)
		return s.MBOXTimezone != "" && s.MBOXTimezone != "Local" && e == nil
	}
	return s.Format == "eml-tar" || s.Format == "eml-zip"
}

type ImportSource struct {
	Version        int        `json:"version"`
	Scope          Scope      `json:"scope"`
	Spec           ImportSpec `json:"spec"`
	Chunks         []Object   `json:"chunks"`
	ObservedSHA256 string     `json:"observed_sha256"`
	ObservedSize   int64      `json:"observed_size"`
}

// sourceReader is read-only and generation/hash verifies every loaded chunk.
// It caches one chunk; it never loads the complete master archive in memory.
type sourceReader struct {
	ctx     context.Context
	store   ObjectStore
	source  ImportSource
	cached  int
	data    []byte
	offsets []int64
}

func openImportSource(ctx context.Context, store ObjectStore, source ImportSource) (*sourceReader, error) {
	if source.Version != 1 || !source.Spec.valid() || source.ObservedSHA256 != source.Spec.SourceSHA256 || source.ObservedSize != source.Spec.SourceSize {
		return nil, ErrIntegrity
	}
	r := &sourceReader{ctx: ctx, store: store, source: source, cached: -1}
	var size int64
	for _, o := range source.Chunks {
		if o.Size <= 0 || o.Size > ImportChunkBytes {
			return nil, ErrIntegrity
		}
		r.offsets = append(r.offsets, size)
		size += o.Size
	}
	if size != source.Spec.SourceSize {
		return nil, ErrIntegrity
	}
	return r, nil
}
func (r *sourceReader) ReadAt(p []byte, off int64) (int, error) {
	if off < 0 {
		return 0, fmt.Errorf("negative_source_offset")
	}
	n := 0
	for len(p) > 0 {
		if err := r.ctx.Err(); err != nil {
			return n, err
		}
		if off >= r.source.Spec.SourceSize {
			return n, io.EOF
		}
		index := 0
		for index+1 < len(r.offsets) && r.offsets[index+1] <= off {
			index++
		}
		if r.cached != index {
			b, e := r.store.Get(r.ctx, r.source.Chunks[index])
			if e != nil {
				return n, ErrImportSourceUnavailable
			}
			r.data = b
			r.cached = index
		}
		count := copy(p, r.data[off-r.offsets[index]:])
		if count == 0 {
			return n, ErrIntegrity
		}
		off += int64(count)
		n += count
		p = p[count:]
	}
	return n, nil
}
func sourceDigest(r io.Reader) (string, error) {
	h := sha256.New()
	if _, e := io.Copy(h, r); e != nil {
		return "", e
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
func encoded(v any) []byte {
	b, e := json.Marshal(v)
	if e != nil {
		panic(e)
	}
	return b
}
