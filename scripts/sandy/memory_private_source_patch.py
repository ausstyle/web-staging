"""Exact reviewed patches over API60's original modules; no release side effects."""
from pathlib import Path
from release_web_canary import ROOT,Blocked,digest
API_MODULES={
 'sandy-operation-api/customer_mutations.ts':'96e816b344e5f93509b744784110dacb279efccd26e7e4133c176aa41c55be54',
 'sandy-operation-api/memory_operations.ts':'7867b0e3f6ac3b4b6d9c0009f38d93e9121ad71c8765927d3886faff00c74545',
 'sandy-operation-api/memory_contracts.ts':'4f5da532c159d6045b47da34418128e0b49548b1f009c562e0ee9f22919c2979',
 'sandy-operation-api/customer_services.ts':'b19d2589120c8848fe4b0b20fd252e3346cdf835f612353b332cbb6063cb7984',
}
MCP_MODULES={'sandy-api-mcp/index.ts':'afb17dd64b17029ed1a20d107312817b25a18dacb3d5c6cfa3432a6793377ea8','_shared/sandy_mcp_transport.mjs':'75236f6d909be64613c4c189441ac603e11e4050e2be347e74bde2ebd0580041'}
HOOK='''let memoryCertification;
if(request.headers.has("x-sandy-certification-id")){
 if(delegation||customerKey||!user||!user.email_confirmed_at||!memoryAccess||body.action!=="execute"||operation!=="memory.fact_correct"||!isObject(entry)||internalExecution||(body.channel!==undefined&&!["api","mcp"].includes(String(body.channel))))return reply(403,{ok:false,error:"private_readiness_normal_customer_required",executed:false});
 let deploymentId=dependencies.memoryCertificationDeploymentId??"";
 if(!deploymentId)try{deploymentId=Deno.env.get("DENO_DEPLOYMENT_ID")||""}catch{}
 const readiness=await resolveMemoryCertification({base,anon,token:bearer,readinessId:request.headers.get("x-sandy-certification-id"),deploymentId,entry,args:body.arguments,customerId:portalCustomerId,request:fetchBackend});
 if(!readiness.ok)return reply(readiness.status,{ok:false,error:readiness.error,executed:false});
 memoryCertification=readiness.value;
}
'''
EDITS=[
 ('const entry=storedEntry;if(!isObject(entry)||entry.api_exposed!==true)', 'const entry=storedEntry;'+HOOK+'if(!isObject(entry)||(entry.api_exposed!==true&&!memoryCertification))'),
 ('if(body.channel==="mcp"&&entry.ai_exposed!==true)', 'if(body.channel==="mcp"&&entry.ai_exposed!==true&&!memoryCertification)'),
 ('if(!enabledEntry(entry))', 'if(!enabledEntry(entry)&&!(memoryCertification&&enabledEntry({...entry,api_exposed:true})))'),
 ('entry.verified!==true&&!engineeringProofFor(delegation)?.standingOperations?.includes(operation)', 'entry.verified!==true&&!memoryCertification&&!engineeringProofFor(delegation)?.standingOperations?.includes(operation)'),
 ('if(extensionReady&&!extensionReady.executable)', 'if(extensionReady&&!extensionReady.executable&&!memoryCertification)'),
 ('executeUserExtension({base,anon,service,principal:customerServicePrincipal,fetch:fetchBackend,emailConfirmed:', 'executeUserExtension({base,anon,service,principal:customerServicePrincipal,fetch:fetchBackend,...memoryCertification?{memoryCertification}:{},emailConfirmed:'),
]
def apply_edits(source):
 for old,new in EDITS:
  if source.count(old)!=1:raise Blocked('memory_private_source_anchor_changed')
  source=source.replace(old,new,1)
 return 'import {resolveMemoryCertification} from "./memory_certification.ts";\n'+source
def patch_api(files):
 index='sandy-operation-api/index.ts'
 if digest(files.get(index,b''))!='aefd069c16046ec9cc9dd8166792e0ead3fec4c8d847ded6fec8d5ebbbf1d806':raise Blocked('API60_source_preimage_changed')
 for name,sha in API_MODULES.items():
  if digest(files.get(name,b''))!=sha:raise Blocked('memory_module_preimage_changed')
 if 'sandy-operation-api/memory_certification.ts' in files:raise Blocked('private_readiness_already_installed_reconcile')
 result=dict(files);result[index]=apply_edits(files[index].decode()).encode()
 for name in list(API_MODULES)+['sandy-operation-api/memory_certification.ts']:result[name]=(ROOT/'supabase/functions'/name).read_bytes()
 return result
def patch_mcp(files):
 if set(files)!=set(MCP_MODULES) or any(digest(files[name])!=sha for name,sha in MCP_MODULES.items()):raise Blocked('MCP22_source_preimage_changed')
 return {name:(ROOT/'supabase/functions'/name).read_bytes() for name in files}
