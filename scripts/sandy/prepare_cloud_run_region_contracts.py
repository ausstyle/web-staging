"""Prepare exactly two existing contract revisions; never executes SQL or providers."""
import copy
import hashlib
import json
from pathlib import Path
from build_provider_operations import apply_cloud_run_read_scope, catalogue_loader, compact_manifest
OPERATIONS = {'gcp.cloud_run.services.list', 'gcp.cloud_run.services.get'}
def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def revise(catalogue):
    after=copy.deepcopy(catalogue); changes=[]
    for operation in after['operations']:
        if operation['operation'] not in OPERATIONS: continue
        before=copy.deepcopy(operation)
        output = operation.pop('output_schema', None)
        operation.pop('contract_sha256')
        apply_cloud_run_read_scope(operation)
        if output is not None: operation['output_schema'] = output
        operation['contract_sha256']=hashlib.sha256(canonical(operation).encode()).hexdigest()
        changes.append((before,operation))
    if len(changes) != 2 or {o['operation'] for _,o in changes} != OPERATIONS: raise ValueError('two_existing_contracts_required')
    return after,changes
def migration(changes):
    sql=['BEGIN;','-- Contract-only proposal. Preserve every exposure, verification and permission flag.','DO $guard$ BEGIN']
    for old,new in changes:
        n=new['operation'];digest=old['contract_sha256']
        if digest==new['contract_sha256']:raise ValueError('contract_already_revised_use_existing_migration')
        sql.append(f" IF NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='{n}' AND handler='sandy-provider-operation-api' AND error_contract->>'contract_sha256'='{digest}') THEN RAISE EXCEPTION 'cloud_run_contract_baseline_changed'; END IF;")
    sql.append('END $guard$;')
    for _,new in changes:
        schema=canonical(new['input_schema']).replace("'","''")
        sql.append(f"UPDATE public.sandy_operation_registry SET input_schema='{schema}'::jsonb,error_contract=jsonb_set(error_contract,'{{contract_sha256}}',to_jsonb('{new['contract_sha256']}'::text)) WHERE operation='{new['operation']}';")
    return '\n'.join(sql+['COMMIT;',''])
def main():
    root=Path(__file__).resolve().parents[2];directory=root/'supabase/functions/sandy-provider-operation-api'
    before=json.loads((directory/'contracts.json').read_text());after,changes=revise(before)
    sql=migration(changes) # Validate before changing any source artifact.
    raw=(json.dumps(after,separators=(',',':'),ensure_ascii=False)+'\n').encode()
    (directory/'contracts.json').write_bytes(raw);(directory/'catalogue.ts').write_text(catalogue_loader(raw))
    (directory/'gateway_manifest.json').write_text(json.dumps(compact_manifest(after),separators=(',',':'),ensure_ascii=False)+'\n')
    (root/'supabase/migrations/20261024002500_sandy_cloud_run_region_contracts.sql').write_text(sql)
    print(json.dumps([{'operation':n['operation'],'before':o['contract_sha256'],'after':n['contract_sha256']} for o,n in changes]))
if __name__=='__main__':main()
