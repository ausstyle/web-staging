package mailstore

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func exerciseRichDraftHTTP(t *testing.T, s *Service, ctx context.Context, scope, other Scope) {
	const origin = "http://127.0.0.1:8789"
	token := strings.Repeat("c", 64)
	handler, err := NewLocalInbox(s, scope, origin, token)
	if err != nil {
		t.Fatal(err)
	}
	call := func(operation, key string, args any, auth bool) *httptest.ResponseRecorder {
		request := localRequest{Operation: operation, Version: 1, RequestID: "synthetic-rich-http", IdempotencyKey: key, Arguments: encoded(args)}
		r := httptest.NewRequest("POST", origin+"/api/operations", bytes.NewReader(encoded(request)))
		r.RemoteAddr = "127.0.0.1:12345"
		r.Header.Set("Origin", origin)
		r.Header.Set("Content-Type", "application/json")
		if auth {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	id, key := uuid(), uuid()
	args := map[string]any{"draft_id": id, "expected_version": 0, "mime_base64": syntheticDraftMIME}
	if w := call("mail.drafts.mime.import", key, args, false); w.Code != 401 {
		t.Fatal("anonymous import")
	}
	saved := call("mail.drafts.mime.import", key, args, true)
	if saved.Code != 200 || !strings.Contains(saved.Body.String(), "LOCAL_MUTATION_COMMITTED") {
		t.Fatal(saved.Code, saved.Body.String())
	}
	repeated := call("mail.drafts.mime.import", key, args, true)
	if !bytes.Equal(saved.Body.Bytes(), repeated.Body.Bytes()) {
		t.Fatal("HTTP duplicate changed receipt")
	}
	get := call("mail.drafts.get", "", map[string]any{"draft_id": id}, true)
	if get.Code != 200 || !strings.Contains(get.Body.String(), "mime_available") || strings.Contains(get.Body.String(), "mail/v1/") {
		t.Fatal("draft metadata exposed location")
	}
	view := call("mail.drafts.mime.view", "", map[string]any{"draft_id": id}, true)
	if view.Code != 200 || strings.Contains(view.Body.String(), "mail/v1/") {
		t.Fatal("unsafe view")
	}
	var result struct{ Result DraftMIMEView }
	if err = json.Unmarshal(view.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Result.Recipients) != 6 || len(result.Result.Attachments) != 1 || result.Result.Attachments[0].Size != 14 {
		t.Fatal("lost rich metadata")
	}
	exported := call("mail.drafts.mime.export", "", map[string]any{"draft_id": id}, true)
	var out struct{ Result DraftMIMEExport }
	if err = json.Unmarshal(exported.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if exported.Code != 200 || !bytes.Equal(out.Result.MIME, syntheticDraftMIME) || out.Result.SHA256 != digest(syntheticDraftMIME) {
		t.Fatal("HTTP export not exact")
	}
	foreign, err := NewLocalInbox(s, other, origin, token)
	if err != nil {
		t.Fatal(err)
	}
	handler = foreign
	for _, op := range []string{"mail.drafts.mime.view", "mail.drafts.mime.export"} {
		if w := call(op, "", map[string]any{"draft_id": id}, true); w.Code != 404 {
			t.Fatal("foreign read", op, w.Code)
		}
	}
	handler, _ = NewLocalInbox(s, scope, origin, token)
	for _, raw := range [][]byte{nil, bytes.Repeat([]byte("x"), MaxLocalDraftMIMEBytes+1), []byte("not valid MIME\x00")} {
		bad := map[string]any{"draft_id": uuid(), "expected_version": 0, "mime_base64": raw}
		w := call("mail.drafts.mime.import", uuid(), bad, true)
		if w.Code != 400 && w.Code != 422 {
			t.Fatal("unbounded/malformed import", w.Code)
		}
	}
	args["tenant_id"] = other.Tenant
	if w := call("mail.drafts.mime.import", uuid(), args, true); w.Code != 400 {
		t.Fatal("scope injection")
	}
	delete(args, "tenant_id")
	args["mime_base64"] = bytes.ReplaceAll(syntheticDraftMIME, []byte("first"), []byte("changed"))
	if w := call("mail.drafts.mime.import", key, args, true); w.Code != 409 {
		t.Fatal("changed duplicate")
	}
	if w := call("mail.drafts.mime.import", uuid(), args, true); w.Code != 409 {
		t.Fatal("stale rich replacement")
	}
	args["expected_version"] = 1
	if w := call("mail.drafts.mime.import", uuid(), args, true); w.Code != 200 {
		t.Fatal("full replacement failed", w.Code)
	}
	c, err := s.connection(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Release()
	tx, err := scopedTx(ctx, c, scope)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `SELECT result FROM core.mail_edit_receipts WHERE operation='mail.drafts.mime.save' AND result->>'resource_id'=$1 ORDER BY (result->>'version')::bigint`, id)
	if err != nil {
		t.Fatal(err)
	}
	receipts := []EditReceipt{}
	for rows.Next() {
		var raw []byte
		if err = rows.Scan(&raw); err != nil {
			t.Fatal(err)
		}
		var receipt EditReceipt
		if err = json.Unmarshal(raw, &receipt); err != nil {
			t.Fatal(err)
		}
		receipts = append(receipts, receipt)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(receipts) != 2 || receipts[0].MIMEObjects == nil || receipts[1].MIMEObjects == nil || receipts[1].MIMEObjects.Previous == nil {
		t.Fatal("MIME version audit references missing")
	}
	if *receipts[1].MIMEObjects.Previous != *receipts[0].MIMEObjects.Current {
		t.Fatal("previous original reference changed")
	}
	original, err := s.Objects.Get(ctx, *receipts[0].MIMEObjects.Current)
	if err != nil || !bytes.Equal(original, syntheticDraftMIME) {
		t.Fatal("superseded original lost", err)
	}

}
