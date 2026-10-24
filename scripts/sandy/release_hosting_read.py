#!/usr/bin/env python3
"""Exact two-function regional contract release. Default: read-only inspection.
No binding installation, grant/exposure changes, credentials or Owner impersonation.
Unknown dispatch is reconciled read-only; neither forward nor rollback auto-retries.
"""
import argparse, base64, gzip, io, json, os, subprocess, uuid
from pathlib import Path
from prepare_hosting_read_release import (SOURCE, PROVIDER, GATEWAY, MIGRATION,
    BASELINES, HELPER, REPLACEMENTS, source_file, build_candidate, assert_stable_metadata)
from release_gcp_admin_read import Installer
from release_web_canary import Blocked, ROOT, original_sources, private_write
from release_provider_response_fix import sha, canonical, quote, source_map, BACKUP_CHUNK_BYTES
PIN='ba221f869426f8b16d8dddde4f783e63bf95b2d818628bbd586645efe1be62ed'
TARGETS=(PROVIDER,GATEWAY)
VERSION='20261024002500'
REGISTRY='sandy-operation-registry:cloud-run-region'
COMPONENTS=tuple(sorted((*TARGETS,REGISTRY)))
NEW_HASHES={'gcp.cloud_run.services.list':'5546d66eef72f51f1dd71a03d8ca7ebfee4e3a3646e2c505d1d7cd37d9ad0611',
'gcp.cloud_run.services.get':'e114b33c6a5def2e2e26f22785bb226d908181da4c01f849293e381a429b40d2'}
OPS=','.join(quote(x) for x in sorted(NEW_HASHES))
CHECKS={'provider-response-contract-tests','api-contract-tests','supabase-gap-contract-tests','vm-protocol-contract-tests','examiner-evidence-tests','offline-contract-tests'}
def require(ok,code):
    if not ok:raise Blocked(code)
def validate_manifest(m):
    require(sha(canonical(m))==PIN,'exact_regional_manifest_required')
    require(m['source_commit']==SOURCE and set(m['functions'])==set(TARGETS) and m['project_ref']=='zmqlyygzqoidkcwdysok','release_target_denied')
    for target in TARGETS:
        f=m['functions'][target];v,digest,count=BASELINES[target]
        require(f['expected_prior_version']==v and f['prior_bundle_sha256']==digest and len(f['before_files'])==count and f['verify_jwt'] is True,'fixed_preimage_required')
    require(sha(source_file(MIGRATION))==m['database']['migration_sha256'],'migration_source_changed')
    return m

def load(r,candidate):
    candidate=str(uuid.UUID(candidate))
    rows=r.sql(f"SELECT evidence->'artifact_manifest' AS manifest FROM public.sandy_engineering_tests WHERE change_id='{candidate}' AND outcome='passed' AND evidence->>'artifact_manifest_sha256'='{PIN}'",True)
    unique={sha(canonical(x['manifest'])):x['manifest'] for x in rows}
    require(set(unique)=={PIN},'durable_exact_candidate_required')
    return validate_manifest(unique[PIN])

EXECUTOR_FILES=('scripts/sandy/release_hosting_read.py','scripts/sandy/prepare_hosting_read_release.py',
'scripts/sandy/release_provider_response_fix.py','scripts/sandy/release_gcp_admin_read.py',
'scripts/sandy/release_web_canary.py','.github/workflows/sandy-hosting-read-release.yml')
def executor_pin():return sha(canonical({p:sha((ROOT/p).read_bytes()) for p in EXECUTOR_FILES}))

