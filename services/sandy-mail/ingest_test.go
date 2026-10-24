package mailstore

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func fixture(t *testing.T) []byte {
	t.Helper()
	b, e := os.ReadFile("testdata/first-email.eml")
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func TestParserAndLimits(t *testing.T) {
	p, e := Parse(fixture(t))
	if e != nil {
		t.Fatal(e)
	}
	if p.Subject != "Sandy Mail synthetic first ingest ✓" || !strings.Contains(p.Text, "Receipt test ✓") || len(p.Attachments) != 1 || string(p.Attachments[0].Data) != "Sandy Mail synthetic attachment.\n" {
		t.Fatalf("incorrect MIME parse: %+v", p)
	}
	if strings.Contains(p.DisplayHTML, "<script>") || strings.Contains(p.DisplayHTML, "<img") {
		t.Fatal("active display HTML")
	}
	for _, b := range [][]byte{nil, bytes.Repeat([]byte("x"), MaxMessageBytes+1), []byte("Content-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\ninvalid")} {
		if _, e = Parse(b); e == nil {
			t.Fatal("invalid input accepted")
		}
	}
}
func TestLocalObjectImmutability(t *testing.T) {
	s := LocalStore{t.TempDir()}
	ctx := context.Background()
	o, e := s.Put(ctx, "mail/v1/a/original.eml", []byte("first"))
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Put(ctx, o.Key, []byte("second")); !errors.Is(e, ErrIntegrity) {
		t.Fatalf("overwrite not rejected: %v", e)
	}
	b, e := s.Get(ctx, o)
	if e != nil || string(b) != "first" {
		t.Fatal("original lost")
	}
}
func TestPostgresIntegration(t *testing.T) {
	dsn := os.Getenv("MAIL_TEST_ADMIN_DSN")
	if dsn == "" {
		t.Skip("set MAIL_TEST_ADMIN_DSN for isolated PostgreSQL 17 integration")
	}
	cfg, e := pgx.ParseConfig(dsn)
	if e != nil {
		t.Fatal(e)
	}
	if cfg.Host != "127.0.0.1" || cfg.Database != "sandy_mail_test" {
		t.Fatal("test_requires_local_disposable_database")
	}
	ctx := context.Background()
	admin, e := pgx.ConnectConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer admin.Close(ctx)
	must := func(e error) {
		t.Helper()
		if e != nil {
			t.Fatal(e)
		}
	}
	must(Migrate(ctx, admin))
	must(Migrate(ctx, admin))
	// Tampering with a historical migration must fail closed, then restore it.
	var checksum string
	must(admin.QueryRow(ctx, "SELECT sha256 FROM public.sandy_mail_migrations WHERE version='0001_mail_core.sql'").Scan(&checksum))
	_, e = admin.Exec(ctx, "UPDATE public.sandy_mail_migrations SET sha256='tampered' WHERE version='0001_mail_core.sql'")
	must(e)
	if e = Migrate(ctx, admin); e == nil {
		t.Fatal("migration drift accepted")
	}
	_, e = admin.Exec(ctx, "UPDATE public.sandy_mail_migrations SET sha256=$1 WHERE version='0001_mail_core.sql'", checksum)
	must(e)
	// These roles exist only in this disposable loopback test database/server.
	_, e = admin.Exec(ctx, `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mail_test_worker') THEN CREATE ROLE mail_test_worker LOGIN PASSWORD 'synthetic-local-only' NOSUPERUSER NOBYPASSRLS; END IF; END $$;
 GRANT USAGE ON SCHEMA core TO mail_test_worker;
 GRANT SELECT ON ALL TABLES IN SCHEMA core TO mail_test_worker;
 GRANT INSERT ON core.intake_objects,core.recipients,core.ingestions,core.messages,core.envelopes,core.bodies,core.mime_objects,core.attachments,core.memberships,core.inbound_receipts,core.outbox TO mail_test_worker;
 GRANT UPDATE(attempts,last_error,updated_at,state) ON core.ingestions TO mail_test_worker;`)
	must(e)
	workerCfg, e := pgxpool.ParseConfig(dsn)
	must(e)
	workerCfg.ConnConfig.User = "mail_test_worker"
	workerCfg.ConnConfig.Password = "synthetic-local-only"
	pool, e := pgxpool.NewWithConfig(ctx, workerCfg)
	must(e)
	defer pool.Close()
	scopes := []Scope{{uuid(), uuid(), uuid()}, {uuid(), uuid(), uuid()}}
	scopes = append(scopes, Scope{scopes[0].Tenant, scopes[0].Account, uuid()}, Scope{scopes[0].Tenant, uuid(), uuid()})
	for _, sc := range scopes {
		_, e = admin.Exec(ctx, "INSERT INTO core.tenants(tenant_id,region) VALUES($1,'local-test') ON CONFLICT DO NOTHING", sc.Tenant)
		must(e)
		_, e = admin.Exec(ctx, "INSERT INTO core.mail_accounts VALUES($1,$2,'hosted','synthetic') ON CONFLICT DO NOTHING", sc.Tenant, sc.Account)
		must(e)
		_, e = admin.Exec(ctx, "INSERT INTO core.mailboxes VALUES($1,$2,$3,'Synthetic Inbox')", sc.Tenant, sc.Account, sc.Mailbox)
		must(e)
	}
	root := os.Getenv("MAIL_TEST_OBJECT_DIR")
	if root == "" {
		root = t.TempDir()
	}
	service := Service{DB: pool, Objects: LocalStore{root}, Release: "local-source-under-test"}
	r := Request{Scope: scopes[0], DeliveryID: "synthetic-first-001", Source: "synthetic-rfc822", Envelope: Envelope{From: "sender@example.invalid", To: []string{"first-ingest@example.invalid"}, ReceivedAt: time.Date(2026, 10, 24, 0, 0, 0, 0, time.UTC)}, Raw: fixture(t)}
	receipt, e := service.Ingest(ctx, r)
	must(e)
	m, b, e := service.Retrieve(ctx, r.Scope, r.DeliveryID)
	must(e)
	if !bytes.Equal(b, r.Raw) || m.Subject != "Sandy Mail synthetic first ingest ✓" || m.SecurityState != "quarantined" || receipt.AttachmentCount != 1 {
		t.Fatal("readback mismatch")
	}
	// PostgreSQL evidence survives closing this connection/pool and re-reading.
	bjson, _ := json.MarshalIndent(map[string]any{"environment": "local-postgresql-17-filesystem-not-cloudsql-gcs", "source_scope": "PR239@b1d499f8dd946b6fda11e0cfcaa1f508ec435a08", "scope": r.Scope, "message": m, "raw_byte_equal": bytes.Equal(b, r.Raw), "external_messages_sent": 0}, "", "  ")
	if evidence := os.Getenv("MAIL_TEST_EVIDENCE"); evidence != "" {
		must(os.WriteFile(evidence, bjson, 0600))
	}
	t.Logf("first-email receipt=%s message=%s sha256=%s bytes=%d", receipt.ID, receipt.MessageID, receipt.Raw.SHA256, receipt.Raw.Size)
	t.Run("concurrent_retries", func(t *testing.T) {
		var wg sync.WaitGroup
		for i := 0; i < 12; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				rr, e := service.Ingest(ctx, r)
				if e != nil || rr.ID != receipt.ID {
					t.Errorf("replay mismatch: %v", e)
				}
			}()
		}
		wg.Wait()
	})
	t.Run("same_identity_different_input", func(t *testing.T) {
		changed := r
		changed.Raw = append(append([]byte{}, r.Raw...), []byte("changed")...)
		if _, e := service.Ingest(ctx, changed); !errors.Is(e, ErrConflict) {
			t.Fatalf("%v", e)
		}
		changed = r
		changed.Envelope.From = "other@example.invalid"
		if _, e := service.Ingest(ctx, changed); !errors.Is(e, ErrConflict) {
			t.Fatalf("envelope conflict: %v", e)
		}
	})
	t.Run("same_message_id_distinct_delivery", func(t *testing.T) {
		other := r
		other.DeliveryID = "legitimate-copy"
		rr, e := service.Ingest(ctx, other)
		must(e)
		if rr.MessageID == receipt.MessageID {
			t.Fatal("legitimate copy deduped")
		}
	})
	t.Run("tenant_account_mailbox_isolation", func(t *testing.T) {
		for _, sc := range scopes[1:] {
			if _, _, e := service.Retrieve(ctx, sc, r.DeliveryID); !errors.Is(e, ErrNotFound) {
				t.Fatalf("cross-scope leak: %v", e)
			}
			other := r
			other.Scope = sc
			rr, e := service.Ingest(ctx, other)
			must(e)
			if rr.Raw.Key == receipt.Raw.Key || rr.MessageID == receipt.MessageID {
				t.Fatal("cross-scope collision")
			}
		}
	})
	t.Run("missing_context_and_privileges", func(t *testing.T) {
		c, e := pool.Acquire(ctx)
		must(e)
		defer c.Release()
		var n int
		must(c.QueryRow(ctx, "SELECT count(*) FROM core.messages").Scan(&n))
		if n != 0 {
			t.Fatal("RLS not fail-closed")
		}
		for _, q := range []string{"UPDATE core.inbound_receipts SET release_ref='forged'", "DELETE FROM core.inbound_receipts", "TRUNCATE core.messages", "ALTER TABLE core.messages DISABLE ROW LEVEL SECURITY"} {
			if _, e = c.Exec(ctx, q); e == nil {
				t.Fatalf("privilege allowed: %s", q)
			}
		}
	})
	t.Run("wrong_scope_write", func(t *testing.T) {
		c, e := pool.Acquire(ctx)
		must(e)
		defer c.Release()
		tx, e := scopedTx(ctx, c, r.Scope)
		must(e)
		defer tx.Rollback(ctx)
		_, e = tx.Exec(ctx, "INSERT INTO core.ingestions(tenant_id,account_id,mailbox_id,delivery_id,input_sha256,raw_sha256,raw_size,raw_key,envelope,source) SELECT $1,account_id,mailbox_id,'forged',input_sha256,raw_sha256,raw_size,raw_key,envelope,source FROM core.ingestions LIMIT 1", scopes[1].Tenant)
		if e == nil {
			t.Fatal("cross-tenant insert allowed")
		}
	})
	for _, stage := range []string{"after_raw", "after_objects", "before_commit", "after_commit"} {
		t.Run("recover_"+stage, func(t *testing.T) {
			faulty := service
			faulty.fault = func(s string) error {
				if s == stage {
					return errors.New("injected_crash")
				}
				return nil
			}
			failed := r
			failed.DeliveryID = "fault-" + stage
			if _, e := faulty.Ingest(ctx, failed); e == nil {
				t.Fatal("fault did not fire")
			}
			var count int
			must(admin.QueryRow(ctx, "SELECT count(*) FROM core.messages WHERE tenant_id=$1 AND delivery_id=$2", r.Scope.Tenant, failed.DeliveryID).Scan(&count))
			want := 0
			if stage == "after_commit" {
				want = 1
			}
			if count != want {
				t.Fatalf("partial SQL commit %d", count)
			}
			rr, e := service.Recover(ctx, r.Scope, failed.DeliveryID)
			must(e)
			again, e := service.Ingest(ctx, failed)
			must(e)
			if rr.ID != again.ID {
				t.Fatal("recovery duplicate")
			}
		})
	}
	t.Run("malformed_mime_retained_pending", func(t *testing.T) {
		bad := r
		bad.DeliveryID = "bad-mime"
		bad.Raw = []byte("Content-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\ninvalid")
		if _, e := service.Ingest(ctx, bad); e == nil {
			t.Fatal("bad MIME accepted")
		}
		var state, code string
		must(admin.QueryRow(ctx, "SELECT state,last_error FROM core.ingestions WHERE tenant_id=$1 AND delivery_id='bad-mime'", r.Scope.Tenant).Scan(&state, &code))
		if state != "pending" || code == "" {
			t.Fatal("missing failure ledger")
		}
	})
	t.Run("corruption_and_missing_object", func(t *testing.T) {
		path := filepath.Join(root, receipt.Raw.Key)
		must(os.WriteFile(path, []byte("corrupt"), 0600))
		if _, e := service.Ingest(ctx, r); !errors.Is(e, ErrIntegrity) {
			t.Fatalf("corrupt replay: %v", e)
		}
		must(os.WriteFile(path, r.Raw, 0600))
		a := m.Attachments[0]
		ap := filepath.Join(root, a.Key)
		saved, e := os.ReadFile(ap)
		must(e)
		must(os.Remove(ap))
		if _, e := service.Ingest(ctx, r); e == nil {
			t.Fatal("missing attachment accepted")
		}
		must(os.WriteFile(ap, saved, 0600))
	})
	t.Run("receipt_outbox_atomicity", func(t *testing.T) {
		var messages, receipts, events int
		must(admin.QueryRow(ctx, `SELECT (SELECT count(*) FROM core.messages WHERE tenant_id=$1),(SELECT count(*) FROM core.inbound_receipts WHERE tenant_id=$1),(SELECT count(*) FROM core.outbox WHERE tenant_id=$1)`, r.Scope.Tenant).Scan(&messages, &receipts, &events))
		if messages != receipts || messages != events {
			t.Fatal("atomic counts differ")
		}
	})
}
