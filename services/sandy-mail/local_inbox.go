package mailstore

import (
	"context"
	"crypto/subtle"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

//go:embed localui/*
var localUI embed.FS

type localInbox struct {
	service             *Service
	scope               Scope
	host, origin, token string
	expires             time.Time
	slots               chan struct{}
}

// NewLocalInbox is a development transport, never a deployed identity adapter.
// It refuses non-local DB/object adapters and binds one preseeded synthetic scope.
// No request may supply tenant/account/mailbox, SQL, a provider URL or object key.
func NewLocalInbox(s *Service, scope Scope, origin, token string) (http.Handler, error) {
	if s == nil || s.DB == nil || !scope.valid() || len(token) != 64 {
		return nil, fmt.Errorf("local_session_configuration_required")
	}
	for _, c := range token {
		if !strings.ContainsRune("0123456789abcdef", c) {
			return nil, fmt.Errorf("local_session_configuration_required")
		}
	}
	cfg := s.DB.Config().ConnConfig
	if cfg.Host != "127.0.0.1" || cfg.Database != "sandy_mail_test" || len(cfg.Fallbacks) > 0 {
		return nil, fmt.Errorf("local_test_database_required")
	}
	if _, ok := s.Objects.(LocalStore); !ok {
		return nil, fmt.Errorf("local_objects_required")
	}
	u, err := url.Parse(origin)
	if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.Port() == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return nil, fmt.Errorf("loopback_origin_required")
	}
	return &localInbox{s, scope, u.Host, origin, token, time.Now().Add(time.Hour), make(chan struct{}, 4)}, nil
}

type localRequest struct {
	Operation string          `json:"operation"`
	Version   int             `json:"version"`
	RequestID string          `json:"request_id"`
	Arguments json.RawMessage `json:"arguments"`
}
type localResult struct {
	Operation   string `json:"operation"`
	Version     int    `json:"version"`
	RequestID   string `json:"request_id"`
	State       string `json:"state"`
	Environment string `json:"environment"`
	Result      any    `json:"result,omitempty"`
	Error       string `json:"error,omitempty"`
}

func decodeStrict(r io.Reader, v any) error {
	d := json.NewDecoder(r)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		return e
	}
	if e := d.Decode(new(any)); e != io.EOF {
		return fmt.Errorf("trailing_json")
	}
	return nil
}
func (h *localInbox) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil || !net.ParseIP(host).IsLoopback() || r.Host != h.host || r.Header.Get("Forwarded") != "" || r.Header.Get("X-Forwarded-Host") != "" {
		http.Error(w, "local_origin_required", 403)
		return
	}
	if r.Method == http.MethodGet {
		file, typ := "", ""
		switch r.URL.Path {
		case "/":
			file = "index.html"
			typ = "text/html; charset=utf-8"
		case "/app.js":
			file = "app.js"
			typ = "text/javascript; charset=utf-8"
		case "/style.css":
			file = "style.css"
			typ = "text/css; charset=utf-8"
		}
		if file != "" {
			b, _ := localUI.ReadFile("localui/" + file)
			w.Header().Set("Content-Type", typ)
			w.Write(b)
			return
		}
	}
	if r.URL.Path != "/api/operations" {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method_not_allowed", 405)
		return
	}
	if r.Header.Get("Origin") != h.origin || r.URL.RawQuery != "" || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		http.Error(w, "same_origin_required", 403)
		return
	}
	if time.Now().After(h.expires) || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+h.token)) != 1 {
		http.Error(w, "session_required_or_expired", 401)
		return
	}
	if r.Header.Get("Content-Type") != "application/json" {
		http.Error(w, "json_required", 415)
		return
	}
	var req localRequest
	if decodeStrict(http.MaxBytesReader(w, r.Body, 8192), &req) != nil || req.Version != 1 || len(req.RequestID) == 0 || len(req.RequestID) > 100 {
		http.Error(w, "invalid_request", 400)
		return
	}
	out := localResult{Operation: req.Operation, Version: 1, RequestID: req.RequestID, Environment: "local-postgresql-filesystem-synthetic", State: "FAILED"}
	reply := func(status int, code string, result any) {
		out.Error = code
		out.Result = result
		if status == 200 {
			out.State = "LOCAL_READ_SUCCESS"
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(out)
	}
	select {
	case h.slots <- struct{}{}:
		defer func() { <-h.slots }()
	default:
		reply(429, "local_capacity_retry", nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	var result any
	switch req.Operation {
	case "mail.messages.list":
		var a struct {
			Query string  `json:"query"`
			After *Cursor `json:"after"`
			Limit int     `json:"limit"`
		}
		if decodeStrict(strings.NewReader(string(req.Arguments)), &a) != nil || a.Limit < 1 || a.Limit > 100 || len(a.Query) > 500 || (a.After != nil && (a.After.ReceivedAt.IsZero() || !idPattern.MatchString(a.After.MessageID))) {
			reply(400, "invalid_arguments", nil)
			return
		}
		var items []MailboxItem
		items, err = h.service.List(ctx, h.scope, a.Query, a.After, a.Limit)
		var next *Cursor
		if len(items) == a.Limit {
			last := items[len(items)-1]
			next = &Cursor{last.ReceivedAt, last.MessageID}
		}
		result = struct {
			Items []MailboxItem `json:"items"`
			Next  *Cursor       `json:"next"`
		}{items, next}
	case "mail.messages.get":
		var a struct {
			MessageID string `json:"message_id"`
		}
		if decodeStrict(strings.NewReader(string(req.Arguments)), &a) != nil || !idPattern.MatchString(a.MessageID) {
			reply(400, "invalid_arguments", nil)
			return
		}
		result, err = h.service.ViewMessage(ctx, h.scope, a.MessageID)
	default:
		reply(404, "unsupported_operation", nil)
		return
	}
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			reply(404, "message_not_found_or_not_authorized", nil)
		case errors.Is(err, ErrIntegrity), errors.Is(err, ErrObjectNotFound):
			reply(409, "source_integrity_unavailable", nil)
		default:
			reply(503, "local_backend_unavailable_retry", nil)
		}
		return
	}
	if ctx.Err() != nil {
		reply(503, "local_backend_unavailable_retry", nil)
		return
	}
	reply(200, "", result)
}
