"""Publish an existing bounded text-source commit through Sandy MCP, never gh.

Normal renewable workload Auth, standing resource policy and the existing provider
engine remain mandatory. No authority, credentials or direct provider requests are
implemented here. Checkpoints refuse uncertain mutation replay. Only an exact
provider Git commit hash may advance the non-forced engineering branch.

Limitations: one parent, regular UTF-8 files, no deletions, <=120 KiB tree input.
CI/security-file writes remain subject to the standing policy. Arbitrary binaries,
large bundles, protected branches and merges require their reviewed delivery path.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import uuid
from engineering_runtime import EngineeringRuntime


def git(*args):
    return subprocess.check_output(['git', *args])


def source_candidate(commit, branch):
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise ValueError('immutable_commit_required')
    if not re.fullmatch(r'engineering/[A-Za-z0-9_./-]+', branch) or any(
            part in ('', '.', '..') for part in branch.split('/')):
        raise ValueError('engineering_branch_required')
    parents = git('show', '-s', '--format=%P', commit).decode().split()
    if len(parents) != 1:
        raise ValueError('single_parent_source_commit_required')
    parent = parents[0]
    tree = git('rev-parse', commit + '^{tree}').decode().strip()
    entries, files = [], []
    for line in git('diff-tree', '--no-commit-id', '--raw', '-r', '-z', commit).split(b'\0')[::2]:
        if not line:
            continue
        columns = line.decode().split()
        if columns[-1] == 'D' or columns[1] not in ('100644', '100755'):
            raise ValueError('source_deletion_or_nonregular_file_not_supported')
    names = git('diff-tree', '--no-commit-id', '--name-only', '-r', '-z', commit).split(b'\0')
    for encoded in filter(None, names):
        name = encoded.decode('utf-8', errors='strict')
        source = git('show', commit + ':' + name)
        text = source.decode('utf-8', errors='strict')
        if any(ord(c) < 32 and c not in '\n\r\t' for c in text):
            raise ValueError('binary_source_not_supported')
        mode = git('ls-tree', commit, '--', name).decode().split()[0]
        entries.append({'path': name, 'type': 'blob', 'mode': mode, 'content': text})
        files.append({'path': name, 'bytes': len(source), 'sha256': hashlib.sha256(source).hexdigest()})
    tree_args = {'body': {'base_tree': git('rev-parse', parent + '^{tree}').decode().strip(), 'tree': entries}}
    if not entries or len(json.dumps(tree_args).encode()) > 120 * 1024:
        raise ValueError('bounded_source_tree_required')
    fields = git('show', '-s', '--format=%an%n%ae%n%aI%n%cn%n%ce%n%cI', commit).decode().splitlines()
    # Preserve the exact Git message bytes. The provider readback verifier handles
    # the REST-only terminal-newline representation without changing the object.
    message = git('cat-file', 'commit', commit).split(b'\n\n', 1)[1].decode()
    commit_args = {'body': {'tree': tree, 'parents': [parent], 'message': message,
        'author': dict(zip(('name', 'email', 'date'), fields[:3])),
        'committer': dict(zip(('name', 'email', 'date'), fields[3:]))}}
    return parent, tree, tree_args, commit_args, files


class SourcePublisher:
    def __init__(self, runtime, checkpoint, commit, branch):
        self.runtime, self.checkpoint = runtime, Path(checkpoint)
        self.report = json.loads(self.checkpoint.read_text()) if self.checkpoint.exists() else {
            'source_commit': commit, 'branch': branch, 'calls': {}, 'complete': False}
        if self.report['source_commit'] != commit or self.report['branch'] != branch:
            raise ValueError('checkpoint_source_mismatch')

    def save(self):
        self.checkpoint.write_text(json.dumps(self.report, indent=2) + '\n')
        self.checkpoint.chmod(0o600)

    def call(self, label, operation, arguments):
        prior = self.report['calls'].get(label)
        if prior:
            if not prior.get('complete'):
                raise RuntimeError('uncertain_checkpoint_requires_receipt_reconciliation:' + label)
            return prior
        rid = str(uuid.uuid4())
        record = {'operation': operation, 'request_id': rid, 'complete': False,
                  'input_sha256': hashlib.sha256(json.dumps(arguments, sort_keys=True, separators=(',', ':')).encode()).hexdigest()}
        self.report['calls'][label] = record
        self.save()  # Persist nonce before dispatch. Never automatically replay a mutation.
        status, response = self.runtime.invoke({'jsonrpc': '2.0', 'id': rid, 'method': 'tools/call',
            'params': {'name': operation, 'arguments': {'__sandy_execution': {'request_id': rid}, 'arguments': arguments}}})
        result = response.get('result', {})
        envelope = json.loads(result.get('content', [{}])[0].get('text', '{}'))
        body = envelope.get('result', {})
        payload = result.get('structuredContent', body)
        record.update(http_status=status, API_status=envelope.get('status'), MCP_isError=result.get('isError'),
            admission_id=payload.get('admission_id', body.get('admission_id')),
            result=payload.get('result'), error=body.get('error'), execution_receipt=body.get('execution_receipt'),
            response_sha256=hashlib.sha256(json.dumps(response, sort_keys=True).encode()).hexdigest())
        self.save()
        if status != 200 or envelope.get('status') != 200 or result.get('isError') is not False:
            raise RuntimeError('source_publication_refused_or_uncertain:' + label)
        record['complete'] = True
        self.save()
        return record

    def publish(self):
        commit, branch = self.report['source_commit'], self.report['branch']
        parent, tree, tree_args, commit_args, files = source_candidate(commit, branch)
        before = self.call('head-before', 'github.refs.get', {'path': {'ref': 'heads/' + branch}})
        if before['result']['object']['sha'] != parent:
            raise RuntimeError('source_parent_not_current_remote_head')
        created = self.call('source-tree', 'github.git.trees.create', tree_args)
        if created['result']['sha'] != tree:
            raise RuntimeError('provider_source_tree_mismatch')
        read = self.call('verify-tree', 'github.git.trees.get', {'path': {'tree_sha': tree}})
        if read['result']['sha'] != tree:
            raise RuntimeError('provider_tree_readback_mismatch')
        created = self.call('source-commit', 'github.git.commits.create', commit_args)
        if created['result']['sha'] != commit or created.get('execution_receipt', {}).get('effect_verified') is not True:
            raise RuntimeError('provider_commit_or_verified_receipt_mismatch')
        update = self.call('advance-pr-branch', 'github.refs.update', {'path': {'ref': 'heads/' + branch}, 'body': {'sha': commit, 'force': False}})
        if update.get('execution_receipt', {}).get('effect_verified') is not True:
            raise RuntimeError('provider_ref_verification_required')
        observed = self.call('head-after', 'github.refs.get', {'path': {'ref': 'heads/' + branch}})
        if observed['result']['object']['sha'] != commit:
            raise RuntimeError('source_branch_readback_mismatch')
        self.report.update(complete=True, exact_git_source_commit_published=True, force_push_used=False,
            source_files=files, expected_tree_sha=tree, parent_commit=parent,
            tree_acceptance_has_independent_readback_not_a_durable_effect_receipt=True)
        self.save()
        return {'source_commit': commit, 'branch': branch, 'source_files': len(files),
                'exact_commit_published': True, 'commit_and_ref_receipts_verified': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--branch', required=True)
    parser.add_argument('--checkpoint', required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(SourcePublisher(EngineeringRuntime(), args.checkpoint, args.commit, args.branch).publish()))
