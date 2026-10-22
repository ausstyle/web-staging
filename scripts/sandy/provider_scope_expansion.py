"""Audit constituent provider methods against the wildcard requirements.

This inventory uses checksum-pinned official schemas, not provider discovery at
runtime. A covered family never implies that each method is implemented or tested.
No network requests, registry writes or provider calls are made by this script.
"""
from __future__ import annotations
import argparse
import hashlib
import base64
import gzip
import io
import json
from pathlib import Path
import re
from collections import Counter
import build_provider_operations as compiler

ROOT = Path(__file__).resolve().parents[2]
# Explicit resource assignments reviewed against PDF sections 4.1--5.1 and 6.
# Descendants belong to the same family unless a more specific assignment exists.
COMPUTE = {
 26:['instances','regionInstances'],30:['disks','regionDisks'],31:['images','imageFamilyViews','imageViews','machineImages'],32:['snapshots','regionSnapshots','instantSnapshots','regionInstantSnapshots','snapshotSettings','regionSnapshotSettings','instantSnapshotGroups','regionInstantSnapshotGroups'],
 34:['zoneOperations','regionOperations','globalOperations'],
 45:['instanceGroups','regionInstanceGroups','instanceGroupManagers','regionInstanceGroupManagers','instanceGroupManagerResizeRequests','regionInstanceGroupManagerResizeRequests','autoscalers','regionAutoscalers'],46:['instanceTemplates','regionInstanceTemplates'],
 47:['networks','networkAttachments','networkProfiles'],48:['subnetworks'],49:['routes'],50:['firewalls'],51:['networkFirewallPolicies','regionNetworkFirewallPolicies','firewallPolicies','securityPolicies','regionSecurityPolicies','networkEdgeSecurityServices','managedRulesets'],52:['routers'],53:['vpnTunnels','vpnGateways','targetVpnGateways','externalVpnGateways'],54:['addresses','globalAddresses'],
 57:['backendServices','regionBackendServices','backendBuckets','regionBackendBuckets','forwardingRules','globalForwardingRules','urlMaps','regionUrlMaps','targetHttpProxies','regionTargetHttpProxies','targetHttpsProxies','regionTargetHttpsProxies','targetTcpProxies','regionTargetTcpProxies','targetSslProxies','targetGrpcProxies','targetPools','networkEndpointGroups','regionNetworkEndpointGroups','globalNetworkEndpointGroups','serviceAttachments'],
 58:['sslCertificates','regionSslCertificates','sslPolicies','regionSslPolicies'],59:['healthChecks','regionHealthChecks','httpHealthChecks','httpsHealthChecks','regionCompositeHealthChecks','regionHealthCheckServices','regionHealthAggregationPolicies','regionHealthSources','regionNotificationEndpoints'],
}
EXTRA_GCP = {
 'dns':{55:['managedZones','managedZoneOperations','dnsKeys','policies','responsePolicies','outboundEndpoints'],56:['resourceRecordSets','changes','responsePolicyRules'],34:['operations']},
 'run':{60:['projects.locations.services'],61:['projects.locations.jobs'],34:['projects.locations.operations']},
 'pubsub':{70:['projects.topics','projects.subscriptions','projects.snapshots','projects.schemas']},
 'cloudtasks':{71:['projects.locations.queues']},
 'cloudkms':{73:['projects.locations.keyRings','projects.locations.ekmConnections','projects.locations.ekmConfig','projects.locations.operations']},
 'backupdr':{74:['projects.locations.backupPlans','projects.locations.backupPlanAssociations','projects.locations.backupVaults','projects.locations.dataSourceReferences','projects.locations.resourceBackupConfigs','projects.locations.managementServers','projects.locations.operations']},
}
GH_PREFIXES={
 113:['/repos/{owner}/{repo}/installation'],114:['/repos/{owner}/{repo}'],115:['/repos/{owner}/{repo}/git/refs','/repos/{owner}/{repo}/git/matching-refs'],116:['/repos/{owner}/{repo}/branches'],117:['/repos/{owner}/{repo}/contents'],118:['/repos/{owner}/{repo}/git/blobs','/repos/{owner}/{repo}/git/trees','/repos/{owner}/{repo}/git/commits'],119:['/repos/{owner}/{repo}/pulls'],120:['/repos/{owner}/{repo}/issues','/repos/{owner}/{repo}/assignees','/repos/{owner}/{repo}/comments','/repos/{owner}/{repo}/events','/repos/{owner}/{repo}/notifications','/repos/{owner}/{repo}/sub_issues'],121:['/repos/{owner}/{repo}/labels'],122:['/repos/{owner}/{repo}/milestones'],123:['/repos/{owner}/{repo}/discussions'],124:['/repos/{owner}/{repo}/tags','/repos/{owner}/{repo}/git/tags'],125:['/repos/{owner}/{repo}/releases'],126:['/orgs/{org}/packages','/users/{username}/packages'],127:['/repos/{owner}/{repo}/actions/workflows'],128:['/repos/{owner}/{repo}/actions/runs','/repos/{owner}/{repo}/actions/jobs'],129:['/repos/{owner}/{repo}/actions/artifacts'],130:['/repos/{owner}/{repo}/check-runs','/repos/{owner}/{repo}/check-suites','/repos/{owner}/{repo}/commits/{ref}/check-runs','/repos/{owner}/{repo}/commits/{ref}/check-suites'],131:['/repos/{owner}/{repo}/statuses','/repos/{owner}/{repo}/commits/{ref}/statuses','/repos/{owner}/{repo}/commits/{ref}/status'],132:['/repos/{owner}/{repo}/deployments'],133:['/repos/{owner}/{repo}/environments'],134:['/repos/{owner}/{repo}/actions/secrets'],135:['/repos/{owner}/{repo}/actions/variables','/repos/{owner}/{repo}/environments/{environment_name}/variables'],136:['/repositories/{repository_id}/environments/{environment_name}/secrets','/repos/{owner}/{repo}/environments/{environment_name}/secrets'],137:['/repos/{owner}/{repo}/hooks'],138:['/repos/{owner}/{repo}/collaborators','/repos/{owner}/{repo}/teams','/repos/{owner}/{repo}/invitations'],139:['/repos/{owner}/{repo}/rulesets','/repos/{owner}/{repo}/rules','/repos/{owner}/{repo}/rulesets/rule-suites'],140:['/orgs/{org}/audit-log','/enterprises/{enterprise}/audit-log'],141:['/repos/{owner}/{repo}/dependabot/alerts','/repos/{owner}/{repo}/secret-scanning/alerts','/repos/{owner}/{repo}/vulnerability-alerts','/repos/{owner}/{repo}/security-advisories','/repos/{owner}/{repo}/code-security-configuration'],142:['/repos/{owner}/{repo}/code-scanning'],
}
SB_PREFIXES={76:['/v1/projects/{ref}'],77:['/v1/projects/{ref}/config','/v1/projects/{ref}/postgrest'],78:['/v1/projects/{ref}/network','/v1/projects/{ref}/ssl-enforcement'],79:['/v1/projects/{ref}/custom-hostname','/v1/projects/{ref}/vanity-subdomain'],80:['/v1/projects/{ref}/branches','/v1/branches/{branch_id_or_ref}'],82:['/v1/projects/{ref}/database/migrations'],83:['/v1/projects/{ref}/functions'],84:['/v1/projects/{ref}/secrets'],85:['/v1/projects/{ref}/analytics'],87:['/v1/projects/{ref}/database/backups'],105:['/v1/projects/{ref}/storage'],104:['/v1/projects/{ref}/config/auth'],99:['/v1/projects/{ref}/config/database'],100:['/v1/projects/{ref}/database/backups/restore-point'],
}
HTTP_METHODS={'get','put','post','delete','patch','head'}
DELEGATED_GAP_REQUIREMENTS={33,75,85,110,123,126,136,140}
# These methods return credentials or sign arbitrary identity assertions and use
# the dedicated custody/identity services, never generic public provider JSON.
# Existing dedicated handlers already implement these exact provider reads.
# They must not be reintroduced under generated aliases.
DEDICATED_PROVIDER_READS={
 'v1-get-project':'supabase.projects.get',
 'v1-get-services-health':'supabase.project.health',
 'v1-list-all-branches':'supabase.branches.list',
 'v1-get-a-branch':'supabase.branches.get',
 'v1-get-network-restrictions':'supabase.network.restrictions.get',
 'v1-list-all-secrets':'supabase.functions.secrets.list',
 'v1-list-all-backups':'supabase.backups.list',
 'v1-list-all-functions':'supabase.functions.list',
 'v1-get-a-function':'supabase.functions.get',
 'v1-list-migration-history':'supabase.db.migrations.list',
}
CUSTODY_METHODS={
 'iam.projects.serviceAccounts.keys.create','iam.projects.serviceAccounts.keys.upload',
 'iam.projects.serviceAccounts.signBlob','iam.projects.serviceAccounts.signJwt',
 'secretmanager.projects.secrets.addVersion','secretmanager.projects.secrets.versions.access',
 'secretmanager.projects.secrets.rotateSecret',
}


