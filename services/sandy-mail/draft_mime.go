package mailstore

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

var ErrDraftMIMEEditRequired = errors.New("mime_draft_requires_full_mime_edit")

// Accounting distinguishes an original preserved byte-for-byte from a MIME
// serialization of a previously plain-text-only draft. Neither authorizes send.
type DraftMIMEAccounting struct {
	Version                int      `json:"version"`
	Source                 string   `json:"source"`
	OriginalBytesPreserved bool     `json:"original_bytes_preserved"`
	Changes                []string `json:"changes"`
}

func draftAccounting(d Draft) DraftMIMEAccounting {
	if d.MIME != nil {
		return DraftMIMEAccounting{1, "mime_original", true, []string{}}
	}
	return DraftMIMEAccounting{1, "composed_text", false, []string{"generated_mime_headers_and_quoted_printable_utf8", "date_from_draft_created_at", "from_and_message_id_absent_in_source"}}
}
func draftPrefix(scope Scope) string {
	return "mail/v1/" + scope.Tenant + "/" + scope.Account + "/" + scope.Mailbox + "/"
}
func validDraftObject(scope Scope, o Object) bool {
	return scope.valid() && strings.HasPrefix(o.Key, draftPrefix(scope)) && validKey(o.Key) && o.Generation > 0 && o.Size > 0 && o.Size <= MaxMessageBytes && len(o.SHA256) == 64
}
func mimeDraftProjection(raw []byte) (Draft, error) {
	p, err := Parse(raw)
	if err != nil {
		return Draft{}, err
	}
	to := []string{}
	for _, r := range p.Recipients {
		if r.Kind == "To" {
			to = append(to, (&mail.Address{Name: r.Name, Address: r.Address}).String())
		}
	}
	return Draft{Subject: p.Subject, To: to, Text: strings.TrimSuffix(p.Text, "\n")}, nil
}
func draftProjectionMatches(d Draft, raw []byte) bool {
	p, err := mimeDraftProjection(raw)
	return err == nil && p.Subject == d.Subject && bytes.Equal(encoded(p.To), encoded(d.To)) && p.Text == d.Text
}

// Fold encoded words at UTF-8 boundaries, including long ASCII subjects.
func encodedDraftSubject(value string) string {
	if value == "" {
		return ""
	}
	words := []string{}
	for len(value) > 0 {
		n := len(value)
		if n > 42 {
			n = 42
			for !utf8.RuneStart(value[n]) {
				n--
			}
		}
		words = append(words, "=?utf-8?B?"+base64.StdEncoding.EncodeToString([]byte(value[:n]))+"?=")
		value = value[n:]
	}
	return strings.Join(words, "\r\n ")
}

// GenerateDraftMIME serializes only source fields; no sender identity is invented.
// Explicit QP octets preserve even mixed CRLF/LF bodies exactly.
func GenerateDraftMIME(d Draft) ([]byte, error) {
	if !validPortableDraft(d) || d.MIME != nil {
		return nil, ErrEditInvalid
	}
	var b bytes.Buffer
	fmt.Fprintf(&b, "MIME-Version: 1.0\r\nX-Unsent: 1\r\nDate: %s\r\nSubject: %s\r\n", d.CreatedAt.Format(time.RFC1123Z), encodedDraftSubject(d.Subject))
	if len(d.To) > 0 {
		fmt.Fprintf(&b, "To: %s\r\n", strings.Join(d.To, ",\r\n "))
	}
	b.WriteString("Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n")
	// Encode CR/LF explicitly so a mixed-line-ending source is not normalized.
	const hex = "0123456789ABCDEF"
	line := 0
	for _, v := range []byte(d.Text) {
		if line+3 > 72 {
			b.WriteString("=\r\n")
			line = 0
		}
		b.WriteByte('=')
		b.WriteByte(hex[v>>4])
		b.WriteByte(hex[v&15])
		line += 3
	}
	return b.Bytes(), nil
}

