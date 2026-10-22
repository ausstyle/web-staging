#!/usr/bin/env python3
"""Protected administrative installation of one owner-approved Amendment B grant.

Authority comes from a genuine owner audit over exact source, manifest AND the
standing declaration. This is not the engineering workload granting itself access.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import uuid
from release_owner_session_repair import Repair, quote
from release_web_canary import ROOT, Blocked, original_sources, private_write
from release_delegated_runtime import upload
MANIFEST=ROOT/'docs/sandy-engineering/evaluations/p0-amendment-b-source-manifest.json'
DECLARATION=ROOT/'docs/sandy-engineering/evaluations/p0-amendment-b-standing-declaration.json'
digest=lambda b:hashlib.sha256(b).hexdigest()

def candidate():
    raw=MANIFEST.read_bytes();m=json.loads(raw);source=m['source_commit'];pin=digest(raw)
    if len(source)!=40 or any(x not in '0123456789abcdef' for x in source):raise Blocked('invalid_source')
    for section in ['tooling','workflow','frontend']:
        for name,p in m[section].items():
            committed=subprocess.check_output(['git','show',source+':'+name],cwd=ROOT)
            if digest(committed)!=p:raise Blocked('approved_artifact_changed')
            if section in ['tooling','workflow'] and (ROOT/name).read_bytes()!=committed:raise Blocked('release_harness_changed_since_owner_approved_source')
    declaration=DECLARATION.read_text().strip()
    if digest(declaration.encode())!=m['standing_declaration_sha256']:raise Blocked('standing_declaration_changed')
    files={}
    for f in m['functions']:
        files[f['slug']]={name:subprocess.check_output(['git','show',source+':supabase/functions/'+name],cwd=ROOT) for name in f['files']}
        if {p:digest(v) for p,v in files[f['slug']].items()}!=f['files']:raise Blocked('source_module_mismatch')
    migrations={}
    for name,p in m['migrations'].items():
        b=subprocess.check_output(['git','show',source+':'+name],cwd=ROOT)
        if digest(b)!=p:raise Blocked('migration_mismatch')
        migrations[name]=b.decode()
    return m,pin,declaration,files,migrations

class Amendment(Repair):
    def __init__(self,out,change,m,pin,declaration):
        super().__init__(out);self.change=change;self.m=m;self.pin=pin;self.declaration=declaration
    def admission(self,lease=False):
        source=self.m['source_commit'];decl=self.m['standing_declaration_sha256']
        rows=self.sql(f"""SELECT EXISTS(SELECT 1 FROM public.sandy_engineering_changes c
         JOIN public.sandy_engineering_change_events e ON e.change_id=c.id
         JOIN public.sandy_controller_admins a ON a.auth_user_id=e.actor AND a.enabled AND a.role='owner'
         JOIN auth.users u ON u.id=e.actor AND coalesce(u.raw_app_meta_data->>'sandy_engineering_test','false')<>'true'
         WHERE c.id='{self.change}' AND c.status='approved' AND c.risk='high'
         AND c.scope ? 'security:standing-engineering-delegation'
         AND position('{source}' in c.expected_behavior)>0 AND position('{self.pin}' in c.expected_behavior)>0
         AND c.regression_rules @> jsonb_build_array('Standing-policy declaration: '||{quote(self.declaration)})
         AND e.event_type IN ('status_changed','owner_release_attested') AND e.detail->>'to'='approved'
         AND position('{source}' in e.detail->>'reason')>0 AND position('{self.pin}' in e.detail->>'reason')>0
         AND position('standing-policy declaration {decl}' in e.detail->>'reason')>0) AS admitted""")
        if rows!=[{'admitted':True}]:raise Blocked('genuine_owner_approval_of_release_and_declaration_required')
        if lease and self.sql(f"SELECT count(*)::integer AS held FROM public.sandy_engineering_component_leases WHERE holder='{self.holder}' AND change_id='{self.change}' AND expires_at>clock_timestamp()")!=[{'held':len(self.m['functions'])}]:raise Blocked('component_lease_lost')

def inspect(r):
    result={}
    for f in r.m['functions']:
        slug=f['slug'];meta=r.api('GET','/functions/'+slug);body=r.api('GET','/functions/'+slug+'/body');d=json.loads(meta)
        if d.get('version')!=f['expected_prior_version'] or d.get('status')!='ACTIVE' or d.get('verify_jwt') is not False:raise Blocked('prior_version_or_auth_changed')
        if f.get('prior_bundle_sha256') and digest(body)!=f['prior_bundle_sha256']:raise Blocked('prior_bundle_changed')
        if f.get('prior_original_files') and {p:digest(v) for p,v in original_sources(body).items()}!=f['prior_original_files']:raise Blocked('approved_owner_repair_prerequisite_not_deployed')
        result[slug]=(meta,body)
    expected=r.m['prerequisite']['migration_functions']
    names=','.join(quote(name) for name in expected)
    functions=r.sql("SELECT proname,prosrc FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ("+names+")")
    if {f['proname']:digest(f['prosrc'].encode()) for f in functions}!=expected:raise Blocked('approved_owner_repair_schema_prerequisite_not_verified')
    return result

def run(r,files,migrations,deploy):
    r.admission();before=inspect(r)
    if not deploy:return {'ok':True,'preflight_passed':True,'deployed':False,'owner_approval_verified':True}
    if os.environ.get('GITHUB_ACTIONS')!='true':raise Blocked('protected_release_workflow_required')
    for slug,(meta,body) in before.items():private_write(r.evidence,slug+'.before-metadata.json',meta);private_write(r.evidence,slug+'.before.body',body)
    statements=['BEGIN;']
    for f in sorted(r.m['functions'],key=lambda x:x['slug']):
        slug=f['slug'];prior=digest(before[slug][1])
        statements.append(f"""DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at)
        VALUES('{slug}','{r.holder}','{r.change}','{prior}',clock_timestamp()+interval '15 minutes')
        ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp()
        WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$;""")
    r.sql('\n'.join(statements+['COMMIT;']))
    try:
        r.admission(True);inspect(r)
        statements=["BEGIN; SELECT pg_advisory_xact_lock(hashtext('sandy-amendment-b-security-migration'));"]
        for path,sql in migrations.items():
            core=sql.strip()
            if not core.startswith('BEGIN;') or not core.endswith('COMMIT;'):raise Blocked('transactional_migrations_required')
            statements.append(core[len('BEGIN;'):-len('COMMIT;')])
            version=Path(path).name.split('_')[0]
            statements.append(f"INSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key) VALUES('{version}',ARRAY[{quote(sql)}],'{Path(path).stem}','protected_amendment_b_installer','amendment-b-{r.change}-{version}');")
        r.sql('\n'.join(statements+['COMMIT;']))
        versions={}
        for f in r.m['functions']:
            r.admission(True);slug=f['slug']
            current=json.loads(r.api('GET','/functions/'+slug));body=r.api('GET','/functions/'+slug+'/body')
            if current.get('version')!=f['expected_prior_version'] or body!=before[slug][1]:raise Blocked('source_changed_before_dispatch')
            private_write(r.evidence,slug+'.provider-receipt.json',upload(r,{'function':slug},files[slug]))
            current=json.loads(r.api('GET','/functions/'+slug));after=r.api('GET','/functions/'+slug+'/body');private_write(r.evidence,slug+'.after.body',after)
            if current.get('version')!=f['expected_prior_version']+1 or current.get('status')!='ACTIVE' or current.get('verify_jwt') is not False or original_sources(after)!=files[slug]:raise Blocked('unknown_outcome_do_not_retry_deployment')
            versions[slug]=current['version']
        # Separate legitimate administrative provisioning applies only the frozen
        # declaration already signed by the real owner. It cannot write approval.
        workflow=r.m['workflow']['.github/workflows/sandy-runtime-release-checks.yml']
        grant=r.sql(f"SELECT public.sandy_engineering_install_approved_policy('{r.change}','{r.m['source_commit']}','{r.pin}',{quote(r.declaration)},'{workflow}') AS result")
        if len(grant)!=1 or grant[0].get('result',{}).get('ok') is not True:raise Blocked('standing_policy_installation_not_verified')
        result={'change_id':r.change,'source_commit':r.m['source_commit'],'manifest_sha256':r.pin,'versions':versions,'all_original_modules_verified':True,'standing_policy_activated':True,'grant_revision':grant[0]['result']['grant_revision'],'grant_expires_at':grant[0]['result']['expires_at'],'approval_event_created_by_installer':False,'owner_impersonation':False,'workload_self_authorized':False,'two_unattended_production_cycles_verified':False,'customer_channels_changed':False}
        r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{r.change}','amendment_b_source_and_policy_verified',NULL,{quote(json.dumps(result))}::jsonb)")
        private_write(r.evidence,'redacted-receipt.json',json.dumps(result,indent=2).encode());return result
    finally:r.sql(f"DELETE FROM public.sandy_engineering_component_leases WHERE holder='{r.holder}' AND change_id='{r.change}'")

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--change-id',required=True);p.add_argument('--deploy',action='store_true');p.add_argument('--evidence-dir',type=Path);args=p.parse_args()
    try:
        change=str(uuid.UUID(args.change_id));m,pin,d,files,sql=candidate();out=(args.evidence_dir or Path('/tmp')/('amendment-b-'+uuid.uuid4().hex)).resolve()
        if out.is_relative_to(ROOT):raise Blocked('private_evidence_outside_repository_required')
        if args.deploy:out.mkdir(mode=0o700)
        print(json.dumps(run(Amendment(out,change,m,pin,d),files,sql,args.deploy)));return 0
    except (Blocked,OSError,ValueError,KeyError,subprocess.CalledProcessError):
        print(json.dumps({'ok':False,'error':'amendment_b_blocked_or_unknown_outcome','automatic_retry':False,'owner_approval_written':False}));return 1
if __name__=='__main__':raise SystemExit(main())
