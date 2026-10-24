package mailstore

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"strings"
)

type MBOXExportRecord struct {
	Path         string `json:"path"`
	Offset       int64  `json:"offset"`
	EncodedBytes int64  `json:"encoded_bytes"`
	RawSHA256    string `json:"raw_sha256"`
	RawSize      int64  `json:"raw_size"`
}
type MBOXExportManifest struct {
	Version  int                `json:"version"`
	Dialect  string             `json:"dialect"`
	Timezone string             `json:"timezone"`
	Complete bool               `json:"complete"`
	SHA256   string             `json:"sha256"`
	Size     int64              `json:"size"`
	Records  []MBOXExportRecord `json:"records"`
	Metadata ExportManifest     `json:"metadata"`
}

// ExportMailboxMBOXRD streams the same frozen SQL snapshot as EML export, with
// a required portable metadata result. It never treats MBOX alone as sufficient
// for flags, hierarchy, timestamps or import provenance. Still a bounded worker
// primitive; encrypted resumable customer export delivery is a separate layer.
func (s *Service) ExportMailboxMBOXRD(ctx context.Context, scope Scope, out io.Writer, limit int) (MBOXExportManifest, error) {
	result := MBOXExportManifest{Version: 1, Dialect: "mboxrd", Timezone: "UTC", Records: []MBOXExportRecord{}}
	child, cancel := context.WithCancel(ctx)
	defer cancel()
	reader, writer := io.Pipe()
	defer reader.Close()
	done := make(chan error, 1)
	go func() { _, e := s.ExportMailbox(child, scope, writer, limit); writer.CloseWithError(e); done <- e }()
	hash := sha256.New()
	destination := io.MultiWriter(out, hash)
	var conversionError error
	preview, e := InspectTAR(reader, func(item ArchiveItem, raw []byte) error {
		if item.Collections != nil {
			return nil
		} // inventory remains in companion metadata
		if item.Draft != nil {
			conversionError = fmt.Errorf("drafts_require_portable_archive_not_mbox")
			return conversionError
		}
		parsed, err := Parse(raw)
		if err != nil {
			return err
		}
		for name := range parsed.Headers {
			if strings.EqualFold(name, "Content-Length") {
				return fmt.Errorf("mbox_content_length_dialect_unsupported")
			}
		}
		sender := "MAILER-DAEMON"
		for _, a := range parsed.Recipients {
			if a.Kind == "From" {
				sender = a.Address
				break
			}
		}
		size, err := WriteMBOXRD(destination, raw, sender, item.SourceTime)
		if err != nil {
			return err
		}
		result.Records = append(result.Records, MBOXExportRecord{item.Path, result.Size, size, item.SHA256, item.Size})
		result.Size += size
		return nil
	})
	if e != nil {
		cancel()
		reader.CloseWithError(e)
		<-done
		if conversionError != nil {
			return result, conversionError
		}
		return result, e
	}
	if e = <-done; e != nil {
		return result, e
	}
	if preview.State != "READY" || preview.PortableMetadata == nil {
		return result, fmt.Errorf("mbox_export_source_snapshot_requires_action")
	}
	result.Metadata = *preview.PortableMetadata
	result.SHA256 = hex.EncodeToString(hash.Sum(nil))
	result.Complete = true
	return result, nil
}
