"""Compose the reviewed rollback-only trigger guard and VM-specific native fixture."""
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
guard=(ROOT/'supabase/tests/sandy_legacy_provider_rollback.sql').read_text().split('CREATE TEMP TABLE legacy_provider_checks')[0]
(HERE/'custody_test.sql').write_text(guard+(HERE/'custody_test_body.sql').read_text())
parts=["BEGIN;SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;\nCREATE TEMP TABLE vm_registry_snapshot ON COMMIT DROP AS SELECT operation,to_jsonb(r) AS document FROM public.sandy_operation_registry r;"]
for name in ['20261021008900_sandy_vm_protocol_boundary.sql','20261021008910_sandy_vm_protocol_contracts.sql']:
 body=(ROOT/'supabase/migrations'/name).read_text().replace('BEGIN;\n','',1)
 parts.append(body[:body.rfind('COMMIT;')])
Path('/tmp/vm-protocol-089-combined.sql').write_text('\n'.join(parts)+'\nCOMMIT;\n')
