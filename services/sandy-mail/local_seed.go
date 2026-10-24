package mailstore

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// A separate synthetic mailbox: never changes the first-email canary rows.
var LocalInboxScope = Scope{"23900000-0000-4000-8000-000000000101", "23900000-0000-4000-8000-000000000102", "23900000-0000-4000-8000-000000000103"}

func SeedLocalInbox(ctx context.Context, admin *pgx.Conn, s *Service) ([]Receipt, error) {
	cfg := admin.Config()
	if cfg.Host != "127.0.0.1" || cfg.Database != "sandy_mail_test" || len(cfg.Fallbacks) > 0 {
		return nil, fmt.Errorf("local_test_database_required")
	}
	// Validate the runtime adapter before any seed write. No grants are created.
	if _, err := NewLocalInbox(s, LocalInboxScope, "http://127.0.0.1:8789", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"); err != nil {
		return nil, err
	}
	tx, err := scopedTx(ctx, admin, LocalInboxScope)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	sc := LocalInboxScope
	_, err = tx.Exec(ctx, `INSERT INTO core.tenants(tenant_id,region) VALUES($1,'local-inbox-synthetic') ON CONFLICT DO NOTHING`, sc.Tenant)
	if err != nil {
		return nil, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO core.mail_accounts VALUES($1,$2,'hosted','synthetic-local-inbox') ON CONFLICT DO NOTHING`, sc.Tenant, sc.Account)
	if err != nil {
		return nil, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO core.mailboxes VALUES($1,$2,$3,'Synthetic Local Inbox') ON CONFLICT DO NOTHING`, sc.Tenant, sc.Account, sc.Mailbox)
	if err != nil {
		return nil, err
	}
	var valid bool
	err = tx.QueryRow(ctx, `SELECT t.region='local-inbox-synthetic' AND a.provider='synthetic-local-inbox' AND m.name='Synthetic Local Inbox' FROM core.tenants t JOIN core.mail_accounts a USING(tenant_id) JOIN core.mailboxes m USING(tenant_id,account_id) WHERE tenant_id=$1 AND account_id=$2 AND mailbox_id=$3`, sc.Tenant, sc.Account, sc.Mailbox).Scan(&valid)
	if err != nil {
		return nil, err
	}
	if !valid {
		return nil, fmt.Errorf("synthetic_scope_collision")
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	receipts := []Receipt{}
	for i, raw := range LocalInboxFixtures() {
		r, err := s.Ingest(ctx, Request{Scope: sc, DeliveryID: fmt.Sprintf("local-inbox-v1-%02d", i), Source: "synthetic-local-inbox-v1", Envelope: Envelope{From: "demo@example.invalid", To: []string{"reader@example.invalid"}, ReceivedAt: time.Date(2026, 10, 24, 10, i, 0, 0, time.UTC)}, Raw: raw})
		if err != nil {
			return nil, err
		}
		receipts = append(receipts, r)
	}
	return receipts, nil
}
func LocalInboxFixtures() [][]byte {
	base := "From: Synthetic Demo <demo@example.invalid>\r\nTo: reader@example.invalid\r\nMIME-Version: 1.0\r\n"
	return [][]byte{
		[]byte(base + "Message-ID: <local-welcome@example.invalid>\r\nSubject: Welcome to your synthetic inbox\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nThis message was ingested into local PostgreSQL. Its original bytes are stored locally.\r\n\r\nSearch, open, refresh and retry use the real backend. Nothing here was sent over SMTP.\r\n"),
		[]byte(base + "Message-ID: <local-meeting@example.invalid>\r\nSubject: Synthetic meeting agenda\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nA fictional meeting agenda: verify the inbox, inspect the receipt and test search.\r\nNo meeting has been booked and no external message has been sent.\r\n"),
		append([]byte(nil), SyntheticFixture...),
		[]byte(base + "Message-ID: <local-safety@example.invalid>\r\nSubject: HTML safety fixture\r\nContent-Type: multipart/mixed; boundary=local-safety\r\n\r\n--local-safety\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<h1>Synthetic untrusted HTML</h1><script>window.mailUnsafeExecuted=true</script><img src=\"https://tracker.example.invalid/pixel\" onerror=\"window.mailUnsafeExecuted=true\"><a href=\"javascript:alert(1)\">unsafe link</a>\r\n--local-safety\r\nContent-Type: text/html\r\nContent-Disposition: attachment; filename=\"untrusted-preview.html\"\r\n\r\n<script>window.mailUnsafeExecuted=true</script>\r\n--local-safety--\r\n"),
	}
}
