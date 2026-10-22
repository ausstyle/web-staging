"""Real negative MCP checks against the existing owner-authorized GitHub fixture.

Requires a completed verify_engineering_workload GitHub checkpoint. The normal
renewable engineering identity is used; no personal JWT or permission widening.
Only the same approved test file can be changed, including failure cleanup.
"""
import argparse
import base64
import copy
import hashlib
import json
from pathlib import Path
import urllib.parse
import uuid
from verify_engineering_workload import Verification, POLICY


def verify(checkpoint, output):
    if output.exists():
        raise RuntimeError('existing_boundary_checkpoint_requires_review')
    check = Verification(checkpoint, ['github'], True)
    assert check.state.get('complete') and check.state.get('github_file_content_restored')
    assert check.state.get('github_reference_preserved')
    report = {'complete': False, 'personal_controller_session_used': False, 'calls': []}
    original_state = copy.deepcopy(check.state)
    check.output = output.with_suffix('.recovery.json')
    check.state = {'steps': {}, 'original_github': original_state['original_github']}
    branch, path = POLICY['github_branch'], POLICY['github_path']
    ref = 'git/ref/heads/' + branch
    endpoint = 'contents/' + path + '?' + urllib.parse.urlencode({'ref': branch})
    before_head = check.github(ref)['object']['sha']
    current = check.github(endpoint)
    args = {'path': {'path': path}, 'body': {'branch': branch, 'sha': current['sha'],
        'message': 'Verify dedicated Sandy engineering workload fixture',
        'content': base64.b64encode(b'Sandy engineering fixture machine verified\n').decode()}}
    cases = []
    for name, key, value in [('wrong_branch', 'branch', 'main'), ('invalid_sha', 'sha', 'invalid-sha')]:
        candidate = copy.deepcopy(args)
        candidate['body'][key] = value
        cases.append((name, 'github.files.update', candidate, str(uuid.uuid4())))
    candidate = copy.deepcopy(args)
    candidate['path']['path'] = 'README.md'
    cases.append(('wrong_path', 'github.files.update', candidate, str(uuid.uuid4())))
    candidate = copy.deepcopy(args)
    del candidate['body']['content']
    cases.append(('missing_content', 'github.files.update', candidate, str(uuid.uuid4())))
    replay = copy.deepcopy(args)
    replay['body']['sha'] = original_state['original_github']['sha']
    cases.append(('retired_session_request_replay', 'github.files.update', replay,
                  original_state['steps']['github_write']['request_id']))
    cases.append(('outside_standing_grant', 'github.repos.get', {}, str(uuid.uuid4())))
    try:
        for name, operation, arguments, request_id in cases:
            status, value = check.runtime.invoke({'jsonrpc': '2.0', 'id': request_id, 'method': 'tools/call',
                'params': {'name': operation, 'arguments': {'__sandy_execution': {'request_id': request_id}, 'arguments': arguments}}})
            result = value.get('result', {})
            envelope = json.loads(result.get('content', [{}])[0].get('text', '{}'))
            api = envelope.get('result', {})
            row = {'case': name, 'operation': operation, 'request_id': request_id,
                'http_status': status, 'api_status': envelope.get('status'), 'error': api.get('error'),
                'executed': api.get('executed'), 'admission_id': api.get('admission_id'),
                'response_sha256': hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()}
            row['passed'] = (status == 200 and result.get('isError') is True and
                envelope.get('status') in (400, 403, 409) and not api.get('executed') and not api.get('admission_id'))
            report['calls'].append(row)
            output.write_text(json.dumps(report, indent=2) + '\n')
            assert row['passed'], 'negative_MCP_call_not_denied:' + name
            assert check.github(ref)['object']['sha'] == before_head, 'negative_call_changed_fixture_ref:' + name
        assert base64.b64decode(check.github(endpoint)['content']) == base64.b64decode(original_state['original_github']['content'])
        report.update(complete=True, fixture_reference_unchanged=True, fixture_contents_unchanged=True,
                      controller_memberships=check.runtime.public_status()['controller_memberships'])
    finally:
        # A regression in deduplication cannot leave the marker file in place.
        check.recover_github_fixture()
        report['cleanup_independently_verified'] = check.state.get('github_file_content_restored') is True
        output.write_text(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    report = verify(args.checkpoint, args.output)
    print(json.dumps({'complete': report['complete'], 'denied_calls': len(report['calls']),
                      'fixture_contents_unchanged': report.get('fixture_contents_unchanged')}))
