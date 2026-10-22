"""Verify a real GitHub conditional-write refusal through authenticated MCP.

Only the existing owner-approved fixture is used. A stale blob SHA must produce
409, leave the file/reference unchanged, and settle a failed receipt. Checkpoints
prevent blindly replaying an uncertain provider request; no credentials are saved.
"""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.parse
import uuid
from verify_engineering_workload import Verification, POLICY


def verify(checkpoint: Path, output: Path):
    if output.exists():
        raise RuntimeError('existing_provider_conflict_checkpoint_requires_review')
    check = Verification(checkpoint, ['github'])
    assert check.state.get('complete') and check.state.get('github_file_content_restored')
    reference = 'git/ref/heads/' + POLICY['github_branch']
    endpoint = 'contents/' + POLICY['github_path'] + '?' + urllib.parse.urlencode({'ref': POLICY['github_branch']})
    before = check.github(endpoint)
    head = check.github(reference)['object']['sha']
    stale = check.state['steps']['github_write']['result']['result']['content_sha']
    assert stale != before['sha'] == check.state['original_github']['sha']
    request_id = str(uuid.uuid4())
    report = {'complete': False, 'request_id': request_id, 'operation': 'github.files.update',
        'stale_blob_sha': stale, 'current_blob_sha': before['sha'], 'personal_Controller_session_used': False}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + '\n')
    status, value = check.runtime.invoke({'jsonrpc': '2.0', 'id': request_id, 'method': 'tools/call',
        'params': {'name': 'github.files.update', 'arguments': {'__sandy_execution': {'request_id': request_id},
            'arguments': {'path': {'path': POLICY['github_path']}, 'body': {
                'branch': POLICY['github_branch'], 'sha': stale, 'content': before['content'].replace('\n', ''),
                'message': 'Verify stale SHA conditional write is refused'}}}}})
    result = value.get('result', {})
    envelope = json.loads(result.get('content', [{}])[0].get('text', '{}'))
    api = envelope.get('result', {})
    report.update(http_status=status, MCP_is_error=result.get('isError'), API_status=envelope.get('status'),
        API_error=api.get('error'), provider_http_status=api.get('provider_http_status'),
        admission_id=api.get('admission_id'), state=api.get('request_state'),
        response_sha256=hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest())
    # Persist the returned receipt before independent queries can fail.
    output.write_text(json.dumps(report, indent=2) + '\n')
    after = check.github(endpoint)
    report['file_content_unchanged'] = after['sha'] == before['sha'] and after['content'] == before['content']
    report['fixture_branch_unchanged'] = check.github(reference)['object']['sha'] == head
    receipt = []
    if report['admission_id']:
        receipt = check.runtime._sql("SELECT a.id,a.state,a.provider_http_status,j.status job_status,"
            "(SELECT count(*) FROM public.sandy_api_audit_events e WHERE e.admission_id=a.id) audit_events "
            "FROM public.sandy_api_execution_admissions a JOIN public.sandy_deployment_jobs j ON j.id=a.approval_id "
            "WHERE a.id=" + check.runtime._quote(report['admission_id']), True)
    report['independent_receipt'] = receipt
    report['complete'] = (status == 200 and result.get('isError') is True and report['API_status'] == 409
        and report['API_error'] == 'provider_conflict' and report['provider_http_status'] == 409
        and report['file_content_unchanged'] and report['fixture_branch_unchanged'] and len(receipt) == 1
        and receipt[0]['state'] == receipt[0]['job_status'] == 'failed' and receipt[0]['audit_events'] == 3)
    output.write_text(json.dumps(report, indent=2) + '\n')
    assert report['complete'], 'provider_conflict_not_propagated_or_independently_verified'
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(verify(args.checkpoint, args.output)))
