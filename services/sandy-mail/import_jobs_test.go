package mailstore

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func exerciseImportJobs(t *testing.T, service *Service, admin *pgx.Conn, ctx context.Context, parent Scope) {
	must := func(e error) {
		t.Helper()
		if e != nil {
			t.Fatal(e)
		}
	}
	newScope := func() Scope {
		sc := Scope{parent.Tenant, parent.Account, uuid()}
		_, e := admin.Exec(ctx, "INSERT INTO core.mailboxes VALUES($1,$2,$3,'Synthetic Import')", sc.Tenant, sc.Account, sc.Mailbox)
		must(e)
		return sc
	}
	makeSpec := func(format string, source []byte) ImportSpec {
		return ImportSpec{Key: uuid(), Format: format, SourceSHA256: digest(source), SourceSize: int64(len(source)), Folder: "Legacy/Inbox", Cutoff: time.Date(2026, 10, 24, 0, 0, 0, 0, time.UTC), MBOXTimezone: "UTC", AdmissionRef: "synthetic-local-test-admission-not-live-authority"}
	}
	drive := func(s *Service, sc Scope, spec ImportSpec) ImportJob {
		t.Helper()
		for step := 0; step < 100; step++ {
			job, e := s.ResumeImport(ctx, sc, spec.Key, 1)
			must(e)
			if job.State == "COMPLETE" || job.State == "COMPLETED_WITH_EXCEPTIONS" || job.State == "NEEDS_ACTION" {
				return job
			}
		}
		t.Fatal("import did not finish bounded fixture")
		return ImportJob{}
	}
	var archive bytes.Buffer
	raw := bytes.Replace(SyntheticFixture, []byte("Subject:"), []byte("Status: RO\r\nX-Status: AF\r\nX-Keywords: synthetic custom\r\nSubject:"), 1)
	for n := 0; n < 3; n++ {
		_, e := WriteMBOXRD(&archive, raw, "sender@example.invalid", time.Date(2026, 10, 24, 0, 0, n, 0, time.UTC))
		must(e)
	}
	t.Run("mbox_jobs_flags_receipts_and_master_export", func(t *testing.T) {
		sc := newScope()
		spec := makeSpec("mboxrd", archive.Bytes())
		job, e := service.StageImport(ctx, sc, spec, bytes.NewReader(archive.Bytes()))
		must(e)
		if job.State != "DISCOVERING" {
			t.Fatal(job)
		}
		job = drive(service, sc, spec)
		if job.State != "COMPLETE" {
			t.Fatal(job)
		}
		report, e := service.ImportReport(ctx, sc, spec.Key)
		must(e)
		if report.Expected != 3 || report.Verified != 3 || report.Exceptions != 0 || report.Pending != 0 || report.VerifiedBytes != int64(3*len(raw)) || report.IndependentAcceptance {
			t.Fatalf("reconciliation %+v", report)
		}
		t.Logf("import-job=%s expected=%d verified=%d exceptions=%d source_sha256=%s", job.ID, report.Expected, report.Verified, report.Exceptions, report.SourceSHA256)
		if evidence := os.Getenv("MAIL_TEST_IMPORT_EVIDENCE"); evidence != "" {
			proof := map[string]any{"environment": "local-postgresql-17-filesystem-not-cloudsql-gcs", "source_revision": os.Getenv("MAIL_TEST_SOURCE_REV"), "reconciliation": report, "original_raw_sha256": digest(raw), "same_message_id_distinct_source_items": 3, "cloud_deployed": false, "independent_provider_acceptance": false}
			must(os.WriteFile(evidence, append(encoded(proof), '\n'), 0600))
		}
		var restored bytes.Buffer
		must(service.ExportImportSource(ctx, sc, spec.Key, &restored))
		if !bytes.Equal(restored.Bytes(), archive.Bytes()) {
			t.Fatal("master source modified")
		}
		var flags []string
		must(admin.QueryRow(ctx, "SELECT flags FROM core.memberships WHERE mailbox_id=$1 LIMIT 1", sc.Mailbox).Scan(&flags))
		if fmt.Sprint(flags) != "[answered flagged seen]" {
			t.Fatal(flags)
		}
		for n := 0; n < 2; n++ {
			again, e := service.ResumeImport(ctx, sc, spec.Key, 1)
			must(e)
			if again.ID != job.ID {
				t.Fatal("job replay identity changed")
			}
		}
		var count int
		must(admin.QueryRow(ctx, "SELECT count(*) FROM core.messages WHERE mailbox_id=$1", sc.Mailbox).Scan(&count))
		if count != 3 {
			t.Fatal("duplicate source copies lost or replay duplicated")
		}
		other := newScope()
		if _, e = service.ImportReport(ctx, other, spec.Key); !errors.Is(e, ErrNotFound) {
			t.Fatalf("cross-mailbox report %v", e)
		}
		changed := spec
		changed.Folder = "changed"
		if _, e = service.StageImport(ctx, sc, changed, bytes.NewReader(archive.Bytes())); !errors.Is(e, ErrConflict) {
			t.Fatalf("job spec overwrite %v", e)
		}
	})
	for _, point := range []string{"import_after_stage_chunk", "import_after_discovery_object", "import_after_ingest", "import_before_item_commit", "import_after_item_commit", "import_after_report_object"} {
		t.Run("resume_"+point, func(t *testing.T) {
			sc := newScope()
			spec := makeSpec("mboxrd", archive.Bytes())
			s := *service
			fired := false
			s.fault = func(p string) error {
				if p == point && !fired {
					fired = true
					return errors.New("synthetic crash")
				}
				return nil
			}
			_, e := s.StageImport(ctx, sc, spec, bytes.NewReader(archive.Bytes()))
			if point == "import_after_stage_chunk" {
				if e == nil {
					t.Fatal("fault not reached")
				}
				s.fault = nil
				_, e = s.StageImport(ctx, sc, spec, bytes.NewReader(archive.Bytes()))
				must(e)
			} else {
				must(e)
				for step := 0; step < 100 && !fired; step++ {
					_, e = s.ResumeImport(ctx, sc, spec.Key, 1)
					if e != nil && !fired {
						t.Fatal(e)
					}
				}
				if !fired {
					t.Fatal("fault not reached")
				}
				s.fault = nil
			}
			job := drive(&s, sc, spec)
			if job.State != "COMPLETE" {
				t.Fatal(job)
			}
			report, e := s.ImportReport(ctx, sc, spec.Key)
			must(e)
			if report.Verified != 3 || report.Expected != 3 {
				t.Fatal(report)
			}
			var count int
			must(admin.QueryRow(ctx, "SELECT count(*) FROM core.messages WHERE mailbox_id=$1", sc.Mailbox).Scan(&count))
			if count != 3 {
				t.Fatal("crash duplicated message")
			}
		})
	}
	t.Run("maildir_explicit_exceptions_and_provenance", func(t *testing.T) {
		data := testTAR(t, []string{"Inbox/cur/a:2,FSz", "Archive/new/b", "legacy.pst"}, [][]byte{SyntheticFixture, SyntheticFixture, []byte("unsupported synthetic file")})
		sc := newScope()
		spec := makeSpec("eml-tar", data)
		job, e := service.StageImport(ctx, sc, spec, bytes.NewReader(data))
		must(e)
		job = drive(service, sc, spec)
		if job.State != "COMPLETED_WITH_EXCEPTIONS" {
			t.Fatal(job)
		}
		report, e := service.ImportReport(ctx, sc, spec.Key)
		must(e)
		if report.Expected != 3 || report.Verified != 2 || report.Exceptions != 1 {
			t.Fatal(report)
		}
		var folder string
		var props []byte
		var flags []string
		must(admin.QueryRow(ctx, "SELECT source_folder,flags,properties FROM core.mail_import_items WHERE job_id=$1 AND source_path='Inbox/cur/a:2,FSz'", job.ID).Scan(&folder, &flags, &props))
		var properties map[string]any
		must(json.Unmarshal(props, &properties))
		if folder != "Inbox" || properties["unmapped_flags"] != "z" || len(flags) != 2 {
			t.Fatal("source metadata lost")
		}
		var original bytes.Buffer
		must(service.ExportImportSource(ctx, sc, spec.Key, &original))
		if !bytes.Equal(original.Bytes(), data) {
			t.Fatal("unsupported source not preserved")
		}
	})
	t.Run("ambiguous_mbox_cannot_complete", func(t *testing.T) {
		data := append(append([]byte(nil), archive.Bytes()...), []byte("From ambiguous unescaped text\n")...)
		sc := newScope()
		spec := makeSpec("mboxrd", data)
		_, e := service.StageImport(ctx, sc, spec, bytes.NewReader(data))
		must(e)
		job := drive(service, sc, spec)
		if job.State != "NEEDS_ACTION" || job.InventoryComplete {
			t.Fatal("ambiguous input reported complete")
		}
		if _, e = service.ImportReport(ctx, sc, spec.Key); !errors.Is(e, ErrNotFound) {
			t.Fatal("unreconciled report exists")
		}
		var count int
		must(admin.QueryRow(ctx, "SELECT count(*) FROM core.messages WHERE mailbox_id=$1", sc.Mailbox).Scan(&count))
		if count != 0 {
			t.Fatal("import began before discovery completed")
		}
	})
	t.Run("source_outage_retries_without_losing_cursor", func(t *testing.T) {
		sc := newScope()
		spec := makeSpec("mboxrd", archive.Bytes())
		store := &interruptedImportStore{ObjectStore: service.Objects}
		s := *service
		s.Objects = store
		_, e := s.StageImport(ctx, sc, spec, bytes.NewReader(archive.Bytes()))
		must(e)
		store.fail = true
		job, e := s.ResumeImport(ctx, sc, spec.Key, 1)
		if e == nil || job.State != "DISCOVERING" {
			t.Fatalf("source outage %+v %v", job, e)
		}
		store.fail = false
		job = drive(&s, sc, spec)
		if job.State != "COMPLETE" {
			t.Fatal(job)
		}
	})
	t.Run("mbox_export_restore_with_portable_metadata", func(t *testing.T) {
		sc := newScope()
		spec := makeSpec("mboxrd", archive.Bytes())
		_, e := service.StageImport(ctx, sc, spec, bytes.NewReader(archive.Bytes()))
		must(e)
		drive(service, sc, spec)
		var output bytes.Buffer
		manifest, e := service.ExportMailboxMBOXRD(ctx, sc, &output, 100)
		must(e)
		if !manifest.Complete || len(manifest.Records) != 3 || manifest.SHA256 != digest(output.Bytes()) {
			t.Fatal("MBOX export manifest mismatch")
		}
		for _, item := range manifest.Metadata.Messages {
			if len(item.ImportOrigins) != 1 || len(item.Flags) != 3 {
				t.Fatal("portable source properties missing")
			}
		}
		var offset int64
		for n := 0; n < 3; n++ {
			record, e := NextMBOXRD(bytes.NewReader(output.Bytes()), int64(output.Len()), offset, time.UTC)
			must(e)
			if !bytes.Equal(record.Raw, raw) {
				t.Fatal("MBOX export raw changed")
			}
			offset = record.Next
		}
		var tarOutput bytes.Buffer
		portable, e := service.ExportMailbox(ctx, sc, &tarOutput, 100)
		must(e)
		dest := newScope()
		spec2 := makeSpec("eml-tar", tarOutput.Bytes())
		_, e = service.StageImport(ctx, dest, spec2, bytes.NewReader(tarOutput.Bytes()))
		must(e)
		job := drive(service, dest, spec2)
		if job.State != "COMPLETE" {
			t.Fatal(job)
		}
		var flags []string
		var properties []byte
		must(admin.QueryRow(ctx, "SELECT flags,properties FROM core.mail_import_items WHERE job_id=$1 ORDER BY ordinal LIMIT 1", job.ID).Scan(&flags, &properties))
		if len(flags) != 3 || !bytes.Contains(properties, []byte("import_origins")) || len(portable.Messages) != 3 {
			t.Fatal("restored portable properties lost")
		}
	})
	t.Run("concurrent_import_claim_is_nonblocking", func(t *testing.T) {
		sc := newScope()
		spec := makeSpec("mboxrd", archive.Bytes())
		_, e := service.StageImport(ctx, sc, spec, bytes.NewReader(archive.Bytes()))
		must(e)
		held, e := service.importSession(ctx, sc, spec.Key)
		must(e)
		_, e = service.ResumeImport(ctx, sc, spec.Key, 1)
		held.close()
		if !errors.Is(e, ErrImportBusy) {
			t.Fatalf("competing import claim %v", e)
		}
		if drive(service, sc, spec).State != "COMPLETE" {
			t.Fatal("claim did not recover")
		}
	})
	t.Run("chunked_master_and_malformed_message_reconcile", func(t *testing.T) {
		large := []byte("From: sender@example.invalid\nTo: fixture@example.invalid\nSubject: synthetic chunk test\n\n" + strings.Repeat("synthetic chunk boundary data\n", 40000))
		var source bytes.Buffer
		_, e := WriteMBOXRD(&source, large, "sender@example.invalid", time.Date(2026, 10, 24, 0, 0, 0, 0, time.UTC))
		must(e)
		source.WriteString("From sender@example.invalid Sat Oct 24 00:00:00 2026\nContent-Type: invalid; broken\n\nsynthetic malformed item\n\n")
		sc := newScope()
		spec := makeSpec("mboxrd", source.Bytes())
		s := *service
		fired := false
		s.fault = func(point string) error {
			if point == "import_after_stage_chunk" && !fired {
				fired = true
				return errors.New("interrupt multi-chunk source")
			}
			return nil
		}
		_, e = s.StageImport(ctx, sc, spec, bytes.NewReader(source.Bytes()))
		if e == nil {
			t.Fatal("stage interruption missing")
		}
		s.fault = nil
		_, e = s.StageImport(ctx, sc, spec, bytes.NewReader(source.Bytes()))
		must(e)
		job := drive(&s, sc, spec)
		if job.State != "COMPLETED_WITH_EXCEPTIONS" {
			t.Fatal(job)
		}
		report, e := s.ImportReport(ctx, sc, spec.Key)
		must(e)
		if report.Expected != 2 || report.Verified != 1 || report.Exceptions != 1 {
			t.Fatal(report)
		}
		var restored bytes.Buffer
		must(s.ExportImportSource(ctx, sc, spec.Key, &restored))
		if !bytes.Equal(restored.Bytes(), source.Bytes()) {
			t.Fatal("chunked master loss")
		}
		var parts int
		must(admin.QueryRow(ctx, "SELECT jsonb_array_length(manifest->'chunks') FROM core.mail_import_sources WHERE job_id=$1", job.ID).Scan(&parts))
		if parts < 2 {
			t.Fatal("multi-chunk path not exercised")
		}
	})
	t.Run("import_table_rls_and_column_grants", func(t *testing.T) {
		sc := newScope()
		spec := makeSpec("mboxrd", archive.Bytes())
		job, e := service.StageImport(ctx, sc, spec, bytes.NewReader(archive.Bytes()))
		must(e)
		drive(service, sc, spec)
		connection, e := service.connection(ctx)
		must(e)
		defer connection.Release()
		for _, scope := range []Scope{newScope(), {uuid(), uuid(), uuid()}} {
			tx, e := scopedTx(ctx, connection, scope)
			must(e)
			for _, table := range []string{"mail_import_jobs", "mail_import_sources", "mail_import_items", "mail_import_checkpoints", "mail_import_exceptions", "mail_import_reconciliation"} {
				var n int
				must(tx.QueryRow(ctx, "SELECT count(*) FROM core."+table+" WHERE job_id=$1", job.ID).Scan(&n))
				if n != 0 {
					t.Fatal("cross-scope import visibility")
				}
			}
			must(tx.Rollback(ctx))
		}
		var unsafe bool
		must(connection.QueryRow(ctx, "SELECT has_column_privilege(current_user,'core.mail_import_items','original_object','UPDATE') OR has_table_privilege(current_user,'core.mail_import_reconciliation','UPDATE') OR has_table_privilege(current_user,'core.mail_import_jobs','DELETE')").Scan(&unsafe))
		if unsafe {
			t.Fatal("import role can rewrite originals/reconciliation or delete jobs")
		}
	})
	t.Run("metadata_change_does_not_get_overwritten_or_false_complete", func(t *testing.T) {
		sc := newScope()
		spec := makeSpec("mboxrd", archive.Bytes())
		_, e := service.StageImport(ctx, sc, spec, bytes.NewReader(archive.Bytes()))
		must(e)
		var job ImportJob
		for step := 0; step < 50; step++ {
			job, e = service.ResumeImport(ctx, sc, spec.Key, 1)
			must(e)
			if job.State == "VERIFYING" {
				break
			}
		}
		if job.State != "VERIFYING" {
			t.Fatal("verification phase not reached")
		}
		_, e = admin.Exec(ctx, "UPDATE core.memberships SET flags=ARRAY['synthetic-user-change'] WHERE mailbox_id=$1", sc.Mailbox)
		must(e)
		job, e = service.ResumeImport(ctx, sc, spec.Key, 1)
		must(e)
		if job.State != "NEEDS_ACTION" {
			t.Fatal("metadata mismatch claimed complete")
		}
		if _, e = service.ImportReport(ctx, sc, spec.Key); !errors.Is(e, ErrNotFound) {
			t.Fatal("mismatch completion report exists")
		}
		var flags []string
		must(admin.QueryRow(ctx, "SELECT flags FROM core.memberships WHERE mailbox_id=$1 LIMIT 1", sc.Mailbox).Scan(&flags))
		if len(flags) != 1 || flags[0] != "synthetic-user-change" {
			t.Fatal("verification overwrote later change")
		}
	})
	t.Run("bulk_mbox_checkpoint_reconciliation", func(t *testing.T) {
		if os.Getenv("MAIL_TEST_BULK_1000") != "1" {
			t.Skip("opt-in 1000-message local PostgreSQL measurement")
		}
		const total = 1000
		var source bytes.Buffer
		for n := 0; n < total; n++ {
			_, e := WriteMBOXRD(&source, SyntheticFixture, "sender@example.invalid", time.Date(2026, 10, 24, 0, 0, 0, 0, time.UTC))
			must(e)
		}
		sc := newScope()
		spec := makeSpec("mboxrd", source.Bytes())
		started := time.Now()
		_, e := service.StageImport(ctx, sc, spec, bytes.NewReader(source.Bytes()))
		must(e)
		var job ImportJob
		for step := 0; step < 50; step++ {
			job, e = service.ResumeImport(ctx, sc, spec.Key, 100)
			must(e)
			if job.State == "COMPLETE" {
				break
			}
		}
		if job.State != "COMPLETE" {
			t.Fatal(job)
		}
		report, e := service.ImportReport(ctx, sc, spec.Key)
		must(e)
		if report.Expected != total || report.Verified != total || report.Exceptions != 0 {
			t.Fatal(report)
		}
		t.Logf("LOCAL_ONLY_BULK job=%s messages=%d bytes=%d elapsed_seconds=%.3f messages_per_second=%.2f source_sha256=%s", job.ID, total, len(source.Bytes()), time.Since(started).Seconds(), total/time.Since(started).Seconds(), spec.SourceSHA256)
	})
	t.Run("bad_source_hash_and_recovery", func(t *testing.T) {
		sc := newScope()
		spec := makeSpec("mboxrd", archive.Bytes())
		bad := append([]byte(nil), archive.Bytes()...)
		bad[50] ^= 1
		job, e := service.StageImport(ctx, sc, spec, bytes.NewReader(bad))
		if !errors.Is(e, ErrIntegrity) || job.State != "NEEDS_ACTION" {
			t.Fatalf("bad source %+v %v", job, e)
		}
		_, e = service.StageImport(ctx, sc, spec, bytes.NewReader(archive.Bytes()))
		must(e)
		job = drive(service, sc, spec)
		if job.State != "COMPLETE" {
			t.Fatal(job)
		}
	})
}

type interruptedImportStore struct {
	ObjectStore
	fail bool
}

func (s *interruptedImportStore) Get(ctx context.Context, o Object) ([]byte, error) {
	if s.fail && strings.Contains(o.Key, "/master/chunks/") {
		return nil, errors.New("synthetic source outage")
	}
	return s.ObjectStore.Get(ctx, o)
}
