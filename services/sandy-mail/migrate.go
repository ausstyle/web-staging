package mailstore

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

//go:embed migrations/*.sql
var migrations embed.FS

func digest(b []byte) string { sum := sha256.Sum256(b); return hex.EncodeToString(sum[:]) }

// Migrate uses one transaction and lock, verifies historical checksums, and never
// grants login/IAM privileges. Only a separately authorized migrator may call it.
func Migrate(ctx context.Context, conn *pgx.Conn) error {
	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var db string
	var version int
	if err = tx.QueryRow(ctx, "SELECT current_database(),current_setting('server_version_num')::int").Scan(&db, &version); err != nil {
		return err
	}
	if !strings.HasPrefix(db, "sandy_mail") || version < 170000 {
		return fmt.Errorf("dedicated_sandy_mail_database_and_postgres17_required")
	}
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(239,1)"); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `CREATE TABLE IF NOT EXISTS public.sandy_mail_migrations(version text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()); REVOKE ALL ON public.sandy_mail_migrations FROM PUBLIC`); err != nil {
		return err
	}
	files, err := migrations.ReadDir("migrations")
	if err != nil {
		return err
	}
	for _, f := range files {
		b, e := migrations.ReadFile("migrations/" + f.Name())
		if e != nil {
			return e
		}
		var old string
		e = tx.QueryRow(ctx, "SELECT sha256 FROM public.sandy_mail_migrations WHERE version=$1", f.Name()).Scan(&old)
		if e == nil {
			if old != digest(b) {
				return fmt.Errorf("migration_checksum_mismatch: %s", f.Name())
			}
			continue
		}
		if e != pgx.ErrNoRows {
			return e
		}
		if _, e = tx.Exec(ctx, string(b)); e != nil {
			return e
		}
		if _, e = tx.Exec(ctx, "INSERT INTO public.sandy_mail_migrations(version,sha256) VALUES($1,$2)", f.Name(), digest(b)); e != nil {
			return e
		}
	}
	return tx.Commit(ctx)
}
