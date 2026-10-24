package mailstore

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

var ErrImportBusy = errors.New("import_job_busy")

type ImportJob struct {
	ID                string     `json:"job_id"`
	State             string     `json:"state"`
	InventoryComplete bool       `json:"inventory_complete"`
	Spec              ImportSpec `json:"spec"`
}
type importSession struct {
	service *Service
	conn    *pgx.Conn
	scope   Scope
	job     ImportJob
}

func (s *Service) importSession(ctx context.Context, scope Scope, key string) (*importSession, error) {
	if !scope.valid() || key == "" || len(key) > 200 {
		return nil, fmt.Errorf("invalid_import_identity")
	}
	checked, e := s.connection(ctx)
	if e != nil {
		return nil, e
	}
	checked.Release()
	// A dedicated lock connection avoids exhausting the ingestion pool with
	// waiting job locks. The existing worker owner bounds total worker concurrency.
	c, e := pgx.ConnectConfig(ctx, s.DB.Config().ConnConfig)
	if e != nil {
		return nil, e
	}
	var locked bool
	e = c.QueryRow(ctx, "SELECT pg_try_advisory_lock(hashtextextended($1,240))", scope.Tenant+scope.Account+scope.Mailbox+key).Scan(&locked)
	if e != nil || !locked {
		c.Close(ctx)
		if e != nil {
			return nil, e
		}
		return nil, ErrImportBusy
	}
	return &importSession{service: s, conn: c, scope: scope}, nil
}
func (i *importSession) close() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	i.conn.Close(ctx)
}
func (i *importSession) tx(ctx context.Context, fn func(pgx.Tx) error) error {
	tx, e := scopedTx(ctx, i.conn, i.scope)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if e = fn(tx); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (i *importSession) load(ctx context.Context, key string) error {
	return i.tx(ctx, func(tx pgx.Tx) error {
		var spec []byte
		e := tx.QueryRow(ctx, "SELECT job_id::text,state,inventory_complete,spec FROM core.mail_import_jobs WHERE job_key=$1", key).Scan(&i.job.ID, &i.job.State, &i.job.InventoryComplete, &spec)
		if e == pgx.ErrNoRows {
			return ErrNotFound
		}
		if e != nil {
			return e
		}
		return json.Unmarshal(spec, &i.job.Spec)
	})
}
func (i *importSession) prefix() string {
	return "mail/v1/" + i.scope.Tenant + "/" + i.scope.Account + "/" + i.scope.Mailbox + "/imports/" + i.job.ID
}
func (i *importSession) exception(ctx context.Context, key string, ordinal *int64, code string, retryable bool, evidence any) error {
	return i.tx(ctx, func(tx pgx.Tx) error {
		_, e := tx.Exec(ctx, `INSERT INTO core.mail_import_exceptions(tenant_id,account_id,mailbox_id,job_id,exception_key,item_ordinal,code,retryable,evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(tenant_id,account_id,mailbox_id,job_id,exception_key) DO UPDATE SET code=excluded.code,retryable=excluded.retryable,evidence=excluded.evidence,resolved=false`, i.scope.Tenant, i.scope.Account, i.scope.Mailbox, i.job.ID, key, ordinal, code, retryable, encoded(evidence))
		return e
	})
}
func (i *importSession) checkpoint(ctx context.Context, phase string) (cursor, count int64, chain string, err error) {
	err = i.tx(ctx, func(tx pgx.Tx) error {
		e := tx.QueryRow(ctx, "SELECT cursor,item_count,chain_sha256 FROM core.mail_import_checkpoints WHERE job_id=$1 AND phase=$2", i.job.ID, phase).Scan(&cursor, &count, &chain)
		if e == pgx.ErrNoRows {
			return nil
		}
		return e
	})
	return
}
func (i *importSession) saveCheckpoint(ctx context.Context, tx pgx.Tx, phase string, cursor, count int64, chain string) error {
	_, e := tx.Exec(ctx, `INSERT INTO core.mail_import_checkpoints VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,account_id,mailbox_id,job_id,phase) DO UPDATE SET cursor=excluded.cursor,item_count=excluded.item_count,chain_sha256=excluded.chain_sha256`, i.scope.Tenant, i.scope.Account, i.scope.Mailbox, i.job.ID, phase, cursor, count, chain)
	return e
}
func (i *importSession) setState(ctx context.Context, state string) error {
	return i.tx(ctx, func(tx pgx.Tx) error {
		_, e := tx.Exec(ctx, "UPDATE core.mail_import_jobs SET state=$2,updated_at=now() WHERE job_id=$1", i.job.ID, state)
		return e
	})
}

// StageImport retains the entire immutable master as verified bounded chunks.
// Repeat with the SAME source digest/spec after interruption. No source deletion,
// customer filesystem traversal or network source fetching is performed.
func (s *Service) StageImport(ctx context.Context, scope Scope, spec ImportSpec, input io.Reader) (ImportJob, error) {
	if !spec.valid() {
		return ImportJob{}, fmt.Errorf("invalid_import_spec_or_explicit_format_required")
	}
	session, e := s.importSession(ctx, scope, spec.Key)
	if e != nil {
		return ImportJob{}, e
	}
	defer session.close()
	e = session.tx(ctx, func(tx pgx.Tx) error {
		_, e := tx.Exec(ctx, `INSERT INTO core.mail_import_jobs(tenant_id,account_id,mailbox_id,job_id,job_key,input_sha256,spec,state) VALUES($1,$2,$3,$4,$5,$6,$7,'STAGING') ON CONFLICT DO NOTHING`, scope.Tenant, scope.Account, scope.Mailbox, uuid(), spec.Key, digest(encoded(spec)), encoded(spec))
		if e != nil {
			return e
		}
		var old string
		if e = tx.QueryRow(ctx, "SELECT input_sha256 FROM core.mail_import_jobs WHERE job_key=$1", spec.Key).Scan(&old); e != nil {
			return e
		}
		if old != digest(encoded(spec)) {
			return ErrConflict
		}
		return nil
	})
	if e != nil {
		return session.job, e
	}
	if e = session.load(ctx, spec.Key); e != nil {
		return session.job, e
	}
	var complete bool
	e = session.tx(ctx, func(tx pgx.Tx) error {
		e := tx.QueryRow(ctx, "SELECT complete FROM core.mail_import_sources WHERE job_id=$1 AND source_key='master'", session.job.ID).Scan(&complete)
		if e == pgx.ErrNoRows {
			return nil
		}
		return e
	})
	if e != nil || complete {
		return session.job, e
	}
	if e = session.setState(ctx, "STAGING"); e != nil {
		return session.job, e
	}
	source := ImportSource{Version: 1, Scope: scope, Spec: spec, Chunks: []Object{}}
	h := sha256.New()
	for source.ObservedSize < spec.SourceSize {
		size := int64(ImportChunkBytes)
		if size > spec.SourceSize-source.ObservedSize {
			size = spec.SourceSize - source.ObservedSize
		}
		data := make([]byte, int(size))
		if _, e = io.ReadFull(input, data); e != nil {
			return session.job, fmt.Errorf("source_interrupted_resume_same_spec")
		}
		object, e := s.Objects.Put(ctx, session.prefix()+"/master/chunks/"+digest(data), data)
		if e != nil {
			return session.job, e
		}
		source.Chunks = append(source.Chunks, object)
		source.ObservedSize += int64(len(data))
		h.Write(data)
		e = session.tx(ctx, func(tx pgx.Tx) error {
			_, e := tx.Exec(ctx, `INSERT INTO core.mail_import_sources VALUES($1,$2,$3,$4,'master',$5,false) ON CONFLICT(tenant_id,account_id,mailbox_id,job_id,source_key) DO UPDATE SET manifest=excluded.manifest`, scope.Tenant, scope.Account, scope.Mailbox, session.job.ID, encoded(source))
			if e != nil {
				return e
			}
			return session.saveCheckpoint(ctx, tx, "STAGING", source.ObservedSize, 0, "")
		})
		if e != nil {
			return session.job, e
		}
		if e = s.checkpoint("import_after_stage_chunk"); e != nil {
			return session.job, e
		}
	}
	source.ObservedSHA256 = hex.EncodeToString(h.Sum(nil))
	var extra [1]byte
	n, readErr := io.ReadFull(input, extra[:])
	if n != 0 || readErr != io.EOF || source.ObservedSHA256 != spec.SourceSHA256 {
		e = session.exception(ctx, "source_integrity", nil, "source_size_or_hash_mismatch", false, source)
		if e == nil {
			e = session.setState(ctx, "NEEDS_ACTION")
		}
		if e != nil {
			return session.job, e
		}
		session.job.State = "NEEDS_ACTION"
		return session.job, ErrIntegrity
	}
	// An immutable manifest makes the preserved master independently reconstructable.
	manifest, e := s.Objects.Put(ctx, session.prefix()+"/master/manifest.json", encoded(source))
	if e != nil {
		return session.job, e
	}
	if _, e = s.Objects.Get(ctx, manifest); e != nil {
		return session.job, e
	}
	e = session.tx(ctx, func(tx pgx.Tx) error {
		if _, e := tx.Exec(ctx, "UPDATE core.mail_import_sources SET manifest=$2,complete=true WHERE job_id=$1 AND source_key='master'", session.job.ID, encoded(source)); e != nil {
			return e
		}
		if _, e := tx.Exec(ctx, "UPDATE core.mail_import_exceptions SET resolved=true WHERE job_id=$1 AND exception_key='source_integrity'", session.job.ID); e != nil {
			return e
		}
		_, e := tx.Exec(ctx, "UPDATE core.mail_import_jobs SET state='DISCOVERING',updated_at=now() WHERE job_id=$1", session.job.ID)
		return e
	})
	session.job.State = "DISCOVERING"
	return session.job, e
}
func (i *importSession) source(ctx context.Context) (*sourceReader, error) {
	var source ImportSource
	var complete bool
	e := i.tx(ctx, func(tx pgx.Tx) error {
		var b []byte
		e := tx.QueryRow(ctx, "SELECT manifest,complete FROM core.mail_import_sources WHERE job_id=$1 AND source_key='master'", i.job.ID).Scan(&b, &complete)
		if e != nil {
			return e
		}
		return json.Unmarshal(b, &source)
	})
	if e != nil {
		return nil, e
	}
	if !complete || source.Scope != i.scope || !bytes.Equal(encoded(source.Spec), encoded(i.job.Spec)) {
		return nil, ErrIntegrity
	}
	for _, chunk := range source.Chunks {
		if chunk.Key != i.prefix()+"/master/chunks/"+chunk.SHA256 {
			return nil, ErrIntegrity
		}
	}
	return openImportSource(ctx, i.service.Objects, source)
}

type importItem struct {
	Ordinal                           int64
	Path, Folder                      string
	Object                            Object
	Envelope                          Envelope
	Flags                             []string
	Properties                        map[string]any
	State, Delivery, Message, Receipt string
	DraftID, DraftReceipt             string
}

func importedEnvelope(parsed Parsed, received time.Time) Envelope {
	env := Envelope{ReceivedAt: received}
	for _, a := range parsed.Recipients {
		if a.Kind == "From" && env.From == "" {
			env.From = a.Address
		}
		if a.Kind == "To" || a.Kind == "Cc" || a.Kind == "Bcc" {
			env.To = append(env.To, a.Address)
		}
	}
	return env
}
func mailboxHeaderFlags(p Parsed) ([]string, map[string]any) {
	flags := map[string]bool{}
	metadata := map[string]any{}
	for name, values := range p.Headers {
		switch strings.ToLower(name) {
		case "status", "x-status", "x-keywords", "x-imap", "x-imapbase", "x-uid":
			metadata[name] = values
		}
		if strings.EqualFold(name, "Status") {
			for _, v := range values {
				if strings.Contains(v, "R") {
					flags["seen"] = true
				}
			}
		}
		if strings.EqualFold(name, "X-Status") {
			for _, v := range values {
				for code, flag := range map[string]string{"A": "answered", "F": "flagged", "T": "draft", "D": "deleted"} {
					if strings.Contains(v, code) {
						flags[flag] = true
					}
				}
			}
		}
	}
	result := []string{}
	for f := range flags {
		result = append(result, f)
	}
	sort.Strings(result)
	return result, metadata
}
func (i *importSession) discoverItem(ctx context.Context, item importItem, raw []byte, next int64) error {
	if item.Ordinal > MaxImportItems {
		return fmt.Errorf("import_item_limit")
	}
	if item.Flags == nil {
		item.Flags = []string{}
	}
	parsed, parseErr := Parse(raw)
	item.State = "PENDING"
	code := ""
	if item.Properties["record_kind"] == "draft" {
		parseErr = nil
	}
	if parseErr != nil {
		item.State = "EXCEPTION"
		code = "malformed_mime_retained"
	}
	if item.Envelope.ReceivedAt.IsZero() {
		item.Envelope.ReceivedAt = i.job.Spec.Cutoff
		item.Properties["received_time_source"] = "cutoff_missing_original"
	}
	item.Envelope.ReceivedAt = item.Envelope.ReceivedAt.UTC().Truncate(time.Microsecond)
	if parseErr == nil && item.Properties["record_kind"] != "draft" {
		item.Envelope = importedEnvelope(parsed, item.Envelope.ReceivedAt)
		if len(item.Envelope.To) == 0 || len(item.Envelope.To) > 100 || len(item.Envelope.From) > 320 {
			item.State = "EXCEPTION"
			code = "missing_recipients_requires_mapping"
		}
	}
	if i.job.Spec.Format == "mboxrd" {
		item.Flags, item.Properties["mbox_headers"] = mailboxHeaderFlags(parsed)
	}
	for _, address := range item.Envelope.To {
		if len(address) == 0 || len(address) > 320 {
			item.State = "EXCEPTION"
			code = "import_envelope_requires_mapping"
		}
	}
	object, e := i.service.Objects.Put(ctx, i.prefix()+"/items/"+digest([]byte(item.Path))+"/original.eml", raw)
	if e != nil {
		return e
	}
	if e = i.service.checkpoint("import_after_discovery_object"); e != nil {
		return e
	}
	item.Delivery = "offline:" + i.job.ID + ":" + digest([]byte(item.Path))
	e = i.tx(ctx, func(tx pgx.Tx) error {
		_, e := tx.Exec(ctx, `INSERT INTO core.mail_import_items(tenant_id,account_id,mailbox_id,job_id,ordinal,source_key,source_path,source_folder,original_object,raw_sha256,raw_size,envelope,flags,properties,delivery_id,state) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT DO NOTHING`, i.scope.Tenant, i.scope.Account, i.scope.Mailbox, i.job.ID, item.Ordinal, item.Path, item.Folder, encoded(object), object.SHA256, object.Size, encoded(item.Envelope), item.Flags, encoded(item.Properties), item.Delivery, item.State)
		if e != nil {
			return e
		}
		if code != "" {
			_, e = tx.Exec(ctx, `INSERT INTO core.mail_import_exceptions VALUES($1,$2,$3,$4,$5,$6,$7,false,$8,false) ON CONFLICT DO NOTHING`, i.scope.Tenant, i.scope.Account, i.scope.Mailbox, i.job.ID, fmt.Sprintf("item:%d", item.Ordinal), item.Ordinal, code, encoded(map[string]any{"path": item.Path, "raw": object}))
			if e != nil {
				return e
			}
		}
		return i.saveCheckpoint(ctx, tx, "DISCOVERING", next, item.Ordinal, "")
	})
	return e
}

func (i *importSession) discover(ctx context.Context, limit int) error {
	reader, e := i.source(ctx)
	if e != nil {
		return e
	}
	cursor, count, _, e := i.checkpoint(ctx, "DISCOVERING")
	if e != nil {
		return e
	}
	finished := false
	if i.job.Spec.Format == "mboxrd" {
		location, _ := time.LoadLocation(i.job.Spec.MBOXTimezone)
		for step := 0; step < limit; step++ {
			record, err := NextMBOXRD(reader, i.job.Spec.SourceSize, cursor, location)
			if err == io.EOF {
				finished = true
				break
			}
			if err != nil {
				if errors.Is(err, ErrImportSourceUnavailable) {
					return err
				}
				if e = i.exception(ctx, "discovery", nil, "mboxrd_discovery_requires_action", false, map[string]any{"offset": cursor, "reason": err.Error()}); e != nil {
					return e
				}
				return i.setState(ctx, "NEEDS_ACTION")
			}
			item := importItem{Ordinal: count + 1, Path: fmt.Sprintf("mboxrd/%020d", record.Offset), Folder: i.job.Spec.Folder, Envelope: Envelope{ReceivedAt: record.ReceivedAt}, Properties: map[string]any{"source_offset": record.Offset, "source_next": record.Next, "separator": record.Separator, "conversion": "mboxrd-unquote-and-framing-v1", "timezone": i.job.Spec.MBOXTimezone, "received_time_source": "mbox_separator"}}
			if e = i.discoverItem(ctx, item, record.Raw, record.Next); e != nil {
				return e
			}
			cursor = record.Next
			count++
		}
		if cursor == i.job.Spec.SourceSize {
			finished = true
		}
	} else {
		index := int64(0)
		processed := 0
		boundary := false
		visit := func(item ArchiveItem, raw []byte) error {
			index++
			if index <= count {
				return nil
			}
			if processed >= limit {
				boundary = true
				return fmt.Errorf("batch_boundary")
			}
			received := item.SourceTime
			if received.IsZero() {
				received = i.job.Spec.Cutoff
			}
			entry := importItem{Ordinal: index, Path: item.Path, Folder: item.Folder, Flags: item.Flags, Envelope: Envelope{ReceivedAt: received}, Properties: map[string]any{"source_time": item.SourceTime, "unmapped_flags": item.UnmappedFlags, "conversion": "byte-exact-eml", "received_time_source": "archive_time_or_explicit_cutoff"}}
			if item.Draft != nil {
				entry.Properties["record_kind"] = "draft"
			}
			if e = i.discoverItem(ctx, entry, raw, index); e != nil {
				return e
			}
			processed++
			return nil
		}
		var preview ArchivePreview
		if i.job.Spec.Format == "eml-tar" {
			preview, e = InspectTAR(io.NewSectionReader(reader, 0, i.job.Spec.SourceSize), visit)
		} else {
			preview, e = InspectZIP(reader, i.job.Spec.SourceSize, visit)
		}
		if boundary {
			return nil
		}
		if e != nil {
			// A callback storage/SQL error is retriable at the same checkpoint. A
			// structural failure is durable NEEDS_ACTION; all master bytes survive.
			if errors.Is(e, ErrImportSourceUnavailable) || e.Error() == "archive_visitor_failed" {
				return e
			}
			if e = i.exception(ctx, "discovery", nil, "archive_discovery_requires_action", false, map[string]any{"reason": e.Error(), "entries": preview.Entries}); e != nil {
				return e
			}
			return i.setState(ctx, "NEEDS_ACTION")
		}
		for _, exception := range preview.Exceptions {
			if strings.Contains(exception.Code, "manifest") || exception.Code == "invalid_portable_draft" || exception.Code == "source_export_incomplete_or_pending" {
				if e = i.exception(ctx, "discovery", nil, "portable_manifest_requires_action", false, exception); e != nil {
					return e
				}
				return i.setState(ctx, "NEEDS_ACTION")
			}
			if e = i.exception(ctx, "source:"+digest([]byte(exception.Path+exception.Code)), nil, exception.Code, false, map[string]any{"path": exception.Path}); e != nil {
				return e
			}
		}
		// Exported metadata is supplemental, never identity/authority. Match hashes
		// first; foreign source tenant IDs are retained only as provenance.
		if manifest := preview.PortableMetadata; manifest != nil {
			for _, m := range manifest.Messages {
				if m.Organization != nil && (m.Organization.Folder != nil || len(m.Organization.Labels) > 0) {
					if len(m.Organization.Labels) > 20 {
						return fmt.Errorf("portable_label_limit")
					}
					if !i.hasOrganizationMapping(m.Organization) {
						if e = i.exception(ctx, "organization:"+digest([]byte(m.Path)), nil, "organization_mapping_pending", false, map[string]any{"path": m.Path, "organization": m.Organization}); e != nil {
							return e
						}
					}
				}
				e = i.tx(ctx, func(tx pgx.Tx) error {
					var hash string
					err := tx.QueryRow(ctx, "SELECT raw_sha256 FROM core.mail_import_items WHERE job_id=$1 AND source_path=$2", i.job.ID, m.Path).Scan(&hash)
					if err == pgx.ErrNoRows {
						return nil
					}
					if err != nil {
						return err
					}
					if hash != m.Raw.SHA256 {
						return nil
					}
					if m.Draft != nil {
						return nil
					}
					if len(m.Flags) > 100 {
						return fmt.Errorf("portable_flags_limit")
					}
					for _, f := range m.Flags {
						if len(f) > 200 {
							return fmt.Errorf("portable_flag_limit")
						}
					}
					// Restore timestamps/flags exactly; absence of an original envelope is
					// kept explicit. The existing source bytes remain the message authority.
					var env Envelope
					if json.Unmarshal(m.Envelope, &env) != nil {
						return fmt.Errorf("invalid_portable_envelope")
					}
					env.ReceivedAt = m.ReceivedAt
					if env.ReceivedAt.IsZero() || len(env.To) == 0 {
						return fmt.Errorf("portable_envelope_requires_mapping")
					}
					if m.Flags == nil {
						m.Flags = []string{}
					}
					_, err = tx.Exec(ctx, "UPDATE core.mail_import_items SET flags=$3,envelope=$4,properties=properties || jsonb_build_object('portable_metadata',$5::jsonb) WHERE job_id=$1 AND source_path=$2", i.job.ID, m.Path, m.Flags, encoded(env), encoded(m))
					return err
				})
				if e != nil {
					return e
				}
			}
		}
		finished = true
	}
	if finished {
		return i.tx(ctx, func(tx pgx.Tx) error {
			_, e := tx.Exec(ctx, "UPDATE core.mail_import_jobs SET inventory_complete=true,state='IMPORTING',updated_at=now() WHERE job_id=$1", i.job.ID)
			return e
		})
	}
	return nil
}
func (i *importSession) items(ctx context.Context, after int64, limit int) ([]importItem, error) {
	result := []importItem{}
	e := i.tx(ctx, func(tx pgx.Tx) error {
		rows, e := tx.Query(ctx, `SELECT ordinal,source_path,source_folder,original_object,envelope,flags,properties,state,delivery_id,coalesce(message_id::text,''),coalesce(receipt_id::text,''),coalesce(draft_id::text,''),coalesce(draft_receipt_id::text,'') FROM core.mail_import_items WHERE job_id=$1 AND ordinal>$2 ORDER BY ordinal LIMIT $3`, i.job.ID, after, limit)
		if e != nil {
			return e
		}
		defer rows.Close()
		for rows.Next() {
			var item importItem
			var object, env, properties []byte
			if e = rows.Scan(&item.Ordinal, &item.Path, &item.Folder, &object, &env, &item.Flags, &properties, &item.State, &item.Delivery, &item.Message, &item.Receipt, &item.DraftID, &item.DraftReceipt); e != nil {
				return e
			}
			if e = json.Unmarshal(object, &item.Object); e != nil {
				return e
			}
			if e = json.Unmarshal(env, &item.Envelope); e != nil {
				return e
			}
			if e = json.Unmarshal(properties, &item.Properties); e != nil {
				return e
			}
			if item.Object.Key != i.prefix()+"/items/"+digest([]byte(item.Path))+"/original.eml" {
				return ErrIntegrity
			}
			result = append(result, item)
		}
		return rows.Err()
	})
	return result, e
}
func (i *importSession) importBatch(ctx context.Context, limit int) error {
	cursor, count, _, e := i.checkpoint(ctx, "IMPORTING")
	if e != nil {
		return e
	}
	items, e := i.items(ctx, cursor, limit)
	if e != nil {
		return e
	}
	for _, item := range items {
		if item.Properties["record_kind"] == "draft" && item.State != "EXCEPTION" {
			if e = i.importDraft(ctx, item, count); e != nil {
				return e
			}
		} else if item.State != "EXCEPTION" {
			raw, err := i.service.Objects.Get(ctx, item.Object)
			if err != nil {
				return err
			}
			receipt, err := i.service.Ingest(ctx, Request{Scope: i.scope, DeliveryID: item.Delivery, Source: "offline-import/" + i.job.Spec.Format, Envelope: item.Envelope, Raw: raw})
			if err != nil {
				return err
			}
			if receipt.Raw.SHA256 != item.Object.SHA256 || receipt.Raw.Size != item.Object.Size {
				return ErrIntegrity
			}
			if e = i.service.checkpoint("import_after_ingest"); e != nil {
				return e
			}
			e = i.tx(ctx, func(tx pgx.Tx) error {
				// Link receipt + initial flags + checkpoint together. Replays do not reset
				// flags after the item was committed (e.g. later customer read/unread edits).
				var state string
				if e := tx.QueryRow(ctx, "SELECT state FROM core.mail_import_items WHERE job_id=$1 AND ordinal=$2 FOR UPDATE", i.job.ID, item.Ordinal).Scan(&state); e != nil {
					return e
				}
				if state == "PENDING" {
					if e := i.restoreOrganization(ctx, tx, item, receipt.MessageID); e != nil {
						return e
					}
					if _, e := tx.Exec(ctx, "UPDATE core.memberships SET flags=$2 WHERE message_id=$1", receipt.MessageID, item.Flags); e != nil {
						return e
					}
					if _, e := tx.Exec(ctx, "UPDATE core.mail_import_items SET state='VERIFIED',message_id=$3,receipt_id=$4 WHERE job_id=$1 AND ordinal=$2", i.job.ID, item.Ordinal, receipt.MessageID, receipt.ID); e != nil {
						return e
					}
				}
				if e := i.service.checkpoint("import_before_item_commit"); e != nil {
					return e
				}
				return i.saveCheckpoint(ctx, tx, "IMPORTING", item.Ordinal, count+1, "")
			})
			if e != nil {
				return e
			}
		} else {
			if e = i.tx(ctx, func(tx pgx.Tx) error { return i.saveCheckpoint(ctx, tx, "IMPORTING", item.Ordinal, count+1, "") }); e != nil {
				return e
			}
		}
		count++
		if e = i.service.checkpoint("import_after_item_commit"); e != nil {
			return e
		}
	}
	if len(items) < limit {
		return i.setState(ctx, "VERIFYING")
	}
	return nil
}

type ImportReconciliation struct {
	Version               int    `json:"version"`
	JobID                 string `json:"job_id"`
	Scope                 Scope  `json:"scope"`
	SourceSHA256          string `json:"source_sha256"`
	SourceSize            int64  `json:"source_size"`
	Expected              int64  `json:"expected"`
	Verified              int64  `json:"verified"`
	Exceptions            int64  `json:"exceptions"`
	Pending               int64  `json:"pending"`
	VerifiedBytes         int64  `json:"verified_bytes"`
	ItemChainSHA256       string `json:"item_chain_sha256"`
	State                 string `json:"state"`
	IndependentAcceptance bool   `json:"independent_acceptance"`
}

func (i *importSession) verifyBatch(ctx context.Context, limit int) error {
	cursor, count, chain, e := i.checkpoint(ctx, "VERIFYING")
	if e != nil {
		return e
	}
	items, e := i.items(ctx, cursor, limit)
	if e != nil {
		return e
	}
	for _, item := range items {
		if item.Properties["record_kind"] == "draft" && item.State != "EXCEPTION" {
			if e = i.verifyDraft(ctx, item); e != nil {
				return e
			}
		} else if item.State != "EXCEPTION" {
			message, raw, err := i.service.Retrieve(ctx, i.scope, item.Delivery)
			if err != nil || message.Receipt.ID != item.Receipt || digest(raw) != item.Object.SHA256 || int64(len(raw)) != item.Object.Size {
				if e = i.exception(ctx, "verify:"+item.Path, &item.Ordinal, "import_readback_failed", true, map[string]any{"path": item.Path}); e != nil {
					return e
				}
				return fmt.Errorf("import_verification_failed_retry_same_cursor")
			}
			parsed, parseErr := Parse(raw)
			if parseErr != nil || message.Subject != parsed.Subject || message.InternetMessageID != parsed.MessageID || message.Text != parsed.Text {
				return ErrIntegrity
			}
			var flags []string
			var received time.Time
			if e = i.tx(ctx, func(tx pgx.Tx) error {
				return tx.QueryRow(ctx, "SELECT mb.flags,m.received_at FROM core.memberships mb JOIN core.messages m USING(tenant_id,account_id,mailbox_id,message_id) WHERE m.message_id=$1", item.Message).Scan(&flags, &received)
			}); e != nil {
				return e
			}
			if !bytes.Equal(encoded(flags), encoded(item.Flags)) || !received.Equal(item.Envelope.ReceivedAt) {
				if e = i.exception(ctx, "metadata:"+item.Path, &item.Ordinal, "import_metadata_changed_requires_action", false, map[string]any{"path": item.Path}); e != nil {
					return e
				}
				return i.setState(ctx, "NEEDS_ACTION")
			}
			if e = i.verifyOrganization(ctx, item); e != nil {
				return e
			}
			original, err := i.service.Objects.Get(ctx, item.Object)
			if err != nil || !bytes.Equal(original, raw) {
				return ErrIntegrity
			}
		}
		nextChain := digest(append([]byte(chain), encoded(item)...))
		e = i.tx(ctx, func(tx pgx.Tx) error {
			if _, e := tx.Exec(ctx, "UPDATE core.mail_import_exceptions SET resolved=true WHERE job_id=$1 AND exception_key=$2", i.job.ID, "verify:"+item.Path); e != nil {
				return e
			}
			return i.saveCheckpoint(ctx, tx, "VERIFYING", item.Ordinal, count+1, nextChain)
		})
		if e != nil {
			return e
		}
		count++
		chain = nextChain
	}
	if len(items) == limit {
		return nil
	}
	// Re-read every chunk and the aggregate source hash before completion.
	source, e := i.source(ctx)
	if e != nil {
		return e
	}
	hash, e := sourceDigest(io.NewSectionReader(source, 0, i.job.Spec.SourceSize))
	if e != nil {
		return e
	}
	if hash != i.job.Spec.SourceSHA256 {
		return ErrIntegrity
	}
	if e = i.tx(ctx, func(tx pgx.Tx) error {
		_, e := tx.Exec(ctx, "UPDATE core.mail_import_exceptions SET resolved=true WHERE job_id=$1 AND exception_key='execution:VERIFYING'", i.job.ID)
		return e
	}); e != nil {
		return e
	}
	report := ImportReconciliation{Version: 1, JobID: i.job.ID, Scope: i.scope, SourceSHA256: hash, SourceSize: i.job.Spec.SourceSize, ItemChainSHA256: chain, State: "COMPLETE"}
	e = i.tx(ctx, func(tx pgx.Tx) error {
		var inventory bool
		if e := tx.QueryRow(ctx, "SELECT inventory_complete FROM core.mail_import_jobs WHERE job_id=$1", i.job.ID).Scan(&inventory); e != nil {
			return e
		}
		if !inventory {
			return fmt.Errorf("inventory_not_complete")
		}
		if e := tx.QueryRow(ctx, `SELECT count(*),count(*) FILTER(WHERE state='VERIFIED'),count(*) FILTER(WHERE state='EXCEPTION'),count(*) FILTER(WHERE state='PENDING'),coalesce(sum(raw_size) FILTER(WHERE state='VERIFIED'),0) FROM core.mail_import_items WHERE job_id=$1`, i.job.ID).Scan(&report.Expected, &report.Verified, &report.Exceptions, &report.Pending, &report.VerifiedBytes); e != nil {
			return e
		}
		var sourceExceptions, unresolvedRetry int64
		if e := tx.QueryRow(ctx, "SELECT count(*) FILTER(WHERE item_ordinal IS NULL),count(*) FILTER(WHERE retryable) FROM core.mail_import_exceptions WHERE job_id=$1 AND NOT resolved", i.job.ID).Scan(&sourceExceptions, &unresolvedRetry); e != nil {
			return e
		}
		if report.Pending != 0 || unresolvedRetry != 0 || count != report.Expected {
			return fmt.Errorf("import_reconciliation_incomplete")
		}
		report.Expected += sourceExceptions
		report.Exceptions += sourceExceptions
		if report.Exceptions > 0 {
			report.State = "COMPLETED_WITH_EXCEPTIONS"
		}
		return nil
	})
	if e != nil {
		return e
	}
	data := encoded(report)
	object, e := i.service.Objects.Put(ctx, i.prefix()+"/reports/"+digest(data)+".json", data)
	if e != nil {
		return e
	}
	if _, e = i.service.Objects.Get(ctx, object); e != nil {
		return e
	}
	if e = i.service.checkpoint("import_after_report_object"); e != nil {
		return e
	}
	return i.tx(ctx, func(tx pgx.Tx) error {
		if _, e := tx.Exec(ctx, `INSERT INTO core.mail_import_reconciliation VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`, i.scope.Tenant, i.scope.Account, i.scope.Mailbox, i.job.ID, report.Expected, report.Verified, report.Exceptions, report.Pending, report.VerifiedBytes, chain, encoded(object)); e != nil {
			return e
		}
		_, e := tx.Exec(ctx, "UPDATE core.mail_import_jobs SET state=$2,updated_at=now() WHERE job_id=$1", i.job.ID, report.State)
		return e
	})
}

// ResumeImport executes one bounded phase batch. An existing admitted worker
// invokes it again after interruption/backoff; this is not a second scheduler.
// NEEDS_ACTION is not automatically overridden; no real import is exposed by CLI.
func (s *Service) ResumeImport(ctx context.Context, scope Scope, key string, limit int) (ImportJob, error) {
	if limit < 1 || limit > 1000 {
		return ImportJob{}, fmt.Errorf("import_batch_limit")
	}
	session, e := s.importSession(ctx, scope, key)
	if e != nil {
		return ImportJob{}, e
	}
	defer session.close()
	if e = session.load(ctx, key); e != nil {
		return session.job, e
	}
	switch session.job.State {
	case "DISCOVERING":
		e = session.discover(ctx, limit)
	case "IMPORTING":
		e = session.importBatch(ctx, limit)
	case "VERIFYING":
		e = session.verifyBatch(ctx, limit)
	case "COMPLETE", "COMPLETED_WITH_EXCEPTIONS":
		return session.job, nil
	default:
		return session.job, fmt.Errorf("import_state_requires_action")
	}
	if e != nil {
		originalError := e
		_ = session.exception(ctx, "execution:"+session.job.State, nil, "worker_interrupted_retry_same_checkpoint", true, map[string]any{"phase": session.job.State})
		return session.job, originalError
	}
	if e = session.tx(ctx, func(tx pgx.Tx) error {
		_, e := tx.Exec(ctx, "UPDATE core.mail_import_exceptions SET resolved=true WHERE job_id=$1 AND exception_key=$2", session.job.ID, "execution:"+session.job.State)
		return e
	}); e != nil {
		return session.job, e
	}
	e = session.load(ctx, key)
	return session.job, e
}

// ImportReport returns the durable immutable reconciliation object, not a claim
// of current object health or independent/provider acceptance.
func (s *Service) ImportReport(ctx context.Context, scope Scope, key string) (ImportReconciliation, error) {
	var report ImportReconciliation
	session, e := s.importSession(ctx, scope, key)
	if e != nil {
		return report, e
	}
	defer session.close()
	if e = session.load(ctx, key); e != nil {
		return report, e
	}
	var object Object
	e = session.tx(ctx, func(tx pgx.Tx) error {
		var b []byte
		e := tx.QueryRow(ctx, "SELECT report_object FROM core.mail_import_reconciliation WHERE job_id=$1", session.job.ID).Scan(&b)
		if e == pgx.ErrNoRows {
			return ErrNotFound
		}
		if e != nil {
			return e
		}
		return json.Unmarshal(b, &object)
	})
	if e != nil {
		return report, e
	}
	if object.Key != session.prefix()+"/reports/"+object.SHA256+".json" {
		return report, ErrIntegrity
	}
	b, e := s.Objects.Get(ctx, object)
	if e != nil {
		return report, e
	}
	e = json.Unmarshal(b, &report)
	if e == nil && (report.Scope != scope || report.JobID != session.job.ID || report.SourceSHA256 != session.job.Spec.SourceSHA256) {
		return ImportReconciliation{}, ErrIntegrity
	}
	return report, e
}

// ExportImportSource streams the untouched staged master, including unsupported
// or malformed records. Success requires its aggregate source digest; any writer
// or read error leaves an explicitly partial export, never a completion receipt.
func (s *Service) ExportImportSource(ctx context.Context, scope Scope, key string, out io.Writer) error {
	session, e := s.importSession(ctx, scope, key)
	if e != nil {
		return e
	}
	defer session.close()
	if e = session.load(ctx, key); e != nil {
		return e
	}
	source, e := session.source(ctx)
	if e != nil {
		return e
	}
	h := sha256.New()
	n, e := io.Copy(io.MultiWriter(out, h), io.NewSectionReader(source, 0, session.job.Spec.SourceSize))
	if e != nil {
		return e
	}
	if n != session.job.Spec.SourceSize || hex.EncodeToString(h.Sum(nil)) != session.job.Spec.SourceSHA256 {
		return ErrIntegrity
	}
	return nil
}
