package mailstore

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func exerciseEdits(t *testing.T, s *Service, admin *pgx.Conn, ctx context.Context) {
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	scope := Scope{uuid(), uuid(), uuid()}
	other := Scope{uuid(), uuid(), uuid()}
	sibling := Scope{scope.Tenant, scope.Account, uuid()}
	account := Scope{scope.Tenant, uuid(), uuid()}
	for _, sc := range []Scope{scope, other, sibling, account} {
		_, err := admin.Exec(ctx, `INSERT INTO core.tenants(tenant_id,region) VALUES($1,'local-edit-test') ON CONFLICT DO NOTHING`, sc.Tenant)
		must(err)
		_, err = admin.Exec(ctx, `INSERT INTO core.mail_accounts VALUES($1,$2,'hosted','synthetic') ON CONFLICT DO NOTHING`, sc.Tenant, sc.Account)
		must(err)
		_, err = admin.Exec(ctx, `INSERT INTO core.mailboxes VALUES($1,$2,$3,'Synthetic edits')`, sc.Tenant, sc.Account, sc.Mailbox)
		must(err)
	}
	who := func() EditIdentity { return EditIdentity{"synthetic-editor", uuid()} }
	request := Request{Scope: scope, DeliveryID: "edits-original", Source: "synthetic-edit-fixture", Raw: fixture(t), Envelope: Envelope{From: "sender@example.invalid", To: []string{"reader@example.invalid"}, ReceivedAt: time.Date(2026, 10, 24, 10, 0, 0, 0, time.UTC)}}
	original, err := s.Ingest(ctx, request)
	must(err)
	folder := CollectionInput{uuid(), "folder", "Projects"}
	label := CollectionInput{uuid(), "label", "Needs reply"}
	t.Run("collections_organization_and_portable_metadata", func(t *testing.T) {
		identity := who()
		receipt, err := s.CreateCollection(ctx, scope, identity, folder)
		must(err)
		again, err := s.CreateCollection(ctx, scope, identity, folder)
		must(err)
		if receipt != again {
			t.Fatal("collection replay changed receipt")
		}
		_, err = s.CreateCollection(ctx, scope, who(), CollectionInput{uuid(), "folder", " projects "})
		if !errors.Is(err, ErrEditConflict) {
			t.Fatal("duplicate folder name accepted")
		}
		_, err = s.CreateCollection(ctx, scope, who(), label)
		must(err)
		change := OrganizationInput{original.MessageID, 0, &folder.CollectionID, []string{label.CollectionID}}
		id := who()
		r, err := s.OrganizeMessage(ctx, scope, id, change)
		must(err)
		again, err = s.OrganizeMessage(ctx, scope, id, change)
		must(err)
		if r != again {
			t.Fatal("organization replay changed")
		}
		_, err = s.OrganizeMessage(ctx, scope, who(), change)
		if !errors.Is(err, ErrEditStale) {
			t.Fatal("stale organization accepted")
		}
		inbox, err := s.ListOrganized(ctx, scope, "", nil, 10, "inbox", "")
		must(err)
		if len(inbox) != 0 {
			t.Fatal("moved original still in inbox")
		}
		found, err := s.ListOrganized(ctx, scope, "receipt", nil, 10, folder.CollectionID, label.CollectionID)
		must(err)
		if len(found) != 1 || found[0].MessageID != original.MessageID {
			t.Fatal("folder/label search failed")
		}
		view, err := s.ViewMessage(ctx, scope, original.MessageID)
		must(err)
		if view.Organization.Version != 1 || len(view.Organization.LabelIDs) != 1 || view.ReceiptID != original.ID {
			t.Fatal("organization changed immutable receipt")
		}
		var archive bytes.Buffer
		manifest, err := s.ExportMailbox(ctx, scope, &archive, 10)
		must(err)
		if manifest.Messages[0].Organization == nil || manifest.Messages[0].Organization.Folder.Name != "Projects" || manifest.Messages[0].Organization.Labels[0].Name != "Needs reply" {
			t.Fatal("portable organization lost")
		}
		preview, err := InspectTAR(bytes.NewReader(archive.Bytes()), nil)
		must(err)
		if preview.PortableMetadata.Messages[0].Organization.Folder.CollectionID != folder.CollectionID {
			t.Fatal("archive stripped folder metadata")
		}

		// The resumable export freezes collection metadata, not just the originals.
		sp := ExportSpec{Key: uuid(), AdmissionRef: "synthetic-local-export-test", ExpiresAt: time.Now().UTC().Add(time.Hour), PartitionMessages: 2, ExceptionPolicy: "stop"}
		authority := &syntheticExportAuthority{scope: scope}
		job, err := s.CreateExport(ctx, scope, sp, authority)
		must(err)
		for n := 0; n < 10 && job.State != "COMPLETE"; n++ {
			job, err = s.ResumeExport(ctx, scope, sp.Key, authority)
			must(err)
		}
		if job.State != "COMPLETE" {
			t.Fatal("organization export incomplete")
		}
		var part bytes.Buffer
		_, err = s.ReadExportPart(ctx, scope, sp.Key, 1, 0, &part, authority)
		must(err)
		portable, err := InspectTAR(bytes.NewReader(part.Bytes()), nil)
		must(err)
		if portable.PortableMetadata.Messages[0].Organization.Folder.Name != "Projects" {
			t.Fatal("resumable export lost collection")
		}
		importedSpec := ImportSpec{Key: uuid(), Format: "eml-tar", SourceSHA256: digest(archive.Bytes()), SourceSize: int64(archive.Len()), Folder: "Portable", Cutoff: request.Envelope.ReceivedAt, AdmissionRef: "synthetic-local-edit-import"}
		imported, err := s.StageImport(ctx, sibling, importedSpec, bytes.NewReader(archive.Bytes()))
		must(err)
		for n := 0; n < 10 && imported.State != "COMPLETED_WITH_EXCEPTIONS"; n++ {
			imported, err = s.ResumeImport(ctx, sibling, importedSpec.Key, 10)
			must(err)
		}
		if imported.State != "COMPLETED_WITH_EXCEPTIONS" {
			t.Fatal("unmapped organization reported complete")
		}
		var metadata string
		must(admin.QueryRow(ctx, `SELECT properties->'portable_metadata'->'organization'->'folder'->>'name' FROM core.mail_import_items WHERE mailbox_id=$1 AND job_id=$2`, sibling.Mailbox, imported.ID).Scan(&metadata))
		if metadata != "Projects" {
			t.Fatal("import source metadata lost")
		}
		var exceptionCount int
		must(admin.QueryRow(ctx, `SELECT count(*) FROM core.mail_import_exceptions WHERE mailbox_id=$1 AND job_id=$2 AND code='organization_mapping_pending' AND NOT resolved`, sibling.Mailbox, imported.ID).Scan(&exceptionCount))
		if exceptionCount != 1 {
			t.Fatal("missing mapping exception")
		}
		// A label cannot become a folder, and foreign IDs cannot change local rows.
		change.ExpectedVersion = 1
		change.FolderID = &label.CollectionID
		_, err = s.OrganizeMessage(ctx, scope, who(), change)
		if !errors.Is(err, ErrNotFound) {
			t.Fatal("label used as folder")
		}
		foreign := CollectionInput{uuid(), "label", "Foreign"}
		_, err = s.CreateCollection(ctx, other, who(), foreign)
		must(err)
		change.FolderID = &folder.CollectionID
		change.LabelIDs = []string{foreign.CollectionID}
		_, err = s.OrganizeMessage(ctx, scope, who(), change)
		if !errors.Is(err, ErrNotFound) {
			t.Fatal("foreign label accepted")
		}
		view, err = s.ViewMessage(ctx, scope, original.MessageID)
		must(err)
		if view.Organization.Version != 1 {
			t.Fatal("failed edit changed state")
		}
		// Removing labels retains their history rows and leaves original bytes intact.
		_, err = s.OrganizeMessage(ctx, scope, who(), OrganizationInput{original.MessageID, 1, nil, []string{}})
		must(err)
		_, raw, err := s.Retrieve(ctx, scope, request.DeliveryID)
		must(err)
		if !bytes.Equal(raw, request.Raw) {
			t.Fatal("organization changed raw source")
		}
		var active bool
		must(admin.QueryRow(ctx, `SELECT active FROM core.mail_message_labels WHERE tenant_id=$1 AND message_id=$2 AND label_id=$3`, scope.Tenant, original.MessageID, label.CollectionID).Scan(&active))
		if active {
			t.Fatal("label not removed")
		}
	})
	input := DraftInput{DraftID: uuid(), Subject: "Synthetic draft", To: []string{"reader@example.invalid"}, Text: "Saved locally; never sent."}
	var first EditReceipt
	t.Run("concurrent_duplicate_draft_save_and_version_conflicts", func(t *testing.T) {
		id := who()
		var wg sync.WaitGroup
		receipts := make(chan EditReceipt, 12)
		failures := make(chan error, 12)
		for range 12 {
			wg.Add(1)
			go func() { defer wg.Done(); r, err := s.SaveDraft(ctx, scope, id, input); receipts <- r; failures <- err }()
		}
		wg.Wait()
		close(receipts)
		close(failures)
		for err := range failures {
			must(err)
		}
		for r := range receipts {
			if first.ReceiptID == "" {
				first = r
			}
			if r != first {
				t.Fatal("duplicate draft receipts differ")
			}
		}
		changed := input
		changed.Text = "Different input"
		_, err = s.SaveDraft(ctx, scope, id, changed)
		if !errors.Is(err, ErrEditConflict) {
			t.Fatal("changed idempotency input accepted")
		}
		changed.ExpectedVersion = 1
		winner := 0
		stale := 0
		failures = make(chan error, 2)
		for i := range 2 {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				copy := changed
				copy.Text = fmt.Sprintf("Concurrent draft %d", i)
				_, e := s.SaveDraft(ctx, scope, who(), copy)
				failures <- e
			}(i)
		}
		wg.Wait()
		close(failures)
		for e := range failures {
			if e == nil {
				winner++
			} else if errors.Is(e, ErrEditStale) {
				stale++
			} else {
				t.Fatal(e)
			}
		}
		if winner != 1 || stale != 1 {
			t.Fatal("lost-update protection failed")
		}
		d, err := s.GetDraft(ctx, scope, input.DraftID)
		must(err)
		if d.Version != 2 || !strings.HasPrefix(d.Text, "Concurrent draft") {
			t.Fatal("winner not retained")
		}
		// Replaying the first save returns its historical receipt, never overwrites v2.
		r, err := s.SaveDraft(ctx, scope, id, input)
		must(err)
		if r != first {
			t.Fatal("historical receipt changed")
		}
		d, err = s.GetDraft(ctx, scope, input.DraftID)
		must(err)
		if d.Version != 2 {
			t.Fatal("replay rolled back newer draft")
		}
	})
	t.Run("atomic_receipt_rollback_and_unknown_commit_recovery", func(t *testing.T) {
		for _, stage := range []string{"edit_before_commit", "edit_after_commit"} {
			copy := *s
			copy.fault = func(got string) error {
				if got == stage {
					return errors.New("synthetic interruption")
				}
				return nil
			}
			in := DraftInput{DraftID: uuid(), Subject: stage, To: []string{}, Text: "Only a synthetic draft"}
			id := who()
			_, err := copy.SaveDraft(ctx, scope, id, in)
			if err == nil {
				t.Fatal("fault not triggered")
			}
			var n int
			must(admin.QueryRow(ctx, `SELECT count(*) FROM core.mail_edit_receipts WHERE tenant_id=$1 AND actor_ref=$2 AND mutation_key=$3`, scope.Tenant, id.Actor, id.Key).Scan(&n))
			if stage == "edit_before_commit" && n != 0 {
				t.Fatal("receipt survived rolled-back edit")
			}
			if stage == "edit_after_commit" && (n != 1 || !errors.Is(err, ErrEditUnknown)) {
				t.Fatal("unknown commit not durable")
			}
			r, err := s.SaveDraft(ctx, scope, id, in)
			must(err)
			d, err := s.GetDraft(ctx, scope, in.DraftID)
			must(err)
			if d.Version != 1 || r.Version != 1 {
				t.Fatal("retry duplicated edit")
			}
		}
	})
	t.Run("isolation_grants_and_no_silent_draft_export_loss", func(t *testing.T) {
		for _, sc := range []Scope{other, sibling, account} {
			if _, err := s.GetDraft(ctx, sc, input.DraftID); !errors.Is(err, ErrNotFound) {
				t.Fatal("draft crossed scope")
			}
			if _, err := s.OrganizeMessage(ctx, sc, who(), OrganizationInput{original.MessageID, 2, nil, nil}); !errors.Is(err, ErrNotFound) {
				t.Fatal("organization crossed scope")
			}
			rows, err := s.ListDrafts(ctx, sc, nil, 10)
			must(err)
			if len(rows) != 0 {
				t.Fatal("draft list crossed scope")
			}
		}
		var archive bytes.Buffer
		_, err := s.ExportMailbox(ctx, scope, &archive, 100)
		if err == nil || !strings.Contains(err.Error(), "draft_export_not_supported") || archive.Len() != 0 {
			t.Fatal("draft silently omitted from complete export")
		}
		c, err := s.connection(ctx)
		must(err)
		defer c.Release()
		tx, err := scopedTx(ctx, c, scope)
		must(err)
		_, err = tx.Exec(ctx, `UPDATE core.mail_edit_receipts SET result='{}'`)
		if err == nil {
			t.Fatal("runtime can rewrite receipt")
		}
		tx.Rollback(ctx)
		tx, err = scopedTx(ctx, c, scope)
		must(err)
		_, err = tx.Exec(ctx, `DELETE FROM core.mail_drafts`)
		if err == nil {
			t.Fatal("runtime can delete drafts")
		}
		tx.Rollback(ctx)
		// Static keyset paging returns every draft once.
		seen := map[string]bool{}
		var cursor *DraftCursor
		for {
			rows, err := s.ListDrafts(ctx, scope, cursor, 1)
			must(err)
			if len(rows) == 0 {
				break
			}
			d := rows[0]
			if seen[d.DraftID] {
				t.Fatal("repeated draft page")
			}
			seen[d.DraftID] = true
			cursor = &DraftCursor{d.UpdatedAt, d.DraftID}
		}
		if len(seen) != 3 {
			t.Fatalf("draft page count: %d", len(seen))
		}
	})
	t.Run("real_http_mutation_contract_and_replay", func(t *testing.T) {
		token := strings.Repeat("b", 64)
		origin := "http://127.0.0.1:8789"
		handler, err := NewLocalInbox(s, scope, origin, token)
		must(err)
		call := func(operation, key string, args any, auth bool) *httptest.ResponseRecorder {
			b, _ := json.Marshal(map[string]any{"operation": operation, "version": 1, "request_id": "synthetic-edit-http", "idempotency_key": key, "arguments": args})
			req := httptest.NewRequest("POST", origin+"/api/operations", bytes.NewReader(b))
			req.RemoteAddr = "127.0.0.1:1000"
			req.Header.Set("Origin", origin)
			req.Header.Set("Content-Type", "application/json")
			if auth {
				req.Header.Set("Authorization", "Bearer "+token)
			}
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)
			return w
		}
		id := uuid()
		in := DraftInput{DraftID: uuid(), Subject: "HTTP synthetic draft", To: []string{}, Text: strings.Repeat("s", 10000)}
		w := call("mail.drafts.save", id, in, true)
		if w.Code != 200 || !strings.Contains(w.Body.String(), "LOCAL_MUTATION_COMMITTED") {
			t.Fatalf("save: %d %s", w.Code, w.Body.String())
		}
		again := call("mail.drafts.save", id, in, true)
		if again.Body.String() != w.Body.String() {
			t.Fatal("HTTP retry not identical")
		}
		in.Text = "Changed"
		if call("mail.drafts.save", id, in, true).Code != 409 {
			t.Fatal("HTTP idempotency conflict missing")
		}
		if call("mail.drafts.save", "", in, true).Code != 400 {
			t.Fatal("missing mutation key accepted")
		}
		if call("mail.drafts.save", uuid(), in, false).Code != 401 {
			t.Fatal("unauthorized save accepted")
		}
		if call("mail.drafts.save", uuid(), map[string]any{"draft_id": in.DraftID, "scope": other}, true).Code != 400 {
			t.Fatal("client scope accepted")
		}

		oldExpiry := handler.(*localInbox).expires
		handler.(*localInbox).expires = time.Now().Add(-time.Second)
		if call("mail.drafts.save", uuid(), in, true).Code != 401 {
			t.Fatal("expired session can write")
		}
		handler.(*localInbox).expires = oldExpiry
		bad := in
		bad.Text = strings.Repeat("x", 65537)
		if call("mail.drafts.save", uuid(), bad, true).Code != 400 {
			t.Fatal("draft body bound missing")
		}
		bad = in
		bad.Subject = "Injected\r\nBcc: victim@example.invalid"
		if call("mail.drafts.save", uuid(), bad, true).Code != 400 {
			t.Fatal("header injection accepted")
		}
		// A commit followed by an interrupted response is explicitly unknown, not failed.
		originalFault := s.fault
		s.fault = func(stage string) error {
			if stage == "edit_after_commit" {
				return errors.New("synthetic lost response")
			}
			return nil
		}
		in.DraftID = uuid()
		lostKey := uuid()
		lost := call("mail.drafts.save", lostKey, in, true)
		s.fault = originalFault
		if lost.Code != 503 || !strings.Contains(lost.Body.String(), "UNKNOWN_OUTCOME") {
			t.Fatal("unknown commit misreported")
		}
		if call("mail.drafts.save", lostKey, in, true).Code != 200 {
			t.Fatal("HTTP unknown commit did not reconcile")
		}
		if call("mail.send", uuid(), map[string]any{}, true).Code != 404 {
			t.Fatal("send operation exposed")
		}
	})
}