def owner(r,change):
    # This is the existing genuine Owner gate. A source-only proposal, delegated
    # test identity, stale approval or old PR222 audit cannot admit this release.
    scopes=json.dumps([*TARGETS,MIGRATION]);executor=executor_pin()
    rows=r.sql(f"""SELECT EXISTS(SELECT 1 FROM public.sandy_engineering_changes c
      JOIN public.sandy_engineering_change_events e ON e.change_id=c.id
      JOIN public.sandy_controller_admins a ON a.auth_user_id=e.actor AND a.enabled AND a.role='owner'
      JOIN auth.users u ON u.id=a.auth_user_id
      WHERE c.id='{change}' AND c.status IN ('approved','implementing') AND c.risk IN ('low','normal')
      AND c.scope @> {quote(scopes)}::jsonb
      AND position('{SOURCE}' in c.expected_behavior)>0 AND position('{PIN}' in c.expected_behavior)>0
      AND position('executor_sha256={executor}' in c.expected_behavior)>0
      AND coalesce(u.raw_app_meta_data->>'sandy_engineering_test','false')<>'true'
      AND e.event_type='status_changed' AND e.detail->>'to'='approved'
      AND e.occurred_at > clock_timestamp()-interval '24 hours'
      AND position('{SOURCE}' in e.detail->>'reason')>0 AND position('{PIN}' in e.detail->>'reason')>0
      AND position('executor_sha256={executor}' in e.detail->>'reason')>0
      AND position('bounded source and contract rollback' in e.detail->>'reason')>0) AS admitted""",True)
    require(rows==[{'admitted':True}],'genuine_exact_unexpired_Owner_approval_required')

def verify_ci(rows,source,checks):
    latest={}
    for row in rows:
        name=row.get('name')
        if name in checks and row.get('head_sha')==source and row.get('id',-1)>latest.get(name,{}).get('id',-1):latest[name]=row
    require(set(latest)==checks and all(x.get('status')=='completed' and x.get('conclusion')=='success' for x in latest.values()),'independent_exact_source_CI_required')

def ci():
    # Candidate source and actual workflow revision both need successful checks.
    for source,checks in [(SOURCE,CHECKS),(os.environ.get('GITHUB_SHA',''),{'examiner-evidence-tests','offline-contract-tests'})]:
        require(len(source)==40 and all(c in '0123456789abcdef' for c in source),'protected_executor_revision_required')
        rows=json.loads(subprocess.check_output(['gh','api',f'repos/ausstyle/web-staging/commits/{source}/check-runs?per_page=100'],text=True))
        verify_ci(rows['check_runs'],source,checks)

def inspect_function(r,m,target):
    meta=json.loads(r.api('GET','/functions/'+target));body=r.api('GET','/functions/'+target+'/body')
    assert_stable_metadata(meta,json.loads(r.api('GET','/functions/'+target)))
    f=m['functions'][target];files=original_sources(body);digests=source_map(files)
    require(meta.get('status')=='ACTIVE' and meta.get('verify_jwt') is True and not meta.get('import_map') and not meta.get('import_map_path'),'function_config_drift')
    state='foreign'
    if meta['version']==f['expected_prior_version'] and sha(body)==f['prior_bundle_sha256'] and digests==f['before_files']:state='before'
    elif meta['version']==f['expected_prior_version']+1 and digests==f['after_files']:state='candidate'
    elif meta['version']==f['expected_prior_version']+2 and digests==f['before_files']:state='restored'
    return state,meta,body,files

def contracts(r):
    return r.sql(f'SELECT operation,input_schema,error_contract FROM public.sandy_operation_registry WHERE operation IN ({OPS}) ORDER BY operation',True)

def contract_state(m,rows):
    if sha(canonical(rows))==m['database']['prior_contract_records_sha256']:return 'before'
    old=m['database']['prior_contract_hashes']
    if len(rows)!=2 or {r['operation'] for r in rows}!=set(old):return 'foreign'
    normalized=json.loads(json.dumps(rows))
    for row in normalized:
        if row['error_contract'].get('contract_sha256')!=NEW_HASHES[row['operation']]:return 'foreign'
        row['error_contract']['contract_sha256']=old[row['operation']]
        if row['operation'].endswith('.list'):
            if row['input_schema'].get('properties',{}).get('region')!={'enum':['europe-west1','europe-west8'],'type':'string'}:return 'foreign'
            row['input_schema']['properties'].pop('region')
    return 'candidate' if sha(canonical(normalized))==m['database']['prior_contract_records_sha256'] else 'foreign'

def inspect(r,m):
    return {t:inspect_function(r,m,t) for t in TARGETS},contracts(r)

def event(r,change,kind,detail):
    r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{change}',{quote('hosting_read_'+kind)},NULL,{quote(json.dumps({'manifest_sha256':PIN,**detail}))}::jsonb)")