def match_prefix(path, prefixes):
    matches=[(len(prefix),req) for req,items in prefixes.items() for prefix in items if path==prefix or path.startswith(prefix+'/') or path.startswith(prefix+'-')]
    return max(matches)[1] if matches else None


def resource_assignments():
    result={}
    for service,chain,family,req,_ in compiler.GCP_REVIEWED:result[(service,chain)]=(req,family)
    for req,chains in COMPUTE.items():
        for chain in chains:result.setdefault(('compute',chain),(req,re.sub(r'(?<!^)(?=[A-Z])','_',chain).lower()))
    for service,rows in EXTRA_GCP.items():
        for req,chains in rows.items():
            for chain in chains:result.setdefault((service,chain),(req,{'run':'cloud_run','cloudkms':'kms'}.get(service,service)+'.'+re.sub(r'(?<!^)(?=[A-Z])','_',chain.replace('projects.locations.','').replace('projects.','')).lower()))
    return result


def walk_resources(document, prefix=''):
    for name,resource in sorted(document.get('resources',{}).items()):
        chain=(prefix+'.'+name).strip('.')
        for method,entry in sorted(resource.get('methods',{}).items()):yield chain,method,entry
        yield from walk_resources(resource,chain)


def enumerate_actions(schemas:Path,manifest:list,baseline:dict,gap:list):
    sources={row['provider']:row for row in manifest}
    implemented={item['provider_operation_id']:item['operation'] for item in baseline['operations']}
    pending={item.get('provider_operation_id'):item['operation'] for item in gap if item.get('provider_operation_id')}
    actions=[];assignments=resource_assignments()
    for source_name,source in sorted(sources.items()):
        if source.get('state')!='downloaded':continue
        path=schemas/(source_name+'.json')
        if not path.exists():continue
        raw=path.read_bytes()
        if hashlib.sha256(raw).hexdigest()!=source['sha256']:raise ValueError('Pinned schema mismatch: '+source_name)
        document=json.loads(raw)
        if source_name.startswith('gcp-'):
            service=source_name[4:]
            for chain,method,entry in walk_resources(document):
                matches=[(len(parent),req,family,parent) for (svc,parent),(req,family) in assignments.items() if svc==service and (chain==parent or chain.startswith(parent+'.'))]
                if not matches:continue
                _,req,family,parent=max(matches)
                child=chain[len(parent):]
                if child and req not in set(range(45,66)) | set(range(67,75)) | {21}:continue
                family+=re.sub(r'(?<!^)(?=[A-Z])','_',child).lower()
                row={'provider':'gcp','service':service,'resource':chain,'method':method,'http_method':entry['httpMethod'],'path':'/'+document.get('servicePath','')+entry['path'],'provider_operation_id':entry['id'],'requirement':req,'family':family,'source_sha256':source['sha256']}
                if service=='compute' and chain=='instances':row['requirement']={'start':27,'stop':27,'reset':27,'suspend':27,'resume':27,'setMachineType':28,'setLabels':28,'setTags':28,'setMetadata':28,'attachDisk':29,'detachDisk':29}.get(method,req)
                if service=='cloudresourcemanager' and chain=='projects' and method in {'getIamPolicy','setIamPolicy','testIamPermissions'}:row['requirement']=17
                if method=='getSerialPortOutput':row['requirement']=33
                if entry['id'] in CUSTODY_METHODS:row.update(status='dedicated_credential_boundary',reason='Credential material/signing requires dedicated custody and identity operations; generic execution is prohibited.')
                elif method in {'fetchAccessToken','generateRandomBytes','exportTrustedKeyWrappedCryptoKeyVersion','importTrustedKeyWrappedCryptoKeyVersion','getGuestAttributes','getShieldedInstanceIdentity','getScreenshot','getVerificationCode','getJwks','getPublicKey','asymmetricDecrypt','asymmetricSign','decrypt','encrypt','decapsulate','macSign','macVerify','rawDecrypt','rawEncrypt'}:row.update(status='specialized_sensitive_adapter_required',reason='Explicit sensitive result/import semantics require a dedicated reviewed adapter.')
                elif entry.get('supportsMediaUpload') or entry.get('supportsMediaDownload') or method in {'upload','download','exportArtifact'}:row.update(status='specialized_media_adapter_required',reason='Bounded upload/download transport is not implemented by the JSON executor.')
                elif method in {'subscribe','end','getTrial','initialize'} and service=='backupdr':row.update(status='billing_authorization_required',reason='Trial/subscription provisioning is outside current purchase authorization.')
                elif not ('{project' in row['path'] or 'projects/' in row['path'] or any(name in {'name','parent','resource','topic','subscription','queue','snapshot','keyRing','cryptoKey'} and (parameter.get('pattern','').startswith('^projects/') or name in {'name','parent','resource'}) for name,parameter in entry.get('parameters',{}).items() if parameter.get('location')=='path') or service in {'cloudresourcemanager','cloudbilling','billingbudgets','oslogin'}):row.update(status='additional_resource_binding_required',reason='Provider method lacks an existing fixed project or verified server scope binding.')
                else:row['status']='candidate_json_adapter'
                if row['requirement'] in DELEGATED_GAP_REQUIREMENTS:row.update(status='separate_gap_adapter_review',reason='Separate provider-gap implementation owns this requirement.')
                if method in {'search'} or (service in {'cloudbilling','cloudresourcemanager'} and method=='list' and chain in {'billingAccounts','projects'}):row.update(status='scope_filter_adapter_required',reason='Provider-wide search/list requires explicit authorized resource filtering; fixed-resource aliases alone do not implement this provider method.')
                actions.append(row)
        elif source_name in {'github','supabase'}:
            for path,item in sorted(document['paths'].items()):
                prefixes=GH_PREFIXES if source_name=='github' else SB_PREFIXES
                req=match_prefix(path,prefixes)
                if req is None:continue
                # /repos/{owner}/{repo} alone does not make all repository APIs part
                # of the repository-lifecycle requirement.
                if source_name=='github' and req==114 and path!='/repos/{owner}/{repo}':continue
                if source_name=='supabase' and req==76 and path!='/v1/projects/{ref}' and not any(path.startswith('/v1/projects/{ref}/'+part) for part in ['pause','restore','upgrade']):continue
                for method,entry in sorted(item.items()):
                    if method not in HTTP_METHODS:continue
                    opid=entry.get('operationId',method.upper()+' '+path)
                    row={'provider':source_name,'resource':path,'method':method,'http_method':method.upper(),'path':path,'provider_operation_id':opid,'requirement':req,'source_sha256':source['sha256'],'status':'candidate_json_adapter'}
                    if req in DELEGATED_GAP_REQUIREMENTS:row.update(status='separate_gap_adapter_review',reason='Owned by the separate 35-operation provider-gap implementation track.')
                    if source_name=='supabase' and ('vanity-subdomain' in path or 'upgrade' in path):row.update(status='billing_authorization_required',reason='No purchase/upgrade authorization; preserve current plan and entitlement.')
                    if source_name=='supabase' and '{branch_id_or_ref}' in path:row.update(status='additional_resource_binding_required',reason='Branch identifier needs an independently verified relationship to the fixed project.')
                    if source_name=='github' and not path.startswith('/repos/{owner}/{repo}'):row.update(status='additional_resource_binding_required',reason='Repository/package ownership needs the dedicated fixed-identity adapter.')
                    if row['status']=='candidate_json_adapter' and not any('application/json' in r.get('content',{}) for code,r in entry.get('responses',{}).items() if code.startswith('2')) and method=='get':row.update(status='specialized_media_adapter_required',reason='Provider has a non-JSON/redirect download or undocumented success body.')
                    actions.append(row)
    for row in actions:
        key=row['provider_operation_id']
        if key in DEDICATED_PROVIDER_READS:row.update(status='implemented_existing_dedicated_handler',sandy_operation=DEDICATED_PROVIDER_READS[key],verified_by_this_audit=False)
        elif key in implemented:row.update(status='implemented_existing_595',sandy_operation=implemented[key],verified_by_this_audit=False)
        elif key in pending:row.update(status='implemented_pending_gap_release',sandy_operation=pending[key],verified_by_this_audit=False)
    return actions


