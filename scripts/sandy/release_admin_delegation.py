#!/usr/bin/env python3
"""Forward, source-preserving delegation release. Never replays the installed
Owner migration, establishes a grant, deploys Cloud Run or changes IAM/traffic.
"""
import argparse, json, os, re, uuid
from pathlib import Path
from release_gcp_admin_read import Installer, ROOT, WORKER, original_sources, digest, Blocked, private_write, replace_once

MANIFEST=ROOT/'docs/sandy-engineering/evaluations/admin-delegation-release.json'
MIGRATION='supabase/migrations/20261023170000_sandy_owner_admin_read_delegation.sql'
CONTROL='sandy-engineering-control';GATEWAY='sandy-operation-api'
ADMIN_RESOLVE='''const adminRead=deps.executionScope&&(body.action==="list"||operation==="engineering.preflight")?await rpc(deps.db,"sandy_engineering_resolve_admin_read",{p_actor:user.id,p_session:jwt.session_id,p_epoch:metadata.sandy_engineering_epoch}):null;const adminReadAuthorized=adminRead?.ok===true&&adminRead.identity_user_id===user.id&&adminRead.session_id===jwt.session_id&&adminRead.owner_authority_id===resolved.owner_authority_id&&Number.isSafeInteger(adminRead.revision)&&Number(adminRead.revision)>0&&typeof adminRead.expires_at==="string"&&Date.parse(adminRead.expires_at)>Date.now();'''
ADMIN_EXECUTE='''if(operation==="engineering.preflight"){if(!adminReadAuthorized)return deny(403,"administrator_read_delegation_required");if(!entry||!deps.contractMatches(entry)||entry.api_exposed!==true||entry.ai_exposed!==true||entry.is_mutation!==false||!object(args)||Object.keys(args).length!==1||args.connection!=="sandy-gcp-admin"||!deps.argumentsValid(entry.input_schema,args))return deny(400,"invalid_administrator_read_request");if(request.headers.has("x-sandy-declared-units")&&request.headers.get("x-sandy-declared-units")!=="0")return deny(403,"engineering_cost_scope_denied");headers.delete("x-sandy-approval-id");}else '''
CONTROL_ROUTE='''   if(action==="gcp_admin_read_claim"||(action==="preflight"&&b.connection!==undefined)){
    try{return await handleGcpAdminRead(db,user,{role:"engineering"},token,b,Deno.env.get("SANDY_GCP_ADMIN_WORKER_URL"))}
    catch{return respond({ok:false,error:"administrator_read_state_unavailable",executed:null,reconciliation_required:true},503)}
   }
'''

def patch(slug,files):
    result=dict(files)
    if slug==CONTROL:
        name=slug+'/index.ts'
        if CONTROL_ROUTE in result[name].decode():raise Blocked('delegated_route_already_installed')
        needle='  if(user.app_metadata?.sandy_engineering_test===true){\n'
        result[name]=replace_once(result[name].decode(),needle,needle+CONTROL_ROUTE).encode()
        result[slug+'/gcp_admin_read.ts']=(ROOT/'supabase/functions'/slug/'gcp_admin_read.ts').read_bytes()
    elif slug==GATEWAY:
        name=slug+'/index.ts'
        result[name]=replace_once(result[name].decode(),'if(administratorRead&&admin?.role!=="owner")',
          'if(administratorRead&&(engineeringProofFor(delegation)?engineeringProofFor(delegation)?.administratorRead!==true:admin?.role!=="owner"))').encode()
        name=slug+'/engineering_identity.ts';s=result[name].decode()
        s=replace_once(s,'const allowedOperations=[',ADMIN_RESOLVE+'const allowedOperations=[')
        s=replace_once(s,'...standingAuthorized?standing.operations:[]])];','...standingAuthorized?standing.operations:[],...adminReadAuthorized?["engineering.preflight"]:[]])];')
        s=replace_once(s,'if(standingExecution&&(operation===',ADMIN_EXECUTE+'if(standingExecution&&(operation===')
        s=replace_once(s,'policySha256:String(resolved.policy_sha256),','policySha256:String(resolved.policy_sha256),...adminReadAuthorized?{administratorRead:true}:{},')
        result[name]=s.encode()
    else:raise Blocked('release_target_denied')
    return result

