"""Deterministic hooks over the independently observed API61, never whole-main index."""
from release_web_canary import ROOT,Blocked,digest
INDEX='sandy-operation-api/index.ts'
BEFORE_INDEX='c95b236ee47fd92a8cc81d510fa02f388b24bca988bae5fbf11c72fbc2cbd4a1'
EDITS=[
 ('operation!=="memory.fact_correct"||!isObject(entry)', '!["memory.fact_correct","tasks.update"].includes(operation)||!isObject(entry)'),
 ('await resolveMemoryCertification({base,anon,token:', 'await(operation==="tasks.update"?resolveTaskCancellationCertification:resolveMemoryCertification)({base,anon,token:'),
 ('executeCustomerMutation({base,anon,db,fetch:fetchBackend},', 'executeCustomerMutation({base,anon,db,fetch:fetchBackend,...memoryCertification?{memoryCertification}:{}},'),
 ('reply(response2.status,response2.body),entry.output_schema)', 'reply(response2.status,response2.status===200&&isObject(response2.body.result)?response2.body.result:response2.body),entry.output_schema)'),
]
REPLACE=['sandy-operation-api/customer_mutations.ts','sandy-operation-api/task_cancellation_certification.ts']
def patch_api(files):
 if digest(files.get(INDEX,b''))!=BEFORE_INDEX:raise Blocked('reviewed_API61_preimage_changed')
 if 'sandy-operation-api/task_cancellation_certification.ts' in files:raise Blocked('cancellation_already_installed_reconcile')
 s=files[INDEX].decode()
 for old,new in EDITS:
  if s.count(old)!=1:raise Blocked('reviewed_cancellation_anchor_changed')
  s=s.replace(old,new,1)
 s='import {resolveTaskCancellationCertification} from "./task_cancellation_certification.ts";\n'+s
 result=dict(files);result[INDEX]=s.encode()
 for p in REPLACE:result[p]=(ROOT/'supabase/functions'/p).read_bytes()
 return result
