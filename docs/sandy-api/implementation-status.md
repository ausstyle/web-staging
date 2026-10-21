# Sandy API implementation status

Updated 21 October 2026. This is the API/MCP foundation slice of SANDY-ENG-0005; the original 161 requirement families and customer-onboarding extension remain incomplete. Registry rows, deployed handler metadata and exposure flags are not execution evidence.

The complete [161-family matrix](requirement-coverage-161.md) and its [operation/evidence JSON](requirement-coverage-161.json) now distinguish mandatory operation candidates, optional expansion, source contracts, active-handler metadata, exposure flags, actual MCP receipts and outstanding constituent review. Current evidence supports **11 partially verified families and 33 distinct successful MCP operations**. **0/161 whole families have all required constituent acceptance established**; this is an acceptance gap, not a claim that no implementation exists.

The existing versioned provider engine serves **1,738 reviewed generated contracts** (Google Cloud 1,324; GitHub 336; Supabase 78). The 64 registry handler labels consolidate to 43 review groups, including internal workflow labels; neither number is a new task count or completed-adapter count. Shared authentication, authorization, validation, grants, idempotency, receipts and private custody remain in the existing API boundary. Per-operation schemas, permissions and risk controls are retained.

Actual positive MCP evidence currently covers six shared handler groups: provider operation, provider gap, legacy compatibility, engineering control, customer provisioning and fixed-VM read-only diagnostics. Customer identity/workspace lifecycle and the bounded engineering release fixture are deployed and exercised. General provider lifecycle coverage and private VM SSH/WinRM are incomplete. Evidence is reused at its recorded release; no unchanged live test was rerun merely to increase a count.

The [reviewed disposition](scope-operation-disposition.json) consolidates shared provider actions without declaring different permissions, schemas or targets interchangeable. Expanded maintenance simulations and similar extras are not separate approved-scope obligations. `video.install`, `video.restart`, `video.logs` and `video.verify_call` are not required standalone MCP tools. Existing canonical `supabase.logs.query` satisfies the engineering log capability; an alias-only registry entry is unnecessary. Wildcard families still require semantic review before other operations can be excluded.

Dependency-ordered planning ranges below are provisional engineering effort, not elapsed-time promises or operation-count multiplication. Existing code/evidence is reused; permission and entitlement waiting time is excluded. They require refinement as constituent review finds usable production implementations.

| Component | Remaining functional milestone | Indicative effort |
|---|---|---|
| Shared contracts and release gates | Portable individual contract verification, green PR checks, approved scoped acceptance profiles and source-preserving release | 2–4 engineering days |
| Provider adapters | Review mandatory wildcard constituents; close resource bindings, typed projections, provider-specific lifecycle and risk verification | 8–15 days |
| VM access | Supported private/IAP transport, trusted host enrollment, OS Login credential lifecycle, SSH/WinRM output delivery and actual harmless command | 5–10 days |
| Durable execution and source | Adopt reviewed worker/repository candidates, lease/revocation/cancellation/reconciliation and lost-ack recovery through the same API | 5–10 days |
| Engineering lifecycle | General deployment verification and compensation beyond the already verified fixed Git/SQL/Edge fixtures | 4–8 days |
| Customer provisioning | Organisation/verified link transfer, Google Drive/GCP adapters, OAuth onboarding and asynchronous reconciliation | 5–10 days |
| Application families | Reconcile existing domain handlers and implement remaining required commerce, tenancy, memory and security capabilities | 10–20 days |
| Acceptance and operations | Representative provider tests, independent high-risk readbacks, denied requests, rollback/canary and family certificates | 6–12 days, overlapping implementation |

Confirmed independent dependencies: the existing Google service account receives **403** for `compute.subnetworks.setPrivateIpGoogleAccess` on the fixed default subnet; OS Config inventory receives **403** for `osconfig.inventories.get`. Neither establishes that every private/IAP transport is unavailable. Broader owner-only tests require a legitimately approved scoped delegation, rather than reusing an expired personal Controller token or widening the existing six-operation grant. Custom Domain entitlement remains separate and no plan purchase is authorized. No arbitrary URL executor or unrestricted provider tool is introduced.

The portable reviewed-schema foundation passed **277 offline Python tests** with management/GitHub/Controller credentials removed. Individual integrity/policy/Draft7 checks cover all **1,738 generated contracts**, using 25 exact public pinned schema/protobuf fixtures. On pushed commit `c679725`, all five applicable GitHub checks passed, including the separate VM protocol job; the production deployment job was skipped. These tests do not add registry verification flags.

The existing native VM candidate has been adopted as source with one shared receipt normalizer and an explicit unknown-outcome guard. A real PostgreSQL rollback test reproduced the previous false-completion path, then **53/53** assertions passed after repair. **27** loopback SSH/TLS WinRM tests and **2** shared receipt tests passed; the compiler invariants passed. Candidate migrations and protocol tools remain unapplied/unexposed; no remote VM execution is claimed. [Native receipt evidence](vm-native-receipt-evidence-20261021.json) records the baseline failure, correction and independently absent fixtures.

## Published source and production