// SaveMIMEDraft is an internal, admission-bound worker primitive. MIME bytes are
// immutable; rich edits replace the whole MIME with CAS and an atomic SQL receipt.
// Upload-before-commit can leave an unreferenced object, never a dangling row.
// Retrying the same identity reuses the content-addressed object. No cleanup is
// destructive or automatic. No scanner verdict or delivery authority is implied.
func (s *Service) SaveMIMEDraft(ctx context.Context, scope Scope, who EditIdentity, id string, expected int64, raw []byte) (EditReceipt, error) {
	if !scope.valid() || !idPattern.MatchString(id) || !idPattern.MatchString(who.Key) || len(who.Actor) == 0 || len(who.Actor) > 200 || expected < 0 || expected > 1<<50 {
		return EditReceipt{}, ErrEditInvalid
	}
	d, err := mimeDraftProjection(raw)
	if err != nil {
		return EditReceipt{}, err
	}
	d.DraftID = id
	d.Version = expected + 1
	d.CreatedAt = time.Now().UTC()
	d.UpdatedAt = d.CreatedAt
	if !validPortableDraft(d) {
		return EditReceipt{}, ErrEditInvalid
	}
	o, err := s.Objects.Put(ctx, draftPrefix(scope)+"drafts/"+id+"/"+digest(raw)+".eml", raw)
	if err != nil {
		return EditReceipt{}, err
	}
	if !validDraftObject(scope, o) {
		return EditReceipt{}, ErrIntegrity
	}
	if _, err = s.Objects.Get(ctx, o); err != nil {
		return EditReceipt{}, err
	}
	if err = s.checkpoint("draft_after_mime_object"); err != nil {
		return EditReceipt{}, err
	}
	input := struct {
		ID       string
		Expected int64
		SHA256   string
	}{id, expected, digest(raw)}
	return s.applyEdit(ctx, scope, who, "mail.drafts.mime.save", input, func(tx pgx.Tx) (string, int64, error) {
		if err := lockEdit(ctx, tx, scope, "drafts"); err != nil {
			return "", 0, err
		}
		var revision int64
		err := tx.QueryRow(ctx, `SELECT revision FROM core.mail_drafts WHERE draft_id=$1 FOR UPDATE`, id).Scan(&revision)
		if errors.Is(err, pgx.ErrNoRows) {
			if expected != 0 {
				return "", 0, ErrEditStale
			}
			var n int
			if err = tx.QueryRow(ctx, `SELECT count(*) FROM core.mail_drafts`).Scan(&n); err != nil {
				return "", 0, err
			}
			if n >= 1000 {
				return "", 0, ErrEditLimit
			}
			_, err = tx.Exec(ctx, `INSERT INTO core.mail_drafts(tenant_id,account_id,mailbox_id,draft_id,subject,recipients,body_text,revision,mime_original) VALUES($1,$2,$3,$4,$5,$6,$7,1,$8)`, scope.Tenant, scope.Account, scope.Mailbox, id, d.Subject, d.To, d.Text, encoded(o))
			return id, 1, err
		}
		if err != nil {
			return "", 0, err
		}
		if revision != expected {
			return "", 0, ErrEditStale
		}
		_, err = tx.Exec(ctx, `UPDATE core.mail_drafts SET subject=$2,recipients=$3,body_text=$4,mime_original=$5,revision=revision+1,updated_at=clock_timestamp() WHERE draft_id=$1`, id, d.Subject, d.To, d.Text, encoded(o))
		return id, revision + 1, err
	})
}
func (s *Service) ReadDraftMIME(ctx context.Context, scope Scope, id string) ([]byte, error) {
	d, err := s.GetDraft(ctx, scope, id)
	if err != nil {
		return nil, err
	}
	if d.MIME == nil {
		return GenerateDraftMIME(d)
	}
	if !validDraftObject(scope, *d.MIME) {
		return nil, ErrIntegrity
	}
	return s.Objects.Get(ctx, *d.MIME)
}
func (s *Service) draftMIMEExport(ctx context.Context, scope Scope, d Draft) (ExportItem, error) {
	var raw []byte
	var err error
	if d.MIME == nil {
		raw, err = GenerateDraftMIME(d)
	} else if validDraftObject(scope, *d.MIME) {
		raw, err = s.Objects.Get(ctx, *d.MIME)
	} else {
		err = ErrIntegrity
	}
	if err != nil {
		return ExportItem{}, err
	}
	if !draftProjectionMatches(d, raw) {
		return ExportItem{}, ErrIntegrity
	}
	accounting := draftAccounting(d)
	o := Object{SHA256: digest(raw), Size: int64(len(raw))}
	if d.MIME != nil {
		o = *d.MIME
	}
	return ExportItem{Draft: &d, DraftMIME: &accounting, MessageID: d.DraftID, Subject: d.Subject, Path: "drafts/" + d.DraftID + ".draft.eml", ReceivedAt: d.UpdatedAt, Raw: o}, nil
}
func (s *Service) readDraftExport(ctx context.Context, scope Scope, item ExportItem) ([]byte, error) {
	if item.Draft == nil || item.DraftMIME == nil || !validPortableDraft(*item.Draft) || item.Path != "drafts/"+item.Draft.DraftID+".draft.eml" || !bytes.Equal(encoded(item.DraftMIME), encoded(draftAccounting(*item.Draft))) {
		return nil, ErrIntegrity
	}
	var raw []byte
	var err error
	if item.Draft.MIME == nil {
		raw, err = GenerateDraftMIME(*item.Draft)
	} else {
		if !validDraftObject(scope, *item.Draft.MIME) {
			return nil, ErrIntegrity
		}
		raw, err = s.Objects.Get(ctx, *item.Draft.MIME)
	}
	if err != nil {
		return nil, err
	}
	return checked(item.Raw, raw)
}
func (i *importSession) portableDraft(item importItem, raw []byte) (Draft, error) {
	var d Draft
	if m, ok := item.Properties["portable_metadata"]; ok {
		var metadata ExportItem
		if json.Unmarshal(encoded(m), &metadata) != nil || metadata.Draft == nil || metadata.DraftMIME == nil {
			return d, ErrIntegrity
		}
		d = *metadata.Draft
		if !validPortableDraft(d) || !draftProjectionMatches(d, raw) || !bytes.Equal(encoded(metadata.DraftMIME), encoded(draftAccounting(d))) {
			return Draft{}, ErrIntegrity
		}
		if d.MIME != nil {
			if metadata.Raw.SHA256 != d.MIME.SHA256 || metadata.Raw.Size != d.MIME.Size {
				return Draft{}, ErrIntegrity
			}
			d.MIME = &item.Object
		}
	} else {
		if json.Unmarshal(raw, &d) != nil || d.MIME != nil {
			return Draft{}, ErrIntegrity
		}
	}
	if !validPortableDraft(d) {
		return Draft{}, ErrIntegrity
	}
	return d, nil
}
