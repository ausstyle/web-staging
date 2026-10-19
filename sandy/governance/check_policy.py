import json
from pathlib import Path

root = Path(__file__).parent
policy = (root / "CONSTITUTION.md").read_text()
data = json.loads((root / "regressions.json").read_text())
assert data["schema_version"] == 1
cases = data["cases"]
assert cases and len({c["id"] for c in cases}) == len(cases)
for case in cases:
    assert case["id"] in policy, case["id"]
    assert case["scenario"] and case["expected"]
    assert case["status"] in {"pending_live_test", "not_implemented", "verified"}
print(f"Sandy governance integrity passed: {len(cases)} regression specifications")
