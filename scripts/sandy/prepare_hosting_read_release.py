#!/usr/bin/env python3
"""Read-only, fixed-source Hosting read artifact preparation. No deploy action.

Preserve the captured Runtime gateway entry; apply only three exact scope-argument
edits. No binding, grant, exposure, migration or provider operation is executed.
"""
import argparse
import base64
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
from release_gcp_admin_read import Installer
from release_web_canary import Blocked, original_sources
ROOT=Path(__file__).resolve().parents[2]
SOURCE='4be0ba5950d110d6cb0bbd8434f9ddbf63e7b3b3'
PROVIDER='sandy-provider-operation-api'
GATEWAY='sandy-operation-api'
HELPER=PROVIDER+'/cloud_run_read_region.ts'
MIGRATION='supabase/migrations/20261024002500_sandy_cloud_run_region_contracts.sql'
BASELINES={
 PROVIDER:(31,'17f8d544c0ebe5df2aa31b411074f5285aed6739c4128c8e56eda99ec9e081df',57),
 GATEWAY:(63,'3cb377480b0fe8f236a60fd50ecf45620b80204e8c4c52ca8473a83066459b82',128),
}
COMMON=[PROVIDER+'/configured_scopes.ts',PROVIDER+'/gateway.ts',PROVIDER+'/gateway_manifest.json']
REPLACEMENTS={PROVIDER:[PROVIDER+'/index.ts',PROVIDER+'/catalogue.ts',*COMMON],GATEWAY:COMMON}
PATCHES=[
 ('function providerExecutionScope(operation,config){return providerExpansionOperations[operation]?expandedProviderExecutionScope(operation,config):baselineProviderExecutionScope(operation,config)}',
  'function providerExecutionScope(operation,config,args={}){return providerExpansionOperations[operation]?expandedProviderExecutionScope(operation,config):baselineProviderExecutionScope(operation,config,args)}'),
 ('providerExecutionScope(operation2,dependencies.providerConfig)',
  'providerExecutionScope(operation2,dependencies.providerConfig,args)'),
 ('providerExecutionScope(operation,dependencies.providerConfig)',
  'providerExecutionScope(operation,dependencies.providerConfig,isObject(body.arguments)?body.arguments:{})'),
]
def sha(value):return hashlib.sha256(value).hexdigest()
def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def source_file(path):return subprocess.check_output(['git','show',SOURCE+':'+path],cwd=ROOT)
def patch_gateway(before):
    try: text=before.decode('utf-8')
    except UnicodeDecodeError:raise Blocked('gateway_source_invalid_utf8') from None
    after=text
    for old,new in PATCHES:
        if after.count(old)!=1 or new in after:raise Blocked('gateway_scope_patch_baseline_changed')
        after=after.replace(old,new)
    restored=after
    for old,new in reversed(PATCHES):
        if restored.count(new)!=1:raise Blocked('gateway_scope_patch_ambiguous')
        restored=restored.replace(new,old)
    if restored!=text:raise Blocked('gateway_unrelated_bytes_changed')
    return after.encode()
def build_candidate(target,before,reviewed):
    if target not in REPLACEMENTS or HELPER in before:raise Blocked('candidate_target_or_baseline_changed')
    required=set(REPLACEMENTS[target])|{HELPER}
    if not required<=reviewed.keys() or not set(REPLACEMENTS[target])<=before.keys():raise Blocked('candidate_source_missing')
    after=dict(before)
    for name in required:after[name]=reviewed[name]
    if target==GATEWAY:
        if GATEWAY+'/index.ts' not in before:raise Blocked('gateway_entry_missing')
        after[GATEWAY+'/index.ts']=patch_gateway(before[GATEWAY+'/index.ts'])
    allowed=required|({GATEWAY+'/index.ts'} if target==GATEWAY else set())
    if any(after.get(name)!=value for name,value in before.items() if name not in allowed):raise Blocked('unrelated_module_changed')
    return after

