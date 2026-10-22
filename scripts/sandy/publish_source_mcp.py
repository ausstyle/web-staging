"""Publish an existing bounded text-source commit through Sandy MCP, never gh.

Normal renewable workload Auth, standing resource policy and the existing provider
engine remain mandatory. No authority, credentials or direct provider requests are
implemented here. Checkpoints refuse uncertain mutation replay. Only an exact
provider Git commit hash may advance the non-forced engineering branch.

Limitations: one parent, regular UTF-8 files <=512 KiB, <=256 changes.
Large changes use existing bounded Git blobs and an atomic tree; removals retain
the immutable parent source. Tree/blob acceptance is distinct from verified commit/ref receipts.
CI/security-file writes remain subject to the standing policy. Arbitrary binaries,
large bundles, protected branches and merges require their reviewed delivery path.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess
import uuid
from engineering_runtime import EngineeringRuntime, RuntimePreDispatchError


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
        if columns[-1] != 'D' and columns[1] not in ('100644', '100755'):
            raise ValueError('source_deletion_or_nonregular_file_not_supported')
    names = git('diff-tree', '--no-commit-id', '--name-only', '-r', '-z', commit).split(b'\0')
    for encoded in filter(None, names):
        name = encoded.decode('utf-8', errors='strict')
        if not git('ls-tree', commit, '--', name).strip():
            previous = git('ls-tree', parent, '--', name).decode().split()
            if not previous or previous[0] not in ('100644', '100755'):
                raise ValueError('nonregular_source_removal_not_supported')
            entries.append({'path': name, 'mode': previous[0], 'type': 'blob', 'sha': None})
            files.append({'path': name, 'removed': True, 'previous_blob_sha': previous[2]})
            continue
        source = git('show', commit + ':' + name)
        if len(source) > 512 * 1024:
            raise ValueError('source_file_exceeds_reviewed_text_bound')
        text = source.decode('utf-8', errors='strict')
        if any(ord(c) < 32 and c not in '\n\r\t' for c in text):
            raise ValueError('binary_source_not_supported')
        mode = git('ls-tree', commit, '--', name).decode().split()[0]
        entries.append({'path': name, 'type': 'blob', 'mode': mode, 'content': text})
        files.append({'path': name, 'bytes': len(source), 'sha256': hashlib.sha256(source).hexdigest()})
    tree_args = {'body': {'base_tree': git('rev-parse', parent + '^{tree}').decode().strip(), 'tree': entries}}
    if not entries or len(entries) > 256:
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
        input_sha256 = hashlib.sha256(json.dumps(arguments, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        prior = self.report['calls'].get(label)
        if prior:
            if prior.get('operation') != operation or prior.get('input_sha256') != input_sha256:
                raise ValueError('checkpoint_operation_or_input_mismatch')
            if prior.get('complete'):
                return prior
            if prior.get('not_dispatched') is not True:
                raise RuntimeError('uncertain_checkpoint_requires_receipt_reconciliation:' + label)
            record = prior
            rid = record['request_id']
        else:
            rid = str(uuid.uuid4())
            record = {'operation': operation, 'request_id': rid, 'complete': False,
                      'input_sha256': input_sha256}
            self.report['calls'][label] = record
        record.pop('not_dispatched', None)
        self.save()  # Persist nonce before dispatch. Never automatically replay a mutation.
        try:
            status, response = self.runtime.invoke({'jsonrpc': '2.0', 'id': rid, 'method': 'tools/call',
                'params': {'name': operation, 'arguments': {'__sandy_execution': {'request_id': rid}, 'arguments': arguments}}})
        except RuntimePreDispatchError as error:
            record['not_dispatched'] = True
            record.setdefault('pre_dispatch_errors', []).append(str(error))
            self.save()
            raise
        result = response.get('result', {})
        envelope = json.loads(result.get('content', [{}])[0].get('text', '{}'))
        body = envelope.get('result', {})
        payload = result.get('structuredContent', body)
        record.update(http_status=status, API_status=envelope.get('status'), MCP_isError=result.get('isError'),
            admission_id=payload.get('admission_id', body.get('admission_id')),
            result=payload.get('result'), error=body.get('error'), executed=body.get('executed',payload.get('executed')), execution_receipt=body.get('execution_receipt'),
            response_sha256=hashlib.sha256(json.dumps(response, sort_keys=True).encode()).hexdigest())
        self.save()
        if status != 200 or envelope.get('status') != 200 or result.get('isError') is not False:
            # This fixed gateway refusal occurs before provider admission. Reuse
            # its nonce after policy lookup recovers; every other outcome stays
            # uncertain until the durable receipt is independently reconciled.
            if (record['API_status'] == 503 and record['error'] == 'engineering_policy_unavailable'
                    and record.get('executed') is False and not record.get('admission_id')):
                record['not_dispatched'] = True
                record.setdefault('pre_dispatch_errors', []).append('engineering_policy_unavailable')
                self.save()
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
        if len(json.dumps(tree_args).encode()) > 120 * 1024 or any(f.get('bytes', 0) > 65536 for f in files):
            expected = []
            uploads = []
            for number, entry in enumerate(tree_args['body']['tree']):
                if 'content' not in entry:
                    expected.append(entry)
                    continue
                content = entry['content'].encode()
                sha = hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()
                expected.append({k: v for k, v in entry.items() if k != 'content'} | {'sha': sha})
                uploads.append((number, sha, {'body': {'encoding': 'base64', 'content': base64.b64encode(content).decode()}}))
            planned = {'body': {'base_tree': tree_args['body']['base_tree'], 'tree': expected}}
            if len(json.dumps(planned).encode()) > 120 * 1024:
                raise ValueError('bounded_tree_reference_input_required')
            for number, expected_sha, arguments in uploads:
                blob = self.call('source-blob-' + str(number), 'github.git.blobs.create', arguments)
                if blob['result']['sha'] != expected_sha:
                    raise RuntimeError('provider_source_blob_mismatch')
            tree_args = planned
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
