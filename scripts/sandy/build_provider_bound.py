"""Compile48 fixed-resource relationship adapters; never edits deployed catalogues."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import build_provider_operations as compiler

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'supabase/functions/sandy-provider-bound-api/provider_contracts.json'
BRANCH_ACTIONS={'v1-get-a-branch-config':'get_config','v1-update-a-branch-config':'update_config','v1-delete-a-branch':'delete',
 'v1-push-a-branch':'push','v1-merge-a-branch':'merge','v1-reset-a-branch':'reset','v1-restore-a-branch':'restore','v1-diff-a-branch':'diff'}


def close_request(schema):
    if not isinstance(schema,dict): return
    if schema.get('type')=='string': schema.setdefault('maxLength',10000)
    if schema.get('type')=='array': schema.setdefault('maxItems',100)
    if 'properties' in schema: schema.setdefault('additionalProperties',False)
    for key in ['properties','$defs']:
        for child in schema.get(key,{}).values(): close_request(child)
    for key in ['items','additionalProperties','not']:
        if isinstance(schema.get(key),dict): close_request(schema[key])
    for key in ['anyOf','oneOf','allOf']:
        for child in schema.get(key,[]): close_request(child)


def build(schemas:Path):
    inventory=json.loads((ROOT/'docs/sandy-api/provider-wildcard-coverage.json').read_text())
    manifest={r['provider']:r for r in json.loads((ROOT/'docs/sandy-api/provider-schema-manifest.json').read_text())}
    rows=[]
    for action in inventory['actions']:
        if action['status']!='additional_resource_binding_required' or action['provider']=='github':continue
        source='gcp-'+action['service'] if action['provider']=='gcp' else 'supabase'
        raw=(schemas/(source+'.json')).read_bytes()
        if hashlib.sha256(raw).hexdigest()!=manifest[source]['sha256']:raise ValueError('Pinned source digest mismatch')
        original=json.loads(raw)
        if action['provider']=='gcp':
            document,specs=compiler.discovery_document(original,[(action['service'],action['resource'],action['family'],action['requirement'],[action['method']])])
            spec=specs[0]
            read=action['http_method']=='GET' or action['method'] in {'checkPrewarmedArtifact','testIamPermissions'}
            spec.update(operation=spec['operation']+'.bound',kind='typed_projection' if read else 'mutation_metadata',semantic_read=read,
              sensitive=True,strict_metadata_projection=True)
        else:
            document=original
            entry=original['paths'][action['path']][action['method']]
            spec=compiler.route('supabase.branches.'+BRANCH_ACTIONS[action['provider_operation_id']]+'.bound','supabase',action['path'],action['http_method'],
              query=[p['name'] for p in entry.get('parameters',[]) if p.get('in')=='query'],requirement=action['requirement'],
              kind='mutation_metadata',sensitive=True)
        op=compiler.compile_route(spec,document,manifest[source])
        provider_defs=original.get('schemas',original.get('components',{}).get('schemas',{}))
        for name,definition in op['input_schema'].get('$defs',{}).items():
            original_properties=provider_defs.get(name,{}).get('properties',{})
            for field,value in list(definition.get('properties',{}).items()):
                declared=original_properties.get(field,{})
                if declared.get('readOnly') or declared.get('description','').lower().startswith(('output only','[output only]')):
                    definition['properties'].pop(field,None)
                    if field in definition.get('required',[]):definition['required'].remove(field)
        op.update(service=action.get('service','supabase'),resource_chain=action.get('resource'),method_name=action['method'],
          requirement=action['requirement'],requires_approval=True,api_key_delegable=False,api_exposed=False,ai_exposed=False,verified=False,
          relationship_guard='fresh_branch_membership' if action['provider']=='supabase' else 'fresh_bucket_project' if action['service']=='storage' else
          'verified_firewall_parent' if action['service']=='compute' else 'fixed_project_resource')
        path_props=op['input_schema']['properties'].get('path',{}).get('properties',{})
        # Discovery's nonstandard path parameter names still bind the same fixed
        # project/region. Restrict them before any request or relationship read.
        for name,schema in path_props.items():
            if schema.get('type')=='string' and schema.get('pattern','').startswith('^projects/'):
                schema['pattern']=schema['pattern'].replace('projects/[^/]+','projects/elaborate-haven-511518-a5').replace('locations/[^/]+','locations/europe-west1')
            if name=='firewallPolicy':schema.update(pattern='^[1-9][0-9]{0,19}$',maxLength=20)
            if 'bucket' in name.lower():schema.update(pattern='^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$',maxLength=222)
        # Caller filters cannot override the reviewed hierarchical resource scope.
        if action.get('service')=='compute':
            query_props=op['input_schema']['properties'].get('query',{}).get('properties',{})
            for field in ['parentId','targetResource','includeInheritedPolicies']:
                query_props.pop(field,None)
                required=op['input_schema']['properties'].get('query',{}).get('required',[])
                if field in required:required.remove(field)
        query=op['input_schema']['properties'].get('query',{});query_props=query.get('properties',{})
        for field in ['pageSize','maxResults']:
            if field in query_props:query_props[field].update(minimum=1,maximum=100)
        if 'pageToken' in query_props:
            query_props.pop('pageToken');query_props['cursor_id']={'type':'string','format':'uuid'}
            op['opaque_pagination']=True
        if action['provider']=='supabase':
            # No callback relay. A reviewed server-owned notification target is
            # a separate binding requirement, not an arbitrary caller URL.
            for definition in op['input_schema'].get('$defs',{}).values():
                definition.get('properties',{}).pop('notify_url',None)
            if action['method']=='get' and action['provider_operation_id']!='v1-diff-a-branch':
                response=compiler.Schemas(original);raw_response=entry['responses']['200']['content']['application/json']['schema']
                props=compiler.response_properties(raw_response,response)
                fields={k:response.normalize(v) for k,v in props.items() if k in {'ref','postgres_version','postgres_engine','release_channel','status','db_host','db_port'}}
                op['result_schema']=compiler.object_schema(fields,[k for k in ['ref','status'] if k in fields]);op['public_defs']=response.defs
            if action['provider_operation_id']=='v1-diff-a-branch':op['private_diff_capture']=True
        # Mutation metadata never forwards a provider URL or arbitrary body.
        if 'properties' in op['result_schema']:
            for key in ['url','notify_url','db_pass','db_user','jwt_secret','nextPageToken']:
                op['result_schema']['properties'].pop(key,None)
                if key in op['result_schema'].get('required',[]):op['result_schema']['required'].remove(key)
        close_request(op['input_schema'])
        op.pop('contract_sha256',None);op.pop('output_schema',None)
        rows.append(op)
    if len(rows)!=48 or len({r['operation'] for r in rows})!=48:raise ValueError('48 unique bound methods required')
    return sorted(rows,key=lambda r:r['operation'])


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--schemas',type=Path,required=True);args=parser.parse_args()
    rows=build(args.schemas);OUT.write_text(json.dumps(rows,separators=(',',':'))+'\n')
    print(json.dumps({'generated':len(rows),'provider_called':False}))
