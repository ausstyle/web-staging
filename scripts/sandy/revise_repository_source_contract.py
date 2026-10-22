"""Rebuild only the existing source contract and its signed compact manifests.

No upstream schema refresh and no registry operation creation are performed.
The provider response contract remains pinned; only local source-delivery bounds
and backwards-compatible optional range metadata change.
"""
import hashlib,json
from pathlib import Path
from build_provider_operations import output_schema,catalogue_loader,compact_manifest
ROOT=Path(__file__).resolve().parents[2]
PATTERN=r'^(?!\.)(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*$'

def revise():
    folder=ROOT/'supabase/functions/sandy-provider-operation-api';file=folder/'contracts.json'
    data=json.loads(file.read_text());op=next(x for x in data['operations'] if x['operation']=='github.files.content.get');old=op['contract_sha256']
    op['input_schema']['properties']['path']['properties']['path']['pattern']=PATTERN
    op['input_schema']['properties']['range']={'type':'object','properties':{'offset':{'type':'integer','minimum':0,'maximum':8388608},'max_bytes':{'type':'integer','minimum':1,'maximum':65536}},'required':[],'additionalProperties':False}
    op['result_schema']['properties']['path']['pattern']=PATTERN
    op['result_schema']['properties'].update({'offset':{'type':'integer','minimum':0,'maximum':8388608},'total_size':{'type':'integer','minimum':0,'maximum':8388608},'next_offset':{'type':['integer','null'],'minimum':0,'maximum':8388608},'content_sha256':{'type':'string','pattern':'^[a-f0-9]{64}$'},'source_sha256':{'type':'string','pattern':'^[a-f0-9]{64}$'}})
    op['output_schema']=output_schema(op);op.pop('contract_sha256');op['contract_sha256']=hashlib.sha256(json.dumps(op,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
    if old==op['contract_sha256']:return
    source=(json.dumps(data,separators=(',',':'),ensure_ascii=False)+'\n').encode();file.write_bytes(source);(folder/'catalogue.ts').write_text(catalogue_loader(source));(folder/'gateway_manifest.json').write_text(json.dumps(compact_manifest(data),separators=(',',':'),ensure_ascii=False)+'\n')
    quote=lambda v:"'"+json.dumps(v,separators=(',',':')).replace("'","''")+"'::jsonb"
    sql="BEGIN;\n-- Existing inactive source operation; preserve all exposure/verification flags.\nDO $revision$ DECLARE n int;BEGIN\nUPDATE public.sandy_operation_registry SET input_schema="+quote(op['input_schema'])+",output_schema="+quote(op['output_schema'])+",error_contract=jsonb_set(error_contract,'{contract_sha256}',to_jsonb('"+op['contract_sha256']+"'::text)),updated_at=clock_timestamp() WHERE operation='github.files.content.get' AND error_contract->>'contract_sha256'='"+old+"';GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'repository_source_contract_drift';END IF;END $revision$;\nCOMMIT;\n"
    (ROOT/'supabase/migrations/20261022042000_sandy_repository_source_ranges.sql').write_text(sql)
    print(json.dumps({'operation':op['operation'],'old_contract':old,'new_contract':op['contract_sha256'],'registry_operations_added':0}))
if __name__=='__main__':revise()
