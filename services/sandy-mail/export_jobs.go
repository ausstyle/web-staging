package mailstore

import (
	"archive/tar"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"io"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

var ErrExportAdmission = errors.New("canonical_export_admission_required")

// The canonical API owner supplies this adapter. It must bind the real actor,
// mailbox ownership, fresh reauth/MFA, purpose, consent, retention/scanner policy,
// quota and revocation. There is NO default/fixture implementation in production.
type ExportAuthority interface {
	CheckExport(context.Context, Scope, ExportSpec, string) error
}
type ExportSpec struct {
	Key               string    `json:"key"`
	AdmissionRef      string    `json:"admission_ref"`
	ExpiresAt         time.Time `json:"expires_at"`
	PartitionMessages int       `json:"partition_messages"`
	ExceptionPolicy   string    `json:"exception_policy"` // stop (default) or include-report, explicitly admitted
}

func (s ExportSpec) valid(now time.Time) bool {
	return s.Key != "" && len(s.Key) <= 190 && s.AdmissionRef != "" && len(s.AdmissionRef) <= 200 && s.ExpiresAt.After(now) && !s.ExpiresAt.After(now.Add(7*24*time.Hour)) && s.PartitionMessages >= 1 && s.PartitionMessages <= 100 && (s.ExceptionPolicy == "stop" || s.ExceptionPolicy == "include-report")
}

type ExportJob struct {
	ExpectedDrafts    int64      `json:"expected_drafts"`
	ID                string     `json:"job_id"`
	Spec              ExportSpec `json:"spec"`
	SnapshotAt        time.Time  `json:"snapshot_at"`
	MailboxName       string     `json:"mailbox_name"`
	Expected          int64      `json:"expected_messages"`
	PendingIngestions int64      `json:"pending_ingestions"`
	State             string     `json:"state"`
	Cursor            int64      `json:"cursor"`
	VerifiedPart      int64      `json:"verified_part"`
	VerifiedChain     string     `json:"verified_chain"`
}
type exportSession struct {
	*importSession
	job       ExportJob
	authority ExportAuthority
}

func (s *Service) exportSession(ctx context.Context, scope Scope, key string, authority ExportAuthority) (*exportSession, error) {
	if authority == nil {
		return nil, ErrExportAdmission
	}
	// Ownership is checked before any job lookup, including unknown keys.
	if err := authority.CheckExport(ctx, scope, ExportSpec{Key: key}, "lookup"); err != nil {
		return nil, ErrExportAdmission
	}
	// Reuse only the internal scoped connection/transaction helper, not an import
	// job or generic scheduler. Prefix prevents import/export lock collision.
	base, e := s.importSession(ctx, scope, "export:"+key)
	if e != nil {
		return nil, e
	}
	return &exportSession{importSession: base, authority: authority}, nil
}
func (e *exportSession) check(ctx context.Context, purpose string) error {
	if !time.Now().Before(e.job.Spec.ExpiresAt) {
		return fmt.Errorf("export_expired")
	}
	if err := e.authority.CheckExport(ctx, e.scope, e.job.Spec, purpose); err != nil {
		return ErrExportAdmission
	}
	return nil
}
func (e *exportSession) load(ctx context.Context, key string) error {
	return e.tx(ctx, func(tx pgx.Tx) error {
		var spec []byte
		err := tx.QueryRow(ctx, "SELECT job_id::text,spec,snapshot_at,mailbox_name,expected_messages,pending_ingestions,state,cursor,verified_part,verified_chain FROM core.mail_export_jobs WHERE job_key=$1", key).Scan(&e.job.ID, &spec, &e.job.SnapshotAt, &e.job.MailboxName, &e.job.Expected, &e.job.PendingIngestions, &e.job.State, &e.job.Cursor, &e.job.VerifiedPart, &e.job.VerifiedChain)
		if err == pgx.ErrNoRows {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if err = json.Unmarshal(spec, &e.job.Spec); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT count(*) FROM core.mail_export_items WHERE job_id=$1 AND snapshot->'draft' IS NOT NULL`, e.job.ID).Scan(&e.job.ExpectedDrafts)
	})
}
func (e *exportSession) prefix() string {
	return "mail/v1/" + e.scope.Tenant + "/" + e.scope.Account + "/" + e.scope.Mailbox + "/exports/" + e.job.ID
}

// CreateExport freezes metadata/flags/origin and object generations in one
// repeatable-read transaction. Resume never reselects a moving live mailbox.
func (s *Service) CreateExport(ctx context.Context, scope Scope, spec ExportSpec, authority ExportAuthority) (ExportJob, error) {
	if !spec.valid(time.Now()) {
		return ExportJob{}, fmt.Errorf("invalid_export_spec")
	}
	session, err := s.exportSession(ctx, scope, spec.Key, authority)
	if err != nil {
		return ExportJob{}, err
	}
	defer session.close()
	session.job.Spec = spec
	if err = session.check(ctx, "create"); err != nil {
		return ExportJob{}, err
	}
	tx, err := session.conn.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return ExportJob{}, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT set_config('mail.tenant_id',$1,true),set_config('mail.account_id',$2,true),set_config('mail.mailbox_id',$3,true),set_config('statement_timeout','60000',true)`, scope.Tenant, scope.Account, scope.Mailbox); err != nil {
		return ExportJob{}, err
	}
	var old string
	err = tx.QueryRow(ctx, "SELECT input_sha256 FROM core.mail_export_jobs WHERE job_key=$1", spec.Key).Scan(&old)
	if err == nil {
		if old != digest(encoded(spec)) {
			return ExportJob{}, ErrConflict
		}
		if err = tx.Commit(ctx); err != nil {
			return ExportJob{}, err
		}
		err = session.load(ctx, spec.Key)
		return session.job, err
	}
	if err != pgx.ErrNoRows {
		return ExportJob{}, err
	}
	job := ExportJob{ID: uuid(), Spec: spec, State: "BUILDING"}
	if err = tx.QueryRow(ctx, "SELECT name,transaction_timestamp() FROM core.mailboxes").Scan(&job.MailboxName, &job.SnapshotAt); err == pgx.ErrNoRows {
		return job, ErrNotFound
	} else if err != nil {
		return job, err
	}
	if err = tx.QueryRow(ctx, "SELECT (SELECT count(*) FROM core.messages),(SELECT count(*) FROM core.ingestions WHERE state='pending')").Scan(&job.Expected, &job.PendingIngestions); err != nil {
		return job, err
	}
	drafts, err := snapshotDrafts(ctx, tx)
	if err != nil {
		return job, err
	}
	job.ExpectedDrafts = int64(len(drafts))
	messageCount := job.Expected
	job.Expected += int64(len(drafts))
	if job.Expected > 1000000 {
		return job, fmt.Errorf("export_snapshot_partition_required")
	}
	if job.PendingIngestions > 0 && spec.ExceptionPolicy == "stop" {
		job.State = "NEEDS_ACTION"
	}
	_, err = tx.Exec(ctx, `INSERT INTO core.mail_export_jobs(tenant_id,account_id,mailbox_id,job_id,job_key,input_sha256,spec,snapshot_at,mailbox_name,expected_messages,pending_ingestions,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, scope.Tenant, scope.Account, scope.Mailbox, job.ID, spec.Key, digest(encoded(spec)), encoded(spec), job.SnapshotAt, job.MailboxName, job.Expected, job.PendingIngestions, job.State)
	if err != nil {
		return job, err
	}
	// LEFT JOIN ensures missing related facts cannot silently remove source items.
	_, err = tx.Exec(ctx, `INSERT INTO core.mail_export_items(tenant_id,account_id,mailbox_id,job_id,ordinal,snapshot)
 SELECT m.tenant_id,m.account_id,m.mailbox_id,$1,row_number() OVER(ORDER BY m.received_at,m.message_id),jsonb_build_object(
 'message_id',m.message_id,'internet_message_id',m.internet_message_id,'subject',m.subject,'path','messages/'||m.message_id::text||'.eml',
 'received_at',m.received_at,'sent_at',m.sent_at,'flags',mb.flags,'security_state',m.security_state,'headers',m.headers,
 'envelope',jsonb_build_object('from',e.sender,'to',e.recipients),
 'organization',(SELECT jsonb_build_object('version',org.revision,'folder',(SELECT jsonb_build_object('collection_id',c.collection_id,'kind',c.kind,'name',c.name) FROM core.mail_collections c WHERE (c.tenant_id,c.account_id,c.mailbox_id,c.collection_id)=(m.tenant_id,m.account_id,m.mailbox_id,org.folder_id)),'labels',coalesce((SELECT jsonb_agg(jsonb_build_object('collection_id',c.collection_id,'kind',c.kind,'name',c.name) ORDER BY c.collection_id) FROM core.mail_message_labels ml JOIN core.mail_collections c ON (c.tenant_id,c.account_id,c.mailbox_id,c.collection_id)=(ml.tenant_id,ml.account_id,ml.mailbox_id,ml.label_id) WHERE (ml.tenant_id,ml.account_id,ml.mailbox_id,ml.message_id)=(m.tenant_id,m.account_id,m.mailbox_id,m.message_id) AND ml.active),'[]'::jsonb)) FROM core.mail_message_organization org WHERE (org.tenant_id,org.account_id,org.mailbox_id,org.message_id)=(m.tenant_id,m.account_id,m.mailbox_id,m.message_id)),
 'raw',jsonb_build_object('key',o.object_key,'generation',o.generation,'sha256',o.sha256,'size',o.size_bytes),
 'attachments',coalesce((SELECT jsonb_agg(jsonb_build_object('key',a.object_key,'generation',a.generation,'sha256',a.sha256,'size',a.size_bytes) ORDER BY a.ordinal) FROM core.attachments a WHERE (a.tenant_id,a.account_id,a.mailbox_id,a.message_id)=(m.tenant_id,m.account_id,m.mailbox_id,m.message_id)),'[]'::jsonb),
 'import_origins',coalesce((SELECT jsonb_agg(jsonb_build_object('job_id',j.job_id,'source_sha256',j.spec->>'source_sha256','format',j.spec->>'format','source_path',i.source_path,'source_folder',i.source_folder,'flags',i.flags,'properties',i.properties) ORDER BY i.job_id,i.ordinal) FROM core.mail_import_items i JOIN core.mail_import_jobs j USING(tenant_id,account_id,mailbox_id,job_id) WHERE (i.tenant_id,i.account_id,i.mailbox_id,i.message_id)=(m.tenant_id,m.account_id,m.mailbox_id,m.message_id) AND i.state='VERIFIED'),'[]'::jsonb))
 FROM core.messages m LEFT JOIN core.memberships mb USING(tenant_id,account_id,mailbox_id,message_id) LEFT JOIN core.envelopes e USING(tenant_id,account_id,mailbox_id,message_id) LEFT JOIN core.mime_objects o USING(tenant_id,account_id,mailbox_id,message_id)`, job.ID)
	if err != nil {
		return job, err
	}
	for n, item := range drafts {
		if _, err = tx.Exec(ctx, `INSERT INTO core.mail_export_items(tenant_id,account_id,mailbox_id,job_id,ordinal,snapshot) VALUES($1,$2,$3,$4,$5,$6)`, scope.Tenant, scope.Account, scope.Mailbox, job.ID, messageCount+int64(n)+1, encoded(item)); err != nil {
			return job, err
		}
	}
	_, err = tx.Exec(ctx, `INSERT INTO core.mail_export_exceptions(tenant_id,account_id,mailbox_id,job_id,source_key,code,retryable,evidence) SELECT tenant_id,account_id,mailbox_id,$1,'pending:'||delivery_id,'pending_ingestion_at_snapshot',false,jsonb_build_object('delivery_id',delivery_id,'raw_sha256',raw_sha256,'raw_size',raw_size) FROM core.ingestions WHERE state='pending'`, job.ID)
	if err != nil {
		return job, err
	}
	if err = session.check(ctx, "create_commit"); err != nil {
		return job, err
	}
	return job, tx.Commit(ctx)
}

type ExportExclusion struct {
	Ordinal   int64  `json:"ordinal"`
	MessageID string `json:"message_id"`
	Code      string `json:"code"`
	Retryable bool   `json:"retryable"`
}
type ExportPart struct {
	Version    int               `json:"version"`
	Scope      Scope             `json:"scope"`
	JobID      string            `json:"job_id"`
	Number     int64             `json:"number"`
	First      int64             `json:"first"`
	Last       int64             `json:"last"`
	Size       int64             `json:"size"`
	SHA256     string            `json:"sha256"`
	Chunks     []Object          `json:"chunks"`
	Exported   int64             `json:"exported"`
	Exclusions []ExportExclusion `json:"exclusions"`
}
type exportSnapshotItem struct {
	ordinal int64
	item    ExportItem
}

func (e *exportSession) items(ctx context.Context) ([]exportSnapshotItem, error) {
	result := []exportSnapshotItem{}
	var bytesTotal int64
	err := e.tx(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, "SELECT ordinal,snapshot FROM core.mail_export_items WHERE job_id=$1 AND ordinal>$2 ORDER BY ordinal LIMIT $3", e.job.ID, e.job.Cursor, e.job.Spec.PartitionMessages)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var entry exportSnapshotItem
			var b []byte
			if err = rows.Scan(&entry.ordinal, &b); err != nil {
				return err
			}
			if err = json.Unmarshal(b, &entry.item); err != nil {
				return err
			}
			if len(result) > 0 && bytesTotal+entry.item.Raw.Size > 32<<20 {
				break
			}
			bytesTotal += entry.item.Raw.Size
			result = append(result, entry)
		}
		return rows.Err()
	})
	return result, err
}

type exportChunkWriter struct {
	ctx     context.Context
	session *exportSession
	part    *ExportPart
	buffer  []byte
	hash    hash.Hash
}

func (w *exportChunkWriter) Write(data []byte) (int, error) {
	total := len(data)
	if w.part.Size+int64(total) > MaxArchiveBytes {
		return 0, fmt.Errorf("export_part_size_limit")
	}
	for len(data) > 0 {
		remaining := ImportChunkBytes - len(w.buffer)
		n := len(data)
		if n > remaining {
			n = remaining
		}
		w.buffer = append(w.buffer, data[:n]...)
		w.hash.Write(data[:n])
		w.part.Size += int64(n)
		data = data[n:]
		if len(w.buffer) == ImportChunkBytes {
			if err := w.flush(); err != nil {
				return total - len(data), err
			}
		}
	}
	return total, nil
}
func (w *exportChunkWriter) flush() error {
	if len(w.buffer) == 0 {
		return nil
	}
	if err := w.session.check(w.ctx, "build_chunk"); err != nil {
		return err
	}
	object, err := w.session.service.Objects.Put(w.ctx, fmt.Sprintf("%s/parts/%d/chunks/%s", w.session.prefix(), w.part.Number, digest(w.buffer)), w.buffer)
	if err != nil {
		return err
	}
	w.part.Chunks = append(w.part.Chunks, object)
	w.buffer = nil
	return w.session.service.checkpoint("export_after_chunk")
}
func (e *exportSession) recordException(ctx context.Context, x ExportExclusion) error {
	return e.tx(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO core.mail_export_exceptions(tenant_id,account_id,mailbox_id,job_id,source_key,ordinal,code,retryable,evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(tenant_id,account_id,mailbox_id,job_id,source_key) DO UPDATE SET code=excluded.code,retryable=excluded.retryable,resolved=false,evidence=excluded.evidence`, e.scope.Tenant, e.scope.Account, e.scope.Mailbox, e.job.ID, fmt.Sprintf("item:%d", x.Ordinal), x.Ordinal, x.Code, x.Retryable, encoded(x))
		return err
	})
}

func (e *exportSession) readOriginal(ctx context.Context, item ExportItem) ([]byte, error) {
	if item.Draft != nil {
		raw := encoded(item.Draft)
		if !validPortableDraft(*item.Draft) || item.Path != "drafts/"+item.Draft.DraftID+".draft.json" || digest(raw) != item.Raw.SHA256 || int64(len(raw)) != item.Raw.Size {
			return nil, ErrIntegrity
		}
		return raw, nil
	}
	prefix := "mail/v1/" + e.scope.Tenant + "/" + e.scope.Account + "/" + e.scope.Mailbox + "/"
	if !idPattern.MatchString(item.MessageID) || item.Path != "messages/"+item.MessageID+".eml" || item.Flags == nil || item.ReceivedAt.IsZero() || !strings.HasPrefix(item.Raw.Key, prefix) || item.Raw.Size <= 0 {
		return nil, ErrIntegrity
	}
	var envelope Envelope
	if json.Unmarshal(item.Envelope, &envelope) != nil || envelope.To == nil {
		return nil, ErrIntegrity
	}
	raw, err := e.service.Objects.Get(ctx, item.Raw)
	if err != nil {
		return nil, err
	}
	for _, a := range item.Attachments {
		if !strings.HasPrefix(a.Key, prefix) {
			return nil, ErrIntegrity
		}
		if _, err = e.service.Objects.Get(ctx, a); err != nil {
			return nil, err
		}
	}
	return raw, nil
}
func (e *exportSession) build(ctx context.Context) error {
	entries, err := e.items(ctx)
	if err != nil {
		return err
	}
	if len(entries) == 0 {
		return e.tx(ctx, func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, "UPDATE core.mail_export_jobs SET state='VERIFYING' WHERE job_id=$1", e.job.ID)
			return err
		})
	}
	var number int64
	err = e.tx(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, "SELECT coalesce(max(part_number),0)+1 FROM core.mail_export_parts WHERE job_id=$1", e.job.ID).Scan(&number)
	})
	if err != nil {
		return err
	}
	part := ExportPart{Version: 1, Scope: e.scope, JobID: e.job.ID, Number: number, First: entries[0].ordinal, Last: entries[len(entries)-1].ordinal, Chunks: []Object{}, Exclusions: []ExportExclusion{}}
	output := &exportChunkWriter{ctx: ctx, session: e, part: &part, hash: sha256.New()}
	tw := tar.NewWriter(output)
	manifest := ExportManifest{Version: 1, ExportJobID: e.job.ID, PartNumber: number, ExpectedMessages: len(entries), Scope: e.scope, MailboxName: e.job.MailboxName, SnapshotAt: e.job.SnapshotAt, Messages: []ExportItem{}, Complete: true, Limit: e.job.Spec.PartitionMessages}
	excluded := map[int64]bool{}
	for _, entry := range entries {
		if err = e.check(ctx, "build_item"); err != nil {
			return err
		}
		raw, readErr := e.readOriginal(ctx, entry.item)
		if readErr != nil {
			permanent := errors.Is(readErr, ErrIntegrity) || errors.Is(readErr, ErrObjectNotFound)
			x := ExportExclusion{Ordinal: entry.ordinal, MessageID: entry.item.MessageID, Code: "source_temporarily_unavailable", Retryable: !permanent}
			if permanent {
				x.Code = "source_missing_or_corrupt"
			}
			if err = e.recordException(ctx, x); err != nil {
				return err
			}
			if !permanent || e.job.Spec.ExceptionPolicy != "include-report" {
				return fmt.Errorf("export_source_unavailable_resume_same_snapshot")
			}
			excluded[entry.ordinal] = true
			part.Exclusions = append(part.Exclusions, x)
			manifest.Exclusions = append(manifest.Exclusions, x)
			manifest.Complete = false
			continue
		}
		if err = tw.WriteHeader(&tar.Header{Name: entry.item.Path, Mode: 0600, Size: int64(len(raw)), ModTime: entry.item.ReceivedAt}); err != nil {
			return err
		}
		if _, err = tw.Write(raw); err != nil {
			return err
		}
		if entry.item.Draft != nil {
			manifest.Version = 2
			manifest.CounterUnit = "archive_records_including_drafts"
		}
		manifest.Messages = append(manifest.Messages, entry.item)
		part.Exported++
	}
	b := encoded(manifest)
	if err = tw.WriteHeader(&tar.Header{Name: "manifest.json", Mode: 0600, Size: int64(len(b)), ModTime: e.job.SnapshotAt}); err != nil {
		return err
	}
	if _, err = tw.Write(b); err != nil {
		return err
	}
	if err = tw.Close(); err != nil {
		return err
	}
	if err = output.flush(); err != nil {
		return err
	}
	part.SHA256 = hex.EncodeToString(output.hash.Sum(nil))
	if err = e.service.checkpoint("export_after_part_objects"); err != nil {
		return err
	}
	if err = e.check(ctx, "commit_part"); err != nil {
		return err
	}
	return e.tx(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO core.mail_export_parts VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, e.scope.Tenant, e.scope.Account, e.scope.Mailbox, e.job.ID, number, part.First, part.Last, part.Exported, len(part.Exclusions), encoded(part))
		if err != nil {
			return err
		}
		for _, entry := range entries {
			state := "EXPORTED"
			if excluded[entry.ordinal] {
				state = "EXCEPTION"
			} else {
				if _, err = tx.Exec(ctx, "UPDATE core.mail_export_exceptions SET resolved=true WHERE job_id=$1 AND source_key=$2", e.job.ID, fmt.Sprintf("item:%d", entry.ordinal)); err != nil {
					return err
				}
			}
			if _, err = tx.Exec(ctx, "UPDATE core.mail_export_items SET state=$3,part_number=$4 WHERE job_id=$1 AND ordinal=$2", e.job.ID, entry.ordinal, state, number); err != nil {
				return err
			}
		}
		if err = e.service.checkpoint("export_before_checkpoint_commit"); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, "UPDATE core.mail_export_jobs SET cursor=$2 WHERE job_id=$1", e.job.ID, part.Last)
		return err
	})
}
func (e *exportSession) part(ctx context.Context, number int64) (ExportPart, error) {
	var part ExportPart
	err := e.tx(ctx, func(tx pgx.Tx) error {
		var b []byte
		err := tx.QueryRow(ctx, "SELECT descriptor FROM core.mail_export_parts WHERE job_id=$1 AND part_number=$2", e.job.ID, number).Scan(&b)
		if err == pgx.ErrNoRows {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		return json.Unmarshal(b, &part)
	})
	if err == nil && (part.Scope != e.scope || part.JobID != e.job.ID || part.Number != number || part.Version != 1) {
		return ExportPart{}, ErrIntegrity
	}
	return part, err
}
func (e *exportSession) copyPart(ctx context.Context, part ExportPart, offset int64, out io.Writer, purpose string) (int64, error) {
	if offset < 0 || offset > part.Size {
		return 0, fmt.Errorf("invalid_export_range")
	}
	h := sha256.New()
	var position, written int64
	for _, object := range part.Chunks {
		if err := e.check(ctx, purpose); err != nil {
			return written, err
		}
		if object.Key != fmt.Sprintf("%s/parts/%d/chunks/%s", e.prefix(), part.Number, object.SHA256) {
			return written, ErrIntegrity
		}
		b, err := e.service.Objects.Get(ctx, object)
		if err != nil {
			return written, err
		}
		if err = e.check(ctx, purpose); err != nil {
			return written, err
		}
		h.Write(b)
		start := offset - position
		if start < 0 {
			start = 0
		}
		if start < int64(len(b)) {
			n, err := out.Write(b[start:])
			written += int64(n)
			if err != nil {
				return written, err
			}
			if n != len(b)-int(start) {
				return written, io.ErrShortWrite
			}
		}
		position += int64(len(b))
	}
	if position != part.Size || hex.EncodeToString(h.Sum(nil)) != part.SHA256 {
		return written, ErrIntegrity
	}
	return written, nil
}

type ExportReport struct {
	ExpectedDrafts        int64     `json:"expected_drafts"`
	ExportedDrafts        int64     `json:"exported_drafts"`
	CounterUnit           string    `json:"counter_unit,omitempty"`
	Version               int       `json:"version"`
	Scope                 Scope     `json:"scope"`
	JobID                 string    `json:"job_id"`
	SnapshotAt            time.Time `json:"snapshot_at"`
	ExpiresAt             time.Time `json:"expires_at"`
	Expected              int64     `json:"expected_messages"`
	Exported              int64     `json:"exported_messages"`
	Excluded              int64     `json:"excluded_messages"`
	PendingIngestions     int64     `json:"pending_ingestions"`
	PartCount             int64     `json:"part_count"`
	ArchiveBytes          int64     `json:"archive_bytes"`
	PartChainSHA256       string    `json:"part_chain_sha256"`
	State                 string    `json:"state"`
	Complete              bool      `json:"complete"`
	CustomerDelivered     bool      `json:"customer_delivered"`
	IndependentAcceptance bool      `json:"independent_acceptance"`
}

func (e *exportSession) verify(ctx context.Context) error {
	part, err := e.part(ctx, e.job.VerifiedPart+1)
	if err == nil {
		if _, err = e.copyPart(ctx, part, 0, io.Discard, "verify_part"); err != nil {
			return err
		}
		if err = e.check(ctx, "commit_verification"); err != nil {
			return err
		}
		chain := digest(append([]byte(e.job.VerifiedChain), encoded(part)...))
		return e.tx(ctx, func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, "UPDATE core.mail_export_jobs SET verified_part=$2,verified_chain=$3 WHERE job_id=$1", e.job.ID, part.Number, chain)
			return err
		})
	}
	if !errors.Is(err, ErrNotFound) {
		return err
	}
	report := ExportReport{ExpectedDrafts: e.job.ExpectedDrafts, Version: 1, Scope: e.scope, JobID: e.job.ID, SnapshotAt: e.job.SnapshotAt, ExpiresAt: e.job.Spec.ExpiresAt, Expected: e.job.Expected, PendingIngestions: e.job.PendingIngestions, PartChainSHA256: e.job.VerifiedChain, State: "COMPLETE", Complete: true}
	if report.ExpectedDrafts > 0 {
		report.Version = 2
		report.CounterUnit = "archive_records_including_drafts"
	}
	err = e.tx(ctx, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM core.mail_export_items WHERE job_id=$1 AND state='EXPORTED' AND snapshot->'draft' IS NOT NULL`, e.job.ID).Scan(&report.ExportedDrafts); err != nil {
			return err
		}
		var pending, items, partItems int64
		if err := tx.QueryRow(ctx, "SELECT count(*),count(*) FILTER(WHERE state='EXPORTED'),count(*) FILTER(WHERE state='EXCEPTION'),count(*) FILTER(WHERE state='PENDING') FROM core.mail_export_items WHERE job_id=$1", e.job.ID).Scan(&items, &report.Exported, &report.Excluded, &pending); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, "SELECT count(*),coalesce(sum(exported+excluded),0),coalesce(sum((descriptor->>'size')::bigint),0) FROM core.mail_export_parts WHERE job_id=$1", e.job.ID).Scan(&report.PartCount, &partItems, &report.ArchiveBytes); err != nil {
			return err
		}
		if pending != 0 || items != report.Expected || items != report.Exported+report.Excluded || partItems != items || e.job.Cursor != report.Expected || report.PartCount != e.job.VerifiedPart {
			return fmt.Errorf("export_reconciliation_incomplete")
		}
		return nil
	})
	if err != nil {
		return err
	}
	if report.Excluded > 0 || report.PendingIngestions > 0 {
		report.Complete = false
		report.State = "COMPLETED_WITH_EXCEPTIONS"
	}
	b := encoded(report)
	if err = e.check(ctx, "write_report"); err != nil {
		return err
	}
	object, err := e.service.Objects.Put(ctx, e.prefix()+"/reports/"+digest(b)+".json", b)
	if err != nil {
		return err
	}
	if _, err = e.service.Objects.Get(ctx, object); err != nil {
		return err
	}
	if err = e.service.checkpoint("export_after_report_object"); err != nil {
		return err
	}
	if err = e.check(ctx, "finalize"); err != nil {
		return err
	}
	return e.tx(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, "UPDATE core.mail_export_jobs SET state=$2,report_object=$3 WHERE job_id=$1", e.job.ID, report.State, encoded(object))
		return err
	})
}

// ResumeExport builds or verifies one bounded archive part. The existing owner
// schedules calls and rechecks canonical authority; this package runs no queue.
func (s *Service) ResumeExport(ctx context.Context, scope Scope, key string, authority ExportAuthority) (ExportJob, error) {
	session, err := s.exportSession(ctx, scope, key, authority)
	if err != nil {
		return ExportJob{}, err
	}
	defer session.close()
	if err = session.load(ctx, key); err != nil {
		return session.job, err
	}
	if err = session.check(ctx, "resume"); err != nil {
		return session.job, err
	}
	switch session.job.State {
	case "BUILDING":
		err = session.build(ctx)
	case "VERIFYING":
		err = session.verify(ctx)
	case "COMPLETE", "COMPLETED_WITH_EXCEPTIONS":
		return session.job, nil
	default:
		return session.job, fmt.Errorf("export_not_resumable")
	}
	if err != nil {
		return session.job, err
	}
	if err = s.checkpoint("export_after_checkpoint_commit"); err != nil {
		return session.job, err
	}
	err = session.load(ctx, key)
	return session.job, err
}

// ReadExportPart is an INTERNAL delivery primitive. The canonical authority must
// authorize this purpose and policy (including quarantined content) on every call
// and chunk. No signed URL, public endpoint or customer delivery is created here.
func (s *Service) ReadExportPart(ctx context.Context, scope Scope, key string, number, offset int64, out io.Writer, authority ExportAuthority) (ExportPart, error) {
	session, err := s.exportSession(ctx, scope, key, authority)
	if err != nil {
		return ExportPart{}, err
	}
	defer session.close()
	if err = session.load(ctx, key); err != nil {
		return ExportPart{}, err
	}
	if err = session.check(ctx, "read_part"); err != nil {
		return ExportPart{}, err
	}
	if session.job.State != "COMPLETE" && session.job.State != "COMPLETED_WITH_EXCEPTIONS" {
		return ExportPart{}, fmt.Errorf("export_not_deliverable")
	}
	part, err := session.part(ctx, number)
	if err != nil {
		return part, err
	}
	_, err = session.copyPart(ctx, part, offset, out, "read_chunk")
	if err != nil {
		return ExportPart{}, err
	}
	return part, nil
}
func (s *Service) ReadExportReport(ctx context.Context, scope Scope, key string, authority ExportAuthority) (ExportReport, error) {
	var report ExportReport
	session, err := s.exportSession(ctx, scope, key, authority)
	if err != nil {
		return report, err
	}
	defer session.close()
	if err = session.load(ctx, key); err != nil {
		return report, err
	}
	if err = session.check(ctx, "read_report"); err != nil {
		return report, err
	}
	if session.job.State != "COMPLETE" && session.job.State != "COMPLETED_WITH_EXCEPTIONS" {
		return report, fmt.Errorf("export_not_complete")
	}
	var object Object
	err = session.tx(ctx, func(tx pgx.Tx) error {
		var b []byte
		if err := tx.QueryRow(ctx, "SELECT report_object FROM core.mail_export_jobs WHERE job_id=$1", session.job.ID).Scan(&b); err != nil {
			return err
		}
		return json.Unmarshal(b, &object)
	})
	if err != nil {
		return report, err
	}
	if object.Key != session.prefix()+"/reports/"+object.SHA256+".json" {
		return report, ErrIntegrity
	}
	b, err := s.Objects.Get(ctx, object)
	if err != nil {
		return report, err
	}
	if err = session.check(ctx, "read_report"); err != nil {
		return report, err
	}
	if err = json.Unmarshal(b, &report); err != nil {
		return report, err
	}
	if report.Scope != scope || report.JobID != session.job.ID {
		return ExportReport{}, ErrIntegrity
	}
	return report, nil
}

// Cancellation is between batches and retains private objects/receipts. In-flight
// policy revocation is checked by the authority hook before each chunk/commit.
func (s *Service) CancelExport(ctx context.Context, scope Scope, key string, authority ExportAuthority) error {
	session, err := s.exportSession(ctx, scope, key, authority)
	if err != nil {
		return err
	}
	defer session.close()
	if err = session.load(ctx, key); err != nil {
		return err
	}
	if err = session.check(ctx, "cancel"); err != nil {
		return err
	}
	return session.tx(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, "UPDATE core.mail_export_jobs SET state='CANCELLED' WHERE job_id=$1", session.job.ID)
		return err
	})
}

type ExportExceptionPageItem struct {
	SourceKey string          `json:"source_key"`
	Ordinal   *int64          `json:"ordinal"`
	Code      string          `json:"code"`
	Retryable bool            `json:"retryable"`
	Resolved  bool            `json:"resolved"`
	Evidence  json.RawMessage `json:"evidence"`
}

func (s *Service) ExportExceptionPage(ctx context.Context, scope Scope, key, after string, authority ExportAuthority) ([]ExportExceptionPageItem, error) {
	session, err := s.exportSession(ctx, scope, key, authority)
	if err != nil {
		return nil, err
	}
	defer session.close()
	if err = session.load(ctx, key); err != nil {
		return nil, err
	}
	if err = session.check(ctx, "read_exceptions"); err != nil {
		return nil, err
	}
	result := []ExportExceptionPageItem{}
	err = session.tx(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, "SELECT source_key,ordinal,code,retryable,resolved,evidence FROM core.mail_export_exceptions WHERE job_id=$1 AND source_key>$2 ORDER BY source_key LIMIT 100", session.job.ID, after)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item ExportExceptionPageItem
			if err = rows.Scan(&item.SourceKey, &item.Ordinal, &item.Code, &item.Retryable, &item.Resolved, &item.Evidence); err != nil {
				return err
			}
			result = append(result, item)
		}
		return rows.Err()
	})
	return result, err
}

type ExportProgress struct {
	Job        ExportJob `json:"job"`
	ReadyParts int64     `json:"ready_parts"`
	Exported   int64     `json:"exported_messages"`
	Excluded   int64     `json:"excluded_messages"`
	Remaining  int64     `json:"remaining_messages"`
	Expired    bool      `json:"expired"`
}

// Status can describe an expired job, but never returns bytes or object grants.
func (s *Service) ReadExportStatus(ctx context.Context, scope Scope, key string, authority ExportAuthority) (ExportProgress, error) {
	var progress ExportProgress
	session, err := s.exportSession(ctx, scope, key, authority)
	if err != nil {
		return progress, err
	}
	defer session.close()
	if err = session.load(ctx, key); err != nil {
		return progress, err
	}
	if err = authority.CheckExport(ctx, scope, session.job.Spec, "read_status"); err != nil {
		return progress, ErrExportAdmission
	}
	progress.Job = session.job
	progress.Expired = !time.Now().Before(session.job.Spec.ExpiresAt)
	err = session.tx(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT (SELECT count(*) FROM core.mail_export_parts WHERE job_id=$1),count(*) FILTER(WHERE state='EXPORTED'),count(*) FILTER(WHERE state='EXCEPTION'),count(*) FILTER(WHERE state='PENDING') FROM core.mail_export_items WHERE job_id=$1`, session.job.ID).Scan(&progress.ReadyParts, &progress.Exported, &progress.Excluded, &progress.Remaining)
	})
	return progress, err
}