def compile_expansion(schemas:Path, manifest:list, baseline_contracts:list):
    baseline={'operations':baseline_contracts}
    actions=enumerate_actions(schemas,manifest,baseline,[])
    sources={row['provider']:row for row in manifest}; documents={}; additions=[]
    existing={item['operation'] for item in baseline_contracts}
    for row in actions:
        if row['status']!='candidate_json_adapter':continue
        provider=row['provider'];source_name='gcp-'+row['service'] if provider=='gcp' else provider
        if source_name not in documents:documents[source_name]=json.loads((schemas/(source_name+'.json')).read_text())
        original=documents[source_name]
        try:
            if provider=='gcp':
                document,specs=compiler.discovery_document(original,[(row['service'],row['resource'],row['family'],row['requirement'],[row['method']])])
                spec=specs[0]
                # Newly added metadata reads are also closed until a real scoped
                # fixture verifies the exact action. HTTP GET alone is not proof.
                semantic_read=row['http_method']=='GET' or row['method'] in compiler.READ_METHODS or row['method'] in {'getHealth','getStatus','preview','listUsable','listInstances','listPeeringRoutes','getEffectiveFirewalls','getEffectiveSecurityPolicies','fetchForResourceType','fetchUsable','validate','validateMessage','getNatIpInfo','getNatMappingInfo','getRouterStatus','listBgpRoutes'}
                response=compiler.Schemas(document).resolve(spec['_provider_entry']['responses']['200']['content']['application/json']['schema'])
                empty_observation=semantic_read and response.get('type')=='object' and not response.get('properties') and not response.get('allOf') and row['method'] in {'verifyConnectivity','validate','validateMessage'}
                spec.update(semantic_read=semantic_read,kind='empty' if empty_observation else 'typed_projection' if semantic_read else 'mutation_metadata',strict_metadata_projection=True,sensitive=True)
                if row['service']=='storage':
                    # The existing executor checks one source bucket. Copies,
                    # rewrites and compositions need multi-bucket ownership
                    # validation before either source or destination is used.
                    buckets=[name for name,param in original_resource(original,row['resource'])['methods'][row['method']].get('parameters',{}).items() if param.get('location')=='path' and 'bucket' in name.lower()]
                    if buckets and buckets!=['bucket']:
                        raise ValueError('multi_bucket_ownership_adapter_required')
            else:
                document=original;entry=document['paths'][row['path']][row['method']]
                op=provider+'.'+re.sub('[^a-z0-9_.-]','_',entry['operationId'].replace('/','.').replace('-','_').lower())
                if len(op)>100:op=op[:85]+'_'+hashlib.sha256(op.encode()).hexdigest()[:14]
                spec=compiler.route(op,provider,row['path'],row['method'],query=[compiler.Schemas(document).resolve(p)['name'] for p in [*document['paths'][row['path']].get('parameters',[]),*entry.get('parameters',[])] if compiler.Schemas(document).resolve(p).get('in')=='query'],requirement=row['requirement'],kind='typed_projection' if row['method']=='get' else 'mutation_metadata',sensitive=True)
                spec['strict_metadata_projection']=True
            item=compiler.compile_route(spec,document,sources[source_name])
            if item['operation'] in existing:raise ValueError('operation_identifier_collision')
            existing.add(item['operation']); additions.append(item)
            row.update(status='implemented_expansion_source_ready',sandy_operation=item['operation'],contract_sha256=item['contract_sha256'],verified_by_this_audit=False)
        except (ValueError,KeyError,TypeError,RecursionError) as error:
            row.update(status='adapter_implementation_required',reason=str(error)[:350])
    return additions,actions


