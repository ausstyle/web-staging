"""Execute the actual JS module rather than shadowing its logic in Python."""
import json
from pathlib import Path
import subprocess
import unittest

MODULE=(Path(__file__).resolve().parents[2] /
        "supabase/functions/sandy-feature-discovery/risk-policy.js")

class SensitiveFeatureRiskTests(unittest.TestCase):
    def evaluate(self, risk, *description):
        code=("import {conservativeRisk} from "+json.dumps(MODULE.as_uri())+
              "; process.stdout.write(conservativeRisk("+",".join(map(json.dumps,(risk,*description)))+"));")
        return subprocess.run(["node","--input-type=module","-e",code],check=True,
                              capture_output=True,text=True).stdout

    def test_auth_permissions_cannot_be_low(self):
        for s in ["GitHub OIDC claim rejection logging","OAuth permission scoping",
                  "JWT token validation","Customer data access control","Payment payouts"]:
            with self.subTest(s=s):
                self.assertEqual(self.evaluate("low",s),"high")

    def test_unknown_defaults_high(self):
        self.assertEqual(self.evaluate("unknown","ordinary user interface"),"high")

    def test_ordinary_reversible_ui_stays_low(self):
        self.assertEqual(self.evaluate("low","Make task category dropdown easier to scan"),"low")

    def test_high_is_never_downgraded(self):
        self.assertEqual(self.evaluate("high","Add headings to documentation"),"high")

if __name__=="__main__":
    unittest.main()
