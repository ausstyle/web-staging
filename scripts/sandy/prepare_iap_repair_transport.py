#!/usr/bin/env python3
"""Read/preserve live Control and prepare a narrow reviewed callback patch.

This command cannot deploy, establish grants, change traffic or contact Google.
The release owner must install the migration, independently verify ACL/source,
and bind a source-verified revision before activating the protected worker.
"""
import argparse,json,subprocess,re
from pathlib import Path
from release_gcp_admin_read import Installer,digest,replace_once
from release_web_canary import ROOT,Blocked,original_sources,private_write
SLUG='sandy-engineering-control'
MODULE=SLUG+'/iap_repair.ts'
MIGRATION='supabase/migrations/20261024006000_sandy_iap_repair_custody.sql'
IMPORT='import {handleIapRepairCallback} from "./iap_repair.ts";\nimport {handleIapRepairJob,isIapRepairControlRequest} from "./iap_repair_jobs.ts";\n'
ROUTE='''  if(["gcp_iap_repair_claim","gcp_iap_repair_write_started","gcp_iap_repair_finish"].includes(action)){
   try{return await handleIapRepairCallback(db,user,token,b,{
    source_sha256:Deno.env.get("SANDY_IAP_REPAIR_SOURCE_SHA256")||"",
    worker_revision:Deno.env.get("SANDY_IAP_REPAIR_WORKER_REVISION")||""
   })}catch{return respond({ok:false,error:"protected_repair_custody_unavailable",executed:null,reconciliation_required:true},503)}
  }
  if(user.app_metadata?.sandy_engineering_test===true&&isIapRepairControlRequest(b)){
   try{return await handleIapRepairJob(db,user,token,b,{
    url:Deno.env.get("SANDY_IAP_REPAIR_WORKER_URL")||"",
    source_sha256:Deno.env.get("SANDY_IAP_REPAIR_SOURCE_SHA256")||"",
    worker_revision:Deno.env.get("SANDY_IAP_REPAIR_WORKER_REVISION")||""
   })}catch{return respond({ok:false,error:"protected_repair_job_unavailable",executed:false},503)}
  }
'''
ANCHOR='  let workloadGrant=null;'
def patch(files,helper,job_helper,contract):
    if MODULE in files:raise Blocked('existing_repair_module_reconcile_do_not_overwrite')
    entry=SLUG+'/index.ts';source=files[entry].decode()
    if source.count(ANCHOR)!=1 or 'handleIapRepairCallback' in source:raise Blocked('control_source_anchor_changed')
    candidate=dict(files);candidate[entry]=(IMPORT+source.replace(ANCHOR,ROUTE+ANCHOR,1)).encode();candidate[MODULE]=helper;candidate[SLUG+'/iap_repair_jobs.ts']=job_helper;candidate['_shared/sandy_iap_repair_contract.ts']=contract
    # Every original unrelated module is retained byte-for-byte. Source parity
    # verification after a coordinated deployment must use this complete map.
    if any(candidate[k]!=v for k,v in files.items() if k!=entry):raise Blocked('unrelated_module_changed')
    return candidate
def verify_candidate(expected,actual):
    if {k:digest(v) for k,v in expected.items()}!={k:digest(v) for k,v in actual.items()}:raise Blocked('installed_full_module_map_mismatch')
    return True