def load():
    m=json.loads(MANIFEST.read_text())
    if set(m['functions'])!={CONTROL,GATEWAY}:raise Blocked('release_targets_changed')
    for path,expected in m['reviewed_files'].items():
        if digest((ROOT/path).read_bytes())!=expected:raise Blocked('reviewed_source_changed')
    return m

def inspect(r,m,installed=False):
    bodies={};candidates={};versions={}
    for slug,expected in m['functions'].items():
        meta=json.loads(r.api('GET','/functions/'+slug));body=r.api('GET','/functions/'+slug+'/body');files=original_sources(body)
        want=expected['candidate_files'] if installed else expected['before_files']
        if meta.get('verify_jwt')!=expected['verify_jwt'] or meta.get('status')!='ACTIVE' or {p:digest(v) for p,v in files.items()}!=want:
            raise Blocked('installed_source_drift' if installed else 'prior_source_drift')
        if installed:
            if meta['version']<=expected['version']:raise Blocked('installed_version_not_advanced')
        elif meta['version']!=expected['version'] or digest(body)!=expected['body_sha256']:raise Blocked('prior_version_or_bundle_drift')
        bodies[slug]=(meta,body);versions[slug]=meta['version']
        if not installed:
            candidates[slug]=patch(slug,files)
            if {p:digest(v) for p,v in candidates[slug].items()}!=expected['candidate_files']:raise Blocked('candidate_source_mismatch')
    history=r.sql("SELECT statements FROM supabase_migrations.schema_migrations WHERE version='20261023170000'",True)
    if installed:
        if len(history)!=1 or history[0].get('statements')!=[(ROOT/MIGRATION).read_text()]:raise Blocked('forward_migration_history_mismatch')
        permissions=r.sql("SELECT has_function_privilege('service_role','public.sandy_engineering_set_admin_read_delegation(boolean,timestamptz,integer)','EXECUTE') service_can_grant,has_column_privilege('service_role','public.sandy_engineering_control_grants','admin_read_policy','UPDATE') service_can_expand,has_function_privilege('authenticated','public.sandy_engineering_set_admin_read_delegation(boolean,timestamptz,integer)','EXECUTE') owner_RPC_reachable,EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sandy_engineering_owner_delegation_audit_guard' AND tgenabled='O') owner_audit_guard_installed",True)
        if permissions!=[{'service_can_grant':False,'service_can_expand':False,'owner_rpc_reachable':True,'owner_audit_guard_installed':True}]:raise Blocked('delegation_privilege_readback_failed')
        expected=dict(re.findall(r'CREATE FUNCTION public\.(\w+)\([^$]*?AS \$\$(.*?)\$\$;', (ROOT/MIGRATION).read_text(),re.S))
        names=','.join("'"+name+"'" for name in expected)
        observed=r.sql("SELECT proname,prosrc,prosecdef,proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN ("+names+")",True)
        if len(observed)!=len(expected) or any(x['prosrc']!=expected[x['proname']] or x['prosecdef'] is not True or x['proconfig']!=['search_path=pg_catalog, pg_temp'] for x in observed):raise Blocked('delegation_RPC_source_or_search_path_drift')
    elif history:raise Blocked('already_installed_reconcile_no_replay')
    secrets=json.loads(r.api('GET','/secrets'))
    if not any(x.get('name')=='SANDY_GCP_ADMIN_WORKER_URL' and x.get('value')==digest(WORKER.encode()) for x in secrets):raise Blocked('existing_worker_binding_changed')
    return bodies,candidates,versions

