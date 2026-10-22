#!/usr/bin/env python3
"""Protected, source-preserving installation of the existing administrator read path.
No IAM/grant edits, Owner impersonation, Cloud Run deployment or promotion.
"""
import argparse, hashlib, json, os, subprocess, urllib.request, urllib.error, uuid
from pathlib import Path
from release_web_canary import Blocked, ROOT, NoRedirect, original_sources, private_write

MANIFEST=ROOT/'docs/sandy-engineering/evaluations/gcp-admin-read-release.json'
PROJECT='zmqlyygzqoidkcwdysok'
BASE=f'https://api.supabase.com/v1/projects/{PROJECT}'
WORKER='https://sandy-api-review---sandy-engineering-mcp-4pqn6jsfxq-ew.a.run.app'
HELPER='sandy-engineering-control/gcp_admin_read.ts'
MIGRATION='supabase/migrations/20261022201500_sandy_gcp_admin_read_admission.sql'
CONTRACT_MIGRATION='supabase/migrations/20261023001000_sandy_gcp_admin_read_contract.sql'
CONTROL='sandy-engineering-control'; GATEWAY='sandy-operation-api'
OLD_GATEWAY='const args=body.arguments;if(args!==void 0&&(!isObject(args)||Object.keys(args).length!==0)){return reply(400,{error:"operation_accepts_no_arguments",executed:false})}let response;'
NEW_GATEWAY='const args=body.arguments;const administratorRead=operation==="engineering.preflight"&&isObject(args)&&Object.keys(args).length===1&&args.connection==="sandy-gcp-admin";if(args!==void 0&&(!isObject(args)||Object.keys(args).length!==0)&&!administratorRead){return reply(400,{error:"operation_accepts_no_arguments",executed:false})}if(administratorRead&&admin?.role!=="owner"){return reply(403,{error:"administrator_read_owner_authority_required",executed:false})}let response;'
OLD_BODY='body:JSON.stringify({action:handler.action}),signal:AbortSignal.timeout(2e4)'
NEW_BODY='body:JSON.stringify({action:handler.action,...(administratorRead?{connection:"sandy-gcp-admin"}:{})}),signal:AbortSignal.timeout(administratorRead?95000:20000)'
CONTROL_ROUTE='''  if(action==="gcp_admin_read_claim"||(action==="preflight"&&b.connection!==undefined)){
   try{return await handleGcpAdminRead(db,user,admin,token,b,Deno.env.get("SANDY_GCP_ADMIN_WORKER_URL"))}
   catch{return respond({ok:false,error:"administrator_read_state_unavailable",executed:null,reconciliation_required:true},503)}
  }
'''
def digest(b): return hashlib.sha256(b).hexdigest()
def quote(s): return "'"+s.replace("'","''")+"'"
def replace_once(s,old,new):
    if s.count(old)!=1: raise Blocked('source_patch_anchor_changed')
    return s.replace(old,new,1)
def patch(slug,files,helper):
    result=dict(files);name=slug+'/index.ts';s=result[name].decode()
    if slug==CONTROL:
        if HELPER in result: raise Blocked('administrator_module_already_installed')
        s='import {handleGcpAdminRead} from "./gcp_admin_read.ts";\n'+s
        s=replace_once(s,'  if(action==="preflight"){',CONTROL_ROUTE+'  if(action==="preflight"){')
        result[HELPER]=helper
    elif slug==GATEWAY:
        s=replace_once(s,OLD_GATEWAY,NEW_GATEWAY);s=replace_once(s,OLD_BODY,NEW_BODY)
    else: raise Blocked('release_target_denied')
    result[name]=s.encode();return result

