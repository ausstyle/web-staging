package mailstore

import (
	"context"
	"encoding/hex"
	"fmt"
)

// These projections contain no object keys or attachment bytes. MIME originals
// remain private; a production caller needs canonical admission/scan custody.
type DraftAttachmentView struct {
	Name        string `json:"name"`
	ContentType string `json:"content_type"`
	ContentID   string `json:"content_id"`
	Size        int    `json:"size"`
	SHA256      string `json:"sha256"`
}
type DraftMIMEView struct {
	DraftID        string                `json:"draft_id"`
	Version        int64                 `json:"version"`
	Subject        string                `json:"subject"`
	Recipients     []Recipient           `json:"recipients"`
	Headers        map[string][]string   `json:"headers"`
	Text           string                `json:"text"`
	HTMLSourceOnly bool                  `json:"html_source_only"`
	Attachments    []DraftAttachmentView `json:"attachments"`
	SHA256         string                `json:"sha256"`
	Size           int                   `json:"size"`
	Accounting     DraftMIMEAccounting   `json:"accounting"`
}
type DraftMIMEExport struct {
	DraftID    string              `json:"draft_id"`
	Version    int64               `json:"version"`
	MIME       []byte              `json:"mime_base64"`
	SHA256     string              `json:"sha256"`
	Size       int                 `json:"size"`
	Accounting DraftMIMEAccounting `json:"accounting"`
}

func (s *Service) ExportDraftMIME(ctx context.Context, scope Scope, id string) (DraftMIMEExport, error) {
	d, err := s.GetDraft(ctx, scope, id)
	if err != nil {
		return DraftMIMEExport{}, err
	}
	snapshot, err := draftMIMESnapshot(scope, d)
	if err != nil {
		return DraftMIMEExport{}, err
	}
	raw, err := s.readDraftExport(ctx, scope, snapshot)
	if err != nil {
		return DraftMIMEExport{}, err
	}
	return DraftMIMEExport{d.DraftID, d.Version, raw, digest(raw), len(raw), draftAccounting(d)}, nil
}
func (s *Service) ViewDraftMIME(ctx context.Context, scope Scope, id string) (DraftMIMEView, error) {
	exported, err := s.ExportDraftMIME(ctx, scope, id)
	if err != nil {
		return DraftMIMEView{}, err
	}
	p, err := Parse(exported.MIME)
	if err != nil {
		return DraftMIMEView{}, err
	}
	v := DraftMIMEView{DraftID: id, Version: exported.Version, Subject: p.Subject, Recipients: p.Recipients, Headers: p.Headers, Text: p.Text, Attachments: []DraftAttachmentView{}, SHA256: exported.SHA256, Size: exported.Size, Accounting: exported.Accounting}
	if v.Text == "" {
		v.Text = p.HTML
		v.HTMLSourceOnly = true
	}
	for _, a := range p.Attachments {
		v.Attachments = append(v.Attachments, DraftAttachmentView{a.Name, a.Type, a.ContentID, len(a.Data), digest(a.Data)})
	}
	return v, nil
}

const MaxLocalDraftMIMEBytes = 256 << 10

// Decode/validate before any local mutation. This bound intentionally does not
// change the existing 512 KiB development transport or production file limits.
func validateLocalDraftMIME(raw []byte) error {
	if len(raw) == 0 || len(raw) > MaxLocalDraftMIMEBytes {
		return ErrEditLimit
	}
	if _, err := mimeDraftProjection(raw); err != nil {
		return fmt.Errorf("%w: mime", ErrEditInvalid)
	}
	return nil
}

// Hash shape helper shared by the source-only commit protocol and export checks.
func validSHA256(value string) bool {
	b, err := hex.DecodeString(value)
	return err == nil && len(b) == 32 && value == hex.EncodeToString(b)
}
