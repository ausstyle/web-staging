#!/usr/bin/env python3
"""Read-only release prerequisite verification. Does not install or grant."""
import argparse,json,re
from pathlib import Path
from release_gcp_admin_read import Installer,digest,quote
from release_web_canary import ROOT,Blocked,original_sources,private_write
from prepare_iap_repair_transport import MIGRATION
VERSION='20261024006000'
MODULES={
 'sandy-engineering-control':['sandy-engineering-control/iap_repair.ts','sandy-engineering-control/iap_repair_jobs.ts','_shared/sandy_iap_repair_contract.ts'],
 'sandy-operation-api':['sandy-operation-api/iap_repair_authorization.ts','_shared/sandy_iap_repair_contract.ts'],
}
def verify(r):
 sql=(ROOT/MIGRATION).read_text()
 if r.sql("SELECT statements FROM supabase_migrations.schema_migrations WHERE version='"+VERSION+"'",True)!=[{'statements':[sql]}]:raise Blocked('reviewed_iap_transport_migration_required')
 expected={name:digest(body.encode()) for name,body in re.findall(r'CREATE FUNCTION public\.(\w+)\([^$]*?AS \$\$(.*?)\$\$;',sql,re.S)}
 if len(expected)!=9:raise Blocked('reviewed_iap_rpc_inventory_required')
 actual=r.sql("SELECT proname,encode(extensions.digest(prosrc,'sha256'),'hex') sha256,prosecdef,proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN("+','.join(quote(n) for n in expected)+")",True)
 if len(actual)!=9 or any(x['sha256']!=expected[x['proname']] or not x['prosecdef'] or x['proconfig']!=['search_path=pg_catalog, pg_temp'] for x in actual):raise Blocked('iap_rpc_source_or_search_path_mismatch')
 signatures=['sandy_iap_repair_prepare_job(uuid,uuid,integer,uuid,text,uuid,text,text,text)','sandy_iap_repair_job_admit(uuid,uuid,integer,uuid,text,text)','sandy_iap_repair_claim(uuid,uuid,integer,uuid,uuid,uuid,text,text)','sandy_iap_repair_write_started(uuid,uuid,integer,uuid,uuid,uuid,integer,text,text,text,text,text)','sandy_iap_repair_finish(uuid,uuid,integer,uuid,uuid,uuid,jsonb)']
 for sig in signatures:
  if r.sql("SELECT has_function_privilege('authenticated',"+quote('public.'+sig)+",'EXECUTE') client,has_function_privilege('anon',"+quote('public.'+sig)+",'EXECUTE') anonymous,has_function_privilege('service_role',"+quote('public.'+sig)+",'EXECUTE') transport",True)!=[{'client':False,'anonymous':False,'transport':True}]:raise Blocked('protected_transport_privileges_required')
 private=['sandy_iap_repair_admit(uuid,uuid,integer,text,uuid,text,text)','sandy_iap_repair_context(uuid,uuid,integer,uuid,uuid,uuid,boolean)','sandy_engineering_set_iap_repair_delegation(boolean,timestamptz,integer,uuid)']
 for sig in private:
  if r.sql("SELECT has_function_privilege('service_role',"+quote('public.'+sig)+",'EXECUTE') enabled",True)!=[{'enabled':False}]:raise Blocked('transport_must_not_expand_or_bypass_authority')
 functions={}
 for slug,modules in MODULES.items():
  meta=json.loads(r.api('GET','/functions/'+slug));files=original_sources(r.api('GET','/functions/'+slug+'/body'))
  if meta.get('status')!='ACTIVE' or meta.get('verify_jwt') is not (slug=='sandy-operation-api'):raise Blocked('preserved_jwt_ingress_required')
  if any(files.get(p)!=(ROOT/'supabase/functions'/p).read_bytes() for p in modules):raise Blocked('installed_repair_module_source_mismatch')
  if slug=='sandy-engineering-control' and not all(needle in files[slug+'/index.ts'].decode() for needle in ['handleIapRepairCallback(db,user,token,b,','handleIapRepairJob(db,user,token,b,']):raise Blocked('protected_control_routes_required')
  if slug=='sandy-operation-api' and not all(needle in files[slug+'/engineering_identity.ts'].decode() for needle in ['const repairAuthorized=await resolveIapRepairScope','authorizeIapRepairExecution(deps,user,jwt']):raise Blocked('protected_api_job_route_required')
  functions[slug]={'version':meta['version'],'verify_jwt':meta['verify_jwt'],'module_sha256':{p:digest(files[p]) for p in modules}}
 rows=r.sql("SELECT g.iap_repair_revision,g.iap_repair_policy IS NULL no_iap_grant,g.admin_read_revision,(SELECT version FROM public.sandy_engineering_standing_delegations d WHERE d.identity_user_id=g.identity_user_id) canary_revision FROM public.sandy_engineering_control_grants g JOIN auth.users u ON u.id=g.identity_user_id WHERE u.email='sandy-engineering-test@sandy-ai.internal'",True)
 if rows!=[{'iap_repair_revision':0,'no_iap_grant':True,'admin_read_revision':1,'canary_revision':6}]:raise Blocked('closed_acceptance_requires_unchanged_independent_grant_zero')
 return {'passed':True,'installed_rpc_source_and_acl_verified':True,'functions':functions,'grant':rows[0],'IAM_changes':0,'grants_changed':False,'source_only_control_assumptions':False}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output',required=True);a=p.parse_args();path=Path(a.output);path.parent.mkdir(parents=True,exist_ok=True)
 try:report=verify(Installer(path.parent))
 except Blocked as e:report={'passed':False,'error':str(e),'IAM_changes':0,'grants_changed':False}
 except Exception:report={'passed':False,'error':'transport_installation_verification_unavailable','IAM_changes':0,'grants_changed':False}
 private_write(path.parent,path.name,json.dumps(report,indent=2).encode());print('::notice title=Protected IAP transport prerequisite::'+json.dumps(report));raise SystemExit(0 if report['passed'] else 1)
