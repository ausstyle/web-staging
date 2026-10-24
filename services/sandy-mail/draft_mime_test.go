package mailstore

import (
	"archive/tar"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// Authored solely for this test. Every address is reserved .invalid; no copied mail.
var syntheticDraftMIME = []byte(strings.ReplaceAll(`From: Synthetic Author <author@example.invalid>
Sender: Synthetic Sender <sender@example.invalid>
Reply-To: Synthetic Replies <reply@example.invalid>
To: Synthetic To <to@example.invalid>
Cc: Synthetic Cc <cc@example.invalid>
Bcc: Synthetic Bcc <bcc@example.invalid>
Subject: =?UTF-8?Q?Synthetic_caf=C3=A9_draft?=
Date: Sat, 24 Oct 2026 12:00:00 +0000
Message-ID: <purely-synthetic-draft@example.invalid>
X-Synthetic-Provenance: authored-in-draft_mime_test.go
X-Repeated: first
X-Repeated: second
X-Folded: preserve
 this exact folding
MIME-Version: 1.0
X-Unsent: 1
Content-Type: multipart/mixed; boundary="synthetic-mixed"

--synthetic-mixed
Content-Type: multipart/alternative; boundary="synthetic-alt"

--synthetic-alt
Content-Type: text/plain; charset=iso-8859-1
Content-Transfer-Encoding: quoted-printable

Synthetic caf=E9
--synthetic-alt
Content-Type: text/html; charset=utf-8
Content-Transfer-Encoding: base64

PGI+U3ludGhldGljIGNhZsOpPC9iPjxpbWcgc3JjPSJodHRwczovL2V4YW1wbGUuaW52YWxpZC90cmFjayI+
--synthetic-alt--
--synthetic-mixed
Content-Type: application/octet-stream
Content-Disposition: attachment; filename*=utf-8''synthetic-%E2%98%81.bin
Content-ID: <synthetic-attachment>
Content-Transfer-Encoding: base64

AAECA/9TWU5USEVUSUM=
--synthetic-mixed--
`, "\n", "\r\n"))

func TestDraftMIMEEncoding(t *testing.T) {
	for _, text := range []string{"", "plain", "mixed\r\nline\nend\r", strings.Repeat("☁️ 日本語\r\n", 100), "=literal\t "} {
		d := Draft{DraftID: uuid(), Version: 1, Subject: "Synthetic 日本語", To: []string{}, Text: text, CreatedAt: time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)}
		raw, err := GenerateDraftMIME(d)
		if err != nil {
			t.Fatal(err)
		}
		if !draftProjectionMatches(d, raw) {
			t.Fatalf("body or header changed: %q", text)
		}
		if bytes.Contains(raw, []byte("From:")) || bytes.Contains(raw, []byte("Message-ID:")) {
			t.Fatal("invented sender identity")
		}
		for _, line := range bytes.Split(raw, []byte("\r\n")) {
			if len(line) > 998 {
				t.Fatal("RFC line limit")
			}
		}
		d.Subject = "bad\r\nBcc: injection@example.invalid"
		if _, err = GenerateDraftMIME(d); err == nil {
			t.Fatal("header injection")
		}
	}
	d := Draft{DraftID: uuid(), Version: 1, Subject: strings.Repeat("long", 249), To: []string{}, Text: "body", CreatedAt: time.Now(), UpdatedAt: time.Now()}
	raw, e := GenerateDraftMIME(d)
	if e != nil || !draftProjectionMatches(d, raw) {
		t.Fatal("long subject changed", e)
	}
	for _, line := range bytes.Split(raw, []byte("\r\n")) {
		if len(line) > 998 {
			t.Fatal("long subject line limit")
		}
	}
	p, err := Parse(syntheticDraftMIME)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Recipients) != 6 || len(p.Headers["X-Repeated"]) != 2 || len(p.Attachments) != 1 || !strings.Contains(p.Text, "café") || !strings.Contains(p.HTML, "example.invalid/track") {
		t.Fatalf("fixture not exercising fields: %+v", p)
	}
	if !bytes.Equal(p.Attachments[0].Data, []byte{0, 1, 2, 3, 255, 'S', 'Y', 'N', 'T', 'H', 'E', 'T', 'I', 'C'}) {
		t.Fatal("attachment decoding")
	}
}
func draftArchive(t *testing.T, m ExportManifest, raw []byte) []byte {
	t.Helper()
	var b bytes.Buffer
	w := tar.NewWriter(&b)
	for _, item := range m.Messages {
		if err := w.WriteHeader(&tar.Header{Name: item.Path, Mode: 0600, Size: int64(len(raw))}); err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(raw); err != nil {
			t.Fatal(err)
		}
	}
	metadata := encoded(m)
	if err := w.WriteHeader(&tar.Header{Name: "manifest.json", Mode: 0600, Size: int64(len(metadata))}); err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write(metadata); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}
