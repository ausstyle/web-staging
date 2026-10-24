package mailstore

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func exerciseLocalInbox(t *testing.T, s *Service, ctx context.Context, scopes []Scope) {
	token := strings.Repeat("a", 64)
	origin := "http://127.0.0.1:8789"
	handler, err := NewLocalInbox(s, scopes[0], origin, token)
	if err != nil {
		t.Fatal(err)
	}
	call := func(h http.Handler, operation string, args any, change func(*http.Request)) *httptest.ResponseRecorder {
		b, _ := json.Marshal(map[string]any{"operation": operation, "version": 1, "request_id": "synthetic-http", "arguments": args})
		req := httptest.NewRequest("POST", origin+"/api/operations", bytes.NewReader(b))
		req.RemoteAddr = "127.0.0.1:55555"
		req.Header.Set("Origin", origin)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		if change != nil {
			change(req)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		return w
	}
	readResult := func(w *httptest.ResponseRecorder, target any) {
		t.Helper()
		if w.Code != 200 {
			t.Fatalf("HTTP %d: %s", w.Code, w.Body.String())
		}
		var out struct {
			State  string          `json:"state"`
			Result json.RawMessage `json:"result"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		if out.State != "LOCAL_READ_SUCCESS" {
			t.Fatal(out.State)
		}
		if err := json.Unmarshal(out.Result, target); err != nil {
			t.Fatal(err)
		}
	}
	ids := []string{}
	for i, raw := range LocalInboxFixtures() {
		r := Request{Scope: scopes[0], DeliveryID: "local-reader-" + uuid(), Source: "synthetic-reader", Envelope: Envelope{From: "demo@example.invalid", To: []string{"reader@example.invalid"}, ReceivedAt: time.Date(2026, 10, 24, 10, i, 0, 0, time.UTC)}, Raw: raw}
		receipt, err := s.Ingest(ctx, r)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, receipt.MessageID)
	}
	t.Run("reads_real_content_receipt_and_safe_attachment_metadata", func(t *testing.T) {
		var v MessageView
		readResult(call(handler, "mail.messages.get", map[string]any{"message_id": ids[3]}, nil), &v)
		if !v.HTMLSourceOnly || !strings.Contains(v.Text, "<script>") || v.ReceiptID == "" || !v.IntegrityVerified || len(v.Attachments) != 1 || v.Attachments[0].DownloadAllowed || v.Attachments[0].ScanState != "pending" {
			t.Fatalf("bad view: %+v", v)
		}
		w := call(handler, "mail.messages.get", map[string]any{"message_id": ids[3]}, nil)
		if strings.Contains(w.Body.String(), "object_key") || strings.Contains(w.Body.String(), "mail/v1/") || strings.Contains(w.Body.String(), "display_html") {
			t.Fatal("private object location or renderable HTML leaked")
		}
		if w.Header().Get("Cache-Control") != "no-store" || !strings.Contains(w.Header().Get("Content-Security-Policy"), "img-src 'none'") {
			t.Fatal("content policy missing")
		}
	})
	t.Run("query_paging_replay_and_cancel", func(t *testing.T) {
		type page struct {
			Items []MailboxItem `json:"items"`
			Next  *Cursor       `json:"next"`
		}
		var p page
		readResult(call(handler, "mail.messages.list", map[string]any{"query": "meeting", "limit": 1}, nil), &p)
		if len(p.Items) != 1 || p.Items[0].MessageID != ids[1] || p.Next == nil {
			t.Fatalf("query mismatch %+v", p)
		}
		var repeat page
		readResult(call(handler, "mail.messages.list", map[string]any{"query": "meeting", "limit": 1}, nil), &repeat)
		if repeat.Items[0].MessageID != p.Items[0].MessageID {
			t.Fatal("repeated read changed")
		}
		var tail page
		readResult(call(handler, "mail.messages.list", map[string]any{"query": "meeting", "limit": 1, "after": p.Next}, nil), &tail)
		if len(tail.Items) != 0 || tail.Next != nil {
			t.Fatal("keyset repeated row")
		}
		w := call(handler, "mail.messages.list", map[string]any{"query": "meeting", "limit": 1}, func(r *http.Request) { c, cancel := context.WithCancel(r.Context()); cancel(); *r = *r.WithContext(c) })
		if w.Code != 503 || strings.Contains(w.Body.String(), "LOCAL_READ_SUCCESS") {
			t.Fatal("cancelled read reported success")
		}
		readResult(call(handler, "mail.messages.list", map[string]any{"query": "meeting", "limit": 1}, nil), &repeat)
	})
	t.Run("cross_tenant_account_mailbox_and_scope_injection", func(t *testing.T) {
		for _, sc := range scopes[1:] {
			other, err := NewLocalInbox(s, sc, origin, token)
			if err != nil {
				t.Fatal(err)
			}
			if w := call(other, "mail.messages.get", map[string]any{"message_id": ids[0]}, nil); w.Code != 404 {
				t.Fatalf("scope leak: %d", w.Code)
			}
			var out struct {
				Items []MailboxItem `json:"items"`
			}
			readResult(call(other, "mail.messages.list", map[string]any{"query": "meeting", "limit": 10}, nil), &out)
			for _, m := range out.Items {
				if m.MessageID == ids[1] {
					t.Fatal("search scope leak")
				}
			}
		}
		if w := call(handler, "mail.messages.list", map[string]any{"query": "", "limit": 10, "scope": scopes[1]}, nil); w.Code != 400 {
			t.Fatal("scope selector accepted")
		}
	})
	t.Run("session_origin_transport_and_operation_guards", func(t *testing.T) {
		for name, change := range map[string]func(*http.Request){
			"no_token": func(r *http.Request) { r.Header.Del("Authorization") }, "wrong_origin": func(r *http.Request) { r.Header.Set("Origin", "https://evil.invalid") }, "dns_rebinding": func(r *http.Request) { r.Host = "evil.invalid:8789" }, "remote_client": func(r *http.Request) { r.RemoteAddr = "192.0.2.1:1000" }, "forwarded": func(r *http.Request) { r.Header.Set("Forwarded", "host=evil.invalid") }, "wrong_type": func(r *http.Request) { r.Header.Set("Content-Type", "text/plain") },
		} {
			t.Run(name, func(t *testing.T) {
				w := call(handler, "mail.messages.list", map[string]any{"query": "", "limit": 10}, change)
				if w.Code < 400 {
					t.Fatal("unsafe request accepted")
				}
			})
		}
		for _, operation := range []string{"mail.send", "mail.attachments.download", "mail.import", "mail.messages.set_flags"} {
			if w := call(handler, operation, map[string]any{}, nil); w.Code != 404 {
				t.Fatal("unsupported effect accepted")
			}
		}
		h := handler.(*localInbox)
		h.expires = time.Now().Add(-time.Second)
		if w := call(handler, "mail.messages.list", map[string]any{"query": "", "limit": 10}, nil); w.Code != 401 {
			t.Fatal("expired session accepted")
		}
		h.expires = time.Now().Add(time.Hour)
		req := httptest.NewRequest("GET", origin+"/", nil)
		req.RemoteAddr = "127.0.0.1:1000"
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != 200 || strings.Contains(w.Body.String(), token) || strings.Contains(w.Body.String(), ids[0]) {
			t.Fatal("static shell leaked session/message")
		}
	})
	t.Run("source_outage_and_corruption_fail_closed_then_recover", func(t *testing.T) {
		broken := *s
		broken.Objects = LocalStore{t.TempDir()}
		h, err := NewLocalInbox(&broken, scopes[0], origin, token)
		if err != nil {
			t.Fatal(err)
		}
		w := call(h, "mail.messages.get", map[string]any{"message_id": ids[2]}, nil)
		if w.Code != 409 || strings.Contains(w.Body.String(), "LOCAL_READ_SUCCESS") || strings.Contains(w.Body.String(), "synthetic first ingest") {
			t.Fatal("missing originals returned content")
		}
		var view MessageView
		readResult(call(handler, "mail.messages.get", map[string]any{"message_id": ids[2]}, nil), &view)
		if view.From == view.EnvelopeFrom || !strings.Contains(view.From, "sender@example.invalid") || view.EnvelopeFrom != "demo@example.invalid" {
			t.Fatal("header/envelope distinction lost")
		}
		failed := *s
		failed.Objects = errorReadStore{ErrIntegrity}
		if _, err := failed.ViewMessage(ctx, scopes[0], ids[2]); !errors.Is(err, ErrIntegrity) {
			t.Fatal("corrupt object accepted")
		}
	})
}

type errorReadStore struct{ err error }

func (s errorReadStore) Get(context.Context, Object) ([]byte, error)         { return nil, s.err }
func (s errorReadStore) Put(context.Context, string, []byte) (Object, error) { return Object{}, s.err }
