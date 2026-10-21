"""Deterministic08900 boundary +08910 closed contracts; preserve post108 resolver."""
import hashlib,json,pathlib
HERE=pathlib.Path(__file__).resolve().parent;ROOT=HERE.parents[2]
def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def literal(value):return "'"+value.replace("'","''")+"'"
before=(HERE/'consumer_before.sql').read_text();sha=hashlib.sha256(before.encode()).hexdigest()
needle="'sandy-provider-bound-api','sandy-legacy-compatibility-api')"
assert before.count(needle)==1
after=before.replace(needle,"'sandy-provider-bound-api','sandy-legacy-compatibility-api','sandy-vm-protocol-api')")
needle=' IF admission.credential_id IS NOT NULL THEN';assert after.count(needle)==1
proof=""" IF entry.handler='sandy-vm-protocol-api' THEN
  IF p_consumer IS DISTINCT FROM 'gcp_access_token' OR NOT EXISTS(SELECT 1 FROM public.sandy_vm_protocol_contracts WHERE operation=p_operation AND kind IN('ssh','winrm','registered_exec','binding_enroll'))
  OR NOT EXISTS(SELECT 1 FROM public.sandy_vm_protocol_admission_contexts proof JOIN vault.decrypted_secrets material ON material.id=proof.arguments_vault_id WHERE proof.admission_id=admission.id AND proof.input_sha256=admission.input_sha256 AND proof.expires_at>clock_timestamp() AND encode(extensions.digest(material.decrypted_secret,'sha256'),'hex')=proof.input_sha256 AND public.sandy_vm_protocol_context(jsonb_build_object('actor_id',p_actor,'admission_id',p_admission,'operation',p_operation,'request_id',admission.request_id,'grant_id',admission.grant_id,'tenant_id',NULL,'credential_id',NULL,'arguments',material.decrypted_secret::jsonb,'canonical_arguments',material.decrypted_secret,'canonical_scope',proof.scope_canonical),'consumed')->>'allowed'='true')
  THEN RAISE EXCEPTION 'consumer_scoped_admission_required';END IF;
 END IF;
"""
after=after.replace(needle,proof+needle)
needle=" expected_consumer:=CASE WHEN p_operation LIKE 'supabase.%'"
assert after.count(needle)==1
after=after.replace(needle," expected_consumer:=CASE WHEN p_operation='cloud.vm.exec' AND entry.handler='sandy-vm-protocol-api' THEN 'gcp_access_token' WHEN p_operation LIKE 'supabase.%'")
header="--08900 real pinned SSH/WinRM protocol owner boundary; no provider activation.\nBEGIN;\nDO $guard$ BEGIN IF (SELECT encode(extensions.digest(prosrc,'sha256'),'hex') FROM pg_proc WHERE oid='public.sandy_credential_resolve_consumer(text,uuid,uuid,text)'::regprocedure AND prosecdef) IS DISTINCT FROM '"+sha+"' THEN RAISE EXCEPTION 'reviewed_post108_consumer_required';END IF;END $guard$;\n"
body=header+(HERE/'boundary.sql').read_text()+"\nCREATE OR REPLACE FUNCTION public.sandy_credential_resolve_consumer(p_consumer text,p_actor uuid,p_admission uuid,p_operation text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $consumer$"+after+"$consumer$;\n"
body+="DO $cron$ BEGIN IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN PERFORM cron.schedule('sandy-vm-protocol-private-ttl','* * * * *','SELECT public.sandy_vm_protocol_cleanup()');END IF;END $cron$;\nCOMMIT;\n"
(ROOT/'supabase/migrations/20261021008900_sandy_vm_protocol_boundary.sql').write_text(body)
ops=json.loads((HERE/'contracts.json').read_text());baseline={r['operation']:r for r in json.loads((HERE/'registry_before.json').read_text())};lines=['--08910 exactly9 closed/unverified real protocol and metadata contracts.','BEGIN;']
for op in ops:
 config={key:op[key] for key in ['operation','kind','handler','permission_scope','is_mutation','input_schema','output_schema','contract_sha256']}
 lines.append('INSERT INTO public.sandy_vm_protocol_contracts SELECT * FROM jsonb_populate_record(NULL::public.sandy_vm_protocol_contracts,'+literal(canonical(config))+'::jsonb);')
 error={'contract_sha256':op['contract_sha256'],'requires_approval':True,'requires_grant':True,'requires_real_user_session':True,'api_key_delegable':False,'provider_effect_confirmed':False,'private_output_delivery':False}
 values={'handler':op['handler'],'permission_scope':op['permission_scope'],'is_mutation':op['is_mutation'],'input_schema':op['input_schema'],'output_schema':op['output_schema'],'error_contract':error,'api_exposed':False,'ai_exposed':False,'ui_exposed':False,'verified':False,'implementation_state':'implemented_unverified','last_verified_at':None}
 if op['operation'] in baseline:
  old=baseline[op['operation']];keys=list(old);keys.remove('operation');parts=','.join(literal(k) for k in keys)
  lines.append("DO $row$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry r WHERE r.operation="+literal(op['operation'])+" AND (SELECT jsonb_object_agg(k,to_jsonb(r)->k) FROM unnest(ARRAY["+parts+"])k)="+literal(canonical({k:old[k] for k in keys}))+"::jsonb) THEN RAISE EXCEPTION 'reviewed_vm_prior_contract_required';END IF;END $row$;")
  expr=[]
  for k,v in values.items():
   expr.append(k+'='+('NULL' if v is None else str(v).lower() if isinstance(v,bool) else literal(canonical(v))+'::jsonb' if isinstance(v,dict) else literal(v)))
  lines.append('UPDATE public.sandy_operation_registry SET '+','.join(expr)+' WHERE operation='+literal(op['operation'])+';')
 else:
  values.pop('last_verified_at');values.update(operation=op['operation'],domain='infrastructure',description='Approved fixed VM '+op['kind']+'; no production provider verification.',source_repository='ausstyle/web-staging',source_path='supabase/functions/sandy-vm-protocol-api/index.ts',dependencies=['current confirmed Controller owner and exact approval','approved fixed VM host key or CA enrollment','fixed VM provider IAM and actual network fixture'],retry_policy={'automatic_retry':False,'unknown':'reconcile before a fresh reviewed action'},rollback_policy={'automatic':False,'private_ttl_seconds':600})
  columns=','.join(values);expr=[]
  for v in values.values():expr.append(str(v).lower() if isinstance(v,bool) else literal(canonical(v))+'::jsonb' if isinstance(v,(dict,list)) else literal(v))
  lines.append('INSERT INTO public.sandy_operation_registry('+columns+') VALUES('+','.join(expr)+');')
lines.append('COMMIT;');(ROOT/'supabase/migrations/20261021008910_sandy_vm_protocol_contracts.sql').write_text('\n'.join(lines)+'\n')
print(json.dumps({'operations':len(ops),'existing_replacements':len(baseline),'new_operations':len(ops)-len(baseline),'consumer_before_sha256':sha,'consumer_after_sha256':hashlib.sha256(after.encode()).hexdigest()}))