func exerciseDraftMIME(t *testing.T, s *Service, admin *pgx.Conn, ctx context.Context) {
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	newScope := func() Scope {
		sc := Scope{uuid(), uuid(), uuid()}
		_, err := admin.Exec(ctx, `INSERT INTO core.tenants(tenant_id,region) VALUES($1,'local-mime')`, sc.Tenant)
		must(err)
		_, err = admin.Exec(ctx, `INSERT INTO core.mail_accounts VALUES($1,$2,'hosted','synthetic')`, sc.Tenant, sc.Account)
		must(err)
		_, err = admin.Exec(ctx, `INSERT INTO core.mailboxes VALUES($1,$2,$3,'Synthetic MIME')`, sc.Tenant, sc.Account, sc.Mailbox)
		must(err)
		return sc
	}
	who := func() EditIdentity { return EditIdentity{"synthetic-mime-only", uuid()} }
	source := newScope()
	id := uuid()
	actor := who()
	r, err := s.SaveMIMEDraft(ctx, source, actor, id, 0, syntheticDraftMIME)
	must(err)
	repeat, err := s.SaveMIMEDraft(ctx, source, actor, id, 0, syntheticDraftMIME)
	must(err)
	if repeat.ReceiptID != r.ReceiptID {
		t.Fatal("duplicate MIME receipt")
	}
	original, err := s.GetDraft(ctx, source, id)
	must(err)
	t.Run("mime_save_atomicity_recovery_and_isolation", func(t *testing.T) {
		for _, stage := range []string{"draft_after_mime_object", "edit_before_commit", "edit_after_commit"} {
			sc := newScope()
			key := who()
			did := uuid()
			broken := *s
			broken.fault = func(at string) error {
				if at == stage {
					return errors.New("synthetic interrupted")
				}
				return nil
			}
			_, err := broken.SaveMIMEDraft(ctx, sc, key, did, 0, syntheticDraftMIME)
			if err == nil {
				t.Fatal("fault missed")
			}
			var before int
			must(admin.QueryRow(ctx, `SELECT count(*) FROM core.mail_drafts WHERE draft_id=$1`, did).Scan(&before))
			expected := 0
			if stage == "edit_after_commit" {
				expected = 1
			}
			if before != expected {
				t.Fatal("incorrect commit boundary", stage, before)
			}
			receipt, err := s.SaveMIMEDraft(ctx, sc, key, did, 0, syntheticDraftMIME)
			must(err)
			got, err := s.ReadDraftMIME(ctx, sc, did)
			must(err)
			if !bytes.Equal(got, syntheticDraftMIME) {
				t.Fatal("original changed")
			}
			var n int
			must(admin.QueryRow(ctx, `SELECT count(*) FROM core.mail_edit_receipts WHERE mailbox_id=$1 AND receipt_id=$2`, sc.Mailbox, receipt.ReceiptID).Scan(&n))
			if n != 1 {
				t.Fatal("receipt missing")
			}
		}
		if _, err = s.ReadDraftMIME(ctx, newScope(), id); !errors.Is(err, ErrNotFound) {
			t.Fatal("cross tenant MIME read")
		}
		_, err = s.SaveDraft(ctx, source, who(), DraftInput{DraftID: id, ExpectedVersion: 1, Subject: original.Subject, To: original.To, Text: "would lose attachments"})
		if !errors.Is(err, ErrDraftMIMEEditRequired) {
			t.Fatal("lossy overwrite allowed")
		}
		_, err = s.SaveMIMEDraft(ctx, source, actor, id, 0, bytes.ReplaceAll(syntheticDraftMIME, []byte("first"), []byte("changed")))
		if !errors.Is(err, ErrEditConflict) {
			t.Fatal("same key changed bytes")
		}
		foreign := *original.MIME
		foreign.Key = "mail/v1/" + uuid() + "/" + uuid() + "/" + uuid() + "/x"
		tx, err := admin.Begin(ctx)
		must(err)
		_, err = tx.Exec(ctx, `UPDATE core.mail_drafts SET mime_original=$2 WHERE draft_id=$1`, id, encoded(foreign))
		if err == nil {
			t.Fatal("foreign object binding accepted")
		}
		must(tx.Rollback(ctx))
		for _, statement := range []string{`UPDATE core.mail_drafts SET body_text='lossy old writer' WHERE draft_id=$1`, `UPDATE core.mail_drafts SET mime_original=NULL WHERE draft_id=$1`} {
			tx, err := admin.Begin(ctx)
			must(err)
			_, err = tx.Exec(ctx, statement, id)
			if err == nil {
				t.Fatal("old writer discarded MIME")
			}
			must(tx.Rollback(ctx))
		}
	})
	var archive bytes.Buffer
	manifest, err := s.ExportMailbox(ctx, source, &archive, 100)
	must(err)
	t.Run("draft_mime_manifest_loss_accounting_and_tamper", func(t *testing.T) {
		if manifest.Version != 4 || len(manifest.Messages) != 1 || !manifest.Messages[0].DraftMIME.OriginalBytesPreserved || len(manifest.Messages[0].DraftMIME.Changes) != 0 {
			t.Fatal("missing MIME accounting")
		}
		var mbox bytes.Buffer
		_, err := s.ExportMailboxMBOXRD(ctx, source, &mbox, 100)
		if err == nil || err.Error() != "drafts_require_portable_archive_not_mbox" || mbox.Len() != 0 {
			t.Fatal("MIME draft became an MBOX message", err, mbox.Len())
		}
		preview, err := InspectTAR(bytes.NewReader(archive.Bytes()), nil)
		must(err)
		if preview.State != "READY" {
			t.Fatal(preview)
		}
		tr := tar.NewReader(bytes.NewReader(archive.Bytes()))
		_, err = tr.Next()
		must(err)
		raw, err := io.ReadAll(tr)
		must(err)
		if !bytes.Equal(raw, syntheticDraftMIME) {
			t.Fatal("MIME bytes changed")
		}
		for _, change := range []string{"projection", "hash", "format", "accounting"} {
			var m ExportManifest
			must(json.Unmarshal(encoded(manifest), &m))
			switch change {
			case "projection":
				m.Messages[0].Draft.Text = "false body"
			case "hash":
				m.Messages[0].Raw.SHA256 = strings.Repeat("0", 64)
			case "format":
				m.Version = 3
			case "accounting":
				m.Messages[0].DraftMIME.OriginalBytesPreserved = false
			}
			p, err := InspectTAR(bytes.NewReader(draftArchive(t, m, syntheticDraftMIME)), nil)
			must(err)
			if p.State != "NEEDS_ACTION" {
				t.Fatal("tampered MIME accepted", change)
			}
		}
	})
	stage := func(dest Scope, b []byte) ImportJob {
		spec := ImportSpec{Key: uuid(), Format: "eml-tar", SourceSHA256: digest(b), SourceSize: int64(len(b)), Folder: "Synthetic drafts", Cutoff: time.Now().UTC(), AdmissionRef: "synthetic-local-mime"}
		j, err := s.StageImport(ctx, dest, spec, bytes.NewReader(b))
		must(err)
		return j
	}
	for _, fault := range []string{"edit_before_commit", "edit_after_commit", "import_after_draft_restore", "import_before_item_commit"} {
		t.Run("mime_roundtrip_recovery_"+fault, func(t *testing.T) {
			dest := newScope()
			j := stage(dest, archive.Bytes())
			for j.State == "DISCOVERING" {
				j, err = s.ResumeImport(ctx, dest, j.Spec.Key, 1)
				must(err)
			}
			broken := *s
			broken.fault = func(at string) error {
				if at == fault {
					return errors.New("synthetic interrupted")
				}
				return nil
			}
			if _, err = broken.ResumeImport(ctx, dest, j.Spec.Key, 1); err == nil {
				t.Fatal("fault missed")
			}
			for n := 0; n < 15 && j.State != "COMPLETE"; n++ {
				j, err = s.ResumeImport(ctx, dest, j.Spec.Key, 1)
				must(err)
			}
			if j.State != "COMPLETE" {
				t.Fatal(j.State)
			}
			report, err := s.ImportReport(ctx, dest, j.Spec.Key)
			must(err)
			if report.Verified != 1 || report.Exceptions != 0 {
				t.Fatal(report)
			}
			var did, receipt string
			must(admin.QueryRow(ctx, `SELECT draft_id::text,draft_receipt_id::text FROM core.mail_import_items WHERE job_id=$1`, j.ID).Scan(&did, &receipt))
			got, err := s.ReadDraftMIME(ctx, dest, did)
			must(err)
			if !bytes.Equal(got, syntheticDraftMIME) {
				t.Fatal("roundtrip loss")
			}
			d, err := s.GetDraft(ctx, dest, did)
			must(err)
			if d.MIME.Key == original.MIME.Key || !validDraftObject(dest, *d.MIME) {
				t.Fatal("foreign reference reused")
			}
			var output bytes.Buffer
			again, err := s.ExportMailbox(ctx, dest, &output, 100)
			must(err)
			if again.Messages[0].Raw.SHA256 != digest(syntheticDraftMIME) {
				t.Fatal("second export loss")
			}
			var n int
			must(admin.QueryRow(ctx, `SELECT count(*) FROM core.messages WHERE mailbox_id=$1`, dest.Mailbox).Scan(&n))
			if n != 0 {
				t.Fatal("draft ingested as received message")
			}
			changed := bytes.ReplaceAll(syntheticDraftMIME, []byte("X-Repeated: first"), []byte("X-Repeated: customer-edited"))
			_, err = s.SaveMIMEDraft(ctx, dest, who(), did, d.Version, changed)
			must(err)
			_, err = s.ResumeImport(ctx, dest, j.Spec.Key, 1)
			must(err)
			got, err = s.ReadDraftMIME(ctx, dest, did)
			must(err)
			if !bytes.Equal(got, changed) {
				t.Fatal("completed retry overwrote customer edit")
			}
			if path := os.Getenv("MAIL_TEST_MIME_EVIDENCE"); path != "" && fault == "import_before_item_commit" {
				evidence := map[string]any{"source_revision": os.Getenv("MAIL_TEST_SOURCE_REV"), "local_only": true, "cloud_deployed": false, "independent_acceptance": false, "scope": dest, "job_id": j.ID, "draft_id": did, "receipt_id": receipt, "original_sha256": digest(syntheticDraftMIME), "original_size": len(syntheticDraftMIME), "restored_object": d.MIME, "report": report, "post_completion_edited_sha256": digest(changed)}
				must(os.WriteFile(path, encoded(evidence), 0600))
				must(os.WriteFile(path+".original.eml", syntheticDraftMIME, 0600))
				composed := original
				composed.MIME = nil
				composed.Text = "Synthetic mixed\r\nline\n☁️"
				generated, e := GenerateDraftMIME(composed)
				must(e)
				must(os.WriteFile(path+".composed.eml", generated, 0600))
			}
		})
	}
	t.Run("missing_mime_original_is_accounted_and_transient_reads_resume", func(t *testing.T) {
		auth := &syntheticExportAuthority{scope: source}
		for _, permanent := range []bool{true, false} {
			spec := ExportSpec{Key: uuid(), AdmissionRef: "synthetic-local-export-test", ExpiresAt: time.Now().Add(time.Hour), PartitionMessages: 1, ExceptionPolicy: "stop"}
			failure := errors.New("synthetic temporary read outage")
			if permanent {
				spec.ExceptionPolicy = "include-report"
				failure = ErrObjectNotFound
			}
			broken := *s
			broken.Objects = unavailableExportObject{ObjectStore: s.Objects, key: original.MIME.Key, failure: failure}
			j, err := broken.CreateExport(ctx, source, spec, auth)
			must(err)
			if !permanent {
				if _, err = broken.ResumeExport(ctx, source, spec.Key, auth); err == nil {
					t.Fatal("outage reported success")
				}
				broken.Objects = s.Objects
			}
			for n := 0; n < 10 && j.State != "COMPLETE" && j.State != "COMPLETED_WITH_EXCEPTIONS"; n++ {
				j, err = broken.ResumeExport(ctx, source, spec.Key, auth)
				must(err)
			}
			report, err := broken.ReadExportReport(ctx, source, spec.Key, auth)
			must(err)
			if permanent {
				if report.Complete || report.ExpectedDrafts != 1 || report.ExportedDrafts != 0 || report.Excluded != 1 || report.State != "COMPLETED_WITH_EXCEPTIONS" {
					t.Fatal("missing draft silently completed", report)
				}
			} else {
				if !report.Complete || report.ExportedDrafts != 1 {
					t.Fatal("same snapshot did not recover", report)
				}
			}
			exceptions, err := broken.ExportExceptionPage(ctx, source, spec.Key, "", auth)
			must(err)
			if len(exceptions) != 1 || exceptions[0].Resolved == permanent {
				t.Fatal("loss/recovery accounting missing")
			}
		}
	})
	t.Run("legacy_json_drafts_remain_importable", func(t *testing.T) {
		d := original
		d.MIME = nil
		raw := encoded(d)
		m := ExportManifest{Version: 2, Complete: true, Messages: []ExportItem{{Draft: &d, Path: "drafts/" + d.DraftID + ".draft.json", Raw: Object{SHA256: digest(raw), Size: int64(len(raw))}}}}
		dest := newScope()
		j := stage(dest, draftArchive(t, m, raw))
		for n := 0; n < 15 && j.State != "COMPLETE"; n++ {
			j, err = s.ResumeImport(ctx, dest, j.Spec.Key, 1)
			must(err)
		}
		if j.State != "COMPLETE" {
			t.Fatal(j.State)
		}
		var did string
		must(admin.QueryRow(ctx, `SELECT draft_id::text FROM core.mail_import_items WHERE job_id=$1`, j.ID).Scan(&did))
		got, err := s.GetDraft(ctx, dest, did)
		must(err)
		got.DraftID = d.DraftID
		if !bytes.Equal(encoded(got), encoded(d)) {
			t.Fatal("legacy draft changed")
		}
	})
	t.Run("resumable_mime_export_frozen_generation", func(t *testing.T) {
		auth := &syntheticExportAuthority{scope: source}
		spec := ExportSpec{Key: uuid(), AdmissionRef: "synthetic-local-export-test", ExpiresAt: time.Now().Add(time.Hour), PartitionMessages: 1, ExceptionPolicy: "stop"}
		j, err := s.CreateExport(ctx, source, spec, auth)
		must(err)
		_, err = s.SaveMIMEDraft(ctx, source, who(), id, 1, bytes.ReplaceAll(syntheticDraftMIME, []byte("first"), []byte("later")))
		must(err)
		broken := *s
		broken.fault = func(at string) error {
			if at == "export_after_part_objects" {
				return errors.New("synthetic interrupted")
			}
			return nil
		}
		if _, err = broken.ResumeExport(ctx, source, spec.Key, auth); err == nil {
			t.Fatal("fault missed")
		}
		for n := 0; n < 10 && j.State != "COMPLETE"; n++ {
			j, err = s.ResumeExport(ctx, source, spec.Key, auth)
			must(err)
		}
		if j.State != "COMPLETE" {
			t.Fatal(j.State)
		}
		var output bytes.Buffer
		_, err = s.ReadExportPart(ctx, source, spec.Key, 1, 0, &output, auth)
		must(err)
		preview, err := InspectTAR(bytes.NewReader(output.Bytes()), nil)
		must(err)
		if preview.State != "READY" || preview.PortableMetadata.Version != 4 || preview.Items[0].SHA256 != digest(syntheticDraftMIME) {
			t.Fatal("snapshot not frozen")
		}
	})
}
