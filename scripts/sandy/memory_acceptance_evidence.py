"""Read immutable protected-run evidence; never trust workload proof metadata."""
import hashlib
import io
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from release_web_canary import Blocked,NoRedirect

REPO='ausstyle/web-staging'
WORKFLOW='.github/workflows/sandy-memory-private-correction.yml'
REQUIRED={
 'actual_MCP_correction_receipt','independent_atomic_provider_receipt',
 'independent_original_action_base_row_readback','same_key_replay_no_second_effect',
 'same_key_changed_arguments_denied','other_normal_fixture_cannot_use_readiness',
 'out_of_scope_fact_denied','actual_MCP_reject','independent_reject_receipt',
 'actual_MCP_unchanged','independent_unchanged_receipt','bounded_mutation_budget_enforced',
 'revocation_blocks_even_successful_key_replay','catalogue_stays_globally_closed_and_unverified',
 'protected_readiness_independent_source_event','classification_repair_independently_installed',
}


def fetch_run_evidence(run_id,token=None,opener=None):
    if not re.fullmatch('[1-9][0-9]{5,18}',str(run_id)):raise Blocked('exact_acceptance_run_required')
    token=token or os.environ['GH_TOKEN'];opener=opener or urllib.request.build_opener(NoRedirect())
    def get(path,archive=False):
        req=urllib.request.Request('https://api.github.com/repos/'+REPO+path,headers={'authorization':'Bearer '+token,'accept':'application/vnd.github+json','x-github-api-version':'2022-11-28'})
        try:response=opener.open(req,timeout=90)
        except urllib.error.HTTPError as error:
            if not archive or error.code!=302:raise Blocked('protected_GitHub_evidence_http_'+str(error.code)) from None
            location=error.headers.get('location','');parsed=urllib.parse.urlsplit(location)
            if parsed.scheme!='https' or parsed.username or parsed.password or not parsed.hostname or not (parsed.hostname.endswith('.actions.githubusercontent.com') or parsed.hostname.endswith('.blob.core.windows.net')):raise Blocked('untrusted_GitHub_artifact_location')
            # Presigned provider URL receives NO GitHub/Management/customer credential.
            try:response=opener.open(urllib.request.Request(location),timeout=90)
            except urllib.error.HTTPError as provider_error:raise Blocked('protected_GitHub_artifact_http_'+str(provider_error.code)) from None
        with response:raw=response.read(64*1024*1024+1)
        if len(raw)>64*1024*1024:raise Blocked('GitHub_evidence_size_limit')
        return raw
    run=json.loads(get('/actions/runs/'+str(run_id)))
    if (run.get('status')!='completed' or run.get('conclusion')!='success' or run.get('event')!='workflow_dispatch'
        or run.get('head_branch')!='main' or run.get('path')!=WORKFLOW
        or run.get('repository',{}).get('full_name')!=REPO
        or not re.fullmatch('[a-f0-9]{40}',run.get('head_sha',''))):raise Blocked('successful_protected_main_acceptance_required')
    artifacts=json.loads(get('/actions/runs/'+str(run_id)+'/artifacts?per_page=100')).get('artifacts',[])
    matches=[a for a in artifacts if a.get('name')=='memory-correction-custody-'+str(run_id) and a.get('expired') is False and isinstance(a.get('id'),int)]
    if len(matches)!=1:raise Blocked('unique_unexpired_acceptance_artifact_required')
    archive=get('/actions/artifacts/'+str(matches[0]['id'])+'/zip',True)
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        entries=[i for i in z.infolist() if i.filename=='normal-customer-MCP.json']
        if len(entries)!=1 or entries[0].file_size>2_000_000:raise Blocked('bounded_normal_customer_report_required')
        raw=z.read(entries[0])
    report=json.loads(raw)
    if report.get('source_commit')!=run['head_sha']:raise Blocked('acceptance_artifact_source_mismatch')
    validate_report(report)
    return report,{'run_id':int(run_id),'run_source_commit':run['head_sha'],'artifact_id':matches[0]['id'],'artifact_archive_sha256':hashlib.sha256(archive).hexdigest(),'report_sha256':hashlib.sha256(raw).hexdigest(),'workflow':WORKFLOW}


def validate_report(report):
    checks={c.get('name') for c in report.get('checks',[]) if c.get('passed') is True}
    cleanup=report.get('cleanup',{})
    if (report.get('complete') is not True or report.get('kind')!='private_source_attested_normal_customer_MCP'
        or not REQUIRED<=checks or any(c.get('passed') is not True for c in report.get('checks',[]))
        or cleanup.get('complete') is not True or cleanup.get('sessions')!=0 or cleanup.get('portal_accounts')!=0
        or cleanup.get('banned_fixtures')!=2 or cleanup.get('immutable_receipts_and_audit_preserved') is not True
        or report.get('readiness_retired') is not True or report.get('service_key_as_customer') is not False
        or report.get('Owner_authority_claimed') is not False or report.get('global_exposure_changed') is not False
        or len(report.get('verified_mutation_receipts',[]))!=3):raise Blocked('complete_independent_private_MCP_proof_required')
    calls=report.get('calls',[])
    if (not calls or any(c.get('operation')!='memory.fact_correct' or not re.fullmatch('[a-f0-9]{64}',c.get('response_sha256','')) for c in calls)
        or not any(c.get('api_status')==200 and c.get('executed') is True for c in calls)
        or not any(c.get('api_status')==403 and c.get('is_error') is True for c in calls)
        or not any(c.get('api_status')==409 and c.get('is_error') is True for c in calls)):
        raise Blocked('actual_MCP_success_denial_replay_evidence_required')
