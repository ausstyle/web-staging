package mailstore

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func exercisePortability(t *testing.T, s *Service, admin *pgx.Conn, ctx context.Context) {
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	newScope := func() Scope {
		sc := Scope{uuid(), uuid(), uuid()}
		_, err := admin.Exec(ctx, `INSERT INTO core.tenants(tenant_id,region) VALUES($1,'local-portability')`, sc.Tenant)
		must(err)
		_, err = admin.Exec(ctx, `INSERT INTO core.mail_accounts VALUES($1,$2,'hosted','synthetic')`, sc.Tenant, sc.Account)
		must(err)
		_, err = admin.Exec(ctx, `INSERT INTO core.mailboxes VALUES($1,$2,$3,'Synthetic portable')`, sc.Tenant, sc.Account, sc.Mailbox)
		must(err)
		return sc
	}
	who := func() EditIdentity { return EditIdentity{"synthetic-portability", uuid()} }
	source := newScope()
	input := DraftInput{DraftID: uuid(), Subject: "Synthetic unsent 日本語", To: []string{"Synthetic <draft@example.invalid>"}, Text: "<script>never rendered</script>\r\nFrom preserved\n☁️"}
	_, err := s.SaveDraft(ctx, source, who(), input)
	must(err)
	original, err := s.GetDraft(ctx, source, input.DraftID)
	must(err)
	var archive bytes.Buffer
	manifest, err := s.ExportMailbox(ctx, source, &archive, 100)
	must(err)
	t.Run("draft_only_archive_exact_and_mbox_explicit_rejection", func(t *testing.T) {
		if manifest.Version != 4 || len(manifest.Messages) != 1 || manifest.Messages[0].Draft == nil {
			t.Fatal("draft not explicit")
		}
		p, err := InspectTAR(bytes.NewReader(archive.Bytes()), nil)
		must(err)
		if p.State != "READY" || len(p.Items) != 1 || !bytes.Equal(encoded(p.Items[0].Draft), encoded(original)) {
			t.Fatal("draft archive not lossless")
		}
		var mbox bytes.Buffer
		if _, err = s.ExportMailboxMBOXRD(ctx, source, &mbox, 100); err == nil || mbox.Len() != 0 {
			t.Fatal("draft converted to ordinary message")
		}
	})
	auth := &syntheticExportAuthority{scope: source}
	sp := ExportSpec{Key: uuid(), AdmissionRef: "synthetic-local-export-test", ExpiresAt: time.Now().Add(time.Hour), PartitionMessages: 1, ExceptionPolicy: "stop"}
	job, err := s.CreateExport(ctx, source, sp, auth)
	must(err)
	input.ExpectedVersion = 1
	input.Text = "Changed AFTER snapshot"
	_, err = s.SaveDraft(ctx, source, who(), input)
	must(err)
	var frozen bytes.Buffer
	t.Run("resumable_draft_snapshot_frozen_after_edit_and_interruption", func(t *testing.T) {
		faulty := *s
		faulty.fault = func(stage string) error {
			if stage == "export_after_part_objects" {
				return errors.New("synthetic stop")
			}
			return nil
		}
		if _, err = faulty.ResumeExport(ctx, source, sp.Key, auth); err == nil {
			t.Fatal("fault missed")
		}
		for n := 0; n < 10 && job.State != "COMPLETE"; n++ {
			job, err = s.ResumeExport(ctx, source, sp.Key, auth)
			must(err)
		}
		if job.State != "COMPLETE" || job.Expected != 1 || job.ExpectedDrafts != 1 {
			t.Fatal(job)
		}
		report, e := s.ReadExportReport(ctx, source, sp.Key, auth)
		must(e)
		if report.Version != 2 || report.ExportedDrafts != 1 || report.CounterUnit != "archive_records_including_drafts" {
			t.Fatal(report)
		}
		_, err = s.ReadExportPart(ctx, source, sp.Key, 1, 0, &frozen, auth)
		must(err)
		p, err := InspectTAR(bytes.NewReader(frozen.Bytes()), nil)
		must(err)
		if p.State != "READY" || !bytes.Equal(encoded(p.Items[0].Draft), encoded(original)) {
			t.Fatal("snapshot changed")
		}
	})
	stage := func(sc Scope, b []byte, mapping map[string]string) ImportJob {
		spec := ImportSpec{Key: uuid(), Format: "eml-tar", SourceSHA256: digest(b), SourceSize: int64(len(b)), Folder: "Portable", Cutoff: time.Now().UTC(), AdmissionRef: "synthetic-local-portable", CollectionMap: mapping}
		j, e := s.StageImport(ctx, sc, spec, bytes.NewReader(b))
		must(e)
		return j
	}
	finish := func(sc Scope, j ImportJob) ImportJob {
		for n := 0; n < 30 && j.State != "COMPLETE" && j.State != "COMPLETED_WITH_EXCEPTIONS" && j.State != "NEEDS_ACTION"; n++ {
			j, err = s.ResumeImport(ctx, sc, j.Spec.Key, 1)
			must(err)
		}
		return j
	}
	for _, fault := range []string{"edit_before_commit", "edit_after_commit", "import_after_draft_restore", "import_before_item_commit"} {
		t.Run("draft_restore_retry_"+fault, func(t *testing.T) {
			dest := newScope()
			j := stage(dest, frozen.Bytes(), nil)
			for j.State == "DISCOVERING" {
				j, err = s.ResumeImport(ctx, dest, j.Spec.Key, 1)
				must(err)
			}
			faulty := *s
			faulty.fault = func(stage string) error {
				if stage == fault {
					return errors.New("synthetic stop")
				}
				return nil
			}
			if _, err = faulty.ResumeImport(ctx, dest, j.Spec.Key, 1); err == nil {
				t.Fatal("fault missed")
			}
			j = finish(dest, j)
			if j.State != "COMPLETE" {
				t.Fatal(j.State)
			}
			report, err := s.ImportReport(ctx, dest, j.Spec.Key)
			must(err)
			if report.Verified != 1 || report.Exceptions != 0 {
				t.Fatal(report)
			}
			var id, receipt string
			must(admin.QueryRow(ctx, `SELECT draft_id::text,draft_receipt_id::text FROM core.mail_import_items WHERE job_id=$1`, j.ID).Scan(&id, &receipt))
			d, err := s.GetDraft(ctx, dest, id)
			must(err)
			if d.DraftID == original.DraftID {
				t.Fatal("source ID reused")
			}
			d.DraftID = original.DraftID
			if !bytes.Equal(encoded(d), encoded(original)) {
				t.Fatalf("draft changed: %s != %s", encoded(d), encoded(original))
			}
			var n int
			must(admin.QueryRow(ctx, `SELECT count(*) FROM core.mail_edit_receipts WHERE mailbox_id=$1`, dest.Mailbox).Scan(&n))
			if n != 1 {
				t.Fatal("duplicate receipt")
			}
			must(admin.QueryRow(ctx, `SELECT count(*) FROM core.messages WHERE mailbox_id=$1`, dest.Mailbox).Scan(&n))
			if n != 0 {
				t.Fatal("draft became inbound mail")
			}
			// A completed replay preserves later customer edits and the original receipt.
			_, err = s.SaveDraft(ctx, dest, who(), DraftInput{DraftID: id, ExpectedVersion: d.Version, Subject: d.Subject, To: d.To, Text: "Customer edit after import"})
			must(err)
			_, err = s.ResumeImport(ctx, dest, j.Spec.Key, 1)
			must(err)
			again, err := s.GetDraft(ctx, dest, id)
			must(err)
			if again.Text != "Customer edit after import" {
				t.Fatal("replay overwrote draft")
			}
			if _, err = s.GetDraft(ctx, source, id); !errors.Is(err, ErrNotFound) {
				t.Fatal("scope leaked")
			}
		})
	}

	t.Run("draft_edited_before_reconciliation_needs_action", func(t *testing.T) {
		dest := newScope()
		j := stage(dest, frozen.Bytes(), nil)
		for n := 0; n < 10 && j.State != "VERIFYING"; n++ {
			j, err = s.ResumeImport(ctx, dest, j.Spec.Key, 1)
			must(err)
		}
		var id string
		must(admin.QueryRow(ctx, `SELECT draft_id::text FROM core.mail_import_items WHERE job_id=$1`, j.ID).Scan(&id))
		_, err = s.SaveDraft(ctx, dest, who(), DraftInput{DraftID: id, ExpectedVersion: original.Version, Subject: "Customer changed draft", To: []string{}, Text: "Preserve this edit"})
		must(err)
		if _, err = s.ResumeImport(ctx, dest, j.Spec.Key, 1); err == nil {
			t.Fatal("changed draft reconciled as exact")
		}
		var state string
		must(admin.QueryRow(ctx, `SELECT state FROM core.mail_import_jobs WHERE job_id=$1`, j.ID).Scan(&state))
		if state != "NEEDS_ACTION" {
			t.Fatal(state)
		}
		if _, err = s.ImportReport(ctx, dest, j.Spec.Key); err == nil {
			t.Fatal("false completion report")
		}
		c, e := s.connection(ctx)
		must(e)
		defer c.Release()
		for _, properties := range []string{`{}`, `{"record_kind":null}`, `{"record_kind":"unknown"}`} {
			tx, e := scopedTx(ctx, c, dest)
			must(e)
			_, e = tx.Exec(ctx, `UPDATE core.mail_import_items SET properties=$2 WHERE job_id=$1`, j.ID, []byte(properties))
			tx.Rollback(ctx)
			if e == nil {
				t.Fatal("verified receipt binding bypassed")
			}
		}
	})
	t.Run("malformed_and_missing_draft_manifest_fail_closed", func(t *testing.T) {
		d := original
		raw := encoded(d)
		path := "drafts/" + d.DraftID + ".draft.json"
		for _, b := range [][]byte{testTAR(t, []string{path}, [][]byte{raw}), testTAR(t, []string{path, "manifest.json"}, [][]byte{append(raw, ' '), encoded(manifest)})} {
			sc := newScope()
			j := finish(sc, stage(sc, b, nil))
			if j.State != "NEEDS_ACTION" {
				t.Fatal("invalid draft accepted")
			}
			var n int
			must(admin.QueryRow(ctx, `SELECT count(*) FROM core.mail_drafts WHERE mailbox_id=$1`, sc.Mailbox).Scan(&n))
			if n != 0 {
				t.Fatal("invalid draft persisted")
			}
		}
	})

	t.Run("mixed_roundtrip_explicit_destination_mapping_and_atomic_replay", func(t *testing.T) {
		folder := CollectionInput{uuid(), "folder", "Projects"}
		label := CollectionInput{uuid(), "label", "Needs reply"}
		_, err = s.CreateCollection(ctx, source, who(), folder)
		must(err)
		_, err = s.CreateCollection(ctx, source, who(), label)
		must(err)
		msg, err := s.Ingest(ctx, Request{Scope: source, DeliveryID: uuid(), Source: "synthetic-portable", Raw: SyntheticFixture, Envelope: Envelope{From: "sender@example.invalid", To: []string{"receiver@example.invalid"}, ReceivedAt: time.Now().UTC().Truncate(time.Microsecond)}})
		must(err)
		_, err = s.OrganizeMessage(ctx, source, who(), OrganizationInput{msg.MessageID, 0, &folder.CollectionID, []string{label.CollectionID}})
		must(err)
		var mixed bytes.Buffer
		_, err = s.ExportMailbox(ctx, source, &mixed, 100)
		must(err)
		dest := newScope()
		df := CollectionInput{uuid(), "folder", folder.Name}
		dl := CollectionInput{uuid(), "label", label.Name}
		_, err = s.CreateCollection(ctx, dest, who(), df)
		must(err)
		_, err = s.CreateCollection(ctx, dest, who(), dl)
		must(err)
		mapping := map[string]string{folder.CollectionID: df.CollectionID, label.CollectionID: dl.CollectionID}
		j := stage(dest, mixed.Bytes(), mapping)
		for j.State == "DISCOVERING" {
			j, err = s.ResumeImport(ctx, dest, j.Spec.Key, 1)
			must(err)
		}
		faulty := *s
		faulty.fault = func(stage string) error {
			if stage == "import_before_item_commit" {
				return errors.New("rollback organization")
			}
			return nil
		}
		if _, err = faulty.ResumeImport(ctx, dest, j.Spec.Key, 1); err == nil {
			t.Fatal("fault missed")
		}
		var n int
		must(admin.QueryRow(ctx, `SELECT count(*) FROM core.mail_message_organization WHERE mailbox_id=$1`, dest.Mailbox).Scan(&n))
		if n != 0 {
			t.Fatal("partial mapping survived rollback")
		}
		j = finish(dest, j)
		if j.State != "COMPLETE" {
			t.Fatal(j.State)
		}
		report, err := s.ImportReport(ctx, dest, j.Spec.Key)
		must(err)
		if report.Verified != 3 || report.Exceptions != 0 {
			t.Fatal(report)
		}
		var restored bytes.Buffer
		round, err := s.ExportMailbox(ctx, dest, &restored, 100)
		must(err)
		if len(round.Messages) != 3 {
			t.Fatal("mixed records lost")
		}
		for _, m := range round.Messages {
			if m.Collections != nil {
				if len(m.Collections.Collections) != 2 {
					t.Fatal("collection inventory lost")
				}
				continue
			}
			if m.Draft != nil {
				if m.Draft.Text != input.Text {
					t.Fatal("draft content lost")
				}
				continue
			}
			if m.Raw.SHA256 != msg.Raw.SHA256 || m.Organization.Folder.CollectionID != df.CollectionID || len(m.Organization.Labels) != 1 || m.Organization.Labels[0].CollectionID != dl.CollectionID {
				t.Fatal("message mapping or original lost")
			}
		}
		t.Logf("local mixed roundtrip job=%s mailbox=%s verified=%d raw_sha256=%s", j.ID, dest.Mailbox, report.Verified, msg.Raw.SHA256)
		if path := os.Getenv("MAIL_TEST_PORTABILITY_EVIDENCE"); path != "" {
			evidence := map[string]any{"source_revision": os.Getenv("MAIL_TEST_SOURCE_REV"), "environment": "local-postgresql-17-filesystem", "scope": dest, "import_job": j, "reconciliation": report, "roundtrip_manifest": round, "provider_deployed": false, "independent_acceptance": false}
			b, e := json.MarshalIndent(evidence, "", "  ")
			must(e)
			must(os.WriteFile(path, b, 0600))
		}
		// A foreign collection ID never confers authority, even with explicit mapping.
		foreign := newScope()
		bad := stage(foreign, mixed.Bytes(), mapping)
		for bad.State == "DISCOVERING" {
			bad, err = s.ResumeImport(ctx, foreign, bad.Spec.Key, 1)
			must(err)
		}
		if _, err = s.ResumeImport(ctx, foreign, bad.Spec.Key, 1); err == nil {
			t.Fatal("foreign destination ID accepted")
		}
		must(admin.QueryRow(ctx, `SELECT count(*) FROM core.mail_message_organization WHERE mailbox_id=$1`, foreign.Mailbox).Scan(&n))
		if n != 0 {
			t.Fatal("cross-scope mapping written")
		}
		// Mutating an admitted map under the same key is an identity conflict.
		spec := j.Spec
		spec.CollectionMap = map[string]string{folder.CollectionID: folder.CollectionID, label.CollectionID: label.CollectionID}
		if _, err = s.StageImport(ctx, dest, spec, bytes.NewReader(mixed.Bytes())); !errors.Is(err, ErrConflict) {
			t.Fatal("mapping changed under same job key", err)
		}
	})
}
