import copy,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import verify_runtime_slice_sources as s
import release_runtime_slice as release

class SourceCompatibilityTests(unittest.TestCase):
 def test_only_exact_reviewed_voice_upgrade_can_validate_immutable_historical_source(self):
  module='sandy-voice-account-context/index.ts';old=b'reviewed historical source';new=b'reviewed new source'
  upgrade={'kind':'source-only-normal-customer-voice-context-v1','historical_source_commit':'a'*40,'functions':{'sandy-voice-account-context':{'before_files':{module:s.digest(old)},'candidate_files':{module:s.digest(new)}}}}
  m={'function':'sandy-voice-account-context','version':20}
  with tempfile.TemporaryDirectory()as directory:
   root=Path(directory);path=root/'supabase/functions'/module;path.parent.mkdir(parents=True);path.write_bytes(new);manifest=root/'upgrade.json';manifest.write_text(json.dumps(upgrade))
   with patch.object(s,'ROOT',root),patch.object(s,'UPGRADE',manifest),patch.object(s,'git_prior_source',return_value=old)as prior:
    self.assertEqual(s.source_for_ci(m,module,s.digest(old)),old);prior.assert_called_once_with('a'*40,module)
    for changed in [{**m,'function':'sandy-agent-runtime-v4'},{**m,'version':21}]:
     with self.assertRaises(s.Blocked):s.source_for_ci(changed,module,s.digest(old))
    for change in [{'historical_source_commit':'main'},{'kind':'unreviewed'},{'functions':{}}]:
     manifest.write_text(json.dumps({**upgrade,**change}))
     with self.assertRaises(s.Blocked):s.source_for_ci(m,module,s.digest(old))
    manifest.write_text(json.dumps(upgrade));path.write_bytes(b'unreviewed later edit')
    with self.assertRaises(s.Blocked):s.source_for_ci(m,module,s.digest(old))
 def test_validation_checkout_contains_reviewed_ancestor_objects(self):
  text=(s.ROOT/".github/workflows/sandy-runtime-slice-release.yml").read_text()
  validation=text.split("  validate-runtime-slices:",1)[1].split("  release:",1)[0]
  self.assertIn("- uses: actions/checkout@v4\n        with:\n          fetch-depth: 0",validation)
 def test_historical_receipt_is_not_a_deployment_source_fallback(self):
  # The deployment path intentionally still refuses changed current bytes.
  # CI compatibility is not imported or consulted by candidate construction.
  source=Path(release.__file__).read_text()
  self.assertNotIn('source_for_ci',source)
  self.assertIn("raise Blocked('replacement_digest_changed')",source)
if __name__=='__main__':unittest.main()
