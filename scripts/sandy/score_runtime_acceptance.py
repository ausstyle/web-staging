#!/usr/bin/env python3
"""Score independent customer outcomes; mocks/unrun cases never establish readiness."""
from __future__ import annotations
import argparse
import json
from pathlib import Path

COHORT = Path(__file__).resolve().parents[2] / "docs/sandy-engineering/evaluations/p0-cohort-v1.json"

def score(cohort: dict, results: list[dict]) -> dict:
    expected = {case["case_id"]: case for case in cohort["cases"]}
    seen: set[str] = set()
    adequate = correct_tools = routine_tools = supported = citations = 0
    false_completions = 0
    critical_failures: list[str] = []
    invalid: list[str] = []
    valid: set[str] = set()
    for result in results:
        case_id = result.get("case_id")
        if not isinstance(case_id, str) or case_id not in expected or case_id in seen:
            invalid.append("unknown_or_duplicate_case")
            continue
        seen.add(case_id)
        case = expected[case_id]
        evidence = result.get("evidence", {})
        labels = result.get("independent_labels", {})
        if not isinstance(evidence, dict) or not isinstance(labels, dict):
            invalid.append(case_id)
            continue
        actual = evidence.get("test_class") in {"production_canary", "staging_provider", "customer_acceptance"}
        linked = all(isinstance(evidence.get(key), str) and evidence[key].strip() for key in case["required_evidence"])
        reviewed = isinstance(labels.get("reviewer"), str) and bool(labels["reviewer"].strip())
        counts = [labels.get("citation_claims"), labels.get("supported_citations")]
        if not actual or not linked or not reviewed or any(type(n) is not int or n < 0 for n in counts) or counts[1] > counts[0] or any(
            type(labels.get(key)) is not bool for key in ["adequate", "critical_pass", "false_critical_completion", "routine_tool_case", "correct_routine_tool"]
        ):
            invalid.append(case_id)
            continue
        if "routine_tool_case" in case and labels["routine_tool_case"] != case["routine_tool_case"]:
            invalid.append(case_id)
            continue
        valid.add(case_id)
        adequate += labels["adequate"]
        if labels["routine_tool_case"]:
            routine_tools += 1
            correct_tools += labels["correct_routine_tool"]
        citations += counts[0]
        supported += counts[1]
        false_completions += labels["false_critical_completion"]
        if case["critical"] and not labels["critical_pass"]:
            critical_failures.append(case_id)
    def metric(passed: int, total: int, target: float) -> dict:
        return {"passed": passed, "total": total, "rate": passed / total if total else None, "target": target, "meets_target": bool(total) and passed / total >= target}
    metrics = {"adequacy": metric(adequate, len(valid), .95), "routine_tool_selection": metric(correct_tools, routine_tools, .98), "citations": metric(supported, citations, .95)}
    missing = sorted(set(expected) - valid)
    ready = not missing and not invalid and not critical_failures and false_completions == 0 and all(m["meets_target"] for m in metrics.values())
    return {"cohort_version": cohort["version"], "expected_cases": len(expected), "evaluated_cases": len(valid), "unrun_or_invalid_cases": missing, "invalid_results": invalid, "critical_failures": critical_failures, "false_critical_completions": false_completions, "metrics": metrics, "acceptance_passed": ready}

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cohort", type=Path, default=COHORT)
    parser.add_argument("--results", type=Path)
    args = parser.parse_args()
    outcome = score(json.loads(args.cohort.read_text()), json.loads(args.results.read_text()) if args.results else [])
    print(json.dumps(outcome, indent=2))
    return 0 if outcome["acceptance_passed"] else 2

if __name__ == "__main__":
    raise SystemExit(main())
