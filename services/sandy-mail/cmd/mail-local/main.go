// Loopback-only local fixture reader. Not a customer gateway or cloud release.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	mailstore "github.com/ausstyle/web-staging/services/sandy-mail"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	port := flag.Int("port", 8789, "loopback port; 0 selects an available port")
	seed := flag.Bool("seed", false, "seed only the separate synthetic local inbox, then exit")
	flag.Parse()
	if *port < 0 || *port > 65535 || flag.NArg() != 0 {
		return fmt.Errorf("invalid_arguments")
	}
	dsn := os.Getenv("MAIL_LOCAL_DSN")
	root := os.Getenv("MAIL_LOCAL_OBJECT_DIR")
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil || dsn == "" || root == "" {
		return fmt.Errorf("MAIL_LOCAL_DSN_and_MAIL_LOCAL_OBJECT_DIR_required")
	}
	if cfg.ConnConfig.Host != "127.0.0.1" || cfg.ConnConfig.Database != "sandy_mail_test" || len(cfg.ConnConfig.Fallbacks) > 0 {
		return fmt.Errorf("local_test_database_required")
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return fmt.Errorf("local_database_unavailable")
	}
	defer pool.Close()
	s := &mailstore.Service{DB: pool, Objects: mailstore.LocalStore{Root: root}, Release: "local-inbox-v1"}
	if *seed {
		adminDSN := os.Getenv("MAIL_TEST_ADMIN_DSN")
		ac, err := pgx.ParseConfig(adminDSN)
		if err != nil || adminDSN == "" || ac.Host != "127.0.0.1" || ac.Database != "sandy_mail_test" || len(ac.Fallbacks) > 0 || ac.Port != cfg.ConnConfig.Port {
			return fmt.Errorf("matching_local_admin_database_required")
		}
		admin, err := pgx.ConnectConfig(ctx, ac)
		if err != nil {
			return fmt.Errorf("local_admin_database_unavailable")
		}
		defer admin.Close(ctx)
		receipts, err := mailstore.SeedLocalInbox(ctx, admin, s)
		if err != nil {
			return fmt.Errorf("local_seed_failed: %w", err)
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"environment": "local-only", "receipts": receipts, "external_messages_sent": 0})
	}
	if _, err = s.List(ctx, mailstore.LocalInboxScope, "", nil, 1); err != nil {
		return fmt.Errorf("local_mailbox_unavailable_check_setup_and_runtime_role")
	}
	ln, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		return fmt.Errorf("local_port_unavailable")
	}
	defer ln.Close()
	var secret [32]byte
	if _, err = rand.Read(secret[:]); err != nil {
		return err
	}
	token := hex.EncodeToString(secret[:])
	origin := "http://" + ln.Addr().String()
	handler, err := mailstore.NewLocalInbox(s, mailstore.LocalInboxScope, origin, token)
	if err != nil {
		return err
	}
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 35 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 8192}
	fmt.Printf("Local synthetic inbox (one-hour session; keep URL private): %s/#session=%s\n", origin, token)
	done := make(chan error, 1)
	go func() { done <- server.Serve(ln) }()
	select {
	case err = <-done:
		if err == http.ErrServerClosed {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdown, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		return server.Shutdown(shutdown)
	}
}
