package mailstore

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"regexp"
	"strings"
	"time"
)

var ErrConflict = errors.New("delivery_identity_conflict")
var ErrNotFound = errors.New("message_not_found_or_not_authorized")
var idPattern = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)

// Scope is supplied by canonical API authentication/admission, never mail headers.
// This internal package is not a customer-facing API or authorization service.
type Scope struct{ Tenant, Account, Mailbox string }

func (s Scope) valid() bool {
	return idPattern.MatchString(s.Tenant) && idPattern.MatchString(s.Account) && idPattern.MatchString(s.Mailbox)
}

type Envelope struct {
	From       string    `json:"from"`
	To         []string  `json:"to"`
	ReceivedAt time.Time `json:"received_at"`
}
type Request struct {
	Scope      Scope
	DeliveryID string
	Source     string
	Envelope   Envelope
	Raw        []byte
}
type Receipt struct {
	ID              string    `json:"receipt_id"`
	MessageID       string    `json:"message_id"`
	DeliveryID      string    `json:"delivery_id"`
	Raw             Object    `json:"raw"`
	Ledger          Object    `json:"recovery_ledger"`
	AttachmentCount int       `json:"attachment_count"`
	Release         string    `json:"release_ref"`
	ObservedAt      time.Time `json:"observed_at"`
}
type Message struct {
	Receipt           Receipt  `json:"receipt"`
	Subject           string   `json:"subject"`
	InternetMessageID string   `json:"internet_message_id"`
	Text              string   `json:"text"`
	DisplayHTML       string   `json:"display_html"`
	SecurityState     string   `json:"security_state"`
	Attachments       []Object `json:"attachments"`
}
type Service struct {
	DB      *pgxpool.Pool
	Objects ObjectStore
	Release string
	fault   func(string) error
}

