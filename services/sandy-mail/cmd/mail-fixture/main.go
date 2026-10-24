// A bounded deployment canary, not SMTP ingress or a customer authorization API.
// Requires pre-existing scoped identity, database, bucket and synthetic mailbox.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	mailstore "github.com/ausstyle/web-staging/services/sandy-mail"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/oauth2/google"
	"os"
	"regexp"
	"time"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "Sandy Mail canary failed; no completion receipt: "+err.Error())
		os.Exit(1)
	}
}
func run() error {
	if len(os.Args) != 2 {
		return fmt.Errorf("usage: mail-fixture migrate|ingest|recover|read")
	}
	action := os.Args[1]
	if action != "migrate" && action != "ingest" && action != "recover" && action != "read" {
		return fmt.Errorf("unsupported_action")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	dsn := os.Getenv("MAIL_DATABASE_DSN")
	cfg, e := pgxpool.ParseConfig(dsn)
	if e != nil || dsn == "" {
		return fmt.Errorf("database_configuration_required")
	}
	expected := os.Getenv("MAIL_EXPECTED_DATABASE")
	if expected == "" || cfg.ConnConfig.Database != expected {
		return fmt.Errorf("exact_database_target_required")
	}
	local := os.Getenv("MAIL_ENVIRONMENT") == "local"
	if !local && os.Getenv("MAIL_ENVIRONMENT") != "cloudsql-canary" {
		return fmt.Errorf("explicit_environment_required")
	}
	if local && (cfg.ConnConfig.Host != "127.0.0.1" || expected != "sandy_mail_test") {
		return fmt.Errorf("local_loopback_test_database_required")
	}
	// Remote TCP must validate TLS. An already authorized local Cloud SQL Auth
	// Proxy/socket is acceptable; this command never launches or credentials it.
	if !local && cfg.ConnConfig.TLSConfig == nil && cfg.ConnConfig.Host != "127.0.0.1" && len(cfg.ConnConfig.Host) > 0 && cfg.ConnConfig.Host[0] != '/' {
		return fmt.Errorf("tls_or_existing_local_cloudsql_proxy_required")
	}
	for _, fallback := range cfg.ConnConfig.Fallbacks {
		if !local && (fallback.TLSConfig == nil || fallback.TLSConfig.InsecureSkipVerify) {
			return fmt.Errorf("tls_downgrade_not_allowed")
		}
	}
	if cfg.ConnConfig.TLSConfig != nil && cfg.ConnConfig.TLSConfig.InsecureSkipVerify {
		return fmt.Errorf("verified_tls_required")
	}
	if action == "migrate" {
		c, e := pgx.ConnectConfig(ctx, cfg.ConnConfig)
		if e != nil {
			return fmt.Errorf("database_connection_failed")
		}
		defer c.Close(ctx)
		if e = mailstore.Migrate(ctx, c); e != nil {
			return e
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"migration_applied": true, "environment": os.Getenv("MAIL_ENVIRONMENT"), "database": expected, "mail_ingested": false})
	}
	scope := mailstore.Scope{Tenant: os.Getenv("MAIL_TENANT_ID"), Account: os.Getenv("MAIL_ACCOUNT_ID"), Mailbox: os.Getenv("MAIL_MAILBOX_ID")}
	var objects mailstore.ObjectStore
	if local {
		root := os.Getenv("MAIL_LOCAL_OBJECT_DIR")
		if root == "" {
			return fmt.Errorf("local_object_directory_required")
		}
		objects = mailstore.LocalStore{Root: root}
	} else {
		bucket := os.Getenv("MAIL_GCS_BUCKET")
		if bucket == "" || os.Getenv("MAIL_CLOUDSQL_CONNECTION_NAME") == "" {
			return fmt.Errorf("approved_gcs_and_cloudsql_targets_required")
		}
		client, e := google.DefaultClient(ctx, "https://www.googleapis.com/auth/devstorage.read_write")
		if e != nil {
			return fmt.Errorf("existing_workload_identity_required")
		}
		objects = mailstore.GCSStore{Bucket: bucket, Client: client}
	}
	cfg.MaxConns = 4
	pool, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		return fmt.Errorf("database_configuration_failed")
	}
	defer pool.Close()
	release := os.Getenv("MAIL_RELEASE_REF")
	if !regexp.MustCompile(`^[a-f0-9]{40}([a-f0-9]{24})?$`).MatchString(release) {
		return fmt.Errorf("immutable_release_reference_required")
	}
	service := mailstore.Service{DB: pool, Objects: objects, Release: release}
	req := mailstore.Request{Scope: scope, DeliveryID: "synthetic-first-001", Source: "synthetic-rfc822", Envelope: mailstore.Envelope{From: "sender@example.invalid", To: []string{"first-ingest@example.invalid"}, ReceivedAt: time.Date(2026, 10, 24, 0, 0, 0, 0, time.UTC)}, Raw: mailstore.SyntheticFixture}
	if action == "ingest" {
		if _, e = service.Ingest(ctx, req); e != nil {
			return e
		}
	} else if action == "recover" {
		if _, e = service.Recover(ctx, scope, req.DeliveryID); e != nil {
			return e
		}
	}
	m, raw, e := service.Retrieve(ctx, scope, req.DeliveryID)
	if e != nil {
		return e
	}
	if !bytes.Equal(raw, mailstore.SyntheticFixture) {
		return fmt.Errorf("fixture_readback_mismatch")
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"environment": os.Getenv("MAIL_ENVIRONMENT"), "configured_cloudsql_connection": os.Getenv("MAIL_CLOUDSQL_CONNECTION_NAME"), "database": expected, "configured_gcs_bucket": os.Getenv("MAIL_GCS_BUCKET"), "scope": scope, "message": m, "raw_byte_equal": true, "external_messages_sent": 0, "provider_identity_independently_verified": false})
}
