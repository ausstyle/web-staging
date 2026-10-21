"""Generate additive108xx from reviewed source and pinned private resolver baseline."""
import hashlib,json,pathlib
def canonical(v): return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
HERE=pathlib.Path(__file__).resolve().parent;ROOT=HERE.parents[2]
def inline_refs(value,defs,depth=0):
 if depth>30: raise ValueError('schema_depth')
 if isinstance(value,list): return [inline_refs(v,defs,depth+1) for v in value]
 if not isinstance(value,dict): return value
 if '$ref' in value:
  ref=value['$ref'];assert ref.startswith('#/$defs/')
  return inline_refs(defs[ref.split('/')[-1]],defs,depth+1)
 return {k:inline_refs(v,defs,depth+1) for k,v in value.items() if k!='$defs'}
ops=json.loads((HERE/'provider_contracts.json').read_text())+json.loads((HERE/'workflow_contracts.json').read_text())
before=(HERE/'consumer_before.sql').read_text()
old="'sandy-provider-sensitive-api','sandy-provider-bound-api') THEN RAISE EXCEPTION 'consumer_current_contract_required'"
assert before.count(old)==1
new=before.replace(old,"'sandy-provider-sensitive-api','sandy-provider-bound-api','sandy-legacy-compatibility-api') THEN RAISE EXCEPTION 'consumer_current_contract_required'")
needle=' IF admission.credential_id IS NOT NULL THEN'
assert new.count(needle)==1
check=""" IF entry.handler='sandy-legacy-compatibility-api' THEN
  IF (SELECT consumer FROM public.sandy_legacy_provider_contracts WHERE operation=p_operation) IS DISTINCT FROM p_consumer
  OR public.sandy_legacy_provider_context(jsonb_build_object('operation',p_operation,'actor_id',p_actor,'admission_id',p_admission,
   'request_id',admission.request_id,'grant_id',admission.grant_id,'tenant_id',NULL,'credential_id',NULL),'consumed')->>'allowed' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'consumer_scoped_admission_required';END IF;
 END IF;
"""
new=new.replace(needle,check+needle)
sha=hashlib.sha256(before.encode()).hexdigest()
sql="-- Fixed legacy aliases share the original canonical one-use provider engine.\nBEGIN;\nDO $guard$ BEGIN IF (SELECT encode(extensions.digest(prosrc,'sha256'),'hex') FROM pg_proc WHERE oid='public.sandy_credential_resolve_consumer(text,uuid,uuid,text)'::regprocedure AND prosecdef) IS DISTINCT FROM '"+sha+"' THEN RAISE EXCEPTION 'reviewed_legacy_consumer_baseline_required';END IF;END $guard$;\n"
sql+=(HERE/'provider_context.sql').read_text()
sql+="\nCREATE OR REPLACE FUNCTION public.sandy_credential_resolve_consumer(p_consumer text,p_actor uuid,p_admission uuid,p_operation text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $consumer$"+new+"$consumer$;\nCOMMIT;\n"
(ROOT/'supabase/migrations/20261021010800_sandy_legacy_provider_boundary.sql').write_text(sql)
baseline=json.loads((HERE/'registry_before.json').read_text());oldrows={r['operation']:r for r in baseline}
lines=['-- Exactly7 legacy contract replacements, closed and unverified.','BEGIN;']
for o in ops:
 scope={'provider':'github','repository':'ausstyle/web-staging'} if o['provider']=='github' else {'provider':'supabase','project_ref':'zmqlyygzqoidkcwdysok'}
 config={k:o[k] for k in ['operation','input_schema','output_schema','contract_sha256','permission_scope','is_mutation']};config.update(maximum_input_bytes=o.get('maximum_input_bytes',155000),sql_input_schema=inline_refs(o['input_schema'],o['input_schema'].get('$defs',{})),canonical_scope=canonical(scope),consumer='github_api' if o['provider']=='github' else 'supabase_management')
 cfg=canonical(config).replace("'","''")
 lines.append("INSERT INTO public.sandy_legacy_provider_contracts SELECT * FROM jsonb_populate_record(NULL::public.sandy_legacy_provider_contracts,'"+cfg+"'::jsonb);")
 oldrow={k:oldrows[o['operation']][k] for k in ['handler','permission_scope','is_mutation','input_schema','output_schema','api_exposed','ai_exposed','verified']}
 oldliteral=canonical(oldrow).replace("'","''")
 error={'contract_sha256':o['contract_sha256'],'requires_approval':True,'requires_grant':True,'requires_real_user_session':True,'api_key_delegable':False,'canonical_target':o['canonical_target'],'provider_effect_confirmed':False}
 err=canonical(error).replace("'","''");inp=canonical(o['input_schema']).replace("'","''");out=canonical(o['output_schema']).replace("'","''")
 lines.append("DO $row$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry r WHERE r.operation='"+o['operation']+"' AND (SELECT jsonb_object_agg(k,to_jsonb(r)->k) FROM unnest(ARRAY['handler','permission_scope','is_mutation','input_schema','output_schema','api_exposed','ai_exposed','verified'])k)='"+oldliteral+"'::jsonb) THEN RAISE EXCEPTION 'reviewed_legacy_registry_baseline_required: "+o['operation']+"';END IF;END $row$;".replace('SELECT1','SELECT 1'))
 lines.append("UPDATE public.sandy_operation_registry SET handler='sandy-legacy-compatibility-api',permission_scope='"+o['permission_scope']+"',input_schema='"+inp+"'::jsonb,output_schema='"+out+"'::jsonb,error_contract='"+err+"'::jsonb,api_exposed=false,ai_exposed=false,ui_exposed=false,verified=false,implementation_state='implemented_unverified',last_verified_at=NULL WHERE operation='"+o['operation']+"';")
lines.append('COMMIT;');(ROOT/'supabase/migrations/20261021010810_sandy_legacy_provider_contracts.sql').write_text('\n'.join(lines)+'\n')
print(json.dumps({'contracts':len(ops),'consumer_before_sha256':sha,'consumer_after_sha256':hashlib.sha256(new.encode()).hexdigest()}))

(HERE/'gateway_manifest.json').write_text(json.dumps({'operations':[{k:o[k] for k in ['operation','provider','handler','canonical_target','permission_scope','is_mutation','requires_grant','requires_approval','requires_real_user_session','api_key_delegable','owner_only','contract_sha256','input_schema','output_schema']} for o in ops]},indent=2)+'\n')