func uuid() string {
	var b [16]byte
	if _, e := rand.Read(b[:]); e != nil {
		panic(e)
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	s := hex.EncodeToString(b[:])
	return s[:8] + "-" + s[8:12] + "-" + s[12:16] + "-" + s[16:20] + "-" + s[20:]
}
func (s *Service) checkpoint(stage string) error {
	if s.fault != nil {
		return s.fault(stage)
	}
	return nil
}
func scopedTx(ctx context.Context, c *pgxpool.Conn, scope Scope) (pgx.Tx, error) {
	if !scope.valid() {
		return nil, fmt.Errorf("invalid_scope")
	}
	tx, err := c.Begin(ctx)
	if err != nil {
		return nil, err
	}
	_, err = tx.Exec(ctx, `SELECT set_config('mail.tenant_id',$1,true),set_config('mail.account_id',$2,true),set_config('mail.mailbox_id',$3,true),set_config('statement_timeout','30000',true)`, scope.Tenant, scope.Account, scope.Mailbox)
	if err != nil {
		tx.Rollback(ctx)
		return nil, err
	}
	return tx, nil
}
func (s *Service) connection(ctx context.Context) (*pgxpool.Conn, error) {
	c, err := s.DB.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	var unsafe bool
	err = c.QueryRow(ctx, `SELECT rolsuper OR rolbypassrls OR EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='core' AND pg_has_role(current_user,tableowner,'MEMBER')) FROM pg_roles WHERE rolname=current_user`).Scan(&unsafe)
	if err != nil || unsafe {
		c.Release()
		return nil, fmt.Errorf("non_owner_nobypassrls_runtime_required")
	}
	return c, nil
}
func (s *Service) Ingest(ctx context.Context, r Request) (receipt Receipt, err error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	if len(r.Envelope.From) > 320 {
		return receipt, fmt.Errorf("envelope_limit")
	}
	for _, to := range r.Envelope.To {
		if len(to) == 0 || len(to) > 320 {
			return receipt, fmt.Errorf("envelope_limit")
		}
	}
	if !r.Scope.valid() || len(r.Raw) == 0 || len(r.Raw) > MaxMessageBytes || len(r.DeliveryID) == 0 || len(r.DeliveryID) > 200 || r.Source == "" || len(r.Source) > 100 || len(r.Envelope.To) == 0 || len(r.Envelope.To) > 100 || r.Envelope.ReceivedAt.IsZero() || s.Release == "" {
		return receipt, fmt.Errorf("invalid_ingestion_request")
	}
	scope := r.Scope
	env, err := json.Marshal(r.Envelope)
	if err != nil {
		return receipt, err
	}
	canonical, _ := json.Marshal(struct {
		Source   string
		Envelope Envelope
		Raw      string
	}{r.Source, r.Envelope, digest(r.Raw)})
	inputHash := digest(canonical)
	key := "mail/v1/" + scope.Tenant + "/" + scope.Account + "/" + scope.Mailbox + "/" + digest([]byte(r.DeliveryID)) + "/original.eml"
	c, err := s.connection(ctx)
	if err != nil {
		return receipt, err
	}
	defer c.Release()
	// Crash-safe serialization. Hash collisions only serialize unrelated work.
	lockKey := scope.Tenant + scope.Account + scope.Mailbox + r.DeliveryID
	if _, err = c.Exec(ctx, "SELECT pg_advisory_lock(hashtextextended($1,239))", lockKey); err != nil {
		return receipt, err
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, e := c.Exec(cleanup, "SELECT pg_advisory_unlock(hashtextextended($1,239))", lockKey); e != nil {
			_ = c.Conn().Close(cleanup)
		}
	}()
	tx, err := scopedTx(ctx, c, scope)
	if err != nil {
		return receipt, err
	}
	defer tx.Rollback(ctx)
	var exists bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM core.mailboxes)").Scan(&exists); err != nil {
		return receipt, err
	}
	if !exists {
		return receipt, ErrNotFound
	}
	_, err = tx.Exec(ctx, `INSERT INTO core.ingestions(tenant_id,account_id,mailbox_id,delivery_id,input_sha256,raw_sha256,raw_size,raw_key,envelope,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`, scope.Tenant, scope.Account, scope.Mailbox, r.DeliveryID, inputHash, digest(r.Raw), len(r.Raw), key, env, r.Source)
	if err != nil {
		return receipt, err
	}
	var old, state string
	err = tx.QueryRow(ctx, `SELECT input_sha256,state FROM core.ingestions WHERE delivery_id=$1`, r.DeliveryID).Scan(&old, &state)
	if err != nil {
		return receipt, err
	}
	if old != inputHash {
		return receipt, ErrConflict
	}
	if state == "complete" {
		if err = tx.Commit(ctx); err != nil {
			return receipt, err
		}
		return s.readReceipt(ctx, c, scope, r.DeliveryID)
	}
	if _, err = tx.Exec(ctx, "UPDATE core.ingestions SET attempts=attempts+1,last_error=NULL,updated_at=now() WHERE delivery_id=$1", r.DeliveryID); err != nil {
		return receipt, err
	}
	if err = tx.Commit(ctx); err != nil {
		return receipt, err
	}
	// Durable, bounded error codes only; never store provider/parser PII in logs.
	defer func() {
		if err != nil {
			cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			t, e := scopedTx(cleanup, c, scope)
			if e == nil {
				defer t.Rollback(cleanup)
				_, e = t.Exec(cleanup, "UPDATE core.ingestions SET last_error='ingestion_failed_reconcile',updated_at=now() WHERE delivery_id=$1 AND state='pending'", r.DeliveryID)
				if e == nil {
					_ = t.Commit(cleanup)
				}
			}
		}
	}()
	ledgerBytes, _ := json.Marshal(struct {
		Version    int
		Scope      Scope
		DeliveryID string
		Source     string
		Envelope   Envelope
		RawSHA256  string
		RawSize    int
		RawKey     string
	}{1, scope, r.DeliveryID, r.Source, r.Envelope, digest(r.Raw), len(r.Raw), key})
	ledger, err := s.Objects.Put(ctx, strings.TrimSuffix(key, "/original.eml")+"/intake.json", ledgerBytes)
	if err != nil {
		return receipt, err
	}
	raw, err := s.Objects.Put(ctx, key, r.Raw)
	if err != nil {
		return receipt, err
	}
	if err = s.checkpoint("after_raw"); err != nil {
		return receipt, err
	}
	p, err := Parse(r.Raw)
	if err != nil {
		return receipt, err
	}
	for i := range p.Attachments {
		a := &p.Attachments[i]
		a.Object, err = s.Objects.Put(ctx, fmt.Sprintf("%s/parts/%d", strings.TrimSuffix(key, "/original.eml"), i), a.Data)
		if err != nil {
			return receipt, err
		}
	}
	if err = s.checkpoint("after_objects"); err != nil {
		return receipt, err
	}
	tx, err = scopedTx(ctx, c, scope)
	if err != nil {
		return receipt, err
	}
	defer tx.Rollback(ctx)
	mid, rid := uuid(), uuid()
	headers, _ := json.Marshal(p.Headers)
	recipients, _ := json.Marshal(r.Envelope.To)
	exec := func(q string, args ...any) error { _, e := tx.Exec(ctx, q, args...); return e }
	args := []any{scope.Tenant, scope.Account, scope.Mailbox, mid}
	if err = exec(`INSERT INTO core.messages(tenant_id,account_id,mailbox_id,message_id,delivery_id,internet_message_id,subject,headers,sent_at,received_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, append(args, r.DeliveryID, p.MessageID, p.Subject, headers, p.Date, r.Envelope.ReceivedAt)...); err != nil {
		return receipt, err
	}
	if err = exec(`INSERT INTO core.intake_objects VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, scope.Tenant, scope.Account, scope.Mailbox, r.DeliveryID, ledger.Key, ledger.Generation, ledger.SHA256, ledger.Size); err != nil {
		return receipt, err
	}
	for i, a := range p.Recipients {
		if err = exec(`INSERT INTO core.recipients VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, append(args, i, a.Kind, a.Name, a.Address)...); err != nil {
			return receipt, err
		}
	}
	if err = exec(`INSERT INTO core.envelopes VALUES($1,$2,$3,$4,$5,$6)`, append(args, r.Envelope.From, recipients)...); err != nil {
		return receipt, err
	}
	if err = exec(`INSERT INTO core.bodies VALUES($1,$2,$3,$4,$5,$6,$7)`, append(args, p.Text, p.HTML, p.DisplayHTML)...); err != nil {
		return receipt, err
	}
	if err = exec(`INSERT INTO core.mime_objects VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, append(args, raw.Key, raw.Generation, raw.SHA256, raw.Size)...); err != nil {
		return receipt, err
	}
	for i, a := range p.Attachments {
		if err = exec(`INSERT INTO core.attachments(tenant_id,account_id,mailbox_id,message_id,ordinal,filename,content_type,content_id,object_key,generation,sha256,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, append(args, i, a.Name, a.Type, a.ContentID, a.Object.Key, a.Object.Generation, a.Object.SHA256, a.Object.Size)...); err != nil {
			return receipt, err
		}
	}
	if err = exec(`INSERT INTO core.memberships(tenant_id,account_id,mailbox_id,message_id) VALUES($1,$2,$3,$4)`, args...); err != nil {
		return receipt, err
	}
	if err = exec(`INSERT INTO core.inbound_receipts(tenant_id,account_id,mailbox_id,message_id,receipt_id,delivery_id,raw_sha256,object_key,generation,attachment_count,release_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, append(args, rid, r.DeliveryID, raw.SHA256, raw.Key, raw.Generation, len(p.Attachments), s.Release)...); err != nil {
		return receipt, err
	}
	if err = exec(`INSERT INTO core.outbox(tenant_id,account_id,mailbox_id,message_id,event_id) VALUES($1,$2,$3,$4,$5)`, append(args, uuid())...); err != nil {
		return receipt, err
	}
	if err = exec(`UPDATE core.ingestions SET state='complete',updated_at=now() WHERE delivery_id=$1`, r.DeliveryID); err != nil {
		return receipt, err
	}
	if err = s.checkpoint("before_commit"); err != nil {
		return receipt, err
	}
	if err = tx.Commit(ctx); err != nil {
		return receipt, fmt.Errorf("commit_outcome_unknown_replay_same_identity: %w", err)
	}
	if err = s.checkpoint("after_commit"); err != nil {
		return receipt, err
	}
	return s.readReceipt(ctx, c, scope, r.DeliveryID)
}
func (s *Service) readReceipt(ctx context.Context, c *pgxpool.Conn, scope Scope, delivery string) (Receipt, error) {
	var r Receipt
	tx, err := scopedTx(ctx, c, scope)
	if err != nil {
		return r, err
	}
	defer tx.Rollback(ctx)
	err = tx.QueryRow(ctx, `SELECT r.receipt_id::text,r.message_id::text,r.delivery_id,r.object_key,r.generation,r.raw_sha256,o.size_bytes,r.attachment_count,r.release_ref,r.observed_at,l.object_key,l.generation,l.sha256,l.size_bytes FROM core.inbound_receipts r JOIN core.mime_objects o USING(tenant_id,account_id,mailbox_id,message_id) JOIN core.intake_objects l USING(tenant_id,account_id,mailbox_id,delivery_id) WHERE r.delivery_id=$1`, delivery).Scan(&r.ID, &r.MessageID, &r.DeliveryID, &r.Raw.Key, &r.Raw.Generation, &r.Raw.SHA256, &r.Raw.Size, &r.AttachmentCount, &r.Release, &r.ObservedAt, &r.Ledger.Key, &r.Ledger.Generation, &r.Ledger.SHA256, &r.Ledger.Size)
	if err == pgx.ErrNoRows {
		return r, ErrNotFound
	}
	if err != nil {
		return r, err
	}
	if _, err = s.Objects.Get(ctx, r.Raw); err != nil {
		return Receipt{}, err
	}
	if _, err = s.Objects.Get(ctx, r.Ledger); err != nil {
		return Receipt{}, err
	}
	rows, err := tx.Query(ctx, "SELECT object_key,generation,sha256,size_bytes FROM core.attachments WHERE message_id=$1 ORDER BY ordinal", r.MessageID)
	if err != nil {
		return Receipt{}, err
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var o Object
		if err = rows.Scan(&o.Key, &o.Generation, &o.SHA256, &o.Size); err != nil {
			return Receipt{}, err
		}
		if _, err = s.Objects.Get(ctx, o); err != nil {
			return Receipt{}, err
		}
		n++
	}
	if rows.Err() != nil {
		return Receipt{}, rows.Err()
	}
	if n != r.AttachmentCount {
		return Receipt{}, ErrIntegrity
	}
	return r, tx.Commit(ctx)
}

// Retrieve is an operator integrity read. Customer attachment downloads must be
// denied until scan_state=clean. No public content endpoint or signed URL exists.
func (s *Service) Retrieve(ctx context.Context, scope Scope, delivery string) (Message, []byte, error) {
	var m Message
	c, err := s.connection(ctx)
	if err != nil {
		return m, nil, err
	}
	defer c.Release()
	m.Receipt, err = s.readReceipt(ctx, c, scope, delivery)
	if err != nil {
		return Message{}, nil, err
	}
	tx, err := scopedTx(ctx, c, scope)
	if err != nil {
		return Message{}, nil, err
	}
	defer tx.Rollback(ctx)
	err = tx.QueryRow(ctx, `SELECT subject,internet_message_id,text_body,display_html,security_state FROM core.messages JOIN core.bodies USING(tenant_id,account_id,mailbox_id,message_id) WHERE message_id=$1`, m.Receipt.MessageID).Scan(&m.Subject, &m.InternetMessageID, &m.Text, &m.DisplayHTML, &m.SecurityState)
	if err != nil {
		return Message{}, nil, err
	}
	rows, err := tx.Query(ctx, "SELECT object_key,generation,sha256,size_bytes FROM core.attachments WHERE message_id=$1 ORDER BY ordinal", m.Receipt.MessageID)
	if err != nil {
		return Message{}, nil, err
	}
	for rows.Next() {
		var o Object
		if err = rows.Scan(&o.Key, &o.Generation, &o.SHA256, &o.Size); err != nil {
			rows.Close()
			return Message{}, nil, err
		}
		m.Attachments = append(m.Attachments, o)
	}
	rows.Close()
	if rows.Err() != nil {
		return Message{}, nil, rows.Err()
	}
	if err = tx.Commit(ctx); err != nil {
		return Message{}, nil, err
	}
	raw, err := s.Objects.Get(ctx, m.Receipt.Raw)
	return m, raw, err
}

// Recover reads admitted original objects. Missing originals are explicit errors;
// the edge must retain its queue copy until a verified receipt is returned.
func (s *Service) Recover(ctx context.Context, scope Scope, delivery string) (Receipt, error) {
	c, err := s.connection(ctx)
	if err != nil {
		return Receipt{}, err
	}
	tx, err := scopedTx(ctx, c, scope)
	if err != nil {
		c.Release()
		return Receipt{}, err
	}
	r := Request{Scope: scope, DeliveryID: delivery}
	var o Object
	var env []byte
	err = tx.QueryRow(ctx, `SELECT source,envelope,raw_key,raw_sha256,raw_size FROM core.ingestions WHERE delivery_id=$1`, delivery).Scan(&r.Source, &env, &o.Key, &o.SHA256, &o.Size)
	_ = tx.Rollback(ctx)
	c.Release()
	if err != nil {
		return Receipt{}, err
	}
	if err = json.Unmarshal(env, &r.Envelope); err != nil {
		return Receipt{}, err
	}
	switch objects := s.Objects.(type) {
	case GCSStore:
		g, e := objects.metadata(ctx, o.Key)
		if e != nil {
			return Receipt{}, e
		}
		o.Generation = g
	case LocalStore:
		o.Generation = 1
	default:
		return Receipt{}, fmt.Errorf("recovery_adapter_required")
	}
	r.Raw, err = s.Objects.Get(ctx, o)
	if err != nil {
		return Receipt{}, err
	}
	return s.Ingest(ctx, r)
}
