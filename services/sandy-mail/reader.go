package mailstore

import (
	"context"
	"errors"
	"net/mail"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// MessageView exposes no object locations or executable HTML. The caller must
// bind scope through canonical identity; the local harness binds a fixed fixture.
type MessageView struct {
	MessageID         string           `json:"message_id"`
	Subject           string           `json:"subject"`
	From              string           `json:"from"`
	To                []string         `json:"to"`
	CC                []string         `json:"cc"`
	EnvelopeFrom      string           `json:"envelope_from"`
	EnvelopeTo        []string         `json:"envelope_to"`
	ReceivedAt        time.Time        `json:"received_at"`
	Text              string           `json:"text"`
	HTMLSourceOnly    bool             `json:"html_source_only"`
	SecurityState     string           `json:"security_state"`
	Flags             []string         `json:"flags"`
	Attachments       []AttachmentView `json:"attachments"`
	ReceiptID         string           `json:"receipt_id"`
	RawSHA256         string           `json:"raw_sha256"`
	RawBytes          int64            `json:"raw_bytes"`
	IntegrityVerified bool             `json:"integrity_verified"`
}
type AttachmentView struct {
	Name            string `json:"name"`
	ContentType     string `json:"content_type"`
	Size            int64  `json:"size"`
	SHA256          string `json:"sha256"`
	ScanState       string `json:"scan_state"`
	DownloadAllowed bool   `json:"download_allowed"`
}

func (s *Service) ViewMessage(ctx context.Context, scope Scope, id string) (MessageView, error) {
	var v MessageView
	if !idPattern.MatchString(id) {
		return v, ErrNotFound
	}
	c, err := s.connection(ctx)
	if err != nil {
		return v, err
	}
	defer c.Release()
	tx, err := scopedTx(ctx, c, scope)
	if err != nil {
		return v, err
	}
	defer tx.Rollback(ctx)
	var raw Object
	var html, receiptSHA string
	var expectedAttachments int
	err = tx.QueryRow(ctx, `SELECT m.message_id::text,m.subject,e.sender,e.recipients,m.received_at,b.text_body,b.html_source,m.security_state,mb.flags,r.receipt_id::text,o.object_key,o.generation,o.sha256,o.size_bytes,r.raw_sha256,r.attachment_count
 FROM core.messages m JOIN core.envelopes e USING(tenant_id,account_id,mailbox_id,message_id)
 JOIN core.bodies b USING(tenant_id,account_id,mailbox_id,message_id)
 JOIN core.memberships mb USING(tenant_id,account_id,mailbox_id,message_id)
 JOIN core.inbound_receipts r USING(tenant_id,account_id,mailbox_id,message_id)
 JOIN core.mime_objects o USING(tenant_id,account_id,mailbox_id,message_id) WHERE m.message_id=$1`, id).Scan(&v.MessageID, &v.Subject, &v.EnvelopeFrom, &v.EnvelopeTo, &v.ReceivedAt, &v.Text, &html, &v.SecurityState, &v.Flags, &v.ReceiptID, &raw.Key, &raw.Generation, &raw.SHA256, &raw.Size, &receiptSHA, &expectedAttachments)
	if errors.Is(err, pgx.ErrNoRows) {
		return MessageView{}, ErrNotFound
	}
	if err != nil {
		return MessageView{}, err
	}
	v.To = []string{}
	v.CC = []string{}
	addresses, err := tx.Query(ctx, `SELECT kind,display_name,address FROM core.recipients WHERE message_id=$1 ORDER BY ordinal`, id)
	if err != nil {
		return MessageView{}, err
	}
	from := []string{}
	for addresses.Next() {
		var kind, name, address string
		if err = addresses.Scan(&kind, &name, &address); err != nil {
			addresses.Close()
			return MessageView{}, err
		}
		display := (&mail.Address{Name: name, Address: address}).String()
		switch kind {
		case "From":
			from = append(from, display)
		case "To":
			v.To = append(v.To, display)
		case "Cc":
			v.CC = append(v.CC, display)
		}
	}
	addresses.Close()
	if err = addresses.Err(); err != nil {
		return MessageView{}, err
	}
	v.From = strings.Join(from, ", ")
	v.Attachments = []AttachmentView{}
	objects := []Object{raw}
	rows, err := tx.Query(ctx, `SELECT filename,content_type,scan_state,object_key,generation,sha256,size_bytes FROM core.attachments WHERE message_id=$1 ORDER BY ordinal`, id)
	if err != nil {
		return MessageView{}, err
	}
	for rows.Next() {
		var a AttachmentView
		var o Object
		if err = rows.Scan(&a.Name, &a.ContentType, &a.ScanState, &o.Key, &o.Generation, &o.SHA256, &o.Size); err != nil {
			rows.Close()
			return MessageView{}, err
		}
		a.Size = o.Size
		a.SHA256 = o.SHA256
		v.Attachments = append(v.Attachments, a)
		objects = append(objects, o)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return MessageView{}, err
	}
	if raw.SHA256 != receiptSHA || len(v.Attachments) != expectedAttachments {
		return MessageView{}, ErrIntegrity
	}
	if err = tx.Commit(ctx); err != nil {
		return MessageView{}, err
	}
	// Never display a success receipt if immutable source verification fails.
	for _, o := range objects {
		if _, err = s.Objects.Get(ctx, o); err != nil {
			return MessageView{}, err
		}
	}
	v.RawSHA256 = raw.SHA256
	v.RawBytes = raw.Size
	v.IntegrityVerified = true
	if v.Text == "" {
		v.Text = html
		v.HTMLSourceOnly = true
	}
	return v, nil
}
