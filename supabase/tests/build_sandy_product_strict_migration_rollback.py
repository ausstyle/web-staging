"""Print a complete rollback-only test of the actual additive09020 migration.

Usage: python3 supabase/tests/build_sandy_product_strict_migration_rollback.py > /tmp/product-strict-migration.sql
Execute the whole emitted file in one database connection; it does not create an
Auth user, call a provider, reset a sequence or persist a changed contract.
"""
from pathlib import Path

repository = Path(__file__).resolve().parents[2]
migration = (repository / "supabase/migrations/20261021090200_sandy_product_strict_resource_contracts.sql").read_text()
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
# Reinvoke the actual guard phase against its existing reviewed temporary rows.
# Repeating the multi-megabyte VALUES payload would exceed the Management API
# request limit without testing a different contract transition.
print(guard)
print(rejected_drift(
    "UPDATE public.sandy_product_operation_contracts SET contract='{}' WHERE operation='customer.profile.get'",
    "strict_product_private_contract_drift:",
))
print(rejected_drift(
    "UPDATE public.sandy_operation_registry SET output_schema='{}' WHERE operation='customer.profile.get'",
    "strict_product_registry_contract_drift:",
))
print("""SELECT jsonb_build_object(
 'kind','actual_migration_guard_full_rollback','repeated_exact_revision',true,
 'private_drift_rejected',true,'registry_drift_rejected',true,
 'strict_private_contracts',(SELECT count(*) FROM public.sandy_product_operation_contracts WHERE contract->>'contract_version'='1.1.0'),
 'closed_registry_contracts',(SELECT count(*) FROM public.sandy_operation_registry r JOIN public.sandy_product_operation_contracts c USING(operation) WHERE NOT api_exposed AND NOT ai_exposed AND NOT ui_exposed AND NOT verified AND last_verified_at IS NULL AND r.error_contract->>'contract_sha256'=c.contract->>'contract_sha256')
) AS evidence;ROLLBACK;""")
