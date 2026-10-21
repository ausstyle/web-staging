"""Emit reviewed guest capability contracts; no provider or VM actions are run."""
import json,hashlib,pathlib
ROOT=pathlib.Path(__file__).resolve().parent
WORKER_SHA256=hashlib.sha256((ROOT/'worker.mjs').read_bytes()).hexdigest()
PROVIDER_SOURCE_SHA256=json.loads((ROOT/'compute_instance_binding.json').read_text())['source_sha256']
VM={'type':'string','enum':['sandy-windows','sandy-video']}
UUID={'type':'string','format':'uuid'}
NAME={'type':'string','pattern':'^[A-Za-z0-9](?!.*\\.\\.)[A-Za-z0-9_.@:+-]{0,119}$'}
PATH={'type':'string','pattern':'^(?!\\.\\.?(?:/|$))[A-Za-z0-9_.-]+(?:/(?!\\.\\.?(?:/|$))[A-Za-z0-9_.-]+)*$','maxLength':180}
SHA={'type':'string','pattern':'^[a-f0-9]{64}$'}
evidence_schema={'type':'object','required':['kind'],'properties':{k:{'type':typ} for k,typ in {
 'kind':'string','code':'string','path':'string','bytes':'integer','sha256':'string','content_base64':'string',
 'service':'string','state':'string','mutation_exit_code':['integer','null'],'readback_exit_code':['integer','null'],
 'exit_code':['integer','null'],'output_sha256':'string','readback':'string','inventory_confirmed':'boolean',
 'completion_basis':'string','effect_confirmed':'boolean','rule_id':'string','before_boot_id_sha256':['string','null'],
 'reboot_observed':'boolean','reconciliation_required':'boolean','observed_boot_id_sha256':'string'}.items()},'additionalProperties':False}
nullable_time={'type':['string','null'],'format':'date-time'}
ops=[]
def add(op,req,mutation,fields={},required=None,kind='queue',approval=None):
 fields={'vm_name':VM,**fields}
 if op=='gcp.vm.tasks.get': fields={'job_id':UUID}
 schema={'type':'object','properties':fields,'required':list(fields) if required is None else required,'additionalProperties':False}
 output={'type':'object','required':['ok','operation','contract_version','accepted','executed','request_state','result'],'properties':{'ok':{'const':True},'operation':{'const':op},'contract_version':{'const':'1.0.0'},'accepted':{'type':'boolean'},'executed':{'type':['boolean','null']},'request_state':{'type':'string'},'result':{'type':'object'}},'additionalProperties':False}
 result_fields={}
 if kind=='queue':result_fields={'ok':{'const':True},'job_id':UUID,'state':{'type':'string'},'reused':{'type':'boolean'},'executed':{'type':['boolean','null']},'expires_at':{'type':'string','format':'date-time'},'redispatch_permitted':{'const':False}}
 elif kind=='access':result_fields={'ok':{'const':True},'vm_name':VM,'enabled':{'type':'boolean'},'generation':{'type':'integer'},'instance_id':{'type':'string'},'project_id':{'const':'elaborate-haven-511518-a5'},'key_id':{'type':['string','null']},'agent_connected':{'const':False},'revocation_cancels_already_running_os_effects':{'const':False},'reused':{'type':'boolean'}}
 elif kind=='status':result_fields={'ok':{'const':True},'vm_name':VM,'enabled':{'type':'boolean'},'generation':{'type':'integer'},'instance_id':{'type':'string'},'project_id':{'const':'elaborate-haven-511518-a5'},'platform':{'enum':['linux','win32']},'last_seen_at':nullable_time,'agent_version':{'type':['string','null']},'agent_connected':{'type':'boolean'},'installed_software_attested':{'const':False},'ssh_transport_available':{'const':False},'winrm_transport_available':{'const':False}}
 elif kind=='task_status':result_fields={'ok':{'const':True},'job_id':UUID,'vm_name':VM,'operation':{'type':'string'},'request_id':UUID,'state':{'enum':['queued','claimed','running','completed','accepted','failed','unknown','cancelled','expired','blocked']},'executed':{'type':['boolean','null']},'result_sha256':{'type':['string','null']},'result_digest_format':{'enum':['canonical_json_v1','pg_jsonb_v1']},'evidence':{'anyOf':[{'type':'null'},evidence_schema]},'created_at':{'type':'string','format':'date-time'},'finished_at':nullable_time,'reconciliation_required':{'type':'boolean'},'redispatch_permitted':{'const':False},'evidence_basis':{'const':'authenticated_fixed_vm_report_not_independent_provider_attestation'}}
 elif kind=='logs':result_fields={'contents':{'type':'string','maxLength':8192},'next':{'type':['string','null']},'truncated':{'type':'boolean'},'source':{'const':'compute_serial_port'},'agent_installation_confirmed':{'const':False}}
 elif kind=='install':result_fields={'metadata_request_accepted':{'const':True},'metadata_staged':{'type':'boolean'},'metadata_readback_confirmed':{'type':'boolean'},'provider_operation':{'type':['string','null']},'provider_operation_status':{'enum':['PENDING','RUNNING','DONE']},'worker_sha256':SHA,'installation_confirmed':{'const':False},'startup_execution_requires_reboot_or_provider_startup_runner':{'const':True}}
 if result_fields:output['properties']['result']={'type':'object','properties':result_fields,'required':[k for k in result_fields if not(kind=='queue' and k=='expires_at')],'additionalProperties':False}
 c={'operation':op,'requirement':req,'contract_version':'1.0.0','kind':kind,'is_mutation':mutation,'requires_approval':mutation if approval is None else approval,'input_schema':schema,'output_schema':output,'permission_scope':'infrastructure:write' if mutation else 'infrastructure:read','api_key_delegable':False,'worker_sha256':WORKER_SHA256,'provider_source_sha256':PROVIDER_SOURCE_SHA256,'specification_family':'gcp.vm.firewallGuest.manage' if req==42 else 'gcp.vm.bootstrap.getLogs' if req==44 else op}
 c['contract_sha256']=hashlib.sha256(json.dumps(c,separators=(',',':'),sort_keys=True,ensure_ascii=False).encode()).hexdigest();ops.append(c)