def patch_gateway(files,authorization,contract):
    # Current deployed modules are minified. Patch reviewed unique anchors in
    # those actual bytes, retaining their independently deployed fixes. Never
    # replace a live module wholesale with the differently formatted checkout.
    identity='sandy-operation-api/engineering_identity.ts';legacy='sandy-operation-api/legacy_operations.ts'
    if 'sandy-operation-api/iap_repair_authorization.ts' in files:raise Blocked('existing_gateway_repair_reconcile_no_overwrite')
    s=files[identity].decode()
    s='import {iapRepairOperations,isIapRepairOperationRequest} from "../_shared/sandy_iap_repair_contract.ts";import {resolveIapRepairScope,authorizeIapRepairExecution} from "./iap_repair_authorization.ts";'+s
    s=replace_once(s,'const allowedOperations=', 'const repairAuthorized=await resolveIapRepairScope(deps,user,jwt,resolved,body);const allowedOperations=')
    s=replace_once(s,'...adminReadAuthorized?["engineering.preflight"]:[]])]', '...adminReadAuthorized?["engineering.preflight"]:[],...repairAuthorized?iapRepairOperations:[]])]')
    s=replace_once(s,'if(operation==="engineering.preflight"){','if(isIapRepairOperationRequest(operation,args)){if(!repairAuthorized)return deny(403,"independent_iap_repair_grant_required");const authorized=await authorizeIapRepairExecution(deps,user,jwt,String(operation),args,entry,headers,body.channel);if(!authorized.ok)return deny(authorized.status,authorized.error);boundExecution=authorized.boundExecution;}else if(operation==="engineering.preflight"){')
    s=replace_once(s,'...standingAuthorized?{standingOperations:standing.operations}:{},', '...(standingAuthorized||repairAuthorized)?{standingOperations:[...new Set([...(standingAuthorized?standing.operations:[]),...(repairAuthorized?iapRepairOperations:[])])]}:{},')
    s=replace_once(s,'...adminReadAuthorized?{administratorRead:true}:{},','...adminReadAuthorized?{administratorRead:true}:{},...repairAuthorized?{iapRepair:true}:{},')
    l=files[legacy].decode()
    l='import {iapRepairJobSchemas} from "../_shared/sandy_iap_repair_contract.ts";'+l
    l=replace_once(l,'for(const[operation,action]of[["engineering.job.approve"', 'definitions["engineering.implementation.request"].input_schema={oneOf:[definitions["engineering.implementation.request"].input_schema,...iapRepairJobSchemas]};for(const[operation,action]of[["engineering.job.approve"')
    result=dict(files);result[identity]=s.encode();result[legacy]=l.encode();result['sandy-operation-api/iap_repair_authorization.ts']=authorization;result['_shared/sandy_iap_repair_contract.ts']=contract
    if any(result[k]!=v for k,v in files.items() if k not in [identity,legacy]):raise Blocked('unrelated_gateway_module_changed')
    return result
def worker_manifest(root=ROOT):
    prefix='services/sandy-engineering-mcp/'
    names=subprocess.check_output(['git','ls-files',prefix],cwd=root,text=True).splitlines()
    paths=[n for n in names if n.startswith(prefix+'src/') or n in [prefix+'Dockerfile',prefix+'package.json',prefix+'package-lock.json']]
    if not paths or prefix+'src/iap-repair.mjs' not in paths:raise Blocked('reviewed_worker_sources_required')
    hashes={name:digest((root/name).read_bytes()) for name in sorted(paths)}
    canonical=json.dumps(hashes,separators=(',',':'),sort_keys=True).encode()
    return {'format':'sandy-worker-module-map-v1','source_sha256':digest(canonical),'files':hashes}