def original_resource(document,chain):
    for name in chain.split('.'):document=document['resources'][name]
    return document


def expansion_shards(contracts:list, directory:Path):
    """Bound decoded memory; dynamic imports use fixed checked-in local files.

    Source JSON remains reviewable, but is never parsed in full by the runtime.
    Each shard has an independent plaintext digest/byte count and exact contract
    membership. No remote artifact fetch or credential-bearing URL is involved.
    """
    directory.mkdir(parents=True,exist_ok=True)
    limit=1024*1024;groups={}
    for item in contracts:
        group=item.get('source_provider',item['provider'])
        groups.setdefault(group,[]).append(item)
    entries=[];operation_index={};loaders=[];written=set()
    for group,items in sorted(groups.items()):
        chunks=[];chunk=[];size=2
        for item in sorted(items,key=lambda i:i['operation']):
            item_bytes=len(json.dumps(item,separators=(',',':'),ensure_ascii=False).encode())+1
            if item_bytes>limit:raise ValueError('single_provider_contract_exceeds_shard_budget:'+item['operation'])
            if chunk and (size+item_bytes>limit or len(chunk)>=48):chunks.append(chunk);chunk=[];size=2
            chunk.append(item);size+=item_bytes
        if chunk:chunks.append(chunk)
        for number,chunk in enumerate(chunks):
            name=re.sub('[^a-z0-9-]','-',group)+f'-{number:02d}'
            raw=json.dumps(chunk,separators=(',',':'),ensure_ascii=False).encode()
            buffer=io.BytesIO()
            with gzip.GzipFile(fileobj=buffer,mode='wb',filename='',mtime=0) as zipped:zipped.write(raw)
            source='/** Generated local provider schema shard; plaintext JSON is in expansion_contracts.json. */\nexport default '+json.dumps({'packed':base64.b64encode(buffer.getvalue()).decode(),'expectedBytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()},separators=(',',':'))+';\n'
            (directory/(name+'.ts')).write_text(source)
            written.add(name+'.ts')
            loaders.append(f'  {json.dumps(name)}: () => import("./expansion_shards/{name}.ts"),')
            entries.append({'shard':name,'operations':len(chunk),'plaintext_bytes':len(raw),'source_bytes':len(source.encode()),'sha256':hashlib.sha256(raw).hexdigest()})
            for item in chunk:operation_index[item['operation']]={'shard':name,'contract_sha256':item['contract_sha256']}
    header='''/** Generated lazy schema index. No provider/network discovery occurs here. */
import { createLazyProviderCatalogue } from "./lazy_catalogue.ts";
const loaders = {
'''
    tail='''
export const expansionOperationIndex = Object.freeze(INDEX);
const catalogue = createLazyProviderCatalogue(expansionOperationIndex, loaders);
export const loadExpandedProviderOperation = catalogue.load;
export const clearExpandedProviderCatalogue = catalogue.clear;
export const expandedProviderCatalogueStats = catalogue.stats;
'''.replace('INDEX',json.dumps(operation_index,separators=(',',':')))
    (directory.parent/'expansion.ts').write_text(header+'\n'.join(loaders)+'\n};\n'+tail)
    for old in directory.glob('*.ts'):
        if old.name not in written and old.read_text().startswith('/** Generated local provider schema shard;'):
            old.unlink()
    return entries


def inventory(schemas,manifest,baseline,gap):
    _,actions=compile_expansion(schemas,manifest,baseline['operations'])
    installed_path=ROOT/'supabase/functions/sandy-provider-operation-api/expansion_contracts.json'
    installed={o['operation']:o for o in json.loads(installed_path.read_text())['operations']} if installed_path.exists() else {}
    for action in actions:
        if action['status'] in {'implemented_existing_595','implemented_existing_dedicated_handler','implemented_expansion_source_ready'}:
            action['coverage_boundary']='typed_metadata_or_acceptance_only_not_full_provider_payload_or_verified_lifecycle'
        if action['status']=='implemented_expansion_source_ready':
            current=installed.get(action['sandy_operation'])
            if not current or current['contract_sha256']!=action['contract_sha256']:
                action['status']='compiled_pending_regeneration'
        if action['status'] in {'specialized_media_adapter_required','specialized_sensitive_adapter_required','scope_filter_adapter_required','adapter_implementation_required','additional_resource_binding_required'}:
            action['implementation_missing']=True
            action['external_dependency']=('explicit_verified_resource_binding' if action['status']=='additional_resource_binding_required' else None)
    counts=Counter(a['status'] for a in actions)
    return {'schema_version':'1.0.0','source_specification':'docs/sandy-api/Sandy_Autonomous_Control_API_Specification.pdf','scope':'Constituent REST methods within explicit provider family resource assignments; SQL, guest, customer services and GraphQL use their separate catalogues. This is not an assertion of universal provider completeness.','baseline_provider_operations':len(baseline['operations']),'separate_provider_gap_operations':len(gap),'scope_boundaries':['REST JSON metadata/acceptance is narrower than full provider payload or durable lifecycle completion.','All expansion operations remain unexposed and unverified.','Media/crypto/scoped-search/relationship adapters remain explicit engineering work.','No provider business execution, customer authentication or credential activation was performed by this audit.'],'provider_methods_in_inventory':len(actions),'status_counts':dict(sorted(counts.items())),'all_161_requirements_completed':False,'runtime_verification_performed':False,'requirements':[{'requirement':req,'constituent_provider_methods':len(rows:=[a for a in actions if a['requirement']==req]),'status_counts':dict(sorted(Counter(a['status'] for a in rows).items()))} for req in sorted({a['requirement'] for a in actions})],'actions':sorted(actions,key=lambda a:(a['requirement'],a['provider'],a['provider_operation_id']))}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--schemas',type=Path,required=True);p.add_argument('--output',type=Path,default=ROOT/'docs/sandy-api/provider-wildcard-coverage.json');args=p.parse_args()
    manifest=json.loads((ROOT/'docs/sandy-api/provider-schema-manifest.json').read_text())
    baseline=json.loads((ROOT/'supabase/functions/sandy-provider-operation-api/contracts.json').read_text())
    gap_path=ROOT/'supabase/functions/sandy-provider-gap-api/gateway_manifest.json';gap=json.loads(gap_path.read_text()) if gap_path.exists() else []
    if isinstance(gap,dict):gap=gap.get('operations',[])
    result=inventory(args.schemas,manifest,baseline,gap);args.output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k not in {'actions','requirements'}}))

if __name__=='__main__':main()
