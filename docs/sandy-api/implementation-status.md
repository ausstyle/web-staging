# Sandy API implementation status

Updated 21 October 2026 after real customer provisioning acceptance and repaired VM diagnostic acceptance. The original 161 requirement families and the customer-onboarding extension remain incomplete. Registry rows and exposure flags are not completion evidence.

## Published source and production

GitHub write authorization works. The engineering branch has been pushed through `9f2f9af`. [PR #136](https://github.com/ausstyle/web-staging/pull/136) remains a draft. No new merge is established.

The current gateway is **31 ACTIVE**, from source `c480e3b`. The customer provisioning handler is **3 ACTIVE**, from `e46fe92`. Both preserve `verify_jwt=true`; every uploaded source was accounted for in production readback. Five gateway modules use reproducible type erasure/whitespace compaction with original Git source and artifact digests preserved. The initial larger gateway upload returned HTTP 413, leaving gateway 28 and its source unchanged; the compact candidate then deployed with HTTP 201.

Other last observed metadata versions: MCP **14**, private engineering runtime **4**, engineering control **43**, provider operation API **12**, provider gap API **7**, isolated engineering Edge Function fixture **9**. Prior test secret creation/removal advanced these metadata versions without changing their deployed sources. Gateway, MCP and provider JWT verification remain enabled. The private engineering runtime authenticates its revocable Vault bootstrap before obtaining a genuine normal Auth workload session; it returns no credentials.

## Dedicated engineering identity and verified execution

The permanent engineering test identity has no Controller membership. It obtains fresh short-lived Supabase Auth sessions and does not read or reuse `SANDY_CONTROLLER_ACCESS_TOKEN`. Its owner-authorized fixture policy permits six existing tools. Normal Auth verification, current owner authority, immutable exact approvals and provider grants remain enforced.

All six were discovered with schemas and executed through MCP → Sandy API → providers:

- `github.files.update`: isolated branch contents updated, read back and restored through MCP.
- `github.commit`: detached commit created and checked; this operation does not advance a branch.
- `supabase.db.migrations.apply`: isolated RLS fixture table created, marker checked and table removed through a forward rollback migration.
- `supabase.functions.secrets.set`: noncredential fixture value set, provider digest checked and fixture secret removed.
- `supabase.deploy_edge_function`: reviewed fixture version two deployed, then preserved version one redeployed. Restored source returned its expected response to a normal Auth session.
- `supabase.logs.query`: real fixture console marker retrieved; unrelated project log entries are filtered out for this workload.

Live session retirement caused fresh authenticated sessions. Credential rotation advanced epoch/generation to two, denied the old bootstrap with HTTP 403 and accepted the replacement. Invalid credentials and out-of-scope operations were denied. Natural expiry is covered by clock-based tests; the live renewal test explicitly retired sessions rather than waiting an hour. After gateway 29 deployed, scoped discovery still returned exactly six tools and real-provider MCP log retrieval passed again.

The requested identifiers `supabase.functions.logs`, `engineering.deploy.verify` and `engineering.rollback.execute` remain absent. Actual logs use `supabase.logs.query`. Concrete source, migration and function rollback was demonstrated; a generic recovery operation is not claimed. [Engineering evidence](engineering-workload-evidence-20261021.json) preserves the earlier exact deployment and execution records.

## Customer identity and onboarding

Three new operations are deployed and verified through MCP:

- `customer.onboarding.ensure`
- `customer.onboarding.update`
- `customer.identity.get`

They reuse canonical `email_customers`, unique normalized email addresses, portal accounts and existing verified WhatsApp links. Verified Auth email ownership is required; existing revocation is checked before receipt replay. Unverified email/WhatsApp/voice observations remain provisional and grant no account access. Profile updates use optimistic concurrency. An organisation name is metadata and grants no organisation membership. Onboarding alone provisions no provider resources and does not enable memory learning or proactive activity.

[Onboarding acceptance](customer-onboarding-evidence-20261021.json): **20 real checks passed** using two normal password Auth sessions. Discovery before enrollment, deduplication, cross-customer input, stale writes and revoked replay were tested. Fixtures were deleted and independently checked absent. The earlier result-propagation defect is retained as failed evidence; the additive execution-metadata migration corrected it before successful MCP verification.

Trusted email (`incoming`) and WhatsApp (`inbound`) storage now feed the existing deduplicated provisional-contact service. A service-only resolver checks current verified email records and fresh WhatsApp links on every lookup; revoked/expired links stop matching. Matches are routing hints and grant no authorization, create no customers and perform no identity merging. Customer writes are excluded from trusted ingress. Voice caller ID remains provisional. [Production database checks](customer-ingress-evidence-20261021.json) passed **27/27**, existing onboarding checks **31/31**, and all fixtures were independently absent after rollback. These are actual database integration checks; signed external email/WhatsApp delivery was not exercised and no message was sent.

## Actual resource provisioning and lifecycle

Twelve additional operations are deployed and verified through MCP:

- `customer.provisioning.features.list`, `customer.provisioning.templates.list`
- `customer.provisioning.plan`, `customer.provisioning.execute`, `customer.provisioning.jobs.get`
- `customer.resources.list`, `customer.resources.reconcile`, `customer.resources.recover`, `customer.resources.decommission`
- `customer.workspace.records.get`, `customer.workspace.records.upsert`, `customer.workspace.records.delete`

The first installed adapter is `supabase.workspace`. It creates an actual isolated Postgres table in the existing project, configures RLS and direct-access restrictions, and verifies real provider metadata before returning a completed persisted job. Feature definitions/templates and versioned customer policies live in Supabase; permissions reuse existing commerce entitlements. Execution revalidates the immutable five-minute plan, current entitlements, policy versions, resource limits and storage/purchase budgets. Duplicate plan execution reuses the job. Record updates enforce optimistic concurrency and current logical-storage limits. Unreported actual provider billing stays null.

Reconciliation records actual drift and blocks access to a drifted resource. Recovery restores security configuration only on the exact owned existing resource. Decommission requires explicit data deletion and a matching resource version, verifies physical absence and retains a truthful job. Failed transactional attempts roll back provider effects and retain a failed job/audit record. Unknown transport outcomes remain unknown and are not automatically replayed. This adapter executes synchronously in one database transaction; a general asynchronous provider worker is not claimed.

[Provisioning acceptance](customer-provisioning-evidence-20261021.json): **64 real checks passed** using two normal customer sessions. All twelve operations succeeded through MCP. The completed acceptance run created **two actual workspace tables**, one through the direct API preflight and one through MCP; both were removed. The failed-job test left no resource/orphan. Cross-tenant access, quota denial, actual security drift/recovery and verified decommissioning were demonstrated. Test users, customers, receipts, resources, jobs, plans, policies and entitlements were independently confirmed absent; temporary feature settings were disabled again. Earlier interrupted API-only fixtures were also administratively removed and are not counted as MCP acceptance.

Source regressions passed **192/192**; the exact compact artifacts passed **211/211**, including schema validation. Strict PostgreSQL rollback checks passed **47/47** for provisioning and **31/31** for onboarding. Existing normal-customer regressions passed **23/23**, engineering nonowner denials **8/8**, and authenticated engineering discovery/log regression passed after deployment. These overlapping suites are not operation counts.

## Fixed VM diagnostic verification

The existing provisioning backend is **59 ACTIVE**, from `c480e3b`; its original production source was preserved before changes. Gateway 31 fixes service authentication headers and safe propagation of upstream errors. The backend repairs OS Config policy discovery to the official v1 zonal endpoint and inspects Private Google Access without changing networks. Exact deployed source readback passed for both. Source regressions passed **213/213** and exact compact artifacts **232/232**.

[Actual diagnostic evidence](sandy-video-diagnostic-evidence-20261021.json) verifies seven of nine existing diagnostic operations through fresh workload Auth → MCP → Sandy API → Google. Optional scope revocation removes the tools and denies execution with HTTP 403. The fixed VM is running with OS Login and blocked project SSH keys; it has no external IP, Cloud NAT or Private Google Access. Google denied inventory reads with `osconfig.inventories.get` and denied project IAM-policy reads. The latter does not establish that IAP/OS Login execution permissions are absent. OS Config policy listing now succeeds. These checks do not demonstrate remote shell execution, LiveKit installation or conferencing.

## Database changes

Applied and ledger-read back against exact committed sources:

- `20261021120000`, `20261021121000`: dedicated Auth workload policy, sessions, revocable Vault bootstrap delivery, scoped execution authorization and audit.
- `20261021130000`, `20261021130010`, `20261021131000`: canonical onboarding, provisional contacts, receipts/audit and typed API/MCP contracts; truthful execution metadata correction.
- `20261021160000`: trusted email/WhatsApp observation triggers and service-only current-record matching, preserving existing ingestion/authentication and requiring no new catalogue operations.
- `20261021150000`: separately revocable, fixed-target read-only VM delegation, credential-epoch binding and audit; no shell, IAM, network or installation writes.
- `20261021140000`, `20261021140010`: provisioning features/templates, customer policies, immutable plans, owned resource registry, persisted jobs/receipts/audit, transactional workspace adapter and typed contracts.

## Actual coverage and remaining work

Latest production registry: **2,585 registered**, **447 API exposure flags**, **430 AI exposure flags**, **37 verified flags**. This session has genuine MCP end-to-end evidence for **33 distinct operations**: eleven engineering/provider/control operations, three onboarding operations, twelve workspace/lifecycle operations and seven read-only VM diagnostics. The dedicated engineering identity discovers fifteen while its separately revocable, 24-hour VM diagnostic scope is active; its base fixture scope remains six. These figures do not certify global executable/discoverable coverage or complete wildcard families. **Zero complete original requirement families are newly certified**; every incomplete constituent remains outstanding.

Google Cloud VM/disk provisioning, authenticated remote guest administration, Google Drive folder/permission/file provisioning, integration authorization/initialization, verified new channel linking, organisation membership and the broader asynchronous provisioning worker remain unfinished. Existing provider/identity services are being inspected for reuse. Remote administration of `sandy-video`, LiveKit installation and an actual two-participant conference remain unverified; no overall completion is claimed.

Runtime Google egress, Controller/owner authorization outside the dedicated fixture delegation, and Custom Domain provider entitlement remain separate dependencies. No provider plan purchase or upgrade is authorized. Repository source delivery, SSH/WinRM, remaining durable execution/lifecycle work, and full 161-family reconciliation continue independently. Uncommitted future adapters are excluded from production claims.

The [05:12 historical report](implementation-status-20261021-0512.md) is retained for chronology; its Git-write blocker and zero newly verified operations are superseded by the actual evidence above.