GitHub write authorization works. The engineering branch is pushed through `c679725`; its five applicable checks pass. Source, CI and production are separate states. [PR #136](https://github.com/ausstyle/web-staging/pull/136) remains a draft. No new merge is established.

A fresh [authenticated read-only production checkpoint](production-checkpoint-20261021-1718.json) returned the correct project as `ACTIVE_HEALTHY` and confirmed the counts/versions below. No credentials are included.

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

The existing WhatsApp email-code linker now completes atomically in webhook **156 ACTIVE**, from `41e030c`, with all five deployed sources verified. Actual production version 155 source was preserved in `259c914`, including functionality absent from the checkout. Proof consumption, binding and audit commit together. Wrong attempts are serialized and bounded, current email ownership is rechecked, cross-customer reassignment is refused, and existing narrower scopes are preserved. [Acceptance evidence](customer-channel-link-evidence-20261021.json): **33 real database checks**, **9 handler tests**, concurrent REST completion with one success/one rejected replay and one audit, and **3 actual webhook authentication/method denials** passed. Fixtures were removed and read back absent. External Meta delivery and actual emailed OTPs remain unverified; no message was sent. This change creates no new catalogue operations or verification flags.

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

The existing provisioning backend is **60 ACTIVE**, from `d61bdd3`; its original production source was preserved before changes. Gateway 31 fixes service authentication headers and safe propagation of upstream errors. The backend repairs OS Config policy discovery to the official v1 zonal endpoint and inspects Private Google Access without changing networks. Exact deployed source readback passed for both. Source regressions passed **213/213** and exact compact artifacts **232/232**.

[Actual diagnostic evidence](sandy-video-diagnostic-evidence-20261021.json) verifies seven of nine existing diagnostic operations through fresh workload Auth → MCP → Sandy API → Google. Optional scope revocation removes the tools and denies execution with HTTP 403. The fixed VM is running with OS Login and blocked project SSH keys; it has no external IP, Cloud NAT or Private Google Access. Google denied inventory reads with `osconfig.inventories.get` and denied project IAM-policy reads. The latter does not establish that IAP/OS Login execution permissions are absent. OS Config policy listing now succeeds. These checks do not demonstrate remote shell execution, LiveKit installation or conferencing.

The bounded network prerequisite is implemented in backend **60**, with **20 handler tests**, **24 database authorization/audit checks**, full backend type checking and exact production source readback. The genuine existing owner-approved network scope admits only enabling Private Google Access on the fixed VM's current subnet. [Actual provider attempt](vm-network-preparation-evidence-20261021.json) reached Google using the existing audited Vault worker transport, then returned **HTTP 403**: `Required 'compute.subnetworks.setPrivateIpGoogleAccess' permission for 'projects/elaborate-haven-511518-a5/regions/europe-west1/subnetworks/default'`. Google did not accept the change. No IAM, public IP, NAT, firewall or paid resource changed. The missing permission belongs to the existing `sandy-computer` service account. No automatic retry is performed. This remains a separate external dependency, not a completed VM-execution family. Per the clarified scope, further work targets reusable VM discovery/access/execution rather than specialised video or software-installation MCP tools.

## Database changes

Applied and ledger-read back against exact committed sources:

- `20261021120000`, `20261021121000`: dedicated Auth workload policy, sessions, revocable Vault bootstrap delivery, scoped execution authorization and audit.
- `20261021130000`, `20261021130010`, `20261021131000`: canonical onboarding, provisional contacts, receipts/audit and typed API/MCP contracts; truthful execution metadata correction.
- `20261021162000`: current-owner-approved fixed-VM network admission and typed administrative provider-observation audit; no new catalogue operation.
- `20261021161000`: atomic existing WhatsApp linking, bounded attempts, current ownership checks, service-only channel audit and explicit refusal of identity transfers.
- `20261021160000`: trusted email/WhatsApp observation triggers and service-only current-record matching, preserving existing ingestion/authentication and requiring no new catalogue operations.
- `20261021150000`: separately revocable, fixed-target read-only VM delegation, credential-epoch binding and audit; no shell, IAM, network or installation writes.
- `20261021140000`, `20261021140010`: provisioning features/templates, customer policies, immutable plans, owned resource registry, persisted jobs/receipts/audit, transactional workspace adapter and typed contracts.

## Actual coverage and remaining work

Latest production registry: **2,585 registered**, **447 API exposure flags**, **430 AI exposure flags**, **37 verified flags**. This session has genuine MCP end-to-end evidence for **33 distinct operations**: eleven engineering/provider/control operations, three onboarding operations, twelve workspace/lifecycle operations and seven read-only VM diagnostics. The dedicated engineering identity discovers fifteen while its separately revocable, 24-hour VM diagnostic scope is active; its base fixture scope remains six. These figures do not certify global executable/discoverable coverage or complete wildcard families. **Zero complete original requirement families are newly certified**; every incomplete constituent remains outstanding.

Google Cloud VM/disk provisioning, authenticated remote guest administration, Google Drive folder/permission/file provisioning, integration authorization/initialization, verified new channel linking, organisation membership and the broader asynchronous provisioning worker remain unfinished. Existing provider/identity services are being inspected for reuse. Reusable remote administration of `sandy-video` remains unverified. The current task explicitly excludes video-conferencing deployment; software-specific installation/restart/log/test tools are not additional required MCP operations.

Runtime Google egress, Controller/owner authorization outside the dedicated fixture delegation, and Custom Domain provider entitlement remain separate dependencies. No provider plan purchase or upgrade is authorized. Repository source delivery, SSH/WinRM, remaining durable execution/lifecycle work, and full 161-family reconciliation continue independently. Uncommitted future adapters are excluded from production claims.

The [05:12 historical report](implementation-status-20261021-0512.md) is retained for chronology; its Git-write blocker and zero newly verified operations are superseded by the actual evidence above.