def prepare(r):
    helper=(ROOT/'supabase/functions'/MODULE).read_bytes()
    meta=json.loads(r.api('GET','/functions/'+SLUG));body=r.api('GET','/functions/'+SLUG+'/body')
    if meta.get('status')!='ACTIVE' or meta.get('verify_jwt') is not False:raise Blocked('reviewed_control_ingress_required')
    before=original_sources(body);after=patch(before,helper,(ROOT/'supabase/functions'/SLUG/'iap_repair_jobs.ts').read_bytes(),(ROOT/'supabase/functions/_shared/sandy_iap_repair_contract.ts').read_bytes())
    snapshot={'version':meta['version'],'verify_jwt':meta['verify_jwt'],'body_sha256':digest(body),'files':{k:digest(v) for k,v in before.items()}}
    private_write(r.out,'before-body.eszip',body);private_write(r.out,'before-metadata.json',json.dumps(meta).encode())
    for name,data in after.items():
        rel=Path(name)
        if rel.is_absolute() or '..' in rel.parts:raise Blocked('untrusted_source_path')
        directory=r.out/'candidate'/rel.parent;directory.mkdir(parents=True,exist_ok=True,mode=0o700)
        private_write(directory,rel.name,data)
    api='sandy-operation-api';api_meta=json.loads(r.api('GET','/functions/'+api));api_body=r.api('GET','/functions/'+api+'/body');api_before=original_sources(api_body)
    if api_meta.get('status')!='ACTIVE' or api_meta.get('verify_jwt') is not True:raise Blocked('reviewed_gateway_ingress_required')
    api_after=patch_gateway(api_before,(ROOT/'supabase/functions/sandy-operation-api/iap_repair_authorization.ts').read_bytes(),(ROOT/'supabase/functions/_shared/sandy_iap_repair_contract.ts').read_bytes())
    for name in ['sandy-operation-api/engineering_identity.ts','sandy-operation-api/legacy_operations.ts']:
        subprocess.run(['node','--input-type=module','--check'],input=api_after[name],check=True,capture_output=True)
    private_write(r.out,'api-before-body.eszip',api_body);private_write(r.out,'api-before-metadata.json',json.dumps(api_meta).encode())
    for name,data in api_after.items():
        rel=Path(name)
        if rel.is_absolute() or '..' in rel.parts:raise Blocked('untrusted_source_path')
        directory=r.out/'api-candidate'/rel.parent;directory.mkdir(parents=True,exist_ok=True,mode=0o700);private_write(directory,rel.name,data)
    migration=(ROOT/MIGRATION).read_bytes()
    private_write(r.out,'migration.sql',migration)
    private_write(r.out,'rollback-disable-new-admission.sql',b'-- Stop new admissions only; preserve finish callbacks, private custody and all audit.\nREVOKE ALL ON FUNCTION public.sandy_iap_repair_prepare_job(uuid,uuid,integer,uuid,text,uuid,text,text,text),public.sandy_iap_repair_job_admit(uuid,uuid,integer,uuid,text,text) FROM service_role;\n')
    sql_functions={name:digest(body.encode()) for name,body in re.findall(r'CREATE FUNCTION public\.(\w+)\([^$]*?AS \$\$(.*?)\$\$;',migration.decode(),re.S)}
    if len(sql_functions)!=9:raise Blocked('reviewed_rpc_source_inventory_required')
    report={'prepared':True,'installed':False,'activated':False,'IAM_changes':0,'grant_changes':0,'Cloud_Run_changes':0,
      'before':snapshot,'candidate_files':{k:digest(v) for k,v in after.items()},'worker_manifest':worker_manifest(),
      'migration':MIGRATION,'migration_sha256':digest((ROOT/MIGRATION).read_bytes()),
      'rpc_source_sha256':sql_functions,'gateway_patch_syntax_verified':True,
      'api_before':{'version':api_meta['version'],'verify_jwt':api_meta['verify_jwt'],'body_sha256':digest(api_body),'files':{k:digest(v) for k,v in api_before.items()}},
      'api_candidate_files':{k:digest(v) for k,v in api_after.items()},
      'existing_proposal_id':'52d56740-59c8-4db1-b7e6-a137c7699b86',
      'rollback':'Redeploy the preserved original module map and metadata; disable new transport binding. Retain all admission/custody/audit records.',
      'activation_dependencies':['source-verified immutable worker revision','installed RPC source and ACL readback','normal workload session','independently recorded current Owner IAP delegation','coordinated source-preserving Control/API/worker release']}
    private_write(r.out,'prepared-transport.json',json.dumps(report,indent=2).encode())
    return report
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--evidence-dir',required=True);args=p.parse_args()
    out=Path(args.evidence_dir);out.mkdir(parents=True,exist_ok=False,mode=0o700)
    try:
        result=prepare(Installer(out))
        print(json.dumps({k:result[k] for k in ['prepared','installed','activated','IAM_changes','grant_changes','Cloud_Run_changes','existing_proposal_id']}))
    except Blocked as e:print(json.dumps({'prepared':False,'error':str(e)}));raise SystemExit(1)