def lease(r,m,change,acquire=False):
    if acquire:
        chunks=['BEGIN;']
        for target in COMPONENTS:
            digest=m['functions'][target]['prior_bundle_sha256'] if target in TARGETS else m['database']['prior_contract_records_sha256']
            chunks.append(f"""DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at)
            VALUES({quote(target)},{quote(r.holder)},'{change}','{digest}',clock_timestamp()+interval '15 minutes')
            ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp()
            WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();
            IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$;""")
        r.sql('\n'.join(chunks+['COMMIT;']))
    else:
        names=','.join(quote(t) for t in COMPONENTS)
        rows=r.sql(f"SELECT count(*)::integer AS held FROM public.sandy_engineering_component_leases WHERE component IN ({names}) AND holder={quote(r.holder)} AND change_id='{change}' AND expires_at>clock_timestamp()+interval '2 minutes'",True)
        require(rows==[{'held':len(COMPONENTS)}],'shared_release_lease_lost')

def store_recovery(r,m,change,target,observed,prior_rows):
    require(target in TARGETS and observed[0]=='before','recovery_requires_original_source')
    existing=r.sql(f"SELECT id FROM public.sandy_engineering_artifacts WHERE change_id='{change}' AND target={quote(target)} AND metadata->>'manifest_sha256'='{PIN}'",True)
    require(existing==[],'existing_recovery_requires_reconciliation_no_retry')
    packed=gzip.compress(observed[2],mtime=0);encoded=base64.b64encode(packed).decode()
    data={'kind':'private-hosting-read-recovery-v1','manifest_sha256':PIN,'bundle_transfer_state':'writing','bundle_gzip_base64':'','compressed_sha256':sha(packed),'prior_contract_records':prior_rows}
    rows=r.sql(f"INSERT INTO public.sandy_engineering_artifacts(change_id,artifact_type,target,before_ref,rollback_strategy,rollback_notes,metadata) VALUES('{change}','edge_function',{quote(target)},{quote('version:'+str(observed[1]['version']))},'redeploy_prior','Exact candidate-only source and contract recovery; preserve later releases and evidence',{quote(json.dumps(data))}::jsonb) RETURNING id")
    require(len(rows)==1,'recovery_not_confirmed');artifact=str(uuid.UUID(rows[0]['id']))
    for offset in range(0,len(encoded),BACKUP_CHUNK_BYTES):
        rows=r.sql(f"UPDATE public.sandy_engineering_artifacts SET metadata=jsonb_set(metadata,'{{bundle_gzip_base64}}',to_jsonb((metadata->>'bundle_gzip_base64')||{quote(encoded[offset:offset+BACKUP_CHUNK_BYTES])})) WHERE id='{artifact}' AND change_id='{change}' AND target={quote(target)} AND metadata->>'manifest_sha256'='{PIN}' AND metadata->>'bundle_transfer_state'='writing' AND length(metadata->>'bundle_gzip_base64')={offset} RETURNING id")
        require(rows==[{'id':artifact}],'recovery_append_unknown_no_upload')
    rows=r.sql(f"UPDATE public.sandy_engineering_artifacts SET metadata=jsonb_set(metadata,'{{bundle_transfer_state}}','\"complete\"'::jsonb) WHERE id='{artifact}' AND length(metadata->>'bundle_gzip_base64')={len(encoded)} AND encode(extensions.digest(decode(metadata->>'bundle_gzip_base64','base64'),'sha256'),'hex')='{sha(packed)}' RETURNING id")
    require(rows==[{'id':artifact}],'recovery_digest_unverified_no_upload')
    return artifact

def read_recovery(r,m,change,target):
    rows=r.sql(f"SELECT id,metadata FROM public.sandy_engineering_artifacts WHERE change_id='{change}' AND target={quote(target)} AND metadata->>'manifest_sha256'='{PIN}' AND metadata->>'bundle_transfer_state'='complete'",True)
    require(len(rows)==1,'unique_complete_recovery_required')
    d=rows[0]['metadata'];packed=base64.b64decode(d['bundle_gzip_base64'],validate=True)
    require(sha(packed)==d['compressed_sha256'],'recovery_compressed_digest_invalid')
    with gzip.GzipFile(fileobj=io.BytesIO(packed)) as stream:body=stream.read(32*1024*1024+1)
    require(len(body)<=32*1024*1024 and sha(body)==m['functions'][target]['prior_bundle_sha256'],'recovery_bundle_invalid')
    files=original_sources(body)
    require(source_map(files)==m['functions'][target]['before_files'] and contract_state(m,d['prior_contract_records'])=='before','recovery_modules_or_contracts_invalid')
    return files,d['prior_contract_records']

