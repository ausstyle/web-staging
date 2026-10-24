package mailstore

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5"
)

var SyntheticScope = Scope{"23900000-0000-4000-8000-000000000001", "23900000-0000-4000-8000-000000000002", "23900000-0000-4000-8000-000000000003"}

// SeedSynthetic creates only the reviewed fixture rows, using an already
// authorized migrator. It grants no SQL/IAM rights and provisions no real address.
func SeedSynthetic(ctx context.Context, c *pgx.Conn, region string) error {
	if region == "" || len(region) > 80 {
		return fmt.Errorf("fixture_region_required")
	}
	tx, e := c.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	sc := SyntheticScope
	if _, e = tx.Exec(ctx, `SELECT set_config('mail.tenant_id',$1,true),set_config('mail.account_id',$2,true),set_config('mail.mailbox_id',$3,true)`, sc.Tenant, sc.Account, sc.Mailbox); e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, `INSERT INTO core.tenants(tenant_id,region) VALUES($1,$2) ON CONFLICT DO NOTHING`, sc.Tenant, region); e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, `INSERT INTO core.mail_accounts VALUES($1,$2,'hosted','synthetic') ON CONFLICT DO NOTHING`, sc.Tenant, sc.Account); e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, `INSERT INTO core.mailboxes VALUES($1,$2,$3,'Synthetic Inbox') ON CONFLICT DO NOTHING`, sc.Tenant, sc.Account, sc.Mailbox); e != nil {
		return e
	}
	var matches bool
	e = tx.QueryRow(ctx, `SELECT t.region=$4 AND a.kind='hosted' AND a.provider='synthetic' AND m.name='Synthetic Inbox' FROM core.tenants t JOIN core.mail_accounts a USING(tenant_id) JOIN core.mailboxes m USING(tenant_id,account_id) WHERE tenant_id=$1 AND account_id=$2 AND mailbox_id=$3`, sc.Tenant, sc.Account, sc.Mailbox, region).Scan(&matches)
	if e != nil {
		return e
	}
	if !matches {
		return fmt.Errorf("synthetic_scope_collision_no_changes_committed")
	}
	return tx.Commit(ctx)
}
