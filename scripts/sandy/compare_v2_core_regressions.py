#!/usr/bin/env python3
"""Compare full baseline and candidate suites for an isolated two-fix deployment.

Never changes tests, runtime policy, secrets, or customer traffic. Existing
Examiner failures remain failures in both reports. This is NOT production
acceptance: all new failures, changed failure reasons, and failures outside the
explicit previously observed Examiner cases block even candidate deployment.
"""
from __future__ import annotations
import argparse
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

OBSERVED_EXAMINER_FAILURES = frozenset({
    'test_v2_autonomous_api_qa.TestV2APIQA.test_exact_main_workflow_with_repo_identity',
    'test_v2_autonomous_api_qa.TestV2APIQA.test_multiturn_and_independent_repeat_verification',
    'test_v2_autonomous_api_qa.TestV2APIQA.test_workflow_short_lived_oidc_and_schedule',
    'test_v2_examiner_design.TestExaminerIntelligentDesign.test_dynamic_execution_is_scoped_and_gated',
    'test_v2_examiner_design.TestExaminerIntelligentDesign.test_model_guidance_matches_validation_requirements',
    'test_v2_examiner_design.TestExaminerIntelligentDesign.test_separate_ai_quality_judge_cannot_override_oracle',
    'test_v2_examiner_design.TestExaminerIntelligentDesign.test_workflow_requires_oidc_and_is_daily',
})
RUNTIME = Path('supabase/functions/sandy-agent-runtime/index.ts')


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def test_ids(suite: unittest.TestSuite) -> list[str]:
    result: list[str] = []
    for item in suite:
        if isinstance(item, unittest.TestSuite):
            result.extend(test_ids(item))
        else:
            result.append(item.id())
    return result


def collect(root: Path, output: Path) -> None:
    os.chdir(root)
    os.environ['GITHUB_WORKSPACE'] = str(root)
    loader = unittest.TestLoader()
    suite = loader.discover(str(root / 'scripts/sandy'), pattern='test_*.py')
    identities = test_ids(suite)
    stream = io.StringIO()
    with contextlib.redirect_stdout(stream), contextlib.redirect_stderr(stream):
        result = unittest.TextTestRunner(stream=stream, verbosity=2).run(suite)
    details = {}
    for item, text in result.failures + result.errors:
        # Normalize temporary root only, not assertions, failure content or source.
        normal = text.replace(str(root), '<TEST_ROOT>')
        details[item.id()] = {'kind': 'error' if any(item is e[0] for e in result.errors) else 'failure', 'trace_sha256': sha(normal.encode()), 'traceback': normal}
    report = {'tests_run': result.testsRun, 'test_ids': sorted(identities), 'failures': details,
              'skipped': [item.id() for item, reason in result.skipped],
              'expected_failures': [item.id() for item, text in result.expectedFailures],
              'unexpected_successes': [item.id() for item in result.unexpectedSuccesses],
              'runtime_sha256': sha((root / RUNTIME).read_bytes()), 'successful': result.wasSuccessful()}
    output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    output.with_suffix('.log').write_text(stream.getvalue(), encoding='utf-8')
    print(json.dumps({'report': output.name, 'tests_run':result.testsRun,'failures':len(details),'successful':result.wasSuccessful()}))


def compare() -> None:
    original_root = Path.cwd().resolve()
    evidence = original_root / 'artifacts/sandy-v2-core'
    manifest = json.loads((evidence / 'manifest.json').read_text())
    baseline = (evidence / 'v1-runtime.ts').read_bytes()
    candidate = (evidence / 'v2-runtime.ts').read_bytes()
    if sha(baseline) != manifest['baseline_sha256'] or sha(candidate) != manifest['candidate_sha256']:
        raise RuntimeError('Candidate or baseline artifact hash mismatch')
    if (original_root / RUNTIME).read_bytes() != baseline:
        raise RuntimeError('Repository V1 source does not match preserved baseline')
    with tempfile.TemporaryDirectory(prefix='sandy-core-regression-') as tmp:
        reports = []
        test_hashes: dict[str, str] = {}
        for name, runtime in [('baseline', baseline), ('candidate', candidate)]:
            target = Path(tmp) / name
            shutil.copytree(original_root, target, ignore=shutil.ignore_patterns('.git','node_modules','artifacts','__pycache__'))
            (target / RUNTIME).write_bytes(runtime)
            for path in sorted((target / 'scripts/sandy').glob('test_*.py')):
                digest = sha(path.read_bytes())
                if name == 'baseline':
                    test_hashes[path.name] = digest
                elif test_hashes.get(path.name) != digest:
                    raise RuntimeError('Test source changed between baseline and candidate')
            report = evidence / f'{name}-full-suite.json'
            env = dict(os.environ, GITHUB_WORKSPACE=str(target), PYTHONDONTWRITEBYTECODE='1')
            subprocess.run([sys.executable, str(target/'scripts/sandy/compare_v2_core_regressions.py'), '--collect', str(target), '--output', str(report)], cwd=target, env=env, check=True, timeout=180)
            reports.append(json.loads(report.read_text()))
        old, new = reports
        if old['test_ids'] != new['test_ids'] or old['tests_run'] < 100 or old['tests_run'] != new['tests_run']:
            raise RuntimeError('Incomplete or different test coverage')
        if old['skipped'] != new['skipped'] or old['expected_failures'] != new['expected_failures'] or new['unexpected_successes']:
            raise RuntimeError('Tests were skipped, reclassified, or unexpectedly succeeded')
        prior = old['failures']
        current = new['failures']
        novel = sorted(set(current) - set(prior))
        unexplained = sorted(set(current) - OBSERVED_EXAMINER_FAILURES)
        changed = sorted(k for k in current if k in prior and (current[k]['trace_sha256'] != prior[k]['trace_sha256'] or current[k]['kind'] != prior[k]['kind']))
        report = {'scope':'isolated two-fix candidate only; no production cutover or acceptance-gate change',
                  'tests_per_version':new['tests_run'],'baseline_failed':len(prior),'candidate_failed':len(current),
                  'candidate_passed':new['tests_run']-len(current)-len(new['skipped'])-len(new['expected_failures']),
                  'known_examiner_failures_still_open':sorted(current),'new_regressions':novel,
                  'changed_failure_reasons':changed,'unexpected_failure_scope':unexplained,
                  'all_repository_tests_passed':new['successful'],'production_ready':False,
                  'isolated_candidate_regression_check_passed':not(novel or unexplained or changed),
                  'tests_unchanged':True,'test_file_hashes':test_hashes,'source_commit':os.environ.get('GITHUB_SHA'),
                  'baseline_runtime_sha256':manifest['baseline_sha256'],'candidate_runtime_sha256':manifest['candidate_sha256']}
        (evidence / 'baseline-candidate-comparison.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
        print(json.dumps({k:v for k,v in report.items() if k!='test_file_hashes'},indent=2))
        if not report['isolated_candidate_regression_check_passed']:
            raise RuntimeError('Candidate introduces a regression or unexplained failure')
    if (original_root / RUNTIME).read_bytes() != baseline:
        raise RuntimeError('V1 source was altered')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--collect', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.collect:
        if not args.output:
            parser.error('--output is required with --collect')
        collect(args.collect.resolve(),args.output.resolve())
    else:
        compare()