def mutate_contracts(r,m,change,prior_rows,rollback):
    expected='candidate' if rollback else 'before'
    rows=contracts(r);require(contract_state(m,rows)==expected,'contract_drift_no_mutation')
    # Exact row locks and value preimages protect against other registry writers,
    # including writers not using this component lease. History is never erased.
    sql=['BEGIN;',"SELECT pg_advisory_xact_lock(hashtext('sandy-cloud-run-region-contracts'));",f'SELECT operation FROM public.sandy_operation_registry WHERE operation IN ({OPS}) ORDER BY operation FOR UPDATE;']
    for row in rows:
        sql.append(f"DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation={quote(row['operation'])} AND input_schema={quote(json.dumps(row['input_schema']))}::jsonb AND error_contract={quote(json.dumps(row['error_contract']))}::jsonb AND handler='{PROVIDER}') THEN RAISE EXCEPTION 'contract preimage changed';END IF;END $$;")
    if rollback:
        for row in prior_rows:
            sql.append(f"UPDATE public.sandy_operation_registry SET input_schema={quote(json.dumps(row['input_schema']))}::jsonb,error_contract={quote(json.dumps(row['error_contract']))}::jsonb WHERE operation={quote(row['operation'])};")
    else:
        migration=source_file(MIGRATION).decode().strip()
        require(migration.startswith('BEGIN;') and migration.endswith('COMMIT;'),'transactional_migration_required')
        sql.append(migration[6:-7]);sql.append(f"INSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key) VALUES('{VERSION}',ARRAY[{quote(migration)}],'sandy_cloud_run_region_contracts','protected_github_management_release','hosting-region-{PIN}');")
    # Record the DB outcome in the SAME transaction, so a lost ack can be read.
    sql.append(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{change}','hosting_read_contracts_committed',NULL,{quote(json.dumps({'manifest_sha256':PIN,'rollback':rollback}))}::jsonb);")
    r.sql('\n'.join(sql+['COMMIT;']))
    require(contract_state(m,contracts(r))==('before' if rollback else 'candidate'),'contract_outcome_unknown_reconcile')

def execute(r,m,change,mode):
    change=str(uuid.UUID(change));require(mode in ('deploy','rollback'),'mode_denied');owner(r,change);ci()
    # A prior forward/rollback intent prohibits retry even if the provider still
    # appears unchanged; reconciliation is read-only, never dispatch resumption.
    def no_prior():
        rows=r.sql(f"SELECT count(*)::integer AS n FROM public.sandy_engineering_change_events WHERE change_id='{change}' AND event_type='hosting_read_dispatch_started' AND detail->>'manifest_sha256'='{PIN}' AND detail->>'mode'={quote(mode)}",True)
        require(rows==[{'n':0}],'prior_dispatch_requires_reconciliation_no_retry')
    no_prior();lease(r,m,change,True)
    try:
        no_prior();states,rows=inspect(r,m);dbstate=contract_state(m,rows)
        if mode=='deploy':
            require(all(x[0]=='before' for x in states.values()) and dbstate=='before','release_preimage_drift')
            history=r.sql(f"SELECT version FROM supabase_migrations.schema_migrations WHERE version='{VERSION}'",True)
            require(history==[],'migration_history_exists_reconcile')
            reviewed={n:source_file('supabase/functions/'+n) for n in set(sum(REPLACEMENTS.values(),[]))|{HELPER}}
            candidates={t:build_candidate(t,states[t][3],reviewed) for t in TARGETS}
            require(all(source_map(candidates[t])==m['functions'][t]['after_files'] for t in TARGETS),'candidate_source_mismatch')
            for t in TARGETS:store_recovery(r,m,change,t,states[t],rows)
            order=TARGETS
        else:
            require(all(x[0] in ('before','candidate') for x in states.values()) and dbstate in ('before','candidate'),'rollback_refuses_foreign_or_later_release')
            recovered={t:read_recovery(r,m,change,t) for t in TARGETS}
            candidates={t:recovered[t][0] for t in TARGETS};rows=recovered[PROVIDER][1];order=tuple(reversed(TARGETS))
        # Recheck all source preimages after potentially slow recovery persistence.
        fresh,dbrows=inspect(r,m)
        require({t:x[0] for t,x in fresh.items()}=={t:x[0] for t,x in states.items()} and contract_state(m,dbrows)==dbstate,'source_drift_before_dispatch')
        owner(r,change);lease(r,m,change);event(r,change,'dispatch_started',{'mode':mode,'source_commit':SOURCE,'github_run_id':os.environ.get('GITHUB_RUN_ID')})
        for t in order:
            if mode=='rollback' and states[t][0]=='before':continue
            # Recheck BOTH shared components before each upload. Expected state
            # advances only after source verification; no later release is lost.
            for other in TARGETS:require(inspect_function(r,m,other)[0]==states[other][0],'concurrent_shared_release_no_upload')
            owner(r,change);lease(r,m,change)
            event(r,change,'upload_started',{'mode':mode,'target':t})
            r.upload(t,candidates[t],True)
            observed=inspect_function(r,m,t);expected='restored' if mode=='rollback' else 'candidate'
            require(observed[0]==expected,'upload_outcome_unknown_reconcile_no_retry')
            states[t]=observed;event(r,change,'source_verified',{'mode':mode,'target':t,'version':observed[1]['version']})
        owner(r,change);lease(r,m,change)
        for t in TARGETS:require(inspect_function(r,m,t)[0]==states[t][0],'concurrent_release_before_contracts')
        if mode=='deploy' or dbstate=='candidate':mutate_contracts(r,m,change,rows,mode=='rollback')
        event(r,change,'release_verified',{'mode':mode,'functional_acceptance_passed':False})
        return {'source_verified':True,'mode':mode,'functional_acceptance_passed':False,'configuration_installed':False}
    finally:
        # Never mask an uncertain dispatch with a cleanup exception.
        try:r.sql(f"DELETE FROM public.sandy_engineering_component_leases WHERE holder={quote(r.holder)} AND change_id='{change}' AND component IN ({','.join(quote(t) for t in COMPONENTS)})")
        except Exception:pass

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--candidate-change-id',required=True);p.add_argument('--owner-change-id');p.add_argument('--mode',choices=['inspect','preflight','deploy','reconcile','rollback'],default='inspect');p.add_argument('--evidence-dir',type=Path,required=True);a=p.parse_args()
    try:
        out=a.evidence_dir.resolve();require(not out.is_relative_to(ROOT),'private_evidence_directory_required');out.mkdir(parents=True,exist_ok=True,mode=0o700)
        r=Installer(out);r.holder='hosting-read-'+uuid.uuid4().hex;m=load(r,a.candidate_change_id)
        if a.mode in ('deploy','rollback'):
            require(os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_REF')=='refs/heads/main','protected_main_workflow_required')
            result=execute(r,m,a.owner_change_id,a.mode)
        else:
            if a.mode=='preflight':owner(r,str(uuid.UUID(a.owner_change_id)));ci()
            states,rows=inspect(r,m);result={'functions':{t:{'state':v[0],'version':v[1]['version']} for t,v in states.items()},'contracts':contract_state(m,rows),'mutations':0}
            if a.mode in ('inspect','preflight'):require(all(v[0]=='before' for v in states.values()) and result['contracts']=='before','preflight_baseline_drift')
            if a.mode=='preflight':result['Owner_approval_verified']=True
            if a.mode=='reconcile' and a.owner_change_id:
                change=str(uuid.UUID(a.owner_change_id))
                result['dispatch_events']=r.sql(f"SELECT event_type,occurred_at,detail->>'mode' AS mode,detail->>'target' AS target FROM public.sandy_engineering_change_events WHERE change_id='{change}' AND detail->>'manifest_sha256'='{PIN}' ORDER BY occurred_at",True)
                result['recovery_states']=r.sql(f"SELECT id,target,metadata->>'bundle_transfer_state' AS state FROM public.sandy_engineering_artifacts WHERE change_id='{change}' AND metadata->>'manifest_sha256'='{PIN}'",True)
                result['automatic_retry']=False
        result={'ok':True,'manifest_sha256':PIN,**result};private_write(out,'safe-receipt.json',canonical(result));print(json.dumps(result));return 0
    except Exception as error:
        print(json.dumps({'ok':False,'error':str(error) if isinstance(error,Blocked) else 'release_failed_or_outcome_unknown','automatic_retry':False,'approval_status_written':False}));return 1
if __name__=='__main__':raise SystemExit(main())
