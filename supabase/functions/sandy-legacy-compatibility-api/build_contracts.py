"""Reviewable, deterministic legacy IDs over the existing fixed-provider engine."""
import base64, copy, gzip, hashlib, json, pathlib, re
HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
def canonical(v): return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
def digest(v): return hashlib.sha256(canonical(v).encode()).hexdigest()
def strict(schema):
    if isinstance(schema, list): return [strict(x) for x in schema]
    if not isinstance(schema, dict): return schema
    v = {k: strict(x) for k,x in schema.items()}
    if v.get("type") == "object" or "properties" in v:
        v["additionalProperties"] = False
    if v.get("type") == "string":
        v.setdefault("maxLength", 10000)
    if v.get("type") == "array": v.setdefault("maxItems", 64)
    return v
text=(ROOT/'supabase/functions/sandy-provider-operation-api/catalogue.ts').read_text()
payload=re.search(r'const catalogue = await decodeProviderCatalogue\("([^"]+)"',text).group(1)
source=json.loads(gzip.decompress(base64.b64decode(payload)))
ops={o['operation']:o for o in source['operations']}
aliases={'github.read':'github.files.content.get','github.update_file':'github.files.upsert','github.commit':'github.git.commits.create','github.merge':'github.pull_requests.merge','supabase.apply_migration':'supabase.db.migrations.apply'}
records=[]
sha={'type':'string','pattern':'^[a-f0-9]{40}$','minLength':40,'maxLength':40}
for alias,target in aliases.items():
    o=copy.deepcopy(ops[target]);o.pop('contract_sha256',None)
    o.update(operation=alias,canonical_target=target,handler='sandy-legacy-compatibility-api',requires_grant=True,requires_approval=True,requires_real_user_session=True,api_key_delegable=False,owner_only=True,sensitive=True,api_exposed=False,requires_cost_approval=False)
    o['permission_scope']='database:deploy' if alias.startswith('supabase.') else 'engineering:write' if o['is_mutation'] else 'engineering:read'
    o['input_schema']=strict(o['input_schema'])
    if alias=='github.update_file':
        body=o['input_schema']['properties']['body'];body['required']+=['sha','branch'];body['properties']['sha']=sha;body['properties']['content'].update(minLength=4,maxLength=87384,pattern='^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$')
    if alias=='github.commit':
        body=o['input_schema']['properties']['body'];body['required']+=['parents'];body['properties']['parents'].update(minItems=1,maxItems=8,items=sha);body['properties']['tree']=sha
    if alias=='github.merge':
        o['kind']='github_merge'
        body=o['input_schema']['properties']['body'];body['type']='object';body['required']=['sha','merge_method'];body['properties']['sha']=sha;o['input_schema']['required']+=['body'];o['input_schema']['properties']['path']['properties']['pull_number'].update(minimum=1,maximum=2147483647)
    if alias=='supabase.apply_migration':
        props=o['input_schema']['properties'];props.update(project_id={'const':'zmqlyygzqoidkcwdysok'},migration_ref={'type':'string','pattern':'^[a-f0-9]{64}$','minLength':64,'maxLength':64})
        o['input_schema']['required']+=['project_id','migration_ref']
        body=o['input_schema']['$defs']['V1CreateMigrationBody'];body['properties']['query']['maxLength']=100000
        body['properties']['name'].update(minLength=1,maxLength=128,pattern='^[A-Za-z0-9_-]+$');body['required']+=['name'];body['properties'].pop('rollback',None)
    o['output_schema']['properties']['operation']={'const':alias}
    o['contract_sha256']=digest(o);records.append(o)
(HERE/'provider_contracts.json').write_text(json.dumps(records,indent=2)+'\n')
(HERE/'provider_gateway_manifest.json').write_text(json.dumps({'operations':[{k:o[k] for k in ['operation','provider','canonical_target','handler','permission_scope','is_mutation','requires_grant','sensitive','contract_sha256','input_schema','output_schema']} for o in records]},indent=2)+'\n')
print(json.dumps({'operations':len(records),'source_catalogue_sha256':hashlib.sha256(text.encode()).hexdigest()}))
