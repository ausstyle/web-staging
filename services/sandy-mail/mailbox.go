package mailstore

import (
	"archive/tar"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"time"

	"github.com/jackc/pgx/v5"
)

// Cursor preserves deterministic ordering even when many messages have the same
// timestamp. Callers authenticate the scope before invoking any mailbox method.
type Cursor struct {
	ReceivedAt time.Time `json:"received_at"`
	MessageID  string    `json:"message_id"`
}
type MailboxItem struct {
	MessageID     string    `json:"message_id"`
	Subject       string    `json:"subject"`
	ReceivedAt    time.Time `json:"received_at"`
	SecurityState string    `json:"security_state"`
	Flags         []string  `json:"flags"`
}

func (s *Service) List(ctx context.Context, scope Scope, query string, after *Cursor, limit int) ([]MailboxItem, error) {
	if limit < 1 || limit > 100 || len(query) > 500 {
		return nil, fmt.Errorf("invalid_query_bounds")
	}
	if after != nil && (after.ReceivedAt.IsZero() || !idPattern.MatchString(after.MessageID)) {
		return nil, fmt.Errorf("invalid_cursor")
	}
	c, err := s.connection(ctx)
	if err != nil {
		return nil, err
	}
	defer c.Release()
	tx, err := scopedTx(ctx, c, scope)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var timestamp *time.Time
	var id *string
	if after != nil {
		timestamp = &after.ReceivedAt
		id = &after.MessageID
	}
	rows, err := tx.Query(ctx, `SELECT m.message_id::text,m.subject,m.received_at,m.security_state,mb.flags
 FROM core.messages m JOIN core.bodies b USING(tenant_id,account_id,mailbox_id,message_id)
 JOIN core.memberships mb USING(tenant_id,account_id,mailbox_id,message_id)
 WHERE ($1='' OR to_tsvector('simple',m.subject) @@ websearch_to_tsquery('simple',$1) OR to_tsvector('simple',b.text_body) @@ websearch_to_tsquery('simple',$1))
 AND ($2::timestamptz IS NULL OR (m.received_at,m.message_id)<($2::timestamptz,$3::uuid))
 ORDER BY m.received_at DESC,m.message_id DESC LIMIT $4`, query, timestamp, id, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []MailboxItem{}
	for rows.Next() {
		var item MailboxItem
		if err = rows.Scan(&item.MessageID, &item.Subject, &item.ReceivedAt, &item.SecurityState, &item.Flags); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	return items, tx.Commit(ctx)
}

type ExportItem struct {
	MessageID         string            `json:"message_id"`
	InternetMessageID string            `json:"internet_message_id"`
	Subject           string            `json:"subject"`
	Path              string            `json:"path"`
	ReceivedAt        time.Time         `json:"received_at"`
	SentAt            *time.Time        `json:"sent_at"`
	Flags             []string          `json:"flags"`
	SecurityState     string            `json:"security_state"`
	Headers           json.RawMessage   `json:"headers"`
	Envelope          json.RawMessage   `json:"envelope"`
	Raw               Object            `json:"raw"`
	Attachments       []Object          `json:"attachments"`
	ImportOrigins     []json.RawMessage `json:"import_origins,omitempty"`
}
type ExportManifest struct {
	Version           int               `json:"version"`
	ExportJobID       string            `json:"export_job_id,omitempty"`
	PartNumber        int64             `json:"part_number,omitempty"`
	ExpectedMessages  int               `json:"expected_messages,omitempty"`
	Exclusions        []ExportExclusion `json:"exclusions,omitempty"`
	Scope             Scope             `json:"scope"`
	MailboxName       string            `json:"mailbox_name"`
	SnapshotAt        time.Time         `json:"snapshot_at"`
	PendingIngestions int               `json:"pending_ingestions"`
	Complete          bool              `json:"complete"`
	Messages          []ExportItem      `json:"messages"`
	Limit             int               `json:"prototype_message_limit"`
}

// ExportMailbox is a bounded operator prototype: frozen SQL snapshot, original
// EMLs, JSON metadata and hashes. It never mutates source or releases quarantine.
// Full-account self-service export still requires canonical reauth/MFA, durable
// resumable jobs, encrypted output, quota/retention controls and large-scale tests.
func (s *Service) ExportMailbox(ctx context.Context, scope Scope, output io.Writer, limit int) (ExportManifest, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	var manifest ExportManifest
	if limit < 1 || limit > 1000 {
		return manifest, fmt.Errorf("export_limit_must_be_1_to_1000")
	}
	c, err := s.connection(ctx)
	if err != nil {
		return manifest, err
	}
	defer c.Release()
	tx, err := c.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return manifest, err
	}
	defer tx.Rollback(ctx)
	if !scope.valid() {
		return manifest, fmt.Errorf("invalid_scope")
	}
	_, err = tx.Exec(ctx, `SELECT set_config('mail.tenant_id',$1,true),set_config('mail.account_id',$2,true),set_config('mail.mailbox_id',$3,true)`, scope.Tenant, scope.Account, scope.Mailbox)
	if err != nil {
		return manifest, err
	}
	manifest = ExportManifest{Version: 1, Scope: scope, Limit: limit, Messages: []ExportItem{}}
	err = tx.QueryRow(ctx, "SELECT name,transaction_timestamp() FROM core.mailboxes").Scan(&manifest.MailboxName, &manifest.SnapshotAt)
	if err == pgx.ErrNoRows {
		return manifest, ErrNotFound
	}
	if err != nil {
		return manifest, err
	}
	if err = tx.QueryRow(ctx, "SELECT count(*) FROM core.ingestions WHERE state='pending'").Scan(&manifest.PendingIngestions); err != nil {
		return manifest, err
	}
	rows, err := tx.Query(ctx, `SELECT m.message_id::text,m.internet_message_id,m.subject,m.received_at,m.sent_at,mb.flags,m.security_state,m.headers,
 json_build_object('from',e.sender,'to',e.recipients),o.object_key,o.generation,o.sha256,o.size_bytes
 FROM core.messages m JOIN core.memberships mb USING(tenant_id,account_id,mailbox_id,message_id)
 JOIN core.envelopes e USING(tenant_id,account_id,mailbox_id,message_id)
 JOIN core.mime_objects o USING(tenant_id,account_id,mailbox_id,message_id)
 ORDER BY m.received_at,m.message_id LIMIT $1`, limit+1)
	if err != nil {
		return manifest, err
	}
	for rows.Next() {
		var item ExportItem
		if err = rows.Scan(&item.MessageID, &item.InternetMessageID, &item.Subject, &item.ReceivedAt, &item.SentAt, &item.Flags, &item.SecurityState, &item.Headers, &item.Envelope, &item.Raw.Key, &item.Raw.Generation, &item.Raw.SHA256, &item.Raw.Size); err != nil {
			rows.Close()
			return manifest, err
		}
		item.Path = "messages/" + item.MessageID + ".eml"
		manifest.Messages = append(manifest.Messages, item)
	}
	rows.Close()
	if rows.Err() != nil {
		return manifest, rows.Err()
	}
	if len(manifest.Messages) > limit {
		return manifest, fmt.Errorf("export_requires_resumable_job_no_partial_success")
	}
	tw := tar.NewWriter(output)
	// Do not close a partial TAR on error: no final manifest/success is emitted.
	for i := range manifest.Messages {
		item := &manifest.Messages[i]
		ar, err := tx.Query(ctx, "SELECT object_key,generation,sha256,size_bytes FROM core.attachments WHERE message_id=$1 ORDER BY ordinal", item.MessageID)
		if err != nil {
			return manifest, err
		}
		for ar.Next() {
			var a Object
			if err = ar.Scan(&a.Key, &a.Generation, &a.SHA256, &a.Size); err != nil {
				ar.Close()
				return manifest, err
			}
			item.Attachments = append(item.Attachments, a)
		}
		ar.Close()
		if ar.Err() != nil {
			return manifest, ar.Err()
		}
		origins, err := tx.Query(ctx, `SELECT jsonb_build_object('job_id',j.job_id,'source_sha256',j.spec->>'source_sha256','source_size',j.spec->'source_size','format',j.spec->>'format','source_path',i.source_path,'source_folder',i.source_folder,'flags',i.flags,'properties',i.properties) FROM core.mail_import_items i JOIN core.mail_import_jobs j USING(tenant_id,account_id,mailbox_id,job_id) WHERE i.message_id=$1 AND i.state='VERIFIED' ORDER BY i.job_id,i.ordinal`, item.MessageID)
		if err != nil {
			return manifest, err
		}
		for origins.Next() {
			var origin []byte
			if err = origins.Scan(&origin); err != nil {
				origins.Close()
				return manifest, err
			}
			item.ImportOrigins = append(item.ImportOrigins, json.RawMessage(origin))
		}
		origins.Close()
		if err = origins.Err(); err != nil {
			return manifest, err
		}
		for _, a := range item.Attachments {
			if _, err = s.Objects.Get(ctx, a); err != nil {
				return manifest, err
			}
		}
		raw, err := s.Objects.Get(ctx, item.Raw)
		if err != nil {
			return manifest, err
		}
		if err = tw.WriteHeader(&tar.Header{Name: item.Path, Mode: 0600, Size: int64(len(raw)), ModTime: item.ReceivedAt}); err != nil {
			return manifest, err
		}
		if _, err = tw.Write(raw); err != nil {
			return manifest, err
		}
	}
	// Commit the read snapshot before writing the final completeness marker.
	if err = tx.Commit(ctx); err != nil {
		return manifest, err
	}
	manifest.Complete = true
	b, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return ExportManifest{}, err
	}
	if err = tw.WriteHeader(&tar.Header{Name: "manifest.json", Mode: 0600, Size: int64(len(b)), ModTime: manifest.SnapshotAt}); err != nil {
		manifest.Complete = false
		return manifest, err
	}
	if _, err = tw.Write(b); err != nil {
		manifest.Complete = false
		return manifest, err
	}
	if err = tw.Close(); err != nil {
		manifest.Complete = false
		return manifest, err
	}
	return manifest, nil
}