def prepare(metadata,bundle,reviewed):
    target=metadata.get('slug')
    if target not in BASELINES:raise Blocked('function_target_denied')
    version,digest,count=BASELINES[target]
    if metadata.get('version')!=version or metadata.get('status')!='ACTIVE' or metadata.get('verify_jwt') is not True or sha(bundle)!=digest:
        raise Blocked('captured_function_baseline_changed_reconcile_no_retry')
    if metadata.get('import_map') or metadata.get('import_map_path'):raise Blocked('import_map_requires_separate_preserving_review')
    before=original_sources(bundle)
    if len(before)!=count:raise Blocked('captured_module_count_changed')
    after=build_candidate(target,before,reviewed)
    record={'expected_prior_version':version,'verify_jwt':True,'prior_bundle_sha256':digest,
      'before_files':{n:sha(v) for n,v in sorted(before.items())},'after_files':{n:sha(v) for n,v in sorted(after.items())},
      'changed_modules':[n for n in sorted(after) if before.get(n)!=after[n]],'new_modules':[HELPER]}
    return record,after

def assert_stable_metadata(before,after):
    fields=('slug','version','status','verify_jwt','import_map','import_map_path')
    if any(before.get(k)!=after.get(k) for k in fields):
        raise Blocked('concurrent_release_during_capture_reconcile_no_retry')

def private_write(path,value):
    path.write_bytes(value);path.chmod(0o600)
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',type=Path,required=True);args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True,mode=0o700);args.out.chmod(0o700)
    reviewed={name:source_file('supabase/functions/'+name) for name in set(sum(REPLACEMENTS.values(),[]))|{HELPER}}
    installer=Installer(args.out)
    manifest={'kind':'hosting-regional-read-source-preserving-candidate-v1','source_commit':SOURCE,
      'preparation_script_sha256':sha(Path(__file__).read_bytes()),'project_ref':'zmqlyygzqoidkcwdysok','functions':{},
      'gateway_transformation':'Three exact argument-flow edits, reversible to original bytes; repository gateway entry is never uploaded.',
      'configuration_installed':False,'exposure_changed':False,'grant_changed':False,'deployment_performed':False,
      'excludes':'Blob settlement migration/modules; Storage exposure; regional binding installation; DNS, IAM, credentials and provider writes',
      'rollback':'Restore captured module sets and prior two contract records only while the deployed candidate matches; preserve JWT and historical evidence and refuse to overwrite a later release.'}
    for target in BASELINES:
        metadata=json.loads(installer.api('GET','/functions/'+target));bundle=installer.api('GET','/functions/'+target+'/body')
        assert_stable_metadata(metadata,json.loads(installer.api('GET','/functions/'+target)))
        record,after=prepare(metadata,bundle,reviewed);manifest['functions'][target]=record
        private_write(args.out/(target+'.prior.bundle'),bundle)
        private_write(args.out/(target+'.metadata.json'),canonical(metadata))
        archive={n:base64.b64encode(v).decode() for n,v in sorted(after.items())}
        private_write(args.out/(target+'.candidate.json.gz'),gzip.compress(canonical(archive),mtime=0))
    migration=source_file(MIGRATION);private_write(args.out/'migration.sql',migration)
    baseline=installer.sql("SELECT operation,input_schema,error_contract FROM public.sandy_operation_registry WHERE operation IN ('gcp.cloud_run.services.list','gcp.cloud_run.services.get') ORDER BY operation",True)
    old={'gcp.cloud_run.services.list':'ad8434eb282fa18f82550223acd62a633daad0072af1dd8a5d10a79232dbe7a2','gcp.cloud_run.services.get':'29606689e560dd6bf4e6b2fb056686de44497fa61778a394074d9d25b26a5f39'}
    if len(baseline)!=2 or any(row['error_contract'].get('contract_sha256')!=old.get(row['operation']) for row in baseline):raise Blocked('contract_baseline_changed_reconcile_no_retry')
    private_write(args.out/'prior-contract-records.json',canonical(baseline))
    manifest['database']={'migration':MIGRATION,'migration_sha256':sha(migration),'prior_contract_records_sha256':sha(canonical(baseline)),'prior_contract_hashes':old}
    private_write(args.out/'manifest.json',canonical(manifest))
    print(json.dumps({'source_commit':SOURCE,'manifest_sha256':sha(canonical(manifest)),
      'targets':{k:{'version':v['expected_prior_version'],'changed_modules':v['changed_modules']} for k,v in manifest['functions'].items()},
      'deployment_performed':False,'configuration_installed':False}))
if __name__=='__main__':main()
