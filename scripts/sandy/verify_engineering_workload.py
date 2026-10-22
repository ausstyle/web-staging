"""Real, isolated workload -> MCP -> API -> provider acceptance checks.

Writes only the owner-authorized fixtures in engineering_identity_policy.json.
Independent provider reads validate execution; no personal Controller JWT is used.
A checkpoint prevents blindly replaying an uncertain mutation. Credentials remain
in memory and are never included in the evidence file.
"""
import argparse
import base64
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.parse
import uuid
from engineering_runtime import EngineeringRuntime, MANAGEMENT, BASE

ROOT = Path(__file__).resolve().parents[2]
POLICY = json.loads((ROOT / 'supabase/functions/sandy-operation-api/engineering_identity_policy.json').read_text())

class Verification:
    def __init__(self, output, components=None, require_github_receipts=False):
        self.runtime = EngineeringRuntime()
        self.require_github_receipts = require_github_receipts
        self.output = output
        self.components = set(components or ['github', 'migration', 'secret', 'functions'])
        self.state = json.loads(output.read_text()) if output.exists() else {'personal_controller_session_used': False, 'steps': {}}

    def save(self):
        self.output.parent.mkdir(parents=True, exist_ok=True)
        self.output.write_text(json.dumps(self.state, indent=2) + '\n')

    def call(self, name, operation, arguments):
        steps = self.state['steps']
        if name in steps:
            if steps[name].get('verified'):
                return steps[name]['result']
            raise RuntimeError('uncertain_checkpoint_requires_receipt_reconciliation:' + name)
        request_id = str(uuid.uuid4())
        steps[name] = {'operation': operation, 'request_id': request_id, 'verified': False}
        self.save()
        status, value = self.runtime.invoke({'jsonrpc': '2.0', 'id': request_id, 'method': 'tools/call',
            'params': {'name': operation, 'arguments': {'__sandy_execution': {'request_id': request_id}, 'arguments': arguments}}})
        result = value.get('result', {})
        payload = result.get('structuredContent', {})
        text = result.get('content', [{}])[0].get('text', '{}')
        envelope = json.loads(text)
        # These fixture provider results contain only artifact/resource identifiers.
        steps[name].update(http_status=status, is_error=result.get('isError'), api_status=envelope.get('status'),
            executed=payload.get('executed'), admission_id=payload.get('admission_id'),
            execution_receipt=envelope.get('result', {}).get('execution_receipt'),
            provider_http_status=payload.get('provider_http_status'), response_sha256=hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest())
        if status != 200 or result.get('isError') is not False or not 200 <= envelope.get('status', 0) < 300:
            steps[name]['error'] = envelope.get('result', {}).get('error')
            self.save()
            raise RuntimeError('workload_execution_failed:' + name)
        if getattr(self, 'require_github_receipts', False) and operation.startswith('github.'):
            receipt = steps[name]['execution_receipt']
            if not isinstance(receipt, dict) or receipt.get('admission_id') != payload.get('admission_id') or receipt.get('state') != 'succeeded' or receipt.get('effect_verified') is not True:
                self.save()
                raise RuntimeError('github_readback_receipt_not_verified:' + name)
        steps[name].update(verified=True, result=payload)
        self.save()
        print(json.dumps({'step': name, 'operation': operation, 'passed': True}), flush=True)
        return payload

    def github(self, path):
        # Use the configured CLI credential flow. Missing GH_TOKEN alone does
        # not establish that authorized GitHub credentials are unavailable.
        response = subprocess.run(['gh', 'api', 'repos/' + POLICY['repository'] + '/' + path],
                                  cwd=ROOT, capture_output=True, text=True)
        if response.returncode:
            raise RuntimeError('github_independent_readback_failed')
        return json.loads(response.stdout)

    def deploy_args(self, version):
        path = 'supabase/functions/sandy-engineering-execution-fixture/' + ('versions/v2.ts' if version == 2 else 'index.ts')
        source = subprocess.check_output(['git', 'show', '31565a8:' + path], cwd=ROOT)
        digest = hashlib.sha256(source).hexdigest()
        assert digest in POLICY['function_source_sha256']
        args = {'project_id': POLICY['project_ref'], 'slug': POLICY['function_slug'], 'name': POLICY['function_slug'],
                'entrypoint_path': 'index.ts', 'verify_jwt': True, 'files': [{'path': 'index.ts', 'content_base64': base64.b64encode(source).decode(), 'sha256': digest}]}
        manifest = {k: args[k] for k in ['project_id', 'slug', 'name', 'entrypoint_path', 'verify_jwt']}
        manifest['files'] = [{'path': 'index.ts', 'sha256': digest}]
        args['artifact_ref'] = hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        return args

    def recover_github_fixture(self):
        original = self.state.get('original_github')
        if not original or self.state.get('github_file_content_restored'):
            return
        branch, path = POLICY['github_branch'], POLICY['github_path']
        endpoint = 'contents/' + path + '?' + urllib.parse.urlencode({'ref': branch})
        current = self.github(endpoint)
        original_bytes = base64.b64decode(original['content'])
        current_bytes = base64.b64decode(current['content'])
        if current_bytes != original_bytes:
            if current_bytes != b'Sandy engineering fixture machine verified\n':
                raise RuntimeError('github_recovery_current_content_not_owned')
            strict = getattr(self, 'require_github_receipts', False)
            try:
                # Cleanup uses the same authenticated MCP write. Lack of a new
                # verification receipt cannot prevent restoring our own fixture.
                self.require_github_receipts = False
                self.call('github_failure_recovery', 'github.files.update', {'path': {'path': path}, 'body': {
                    'branch': branch, 'sha': current['sha'], 'message': 'Restore dedicated Sandy engineering test fixture',
                    'content': original['content'].replace('\n', '')}})
            finally:
                self.require_github_receipts = strict
            if base64.b64decode(self.github(endpoint)['content']) != original_bytes:
                raise RuntimeError('github_recovery_independent_readback_failed')
        self.state['github_file_content_restored'] = True
        self.state['failure_recovery_independently_verified'] = True
        self.save()

    def run(self):
        try:
            self._run()
        except Exception as error:
            self.state['complete'] = False
            self.state['failure_type'] = type(error).__name__
            if 'github' in self.components:
                try:
                    self.recover_github_fixture()
                except Exception as recovery:
                    self.state['recovery_failure_type'] = type(recovery).__name__
            self.save()
            raise

    def _run(self):
        r = self.runtime
        self.state['started_at'] = self.state.get('started_at', datetime.datetime.now(datetime.timezone.utc).isoformat())
        suffix = self.state.setdefault('migration_run_suffix', uuid.uuid4().hex)
        status, discovery = r.invoke({'jsonrpc': '2.0', 'id': 'workload-discovery', 'method': 'tools/list', 'params': {}})
        tools = discovery.get('result', {}).get('tools', [])
        optional = json.loads((ROOT / 'supabase/functions/sandy-operation-api/engineering_vm_read_policy.json').read_text())['operations']
        names = [t['name'] for t in tools]
        assert status == 200 and len(names) == len(set(names)) and set(POLICY['operations']) <= set(names) <= set(POLICY['operations'] + optional)
        assert all(t.get('inputSchema') for t in tools)
        self.state['discovery'] = {'http_status': status, 'operations': [t['name'] for t in tools], 'schemas_present': True}
        if 'github' in self.components:
            branch, path = POLICY['github_branch'], POLICY['github_path']
            contents_path = 'contents/' + path + '?' + urllib.parse.urlencode({'ref': branch})
            before = self.github(contents_path)
            if 'original_github' not in self.state:
                self.state['original_github'] = {'content': before['content'], 'sha': before['sha']}
                self.save()
            self.call('github_write', 'github.files.update', {'path': {'path': path}, 'body': {'branch': branch, 'sha': before['sha'], 'message': 'Verify dedicated Sandy engineering workload fixture', 'content': base64.b64encode(b'Sandy engineering fixture machine verified\n').decode()}})
            after = self.github(contents_path)
            if 'github_restore' not in self.state['steps']:
                assert base64.b64decode(after['content']) == b'Sandy engineering fixture machine verified\n'
            self.call('github_restore', 'github.files.update', {'path': {'path': path}, 'body': {'branch': branch, 'sha': after['sha'], 'message': 'Restore dedicated Sandy engineering test fixture', 'content': self.state['original_github']['content'].replace('\n', '')}})
            assert base64.b64decode(self.github(contents_path)['content']) == base64.b64decode(self.state['original_github']['content'])
            self.state['github_file_content_restored'] = True
            head = self.github('git/ref/heads/' + branch)['object']['sha']
            parent = self.github('git/commits/' + head)
            commit = self.call('github_commit', 'github.commit', {'body': {'tree': parent['tree']['sha'], 'parents': [head], 'message': 'Detached Sandy engineering workload verification'}})
            created = self.github('git/commits/' + commit['result']['sha'])
            assert created['tree']['sha'] == parent['tree']['sha'] and [p['sha'] for p in created['parents']] == [head]
            self.state['detached_commit_independent_readback'] = {'sha': created['sha'], 'tree': created['tree']['sha'], 'parent': head}
            self.state['github_reference_preserved'] = self.github('git/ref/heads/' + branch)['object']['sha'] == head
        if 'migration' in self.components:
            if 'migration_up' not in self.state['steps']:
                assert r._sql("SELECT to_regclass('public.sandy_mcp_execution_fixture_20261021') IS NULL restored", True) == [{'restored': True}]
            self.call('migration_up', 'supabase.db.migrations.apply', {'body': {'query': POLICY['migration_queries'][0], 'name': 'sandy_engineering_identity_fixture_up_' + suffix}})
            if 'migration_down' not in self.state['steps']:
                assert r._sql("SELECT marker FROM public.sandy_mcp_execution_fixture_20261021", True) == [{'marker': 'sandy_mcp_fixture_end_to_end_20261021'}]
            self.call('migration_down', 'supabase.db.migrations.apply', {'body': {'query': POLICY['migration_queries'][1], 'name': 'sandy_engineering_identity_fixture_down_' + suffix}})
            assert r._sql("SELECT to_regclass('public.sandy_mcp_execution_fixture_20261021') IS NULL restored", True) == [{'restored': True}]
            self.state['migration_restored'] = True
        if 'secret' in self.components:
            self.call('secret_set', 'supabase.functions.secrets.set', {'body': [{'name': POLICY['secret_name'], 'value': 'isolated-noncredential-machine-test'}]})
            if not self.state.get('secret_removed'):
                status, secrets = r._http('GET', MANAGEMENT + '/secrets', r._management)
                match = [s for s in secrets if s['name'] == POLICY['secret_name']]
                assert status == 200 and len(match) == 1 and match[0]['value'] == hashlib.sha256(b'isolated-noncredential-machine-test').hexdigest()
                self.state['secret_digest_verified'] = True
                status, _ = r._http('DELETE', MANAGEMENT + '/secrets', r._management, [POLICY['secret_name']])
                assert status in (200, 204)
                status, secrets = r._http('GET', MANAGEMENT + '/secrets', r._management)
                assert status == 200 and not any(s['name'] == POLICY['secret_name'] for s in secrets)
                self.state['secret_removed'] = True
                self.save()
        if 'functions' in self.components:
            self.call('function_v2', 'supabase.deploy_edge_function', self.deploy_args(2))
            self.call('function_restore_v1', 'supabase.deploy_edge_function', self.deploy_args(1))
        self.state['verified_components'] = sorted(self.components)
        self.state['VM_diagnostics_performed'] = False
        self.state['complete'] = True
        self.state['identity_status'] = r.public_status()
        self.save()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--components', nargs='+', choices=['github', 'migration', 'secret', 'functions'], help='Exercise affected components while reusing recorded evidence for unchanged ones')
    parser.add_argument('--require-github-receipts', action='store_true', help='Require MCP-propagated, independently settled effect verification')
    args = parser.parse_args()
    Verification(args.output, args.components, args.require_github_receipts).run()
