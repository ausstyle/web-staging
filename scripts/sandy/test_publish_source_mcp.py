import json
from pathlib import Path
import tempfile
import subprocess
import unittest
from publish_source_mcp import SourcePublisher, source_candidate


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

    def test_source_candidate_preserves_git_message_bytes_including_final_newline(self):
        with tempfile.TemporaryDirectory() as folder:
            def git(*args):
                return subprocess.check_output(["git", "-C", folder, *args])
            git("init", "-q")
            git("config", "user.name", "Source delivery test")
            git("config", "user.email", "source-test@example.invalid")
            file = Path(folder) / "source.txt"
            file.write_text("baseline\n")
            git("add", "source.txt")
            git("commit", "-qm", "baseline")
            file.write_text("reviewed source\n")
            git("commit", "-qam", "preserve exact source message")
            commit = git("rev-parse", "HEAD").decode().strip()
            from unittest.mock import patch
            import publish_source_mcp
            with patch.object(publish_source_mcp, "git", side_effect=git):
                _, _, _, arguments, files = source_candidate(commit, "engineering/source-test")
            expected = git("cat-file", "commit", commit).split(b"\n\n", 1)[1].decode()
            self.assertTrue(expected.endswith("\n"))
            self.assertEqual(arguments["body"]["message"], expected)
            self.assertEqual(files[0]["bytes"], len("reviewed source\n"))