def run(r,m,deploy=False,installed=False):
    before,files,versions=inspect(r,m,installed)
    if installed:return {'installed_source_verified':True,'functions':versions,'forward_migration_history_verified':True,'Owner_only_grant_and_audit_privileges_verified':True,'mutations':0}
    if not deploy:return {'source_preservation_preflight_passed':True,'prior_versions':versions,'mutations':0}
    if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main':raise Blocked('protected_main_release_required')
    source=os.environ.get('GITHUB_SHA','')
    if len(source)!=40 or any(c not in '0123456789abcdef' for c in source):raise Blocked('source_commit_required')
    r.out.mkdir(mode=0o700,parents=True,exist_ok=False)
    for slug,(meta,body) in before.items():
        private_write(r.out,slug+'.before.body',body);private_write(r.out,slug+'.before.json',json.dumps(meta).encode())
    private_write(r.out,'source-manifest.json',MANIFEST.read_bytes())
    change=r.sql("INSERT INTO public.sandy_engineering_changes(title,problem,expected_behavior,change_purpose,feature_improvement,scope,regression_rules,acceptance_criteria,risk,requested_by,idempotency_key,status) SELECT 'Owner-only renewable administrator-read delegation','Owner password custody is prohibited','Source "+source+"; bounded separate workload identity; no grant established by release','SANDY-ENG-0001/0005','Genuine Owner policy establishment and renewable delegated execution','[\"sandy-engineering-control\",\"sandy-operation-api\"]'::jsonb,'[\"preserve canary v6 and original Owner path\"]'::jsonb,'[\"Owner RPC and workload execution independently verified\"]'::jsonb,'high',i.user_id,'admin-delegation-source-'+gen_random_uuid()::text,'proposed' FROM public.sandy_engineering_test_identities i JOIN auth.users u ON u.id=i.user_id WHERE u.email='sandy-engineering-test@sandy-ai.internal' RETURNING id")
    if len(change)!=1:raise Blocked('release_tracking_unavailable')
    cid=str(uuid.UUID(change[0]['id']));holder='admin-delegation-'+uuid.uuid4().hex
    lease=['BEGIN;']
    for slug,(_,body) in before.items():
        lease.append(f"DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at) VALUES('{slug}','{holder}','{cid}','{digest(body)}',clock_timestamp()+interval '15 minutes') ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp() WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$;")
    r.sql('\n'.join(lease+['COMMIT;']))
    try:
        inspect(r,m)
        r.stage='forward_migration'
        sql=(ROOT/MIGRATION).read_text();core=sql[sql.index('BEGIN;')+6:].strip()
        if not core.endswith('COMMIT;'):raise Blocked('transactional_migration_required')
        literal="'"+sql.replace("'","''")+"'"
        r.sql("BEGIN; SELECT pg_advisory_xact_lock(hashtext('sandy-gcp-admin-read-install'));\n"+core[:-7]+f"\nINSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key) VALUES('20261023170000',ARRAY[{literal}],'sandy_owner_admin_read_delegation','protected_github_management_release','sandy-owner-admin-read-delegation-v1');COMMIT;")
        for slug in [CONTROL,GATEWAY]:
            r.stage='source_'+slug;r.upload(slug,files[slug],m['functions'][slug]['verify_jwt'])
        result=run(r,m,installed=True)
        r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{cid}','admin_delegation_release_installed',NULL,jsonb_build_object('source_commit','{source}','grant_established',false,'IAM_changes',0,'Cloud_Run_changes',0))")
        return {**result,'release_installed':True,'source_commit':source,'tracking_change_id':cid,'grant_established':False,'mutations':'new forward migration and two source-preserving Edge updates','IAM_changes':0,'Cloud_Run_changes':0}
    finally:r.sql(f"DELETE FROM public.sandy_engineering_component_leases WHERE holder='{holder}'")

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);g=p.add_mutually_exclusive_group();g.add_argument('--deploy',action='store_true');g.add_argument('--verify-installed',action='store_true');p.add_argument('--evidence-dir',required=True);args=p.parse_args()
    root=Path(args.evidence_dir);r=Installer(root/'source-preservation');report={'passed':False,'grant_established':False,'IAM_changes':0,'Cloud_Run_changes':0}
    try:report.update(run(r,load(),args.deploy,args.verify_installed),passed=True)
    except Exception as e:report.update(error=str(e) if isinstance(e,Blocked) else 'release_failed_or_unknown_reconcile_before_retry',stage=r.stage,last_management_request=r.last_request)
    root.mkdir(parents=True,exist_ok=True);private_write(root,'delegation-release.json',(json.dumps(report,indent=2)+'\n').encode());print('::notice title=Owner delegation source release::'+json.dumps(report))
    raise SystemExit(0 if report['passed'] else 1)
