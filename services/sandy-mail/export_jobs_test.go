package mailstore

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"io"
	"os"
	"strings"
	"testing"
	"time"
)

type syntheticExportAuthority struct {
	scope   Scope
	deny    bool
	purpose string
}

func (a *syntheticExportAuthority) CheckExport(_ context.Context, s Scope, spec ExportSpec, purpose string) error {
	if a.deny || a.purpose == purpose || s != a.scope || (purpose != "lookup" && spec.AdmissionRef != "synthetic-local-export-test") {
		return ErrExportAdmission
	}
	return nil
}

type unavailableExportObject struct {
	ObjectStore
	key     string
	failure error
}

func (s unavailableExportObject) Get(ctx context.Context, o Object) ([]byte, error) {
	if o.Key == s.key {
		return nil, s.failure
	}
	return s.ObjectStore.Get(ctx, o)
}
func exerciseExportJobs(t *testing.T, service *Service, admin *pgx.Conn, ctx context.Context, parent Scope) {
	must := func(e error) {
		t.Helper()
		if e != nil {
			t.Fatal(e)
		}
	}
	createSource := func(count int) (Scope, []Receipt) {
		sc := Scope{parent.Tenant, parent.Account, uuid()}
		_, e := admin.Exec(ctx, "INSERT INTO core.mailboxes VALUES($1,$2,$3,'Synthetic Export')", sc.Tenant, sc.Account, sc.Mailbox)
		must(e)
		receipts := []Receipt{}
		for n := 0; n < count; n++ {
			r, e := service.Ingest(ctx, Request{Scope: sc, DeliveryID: fmt.Sprintf("synthetic-export-%d", n), Source: "synthetic-export-fixture", Envelope: Envelope{From: "sender@example.invalid", To: []string{"fixture@example.invalid"}, ReceivedAt: time.Date(2026, 10, 24, 0, 0, n, 0, time.UTC)}, Raw: SyntheticFixture})
			must(e)
			receipts = append(receipts, r)
		}
		_, e = admin.Exec(ctx, "UPDATE core.memberships SET flags=ARRAY['seen'] WHERE mailbox_id=$1", sc.Mailbox)
		must(e)
		return sc, receipts
	}
	spec := func() ExportSpec {
		return ExportSpec{Key: uuid(), AdmissionRef: "synthetic-local-export-test", ExpiresAt: time.Now().UTC().Add(time.Hour).Truncate(time.Microsecond), PartitionMessages: 2, ExceptionPolicy: "stop"}
	}
	drive := func(s *Service, sc Scope, key string, a ExportAuthority) ExportJob {
		t.Helper()
		for n := 0; n < 100; n++ {
			j, e := s.ResumeExport(ctx, sc, key, a)
			must(e)
			if j.State == "COMPLETE" || j.State == "COMPLETED_WITH_EXCEPTIONS" {
				return j
			}
		}
		t.Fatal("export did not finish")
		return ExportJob{}
	}
	t.Run("frozen_snapshot_roundtrip_and_range_resume", func(t *testing.T) {
		sc, _ := createSource(3)
		a := &syntheticExportAuthority{scope: sc}
		sp := spec()
		job, e := service.CreateExport(ctx, sc, sp, a)
		must(e)
		_, e = service.Ingest(ctx, Request{Scope: sc, DeliveryID: "late-arrival", Source: "synthetic-export-fixture", Envelope: Envelope{From: "sender@example.invalid", To: []string{"fixture@example.invalid"}, ReceivedAt: time.Now()}, Raw: SyntheticFixture})
		must(e)
		_, e = admin.Exec(ctx, "UPDATE core.memberships SET flags=ARRAY['later-user-change'] WHERE mailbox_id=$1", sc.Mailbox)
		must(e)
		repeated, e := service.CreateExport(ctx, sc, sp, a)
		must(e)
		if repeated.ID != job.ID || repeated.Expected != 3 {
			t.Fatal("snapshot moved on retry")
		}
		changed := sp
		changed.PartitionMessages++
		if _, e = service.CreateExport(ctx, sc, changed, a); !errors.Is(e, ErrConflict) {
			t.Fatal("changed export spec accepted")
		}
		job = drive(service, sc, sp.Key, a)
		report, e := service.ReadExportReport(ctx, sc, sp.Key, a)
		must(e)
		if !report.Complete || report.Expected != 3 || report.Exported != 3 || report.PartCount != 2 || report.CustomerDelivered || report.IndependentAcceptance {
			t.Fatal(report)
		}
		total := 0
		for number := int64(1); number <= report.PartCount; number++ {
			var data bytes.Buffer
			part, e := service.ReadExportPart(ctx, sc, sp.Key, number, 0, &data, a)
			must(e)
			preview, e := InspectTAR(bytes.NewReader(data.Bytes()), func(_ ArchiveItem, raw []byte) error {
				if !bytes.Equal(raw, SyntheticFixture) {
					return ErrIntegrity
				}
				total++
				return nil
			})
			must(e)
			if preview.State != "READY" || preview.PortableMetadata == nil {
				t.Fatal("invalid portable part")
			}
			for _, item := range preview.PortableMetadata.Messages {
				if fmt.Sprint(item.Flags) != "[seen]" {
					t.Fatal("snapshot flags moved")
				}
			}
			var remainder bytes.Buffer
			_, e = service.ReadExportPart(ctx, sc, sp.Key, number, 513, &remainder, a)
			must(e)
			if !bytes.Equal(data.Bytes()[513:], remainder.Bytes()) || digest(data.Bytes()) != part.SHA256 {
				t.Fatal("range resume changed bytes")
			}
		}
		if total != 3 {
			t.Fatal("omitted snapshot messages")
		}
		if path := os.Getenv("MAIL_TEST_EXPORT_EVIDENCE"); path != "" {
			must(os.WriteFile(path, append(encoded(map[string]any{"environment": "local-postgresql-filesystem-not-cloudsql-gcs", "source_revision": os.Getenv("MAIL_TEST_SOURCE_REV"), "report": report, "raw_messages_checked": 3, "late_arrival_excluded_by_frozen_snapshot": true, "frozen_flags_verified": true, "range_resume_byte_equal": true, "cloud_deployed": false}), '\n'), 0600))
		}

		var flags []string
		must(admin.QueryRow(ctx, "SELECT flags FROM core.memberships WHERE mailbox_id=$1 LIMIT 1", sc.Mailbox).Scan(&flags))
		if fmt.Sprint(flags) != "[later-user-change]" {
			t.Fatal("export mutated source")
		}
	})
	for _, point := range []string{"export_after_chunk", "export_after_part_objects", "export_before_checkpoint_commit", "export_after_checkpoint_commit", "export_after_report_object"} {
		t.Run("resume_"+point, func(t *testing.T) {
			sc, _ := createSource(3)
			a := &syntheticExportAuthority{scope: sc}
			sp := spec()
			s := *service
			_, e := s.CreateExport(ctx, sc, sp, a)
			must(e)
			fired := false
			s.fault = func(p string) error {
				if p == point && !fired {
					fired = true
					return errors.New("synthetic export crash")
				}
				return nil
			}
			for n := 0; n < 100 && !fired; n++ {
				_, e = s.ResumeExport(ctx, sc, sp.Key, a)
				if e != nil && !fired {
					t.Fatal(e)
				}
			}
			if !fired {
				t.Fatal("fault not exercised")
			}
			s.fault = nil
			job := drive(&s, sc, sp.Key, a)
			report, e := s.ReadExportReport(ctx, sc, sp.Key, a)
			must(e)
			if report.Exported != 3 || report.PartCount != 2 || job.Cursor != 3 {
				t.Fatal("checkpoint duplicated/omitted")
			}
		})
	}
	t.Run("mandatory_authority_revocation_expiry_and_cancellation", func(t *testing.T) {
		sc, _ := createSource(3)
		sp := spec()
		if _, e := service.CreateExport(ctx, sc, sp, nil); !errors.Is(e, ErrExportAdmission) {
			t.Fatal("missing authority allowed")
		}
		a := &syntheticExportAuthority{scope: sc, deny: true}
		if _, e := service.CreateExport(ctx, sc, sp, a); !errors.Is(e, ErrExportAdmission) {
			t.Fatal("denied admission allowed")
		}
		a.deny = false
		job, e := service.CreateExport(ctx, sc, sp, a)
		must(e)
		a.purpose = "commit_part"
		if _, e = service.ResumeExport(ctx, sc, sp.Key, a); !errors.Is(e, ErrExportAdmission) {
			t.Fatal("revoked commit allowed")
		}
		var count int
		must(admin.QueryRow(ctx, "SELECT count(*) FROM core.mail_export_parts WHERE job_id=$1", job.ID).Scan(&count))
		if count != 0 {
			t.Fatal("denied commit advanced checkpoint")
		}
		a.purpose = ""
		drive(service, sc, sp.Key, a)
		a.purpose = "read_chunk"
		var b bytes.Buffer
		if _, e = service.ReadExportPart(ctx, sc, sp.Key, 1, 0, &b, a); !errors.Is(e, ErrExportAdmission) || b.Len() != 0 {
			t.Fatal("revoked chunk disclosure")
		}
		a.purpose = ""
		must(service.CancelExport(ctx, sc, sp.Key, a))
		if _, e = service.ReadExportPart(ctx, sc, sp.Key, 1, 0, io.Discard, a); e == nil {
			t.Fatal("cancelled download allowed")
		}
		expired := spec()
		job, e = service.CreateExport(ctx, sc, expired, a)
		must(e)
		_, e = admin.Exec(ctx, "UPDATE core.mail_export_jobs SET spec=jsonb_set(spec,'{expires_at}',to_jsonb($2::text)) WHERE job_id=$1", job.ID, time.Now().UTC().Add(-time.Minute).Format(time.RFC3339Nano))
		must(e)
		if _, e = service.ResumeExport(ctx, sc, expired.Key, a); e == nil {
			t.Fatal("expired export resumed")
		}
		progress, e := service.ReadExportStatus(ctx, sc, expired.Key, a)
		must(e)
		if !progress.Expired || progress.Remaining != 3 {
			t.Fatal("expiry progress unavailable")
		}

	})
	t.Run("explicit_exclusions_and_transient_recovery", func(t *testing.T) {
		sc, receipts := createSource(3)
		a := &syntheticExportAuthority{scope: sc}
		sp := spec()
		sp.ExceptionPolicy = "include-report"
		s := *service
		s.Objects = unavailableExportObject{ObjectStore: service.Objects, key: receipts[1].Raw.Key, failure: ErrObjectNotFound}
		_, e := s.CreateExport(ctx, sc, sp, a)
		must(e)
		drive(&s, sc, sp.Key, a)
		report, e := s.ReadExportReport(ctx, sc, sp.Key, a)
		must(e)
		if report.Complete || report.Exported != 2 || report.Excluded != 1 || report.State != "COMPLETED_WITH_EXCEPTIONS" {
			t.Fatal("missing source silently completed")
		}
		exceptions, e := s.ExportExceptionPage(ctx, sc, sp.Key, "", a)
		must(e)
		if len(exceptions) != 1 || exceptions[0].Resolved || exceptions[0].Retryable {
			t.Fatal("missing source exception lost")
		}
		var part bytes.Buffer
		_, e = s.ReadExportPart(ctx, sc, sp.Key, 1, 0, &part, a)
		must(e)
		preview, e := InspectTAR(bytes.NewReader(part.Bytes()), nil)
		must(e)
		if preview.State != "NEEDS_ACTION" || len(preview.PortableMetadata.Exclusions) != 1 {
			t.Fatal("archive concealed exclusion")
		}
		transient := spec()
		s.Objects = unavailableExportObject{ObjectStore: service.Objects, key: receipts[1].Raw.Key, failure: errors.New("synthetic temporary outage")}
		_, e = s.CreateExport(ctx, sc, transient, a)
		must(e)
		if _, e = s.ResumeExport(ctx, sc, transient.Key, a); e == nil {
			t.Fatal("outage ignored")
		}
		s.Objects = service.Objects
		drive(&s, sc, transient.Key, a)
		exceptions, e = s.ExportExceptionPage(ctx, sc, transient.Key, "", a)
		must(e)
		if len(exceptions) != 1 || !exceptions[0].Resolved {
			t.Fatal("recovered exception not retained/resolved")
		}
	})
	t.Run("pending_intake_is_not_silently_omitted", func(t *testing.T) {
		sc, _ := createSource(1)
		a := &syntheticExportAuthority{scope: sc}
		broken := []byte("malformed synthetic mail")
		_, e := service.Ingest(ctx, Request{Scope: sc, DeliveryID: "unparsed-source", Source: "synthetic-rfc822", Envelope: Envelope{To: []string{"fixture@example.invalid"}, ReceivedAt: time.Now()}, Raw: broken})
		if e == nil {
			t.Fatal("malformed fixture accepted")
		}
		stop := spec()
		job, e := service.CreateExport(ctx, sc, stop, a)
		must(e)
		if job.State != "NEEDS_ACTION" || job.PendingIngestions != 1 {
			t.Fatal("pending intake hidden")
		}
		partial := spec()
		partial.ExceptionPolicy = "include-report"
		_, e = service.CreateExport(ctx, sc, partial, a)
		must(e)
		drive(service, sc, partial.Key, a)
		report, e := service.ReadExportReport(ctx, sc, partial.Key, a)
		must(e)
		if report.Complete || report.PendingIngestions != 1 || report.Exported != 1 {
			t.Fatal(report)
		}
		exceptions, e := service.ExportExceptionPage(ctx, sc, partial.Key, "", a)
		must(e)
		if len(exceptions) != 1 || exceptions[0].Code != "pending_ingestion_at_snapshot" {
			t.Fatal(exceptions)
		}
	})
	t.Run("export_rls_and_immutable_snapshot_grants", func(t *testing.T) {
		sc, _ := createSource(1)
		a := &syntheticExportAuthority{scope: sc}
		sp := spec()
		job, e := service.CreateExport(ctx, sc, sp, a)
		must(e)
		drive(service, sc, sp.Key, a)
		other, _ := createSource(1)
		otherAuthority := &syntheticExportAuthority{scope: other}
		if _, e = service.ReadExportReport(ctx, other, sp.Key, otherAuthority); !errors.Is(e, ErrNotFound) {
			t.Fatal("cross mailbox report visible")
		}
		c, e := service.connection(ctx)
		must(e)
		defer c.Release()
		tx, e := scopedTx(ctx, c, other)
		must(e)
		for _, name := range []string{"mail_export_jobs", "mail_export_items", "mail_export_parts", "mail_export_exceptions"} {
			var n int
			must(tx.QueryRow(ctx, "SELECT count(*) FROM core."+name+" WHERE job_id=$1", job.ID).Scan(&n))
			if n != 0 {
				t.Fatal("export cross-scope visibility")
			}
		}
		must(tx.Rollback(ctx))
		var unsafe bool
		must(c.QueryRow(ctx, "SELECT has_column_privilege(current_user,'core.mail_export_items','snapshot','UPDATE') OR has_table_privilege(current_user,'core.mail_export_parts','UPDATE') OR has_table_privilege(current_user,'core.mail_export_jobs','DELETE')").Scan(&unsafe))
		if unsafe {
			t.Fatal("export worker can rewrite snapshots/parts")
		}
	})
	t.Run("multi_chunk_export_and_corrupt_part_readback", func(t *testing.T) {
		sc, _ := createSource(1)
		a := &syntheticExportAuthority{scope: sc}
		sp := spec()
		sp.PartitionMessages = 1
		large := []byte("From: sender@example.invalid\nTo: fixture@example.invalid\nSubject: large synthetic export\n\n" + strings.Repeat("synthetic export chunk boundary\n", 50000))
		_, e := service.Ingest(ctx, Request{Scope: sc, DeliveryID: "large-synthetic-export", Source: "synthetic-export-fixture", Envelope: Envelope{From: "sender@example.invalid", To: []string{"fixture@example.invalid"}, ReceivedAt: time.Date(2026, 10, 24, 0, 0, 1, 0, time.UTC)}, Raw: large})
		must(e)
		_, e = service.CreateExport(ctx, sc, sp, a)
		must(e)
		drive(service, sc, sp.Key, a)
		var full bytes.Buffer
		part, e := service.ReadExportPart(ctx, sc, sp.Key, 2, 0, &full, a)
		must(e)
		if len(part.Chunks) < 2 {
			t.Fatal("chunk boundary not exercised")
		}
		var remainder bytes.Buffer
		_, e = service.ReadExportPart(ctx, sc, sp.Key, 2, ImportChunkBytes+123, &remainder, a)
		must(e)
		if !bytes.Equal(full.Bytes()[ImportChunkBytes+123:], remainder.Bytes()) {
			t.Fatal("range spanning chunks changed bytes")
		}
		s := *service
		s.Objects = unavailableExportObject{ObjectStore: service.Objects, key: part.Chunks[1].Key, failure: ErrIntegrity}
		if _, e = s.ReadExportPart(ctx, sc, sp.Key, 2, 0, io.Discard, a); !errors.Is(e, ErrIntegrity) {
			t.Fatal("corrupt archive claimed successful delivery")
		}
	})
	t.Run("bounded_1000_message_export", func(t *testing.T) {
		if os.Getenv("MAIL_TEST_EXPORT_1000") != "1" {
			t.Skip("opt-in local export scale fixture")
		}
		sc, _ := createSource(1000)
		a := &syntheticExportAuthority{scope: sc}
		sp := spec()
		sp.PartitionMessages = 100
		started := time.Now()
		job, e := service.CreateExport(ctx, sc, sp, a)
		must(e)
		job = drive(service, sc, sp.Key, a)
		report, e := service.ReadExportReport(ctx, sc, sp.Key, a)
		must(e)
		if !report.Complete || report.Exported != 1000 || report.PartCount != 10 {
			t.Fatal(report)
		}
		count := 0
		archives := [][]byte{}
		for part := int64(1); part <= report.PartCount; part++ {
			var output bytes.Buffer
			_, e = service.ReadExportPart(ctx, sc, sp.Key, part, 0, &output, a)
			must(e)
			preview, e := InspectTAR(bytes.NewReader(output.Bytes()), func(_ ArchiveItem, raw []byte) error {
				if !bytes.Equal(raw, SyntheticFixture) {
					return ErrIntegrity
				}
				count++
				return nil
			})
			must(e)
			if preview.State != "READY" {
				t.Fatal("invalid portable part")
			}
			archives = append(archives, append([]byte(nil), output.Bytes()...))
		}
		if count != 1000 {
			t.Fatal("bulk export omission")
		}
		t.Logf("LOCAL_EXPORT_ONLY job=%s messages=1000 parts=10 elapsed_seconds=%.3f", job.ID, time.Since(started).Seconds())
		destination, _ := createSource(0)
		restoreStarted := time.Now()
		for number, data := range archives {
			importSpec := ImportSpec{Key: fmt.Sprintf("restore-%s-%d", job.ID, number), Format: "eml-tar", SourceSHA256: digest(data), SourceSize: int64(len(data)), Cutoff: report.SnapshotAt, Folder: "Synthetic Export Restore", AdmissionRef: "synthetic-local-export-restore"}
			_, e = service.StageImport(ctx, destination, importSpec, bytes.NewReader(data))
			must(e)
			var imported ImportJob
			for attempt := 0; attempt < 10; attempt++ {
				imported, e = service.ResumeImport(ctx, destination, importSpec.Key, 100)
				must(e)
				if imported.State == "COMPLETE" {
					break
				}
			}
			if imported.State != "COMPLETE" {
				t.Fatal("export partition not restorable")
			}
		}
		var restored, seen int
		must(admin.QueryRow(ctx, "SELECT count(*),count(*) FILTER(WHERE flags=ARRAY['seen']) FROM core.memberships WHERE mailbox_id=$1", destination.Mailbox).Scan(&restored, &seen))
		if restored != 1000 || seen != 1000 {
			t.Fatal("restored snapshot count/flags mismatch")
		}
		t.Logf("LOCAL_EXPORT_RESTORE destination=%s messages=%d flags_verified=%d elapsed_seconds=%.3f", destination.Mailbox, restored, seen, time.Since(restoreStarted).Seconds())

		if path := os.Getenv("MAIL_TEST_EXPORT_EVIDENCE"); path != "" {
			must(os.WriteFile(path, append(encoded(map[string]any{"environment": "local-postgresql-filesystem-not-cloudsql-gcs", "source_revision": os.Getenv("MAIL_TEST_SOURCE_REV"), "report": report, "raw_messages_checked": 1000, "restored_messages": restored, "restored_flags_verified": seen, "restored_scope": destination, "job_key": sp.Key, "cloud_deployed": false}), '\n'), 0600))
		}
	})
}
