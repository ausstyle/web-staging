"""Print a complete rollback-only test of the actual additive09120 migration.

Usage: python3 supabase/tests/build_sandy_commerce_strict_migration_rollback.py > /tmp/commerce-strict-migration.sql
Execute the whole emitted file in one database connection; it does not create an
Auth user, call a provider, reset a sequence or persist a changed contract.
"""
from pathlib import Path

repository = Path(__file__).resolve().parents[2]
migration = (repository / "supabase/migrations/20261021009120_sandy_commerce_strict_result_contracts.sql").read_text()
migration = migration.replace("BEGIN;", "", 1).rsplit("COMMIT;", 1)[0]
guard = "DO $strict_revision$" + migration.split("DO $strict_revision$", 1)[1]


def rejected_drift(update: str, expected: str) -> str:
    # Each deliberately changed row lives in a subtransaction which the actual
    # migration's exception rolls back. Never substitute a mirrored guard here.
    return (
        "DO $test$ BEGIN BEGIN " + update
        + ";EXECUTE $actual_guard$" + guard
        + "$actual_guard$;RAISE EXCEPTION 'expected_migration_guard_failure';"
        + "EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '" + expected
        + "%' THEN RAISE;END IF;END;END $test$;"
    )


print("BEGIN;SET LOCAL statement_timeout='45s';SET LOCAL lock_timeout='3s';")
print(migration)
# ON COMMIT DROP is normally discharged between successive migration calls.
# Removing only this temporary fixture permits a second run in one rollback.
print("DROP TABLE pg_temp.sandy_commerce_strict_revision;")
print(migration)
print(rejected_drift(
    "UPDATE public.sandy_commerce_contracts SET contract='{}' WHERE operation='commerce.configuration.get'",
    "strict_commerce_private_contract_drift:",
))
print(rejected_drift(
    "UPDATE public.sandy_operation_registry SET output_schema='{}' WHERE operation='commerce.configuration.get'",
    "strict_commerce_registry_contract_drift:",
))
print("""SELECT jsonb_build_object(
 'kind','actual_migration_guard_full_rollback','repeated_exact_revision',true,
 'private_drift_rejected',true,'registry_drift_rejected',true,
 'strict_private_contracts',(SELECT count(*) FROM public.sandy_commerce_contracts WHERE contract->>'version'='1.1.0'),
 'closed_registry_contracts',(SELECT count(*) FROM public.sandy_operation_registry r JOIN public.sandy_commerce_contracts c USING(operation) WHERE NOT api_exposed AND NOT ai_exposed AND NOT ui_exposed AND NOT verified AND last_verified_at IS NULL AND r.error_contract->>'contract_sha256'=c.contract->>'contract_sha256')
) AS evidence;ROLLBACK;""")
