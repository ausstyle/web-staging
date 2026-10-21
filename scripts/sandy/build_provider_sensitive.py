"""Generate the18 private-response protocols from pinned official Discovery bytes.

No credentials, network execution, activation or registry writes. Crypto results
and access tokens are captured only in operation-bound encrypted private custody.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
PROJECT = 'elaborate-haven-511518-a5'
REGION = 'europe-west1'
ZONE = 'europe-west1-b'
OUT = ROOT / 'supabase/functions/sandy-provider-sensitive-api/provider_contracts.json'
FAMILIES = {
 'compute': 'compute.instances', 'container': 'kubernetes.clusters',
 'monitoring': 'monitoring.notification_channels', 'backupdr': 'backup.data_sources',
}
FORMATS = {'date-time','uri','uuid','date','email','ipv4','ipv6'}


def normalize(value, doc, defs, request):
    if '$ref' in value:
        name = value['$ref']
        if name not in defs:
            defs[name] = {}
            defs[name] = normalize(doc['schemas'][name], doc, defs, request)
        return {'$ref': '#/$defs/' + name}
    result = {}
    for key in ['type','enum','pattern','minimum','maximum','items','additionalProperties']:
        if key in value:
            result[key] = normalize(value[key], doc, defs, request) if isinstance(value[key], dict) else value[key]
    if result.get('type') == 'any': result.pop('type')
    if value.get('format') in FORMATS: result['format'] = value['format']
    if value.get('format') == 'google-datetime': result['format'] = 'date-time'
    if result.get('type') == 'string':
        result['maxLength'] = 87384 if request and value.get('format') == 'byte' else 1398104 if value.get('format') == 'byte' else 10000
        if value.get('format') == 'byte':
            result['pattern'] = r'^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'
        if value.get('format') in {'int64','uint64'}: result['pattern'] = '^-?[0-9]{1,20}$'
    if result.get('type') == 'array': result['maxItems'] = 1000
    if 'properties' in value:
        properties = {k:v for k,v in value['properties'].items() if not request or not v.get('readOnly') and not k.endswith('Crc32c')}
        result['properties'] = {k:normalize(v, doc, defs, request) for k,v in properties.items()}
        result['additionalProperties'] = False if request else True
        if request:
            required = [k for k,v in properties.items() if v.get('description','').startswith('Required.')]
            if required: result['required'] = required
    return result


def object_schema(properties, required=()):
    return {'type':'object','properties':properties,'required':list(required),'additionalProperties':False}


def compile_protocols(schemas: Path):
    inventory = json.loads((ROOT/'docs/sandy-api/provider-wildcard-coverage.json').read_text())
    manifest = {row['provider']:row for row in json.loads((ROOT/'docs/sandy-api/provider-schema-manifest.json').read_text())}
    rows = []
    for action in inventory['actions']:
        if action['status'] != 'specialized_sensitive_adapter_required': continue
        source = manifest['gcp-'+action['service']]
        raw = (schemas/(source['provider']+'.json')).read_bytes()
        if hashlib.sha256(raw).hexdigest() != source['sha256']: raise ValueError('Pinned provider digest mismatch')
        doc = json.loads(raw); resource = doc
        for part in action['resource'].split('.'): resource = resource['resources'][part]
        method = resource['methods'][action['method']]
        key = next(name for name,p in method['parameters'].items() if p['location']=='path' and name not in {'project','zone'})
        path = '/'+doc.get('servicePath','')+method['path']
        path = path.replace('{project}',PROJECT).replace('{zone}',ZONE)
        pattern = method['parameters'][key].get('pattern')
        if key == 'instance': pattern = '^[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?$'
        elif pattern:
            pattern = pattern.replace('projects/[^/]+', 'projects/'+PROJECT).replace('locations/[^/]+', 'locations/'+REGION)
            pattern = pattern.replace('[^/]+','[A-Za-z0-9_-]{1,200}').replace('cryptoKeys/.*','cryptoKeys/[A-Za-z0-9_-]{1,200}(?:/cryptoKeyVersions/[0-9]{1,20})?')
        else: raise ValueError('Missing resource pattern')
        request_defs = {}; response_defs = {}
        req = normalize(method.get('request', {'type':'object','properties':{}}),doc,request_defs,True)
        if request_defs: req['$defs'] = request_defs
        query = {}; query_required = []
        for name,p in method.get('parameters',{}).items():
            if p['location'] != 'query': continue
            query[name] = normalize(p,doc,{},True)
            if query[name].get('type') == 'string': query[name]['maxLength'] = 1000
            if p.get('required') or p.get('description','').startswith('Required.'): query_required.append(name)
        input_properties = {'resource': {'type':'string','minLength':1,'maxLength':1000,'pattern':pattern}}
        required = ['resource']
        if method.get('request'):
            input_properties['body'] = req
            required.append('body')
        if query: input_properties['query'] = object_schema(query,query_required)
        if query_required: required.append('query')
        response = normalize(method['response'],doc,response_defs,False)
        if response_defs: response['$defs'] = response_defs
        family = FAMILIES.get(action['service'], 'kms.crypto_key_versions' if 'cryptoKeyVersions' in action['resource'] else 'kms.crypto_keys')
        alias = re.sub(r'(?<!^)(?=[A-Z])','_',action['method']).lower()
        operation = 'gcp.'+family+'.'+alias+'.capture'
        rows.append({'operation':operation,'provider':'gcp','service':action['service'],'kind':action['method'],
          'requirement':action['requirement'],'provider_operation_id':method['id'],'source':source['source'],'source_sha256':source['sha256'],
          'method':method['httpMethod'],'host':doc['rootUrl'].rstrip('/'),'path':path,'resource_parameter':key,
          'is_mutation':method['httpMethod']!='GET','permission_scope':'infrastructure:write','requires_approval':True,'api_key_delegable':False,
          'input_schema':{**object_schema(input_properties,required),**({'$defs':request_defs} if request_defs else {})},'provider_request_schema':req,'provider_response_schema':response,
          'provider_request_crc_fields':[k for k in doc['schemas'].get(method.get('request',{}).get('$ref'),{}).get('properties',{}) if k.endswith('Crc32c')],
          'provider_response_crc_fields':[k for k in doc['schemas'].get(method['response']['$ref'],{}).get('properties',{}) if k.endswith('Crc32c')],
          'provider_response_verified_fields':[k for k in doc['schemas'].get(method['response']['$ref'],{}).get('properties',{}) if k.startswith('verified')],
        })
    if len(rows)!=18: raise ValueError('Expected18 sensitive methods')
    return sorted(rows,key=lambda r:r['operation'])


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--schemas',type=Path,required=True)
    args=parser.parse_args()
    rows=compile_protocols(args.schemas)
    OUT.write_text(json.dumps(rows,separators=(',',':'))+'\n')
    print(json.dumps({'generated_protocols':len(rows),'provider_called':False}))