for action in ['bootstrap','rotate','revoke']:add('gcp.vm.access.'+action,35,True,kind='access')
for op,req in [('ssh',36),('winrm',37)]:add('gcp.vm.'+op+'.exec',req,True,{'command':{'type':'string','minLength':1,'maxLength':4096}},kind='unsupported_transport')
add('gcp.vm.files.upload',38,True,{'path':PATH,'content_base64':{'type':'string','maxLength':87384,'pattern':'^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'},'sha256':SHA})
add('gcp.vm.files.download',38,False,{'path':PATH},approval=True)
for action in ['install','update','remove']:add('gcp.vm.packages.'+action,39,True,{'manager':{'type':'string','enum':['apt','dnf','winget']},'packages':{'type':'array','items':NAME,'minItems':1,'maxItems':20,'uniqueItems':True}})
for action in ['start','stop','restart','status']:add('gcp.vm.services.'+action,40,action!='status',{'service':NAME})
add('gcp.vm.reboot',41,True,{'delay_seconds':{'type':'integer','minimum':60,'maximum':300}})
add('gcp.vm.firewall_guest.manage',42,True,{'action':{'type':'string','enum':['allow','deny','remove']},'rule_id':{'type':'string','pattern':'^[A-Za-z0-9][A-Za-z0-9_.-]{0,47}$'},'protocol':{'type':'string','enum':['tcp','udp']},'port':{'type':'integer','minimum':1,'maximum':65535},'source_cidr':{'type':'string','maxLength':18,'pattern':'^(?:[0-9]{1,3}\\.){3}[0-9]{1,3}/[0-9]{1,2}$'}},required=['vm_name','action','rule_id'])
for action in ['install','update']:add('gcp.vm.agent.'+action,43,True,{'expected_metadata_fingerprint':{'type':'string','minLength':1,'maxLength':256}},kind='install')
add('gcp.vm.agent.status',43,False,kind='status')
add('gcp.vm.bootstrap.get_logs',44,False,{'start':{'type':'string','pattern':'^[0-9]{1,20}$'}},kind='logs',approval=True)
add('gcp.vm.tasks.get',40,False,kind='task_status')
manifest={'version':'1.0.0','project_id':'elaborate-haven-511518-a5','zone':'europe-west1-b','evidence_schema':evidence_schema,'operations':ops}
(ROOT/'contracts.json').write_text(json.dumps(manifest,indent=2)+'\n')
worker=(ROOT/'worker.mjs').read_text()
(ROOT/'worker_bundle.ts').write_text('// Generated from worker.mjs by generate_contracts.py; do not edit.\nexport const WORKER_SHA256='+json.dumps(hashlib.sha256(worker.encode()).hexdigest())+';\nexport const WORKER_SOURCE='+json.dumps(worker)+';\n')
rows=[]
for c in ops:
 cols=[c['operation'],'gcp','Managed guest '+c['kind']+'; fixed enrolled VM identity, signed one-use task and durable receipt. SSH/WinRM require a separate supported transport.' if c['kind']=='unsupported_transport' else 'Managed guest '+c['kind']+'; fixed VM identity, Ed25519-signed one-use tasks and durable receipts; actual guest results are required for completion.',c['permission_scope'],c['is_mutation'],c['input_schema'],c['output_schema'],'sandy-guest-operation-api',False,False,False,False,'source_ready','ausstyle/web-staging','supabase/functions/sandy-guest-operation-api/index.ts',{'contract_sha256':c['contract_sha256'],'requires_approval':c['requires_approval'],'api_key_delegable':False,'requirement':c['requirement'],'worker_sha256':hashlib.sha256(worker.encode()).hexdigest(),'transport':'unsupported_'+('ssh' if 'ssh.' in c['operation'] else 'winrm') if c['kind']=='unsupported_transport' else 'managed_guest','key_configuration_required':True,'provider_source_sha256':PROVIDER_SOURCE_SHA256,'specification_family':c['specification_family']}]
 def lit(x):
  if isinstance(x,bool):return str(x).lower()
  if isinstance(x,dict):return "'"+json.dumps(x,separators=(',',':')).replace("'","''")+"'::jsonb"
  return "'"+x.replace("'","''")+"'"
 rows.append('('+','.join(map(lit,cols))+')')
(ROOT/'registry_fragment.sql').write_text('INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,error_contract) VALUES\n'+',\n'.join(rows)+'\nON CONFLICT(operation) DO NOTHING;\n')
print(json.dumps({'operations':len(ops),'worker_sha256':hashlib.sha256(worker.encode()).hexdigest(),'provider_called':False}))

migration=ROOT.parents[1]/'migrations/20261021001000_sandy_guest_operation_contracts.sql'
if migration.exists():
    sql=migration.read_text();mark='INSERT INTO public.sandy_operation_registry('
    if mark in sql:migration.write_text(sql[:sql.index(mark)]+(ROOT/'registry_fragment.sql').read_text()+'COMMIT;\n')
