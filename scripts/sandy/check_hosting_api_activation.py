#!/usr/bin/env python3
"""Read-only preparation of the approved two-operation gateway activation."""
import hashlib,json
from pathlib import Path
from release_gcp_admin_read import Installer
from release_web_canary import ROOT,Blocked,original_sources
MANIFEST=ROOT/'docs/sandy-engineering/evaluations/hosting-api-activation.json'
PIN='15deff0689ac924db407585c836ea102ba17fd0fe21cccc250a5d4d64f1793a0'
PATHS={'sandy-customer-provisioning-api/gateway.ts','sandy-customer-provisioning-api/hosting_accounts.json'}
OPS={'hosting.accounts.create','hosting.accounts.get'}
def sha(b):return hashlib.sha256(b).hexdigest()
def require(ok,message):
 if not ok:raise Blocked(message)
def load():
 raw=MANIFEST.read_bytes();require(sha(raw)==PIN,'activation_manifest_changed');return json.loads(raw)
def patch(m,before,read):
 require({p:sha(b) for p,b in before.items()}==m['gateway']['files'],'gateway_modules_drift')
 require(set(m['replacement_files'])==PATHS,'replacement_scope_changed')
 after=dict(before)
 for p in PATHS:
  b=read(p);require(sha(b)==m['handler']['files'][p],'handler_contract_source_changed');after[p]=b
 require({p:sha(b) for p,b in after.items()}==m['after_files'],'candidate_modules_changed')
 require(set(after)-set(before)=={'sandy-customer-provisioning-api/hosting_accounts.json'},'unexpected_new_module')
 return after
COLS='operation,handler,permission_scope,is_mutation,input_schema,output_schema,error_contract,api_exposed,ai_exposed,ui_exposed,verified'
def registry(r):return r.sql("SELECT "+COLS+" FROM public.sandy_operation_registry WHERE operation IN ('hosting.accounts.create','hosting.accounts.get') ORDER BY operation",True)
def inspect(r,m):
 allfiles={}
 for kind,name in [('gateway','sandy-operation-api'),('handler','sandy-customer-provisioning-api')]:
  a=json.loads(r.api('GET','/functions/'+name));b=r.api('GET','/functions/'+name+'/body');z=json.loads(r.api('GET','/functions/'+name))
  require(a==z,'concurrent_function_change')
  require(a['version']==m[kind]['version'] and a.get('verify_jwt') is True and a.get('status')=='ACTIVE','function_metadata_drift')
  require(sha(b)==m[kind]['bundle_sha256'],'function_bundle_drift')
  allfiles[kind]=original_sources(b)
 require(registry(r)==m['registry'],'registry_preimage_drift')
 return patch(m,allfiles['gateway'],lambda p:allfiles['handler'][p])
def activation_sql(m):
 require({r['operation'] for r in m['registry']}==OPS,'operation_scope_changed')
 statements=['BEGIN;',"SELECT pg_advisory_xact_lock(hashtext('sandy-hosting-api-activation'));"]
 for row in m['registry']:
  require(not any(row[k] for k in ['api_exposed','ai_exposed','ui_exposed','verified']),'inactive_registry_required')
  # Compare every admission-relevant field under the row lock; retain unrelated evidence.
  from release_gcp_admin_read import quote
  expected=quote(json.dumps(row))
  statements.append("DO $$ DECLARE actual jsonb; BEGIN SELECT to_jsonb(x) INTO actual FROM (SELECT "+COLS+" FROM public.sandy_operation_registry WHERE operation="+quote(row['operation'])+" FOR UPDATE) x; IF actual IS DISTINCT FROM "+expected+"::jsonb THEN RAISE EXCEPTION 'hosting activation registry drift'; END IF; UPDATE public.sandy_operation_registry SET api_exposed=true WHERE operation="+quote(row['operation'])+"; END $$;")
 return '\n'.join(statements+['COMMIT;'])
if __name__=='__main__':
 m=load();files=inspect(Installer(Path('/tmp')),m)
 print(json.dumps({'preflight_passed':True,'gateway_version':m['gateway']['version'],'handler_version':m['handler']['version'],'candidate_modules':len(files),'manifest_sha256':PIN,'mutations':0,'deployed':False}))
