# Engineering acceptance evidence — per implementation slice

Scope ID / version:  
Requirement IDs / Master sections / API family IDs:  
Environment and authorized fixture:  
Reviewer / accountable owner:  
Recorded at (UTC):  
Evidence classification: synthetic / unit / adapter-contract / staging-provider / production-canary / human-UX

## 1. Baseline and intended improvement

Describe the reproduced failure and its trace/receipt reference. State the exact customer-visible outcome and invariant being improved. Distinguish observed facts from suspected cause. Do not insert private messages, credentials or raw tokens in this document.

## 2. Immutable implementation references

| Item | Reference | Independently checked? |
| --- | --- | --- |
| Parent and new Git commits | Pending | No |
| Changed source paths and artifact hashes | Pending | No |
| Migration IDs/checksums and schema state | Pending | No |
| Contract/handler/catalogue version | Pending | No |
| Actual deployed function/worker/app version | Pending | No |
| Previous recoverable release | Pending | No |
| Policy/grant revision and fixture scope | Pending | No |

A row reading Pending is not a successful test. Source readback, deployment metadata and functional outcome are separate checks.

## 3. Traceability and test result

| Requirement / test ID | Expected observable result | Actual result | Evidence / provider resource ID | Status | Tested at |
| --- | --- | --- | --- | --- | --- |
| Populate from the scope | | | | NOT_RUN | |

Allowed test states: NOT_RUN, PASSED, FAILED, BLOCKED_EXTERNAL, UNKNOWN_OUTCOME, NOT_APPLICABLE_WITH_APPROVED_REASON. Include permission-negative, tenant-isolation, duplicate/retry, timeout, revocation and recovery tests where relevant. A provider mock passing is not a live provider pass. An approved exception is not counted as a passed original requirement.

## 4. Quantitative quality and performance

Cohort/version and sample size:  
Reference device/network/provider conditions:  
Metric and measurement window:  
Baseline value / post-change value / uncertainty:  
Pass threshold and rationale:  
Outages, exclusions and failures:  
Human or independent-verifier scoring method:  
Observed provider/model/compute cost:

Report denominators, failed cases and fixture limitations; do not quote a percentage without its population. All critical invariants must pass regardless of average scores.

## 5. Deployment and recovery

Record admission/release job, policy authorization, staging/canary cohort, health and functional probes, source parity, monitoring, rollback/forward-repair command references and actual recovery result. Capture unknown/in-flight side effects before retry or rollback. Explain any irreversible action and its permitted compensation.

## 6. Completion statement

Separate: code implemented; code committed; deployed; provider reachable; caller authorized; functional outcome verified; MCP route exercised; rollback tested; customer journey accepted. State what is still unavailable or unverified. Link the updated operation-registry evidence and scope revision, without changing those statuses merely because this report was written.

## 7. Remaining blockers and next action

For each blocker record the exact operation, target scope, redacted error, attempted safe remediation, required external owner/entitlement/fixture, independent work still possible and next review condition. Do not silently abandon accepted missions or claim future background work without a scheduled worker.