def load():
    m=json.loads(MANIFEST.read_bytes())
    if set(m['functions'])!={CONTROL,GATEWAY} or m['worker_url']!=WORKER: raise Blocked('bounded_release_manifest_required')
    if m['reviewed_source_commit']!='0065e44ddc56b83561a458d6e60f162819b013d7':raise Blocked('reviewed_source_pin_changed')
    helper=(ROOT/'supabase/functions'/HELPER).read_bytes()
    migration=(ROOT/MIGRATION).read_bytes()
    if digest(helper)!=m['helper_sha256'] or digest(migration)!=m['migration_sha256']: raise Blocked('reviewed_source_changed')
    contract=(ROOT/CONTRACT_MIGRATION).read_bytes()
    if digest(contract)!=m['contract_migration_sha256']:raise Blocked('contract_migration_changed')
    return m,helper,migration,contract

class Installer:
    def __init__(self,out):
        self.out=out;self.holder='gcp-admin-read-'+uuid.uuid4().hex
        self.opener=urllib.request.build_opener(NoRedirect())
    def api(self,method,path,data=None,mime='application/json'):
        request=urllib.request.Request(BASE+path,method=method,data=data,headers={'authorization':'Bearer '+os.environ['SANDY_SUPABASE_MANAGEMENT_TOKEN'],'content-type':mime})
        try:
            with self.opener.open(request,timeout=90) as r:
                raw=r.read(32*1024*1024+1)
                if len(raw)>32*1024*1024:raise Blocked('management_response_size_limit')
                return raw
        except urllib.error.HTTPError as e:
            raise Blocked("management_http_"+str(e.code)+"_no_automatic_retry") from None
        except Exception as e:
            if isinstance(e,Blocked):raise
            raise Blocked('management_request_failed_or_unknown_outcome_no_retry') from None
    def sql(self,query,read_only=False):
        return json.loads(self.api('POST','/database/query',json.dumps({'query':query,'read_only':read_only}).encode()))
    def read(self,slug,expected):
        meta=json.loads(self.api('GET','/functions/'+slug));body=self.api('GET','/functions/'+slug+'/body')
        if meta.get('version')!=expected['version'] or meta.get('verify_jwt')!=expected['verify_jwt'] or meta.get('status')!='ACTIVE' or digest(body)!=expected['body_sha256']:
            raise Blocked('live_source_or_version_changed')
        files=original_sources(body)
        if {n:digest(v) for n,v in files.items()}!=expected['before_files']:raise Blocked('original_modules_changed')
        return meta,body,files
    def upload(self,slug,files,verify):
        boundary='sandy-admin-read-'+uuid.uuid4().hex
        meta={'name':slug,'entrypoint_path':slug+'/index.ts','verify_jwt':verify}
        parts=[f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n'.encode()+json.dumps(meta).encode()+b'\r\n']
        for name,value in sorted(files.items()):parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: application/typescript\r\n\r\n'.encode()+value+b'\r\n')
        parts.append(f'--{boundary}--\r\n'.encode())
        return self.api('POST','/functions/deploy?slug='+slug,b''.join(parts),'multipart/form-data; boundary='+boundary)

def inspect(r,m,helper):
    before={};candidates={}
    for slug,expected in m['functions'].items():
        before[slug]=r.read(slug,expected)
        candidates[slug]=patch(slug,before[slug][2],helper)
        if {n:digest(v) for n,v in candidates[slug].items()}!=expected['candidate_files']:raise Blocked('candidate_digest_changed')
    installed=r.sql("SELECT proname FROM pg_proc JOIN pg_namespace n ON n.oid=pronamespace WHERE n.nspname='public' AND proname LIKE 'sandy_gcp_admin_read_%'",True)
    history=r.sql("SELECT version FROM supabase_migrations.schema_migrations WHERE version IN ('20261022201500','20261023001000')",True)
    if installed or history:raise Blocked('migration_already_present_reconcile_no_retry')
    secrets=json.loads(r.api('GET','/secrets'))
    if any(row.get('name')=='SANDY_GCP_ADMIN_WORKER_URL' for row in secrets):raise Blocked('existing_worker_binding_requires_source_reconciliation')
    return before,candidates

def run(r,m,helper,migration,contract,deploy=False):
    before,files=inspect(r,m,helper)
    if not deploy:return {'source_preservation_preflight_passed':True,'original_modules':{s:len(v[2]) for s,v in before.items()},'deployed':False}
    if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main':raise Blocked('protected_main_GitHub_release_required')
    source=os.environ.get('GITHUB_SHA','')
    if len(source)!=40 or any(c not in '0123456789abcdef' for c in source):raise Blocked('source_commit_required')
    r.out.mkdir(mode=0o700,parents=True,exist_ok=False)
    private_write(r.out,'release-manifest.json',MANIFEST.read_bytes())
    for slug,(meta,body,_) in before.items():
        private_write(r.out,slug+'.before.body',body);private_write(r.out,slug+'.before.json',json.dumps(meta).encode())
    # A proposed tracking record is not an Owner approval or a standing grant.
    # Authorization is the explicit task + protected GitHub deployment review.
    rows=r.sql("""INSERT INTO public.sandy_engineering_changes(title,problem,expected_behavior,change_purpose,feature_improvement,scope,regression_rules,acceptance_criteria,risk,requested_by,idempotency_key,status)
    SELECT 'Install existing protected GCP administrator read path','Existing candidate is accepted but protected API admission is not installed',%s,'SANDY-ENG-0001/0005 source-preserving authorized release','Enable fixed read-only administrator preflight without IAM changes',
    '["sandy-operation-api","sandy-engineering-control"]'::jsonb,'["Preserve all existing modules, Auth checks and grants"]'::jsonb,'["Independent token issuance and fixed IAP policy reads; no promotion before acceptance"]'::jsonb,'high',i.user_id,'gcp-admin-read-release-20261023-v1','proposed'
    FROM public.sandy_engineering_test_identities i JOIN auth.users u ON u.id=i.user_id WHERE u.email='sandy-engineering-test@sandy-ai.internal' AND i.enabled AND i.revoked_at IS NULL
    ON CONFLICT(requested_by,idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET updated_at=public.sandy_engineering_changes.updated_at RETURNING id;""" % quote('Protected release source '+source+' manifest '+digest(MANIFEST.read_bytes())))
    if len(rows)!=1:raise Blocked('tracking_record_unavailable')
    change=str(uuid.UUID(rows[0]['id']))
    statements=['BEGIN;']
    for slug,(_,body,_) in sorted(before.items()):
        statements.append(f"""DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at)
        VALUES('{slug}','{r.holder}','{change}','{digest(body)}',clock_timestamp()+interval '15 minutes')
        ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp()
        WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$;""")
    r.sql('\n'.join(statements+['COMMIT;']))
    try:
        r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{change}','protected_admin_read_install_started',NULL,{quote(json.dumps({'source_commit':source,'manifest_sha256':digest(MANIFEST.read_bytes()),'github_run_id':os.environ.get('GITHUB_RUN_ID'),'authorization_basis':'explicit_owner_task_and_protected_GitHub_deployment_review','Owner_impersonation':False,'standing_grant_changes':0}))}::jsonb)")
        inspect(r,m,helper)
        statements=["BEGIN; SELECT pg_advisory_xact_lock(hashtext('sandy-gcp-admin-read-install')); "]
        for version,name,sql in [('20261022201500','sandy_gcp_admin_read_admission',migration),('20261023001000','sandy_gcp_admin_read_contract',contract)]:
            core=sql.decode().strip();core=core[core.index('BEGIN;')+len('BEGIN;'):]
            if not core.endswith('COMMIT;'):raise Blocked('transactional_migration_required')
            statements.append(core[:-len('COMMIT;')])
            statements.append(f"INSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key) VALUES('{version}',ARRAY[{quote(sql.decode())}],'{name}','protected_github_management_release','sandy-gcp-admin-read-{version}');")
        r.sql('\n'.join(statements+['COMMIT;']))
        # Additive RPCs remain inert without the authenticated Owner route.
        for slug in [CONTROL,GATEWAY]:
            r.read(slug,m['functions'][slug])
            held=r.sql(f"SELECT count(*)::integer AS held FROM public.sandy_engineering_component_leases WHERE holder='{r.holder}' AND change_id='{change}' AND expires_at>clock_timestamp()",True)
            if held!=[{'held':2}]:raise Blocked('source_lease_lost')
            private_write(r.out,slug+'.provider-receipt.json',r.upload(slug,files[slug],m['functions'][slug]['verify_jwt']))
            meta=json.loads(r.api('GET','/functions/'+slug));body=r.api('GET','/functions/'+slug+'/body')
            private_write(r.out,slug+'.after.json',json.dumps(meta).encode());private_write(r.out,slug+'.after.body',body)
            if meta.get('version')!=m['functions'][slug]['version']+1 or meta.get('verify_jwt')!=m['functions'][slug]['verify_jwt'] or meta.get('status')!='ACTIVE' or original_sources(body)!=files[slug]:raise Blocked('deployment_unknown_outcome_reconcile_no_retry')
        # Recheck absence immediately before the one configuration write.
        if any(x.get('name')=='SANDY_GCP_ADMIN_WORKER_URL' for x in json.loads(r.api('GET','/secrets'))):raise Blocked('worker_binding_changed_before_dispatch')
        r.api('POST','/secrets',json.dumps([{'name':'SANDY_GCP_ADMIN_WORKER_URL','value':WORKER}]).encode())
        rows=json.loads(r.api('GET','/secrets'))
        if not any(x.get('name')=='SANDY_GCP_ADMIN_WORKER_URL' and x.get('value')==digest(WORKER.encode()) for x in rows):raise Blocked('worker_binding_readback_unverified_no_retry')
        result={'deployed':True,'source_commit':source,'manifest_sha256':digest(MANIFEST.read_bytes()),'change_id':change,
          'functions':{s:m['functions'][s]['version']+1 for s in [CONTROL,GATEWAY]},'all_original_modules_preserved_except_reviewed_entrypoint_patches':True,
          'migrations':['20261022201500','20261023001000'],'worker_url':WORKER,'rollback_artifacts_captured':True,'functional_admin_acceptance_verified':False,
          'IAM_changes':0,'standing_grant_changes':0,'agents_enrolled':0,'production_traffic_changes':0,'approval_status_written':False}
        r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{change}','protected_admin_read_source_installed',NULL,{quote(json.dumps(result))}::jsonb)")
        private_write(r.out,'redacted-receipt.json',json.dumps(result,indent=2).encode());return result
    finally:r.sql(f"DELETE FROM public.sandy_engineering_component_leases WHERE holder='{r.holder}' AND change_id='{change}'")

def verify_fixture(r):
    policy=json.loads((ROOT/'supabase/functions/sandy-operation-api/engineering_identity_policy.json').read_text())
    slug=policy['function_slug'];meta=json.loads(r.api('GET','/functions/'+slug))
    files=original_sources(r.api('GET','/functions/'+slug+'/body'))
    if meta.get('verify_jwt') is not True or meta.get('status')!='ACTIVE' or len(files)!=1 or digest(next(iter(files.values()))) not in policy['function_source_sha256']:
        raise Blocked('approved_log_fixture_source_required')
    return {'approved_fixture_source_verified':True,'function':slug,'version':meta['version']}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--deploy',action='store_true');parser.add_argument('--evidence-dir',type=Path,required=True);a=parser.parse_args()
    try:
        m,h,sql,contract=load();print(json.dumps(run(Installer(a.evidence_dir),m,h,sql,contract,a.deploy)));return 0
    except Exception as error:
        print(json.dumps({'ok':False,'error':str(error) if isinstance(error,Blocked) else 'admin_read_install_blocked_or_unknown_outcome','automatic_retry':False,'functional_admin_acceptance_verified':False}));return 1
if __name__=='__main__':raise SystemExit(main())
