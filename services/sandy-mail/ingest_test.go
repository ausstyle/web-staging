package mailstore

import (
	"archive/tar"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
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
	t.Run("synthetic_seed_repeat_and_collision", func(t *testing.T) {
		must(SeedSynthetic(ctx, admin, "local-synthetic"))
		must(SeedSynthetic(ctx, admin, "local-synthetic"))
		if e := SeedSynthetic(ctx, admin, "different-region"); e == nil {
			t.Fatal("fixture scope collision accepted")
		}
		var region string
		must(admin.QueryRow(ctx, "SELECT region FROM core.tenants WHERE tenant_id=$1", SyntheticScope.Tenant).Scan(&region))
		if region != "local-synthetic" {
			t.Fatal("collision changed existing fixture")
		}
	})
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
 GRANT UPDATE(attempts,last_error,updated_at,state) ON core.ingestions TO mail_test_worker;
 GRANT INSERT ON core.mail_import_jobs,core.mail_import_sources,core.mail_import_items,core.mail_import_checkpoints,core.mail_import_exceptions,core.mail_import_reconciliation TO mail_test_worker;
 REVOKE UPDATE ON core.mail_import_jobs,core.mail_import_sources,core.mail_import_items,core.mail_import_checkpoints,core.mail_import_exceptions,core.mail_import_reconciliation FROM mail_test_worker;
 GRANT UPDATE(state,inventory_complete,updated_at) ON core.mail_import_jobs TO mail_test_worker;
 GRANT UPDATE(manifest,complete) ON core.mail_import_sources TO mail_test_worker;
 GRANT UPDATE(state,message_id,receipt_id,flags,envelope,properties) ON core.mail_import_items TO mail_test_worker;
 GRANT UPDATE(cursor,item_count,chain_sha256) ON core.mail_import_checkpoints TO mail_test_worker;
 GRANT UPDATE(code,retryable,evidence,resolved) ON core.mail_import_exceptions TO mail_test_worker;
 GRANT UPDATE(flags) ON core.memberships TO mail_test_worker;
 GRANT INSERT ON core.mail_export_jobs,core.mail_export_items,core.mail_export_parts,core.mail_export_exceptions TO mail_test_worker;
 GRANT UPDATE(state,cursor,verified_part,verified_chain,report_object) ON core.mail_export_jobs TO mail_test_worker;
 GRANT UPDATE(state,part_number) ON core.mail_export_items TO mail_test_worker;
 GRANT UPDATE(code,retryable,resolved,evidence) ON core.mail_export_exceptions TO mail_test_worker;`)
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
	t.Run("scoped_search_and_keyset", func(t *testing.T) {
		items, e := service.List(ctx, r.Scope, "synthetic", nil, 100)
		must(e)
		if len(items) != 6 {
			t.Fatalf("expected six scoped messages, got %d", len(items))
		}
		var cursor *Cursor
		seen := map[string]bool{}
		for {
			page, e := service.List(ctx, r.Scope, "", cursor, 2)
			must(e)
			if len(page) == 0 {
				break
			}
			for _, it := range page {
				if seen[it.MessageID] {
					t.Fatal("duplicate page item")
				}
				seen[it.MessageID] = true
			}
			last := page[len(page)-1]
			cursor = &Cursor{last.ReceivedAt, last.MessageID}
		}
		if len(seen) != len(items) {
			t.Fatal("keyset skipped equal-timestamp messages")
		}
		for _, sc := range scopes[1:] {
			page, e := service.List(ctx, sc, "synthetic", nil, 100)
			must(e)
			if len(page) != 1 {
				t.Fatal("cross-scope search")
			}
			if seen[page[0].MessageID] {
				t.Fatal("cross-scope message leak")
			}
		}
		none, e := service.List(ctx, r.Scope, "noexistuniqueword", nil, 10)
		must(e)
		if len(none) != 0 {
			t.Fatal("false search result")
		}
	})
	t.Run("portable_eml_snapshot_export", func(t *testing.T) {
		var out bytes.Buffer
		manifest, e := service.ExportMailbox(ctx, r.Scope, &out, 100)
		must(e)
		if !manifest.Complete || len(manifest.Messages) != 6 || manifest.PendingIngestions != 1 {
			t.Fatal("incomplete snapshot")
		}
		reader := tar.NewReader(bytes.NewReader(out.Bytes()))
		originals := 0
		foundManifest := false
		for {
			h, e := reader.Next()
			if e == io.EOF {
				break
			}
			must(e)
			data, e := io.ReadAll(reader)
			must(e)
			if h.Name == "manifest.json" {
				var read ExportManifest
				must(json.Unmarshal(data, &read))
				if !read.Complete || len(read.Messages) != 6 {
					t.Fatal("manifest mismatch")
				}
				foundManifest = true
			} else {
				if !bytes.Equal(data, r.Raw) {
					t.Fatal("EML bytes changed")
				}
				parsed, e := Parse(data)
				must(e)
				if len(parsed.Attachments) != 1 {
					t.Fatal("attachments not portable")
				}
				originals++
			}
		}
		if !foundManifest || originals != 6 {
			t.Fatal("silent export omission")
		}
		var limited bytes.Buffer
		if m, e := service.ExportMailbox(ctx, r.Scope, &limited, 1); e == nil || m.Complete || limited.Len() != 0 {
			t.Fatal("partial export called success")
		}
		other := Scope{Tenant: uuid(), Account: uuid(), Mailbox: uuid()}
		if _, e := service.ExportMailbox(ctx, other, io.Discard, 100); !errors.Is(e, ErrNotFound) {
			t.Fatalf("unauthorized export: %v", e)
		}
	})
	t.Run("portable_export_restore_replay", func(t *testing.T) {
		target := Scope{r.Scope.Tenant, r.Scope.Account, uuid()}
		_, e := admin.Exec(ctx, "INSERT INTO core.mailboxes VALUES($1,$2,$3,'Synthetic Restore')", target.Tenant, target.Account, target.Mailbox)
		must(e)
		var archive bytes.Buffer
		exported, e := service.ExportMailbox(ctx, r.Scope, &archive, 100)
		must(e)
		preview, e := InspectTAR(bytes.NewReader(archive.Bytes()), nil)
		must(e)
		if len(preview.Items) != len(exported.Messages) || preview.PortableMetadata == nil {
			t.Fatal("inventory mismatch")
		}
		if exported.PendingIngestions > 0 && preview.State != "NEEDS_ACTION" {
			t.Fatal("pending source silently declared ready")
		}
		expected := map[string]ExportItem{}
		for _, item := range exported.Messages {
			expected[item.Path] = item
		}
		receipts := map[string]string{}
		for pass := 0; pass < 2; pass++ {
			_, e = InspectTAR(bytes.NewReader(archive.Bytes()), func(item ArchiveItem, raw []byte) error {
				source := expected[item.Path]
				var env Envelope
				if e := json.Unmarshal(source.Envelope, &env); e != nil {
					return e
				}
				env.ReceivedAt = source.ReceivedAt
				request := Request{Scope: target, DeliveryID: "archive:" + digest(archive.Bytes()) + ":" + digest([]byte(item.Path)), Source: "synthetic-eml-tar-restore", Envelope: env, Raw: raw}
				receipt, e := service.Ingest(ctx, request)
				if e != nil {
					return e
				}
				if pass == 0 {
					receipts[item.Path] = receipt.ID
				} else if receipt.ID != receipts[item.Path] {
					return fmt.Errorf("restore_replay_duplicated")
				}
				_, restored, e := service.Retrieve(ctx, target, request.DeliveryID)
				if e != nil {
					return e
				}
				if !bytes.Equal(raw, restored) || digest(restored) != item.SHA256 {
					return fmt.Errorf("restore_not_lossless")
				}
				return nil
			})
			must(e)
		}
		var restored bytes.Buffer
		manifest, e := service.ExportMailbox(ctx, target, &restored, 100)
		must(e)
		check, e := InspectTAR(bytes.NewReader(restored.Bytes()), nil)
		must(e)
		if check.State != "READY" || len(manifest.Messages) != len(exported.Messages) {
			t.Fatal("restore reconciliation failed")
		}
		t.Logf("synthetic archive source=%d restored=%d replay_receipts=%d bytes=%d", len(exported.Messages), len(manifest.Messages), len(receipts), archive.Len())
	})
	t.Run("offline_import_jobs", func(t *testing.T) { exerciseImportJobs(t, &service, admin, ctx, r.Scope) })
	t.Run("resumable_exports", func(t *testing.T) { exerciseExportJobs(t, &service, admin, ctx, r.Scope) })
	t.Run("receipt_outbox_atomicity", func(t *testing.T) {
		var messages, receipts, events int
		must(admin.QueryRow(ctx, `SELECT (SELECT count(*) FROM core.messages WHERE tenant_id=$1),(SELECT count(*) FROM core.inbound_receipts WHERE tenant_id=$1),(SELECT count(*) FROM core.outbox WHERE tenant_id=$1)`, r.Scope.Tenant).Scan(&messages, &receipts, &events))
		if messages != receipts || messages != events {
			t.Fatal("atomic counts differ")
		}
	})
}
