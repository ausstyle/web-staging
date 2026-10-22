import json
from pathlib import Path
import tempfile
import unittest
from publish_source_mcp import SourcePublisher


class UncertainRuntime:
    calls = 0
    def invoke(self, body):
        self.calls += 1
        raise TimeoutError('provider outcome not known')


class SourcePublicationTests(unittest.TestCase):
    def test_unknown_mutation_checkpoint_never_replays_even_with_fresh_runtime(self):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / 'checkpoint.json'
            runtime = UncertainRuntime()
            publisher = SourcePublisher(runtime, file, 'a' * 40, 'engineering/test')
            with self.assertRaises(TimeoutError):
                publisher.call('source-tree', 'github.git.trees.create', {'body': {'tree': []}})
            saved = json.loads(file.read_text())
            self.assertTrue(saved['calls']['source-tree']['request_id'])
            self.assertFalse(saved['calls']['source-tree']['complete'])
            with self.assertRaisesRegex(RuntimeError, 'requires_receipt_reconciliation'):
                SourcePublisher(runtime, file, 'a' * 40, 'engineering/test').call(
                    'source-tree', 'github.git.trees.create', {'body': {'tree': []}})
            self.assertEqual(runtime.calls, 1)
            with self.assertRaisesRegex(ValueError, 'checkpoint_source_mismatch'):
                SourcePublisher(runtime, file, 'b' * 40, 'engineering/test')

    def test_caller_cannot_turn_provider_acceptance_into_a_verified_commit(self):
        class AcceptedRuntime:
            def invoke(self, body):
                return 200, {'result': {'isError': False, 'content': [{'text': json.dumps({
                    'status': 200, 'result': {'executed': True,
                    'execution_receipt': {'state': 'accepted', 'effect_verified': False},
                    'result': {'sha': 'a' * 40}}})}]}}
        with tempfile.TemporaryDirectory() as folder:
            publisher = SourcePublisher(AcceptedRuntime(), Path(folder) / 'checkpoint.json',
                                        'a' * 40, 'engineering/test')
            record = publisher.call('source-commit', 'github.git.commits.create', {'body': {}})
            self.assertTrue(record['complete'])
            self.assertFalse(record['execution_receipt']['effect_verified'])
