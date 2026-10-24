"""Exact reviewed hooks over accepted IAP API source, never whole-main upload."""
from release_web_canary import ROOT,Blocked,digest
INDEX='sandy-operation-api/index.ts'
BEFORE_INDEX='ca78a5733a4a358e74e642d80529095c1ed9cc857732d877bd1c15d5f55e3177'
EDITS=[
 ('!["memory.fact_correct","tasks.update"].includes(operation)','!(operation==="memory.fact_correct"||isCustomerMutationOperation(operation))'),
 ('await(operation==="tasks.update"?resolveTaskCancellationCertification:resolveMemoryCertification)','await(isCustomerMutationOperation(operation)?resolveCustomerMutationCertification:resolveMemoryCertification)'),
]
REPLACE=['sandy-operation-api/customer_mutations.ts','sandy-operation-api/task_cancellation_certification.ts','sandy-operation-api/customer_mutation_certification.ts']
def patch_api(files):
 if digest(files.get(INDEX,b''))!=BEFORE_INDEX:raise Blocked('reviewed_IAP_API_source_preimage_changed')
 if 'sandy-operation-api/customer_mutation_certification.ts' in files:raise Blocked('customer_profile_already_installed_reconcile')
 source=files[INDEX].decode()
 for old,new in EDITS:
  if source.count(old)!=1:raise Blocked('reviewed_customer_profile_anchor_changed')
  source=source.replace(old,new,1)
 source='import {resolveCustomerMutationCertification} from "./customer_mutation_certification.ts";\n'+source
 result=dict(files);result[INDEX]=source.encode()
 for path in REPLACE:result[path]=(ROOT/'supabase/functions'/path).read_bytes()
 return result
