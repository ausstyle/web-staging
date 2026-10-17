# Sandy QA engineering handoff — deployed interface reference

This is an architecture reference, **not a migration**. Deployed function definitions and table policies must be verified before changing production.

## Existing Supabase objects

- `public.sandy_evidence_checks`: immutable-by-policy intended evidence records; source channel/id, claim type, scoped customer/task, verdict, JSON evidence and timestamp.
- `public.sandy_evidence_improvement_queue`: groups contradicted claims by issue key, tracks occurrences and priority score.
- `public.sandy_qa_engineering_handoffs`: unique issue key, status, evidence JSON, root cause, recommended fix, regression plan, target function, approval requirement, verification JSON and timestamps.
- `public.sandy_qa_investigation_runs`: investigation run id, issue key, status, evidence, result, error and timestamps. Partial unique index prevents multiple active runs for the same issue.
- `public.sandy_qa_sync_engineering_handoffs()`: creates a handoff for high-priority issues (score >= 70) with `ON CONFLICT DO NOTHING`.
- `public.sandy_qa_handoff_guard()`: prevents `verified` without recorded `verification.production_passed=true` and `deployed` without deployment receipt.
- `public.sandy_qa_engineering_investigate_request()`: pg_net dispatch to the deployed engineering investigator, authenticated with private scheduler token.

## Worker implementation

The exact deployed `sandy-qa-engineering-investigator` v1 source is at `supabase/functions/sandy-qa-engineering-investigator/index.ts` in this PR.

Known boundaries: investigator uses evidence-backed LLM recommendations, not code inspection or execution; it never deploys. It is distinct from the Codex Architect GitHub Action, which inspects repository code. Do not promote its root-cause hypothesis to verified without source and runtime evidence.

## Required security/release controls

Validate tenant binding in the task API from authenticated verified source. No model-supplied customer identity. Review the SECURITY DEFINER delegation verifier for authorisation and historical semantics; direct execution should remain restricted to service role. Correctly handle revoked/pending/accepted delegation and pagination. Keep engineering actions on review branches; PR review and deployment approval required. Never mark the Villa defect passed without a new provider-observed WhatsApp regression.
