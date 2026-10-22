# Sandy API implementation status

Current production checkpoint: 22 October 2026 UTC. The original programme remains incomplete.

Latest release: PR **#182** merged at `f18bd5a`; source `11636b5` is deployed as **guest API v17** plus migration **20261022173000**. Existing typed file/package/service and own-task operations now have bounded standing-policy support and an exact-admission first-canary path. The active grant remains metadata-only; no registry flags, enrollment or provider IAM changed. Post-release normal MCP discovery/read/denial tests passed, including independent GitHub readback. No new operation or accepted infrastructure scenario is claimed. [Source/deployment/MCP proof](bounded-guest-policy-release-evidence-20261022.json).

Latest shared-control repair: PR **#181** merged at `5597bde85578268b0677180d7883c4e9a2665561`; source `b183486fdd64209eeedfb007b7cc37b07cdc4ed9` is deployed as database migration **20261022170000**. Guest dispatch now recognizes the existing exact standing-admission verifier, rejects expired consumed admissions and honors Supabase Auth `not_after`. Actual normal-session MCP GitHub provider read and guest readiness reads passed; expiring an isolated Auth session caused a pre-admission 403, and a newly issued legitimate session succeeded. Both isolated sessions were retired and logged out. Delegation bounds, registry flags and VM enrollments are unchanged; guest Edge API stays **v16**. This closes shared authorization defects, not VM access acceptance. [Actual release/authentication evidence](guest-policy-release-evidence-20261022.json).

PR **#136 merged** normally as `f7855132272b170e5ed387895967097e88f3402e` after all six candidate CI checks passed. Scope synchronization succeeded for all 13 documents; 0001 and 0005 version 1.2 match their merged source hashes. The bounded managed-worker update repair is deployed as **sandy-guest-operation-api v15**, source `37f128f2d0315a44c7f38e93769f4eb82905940e`, with all uploaded sources matched and a real anonymous dispatch refusal. No VM was enrolled, restarted or installed by this release. [Actual release/sync evidence](infrastructure-acceptance-release-20261022.json).

- **0/161 requirement families fully accepted; 33 have reviewed implementations awaiting whole-family acceptance; 128 need software or constituent reconciliation.**
- **38 families have partial required-operation MCP evidence**, covering **84 distinct operations** across retained authenticated test cohorts. Whole wildcard completion is not inferred.
- **Seven families have documented external dependencies** (six involve permission denials, one an entitlement). These overlap implementation work.
- The registry contains **2,585 entries / 460 API flags / 443 AI flags / 79 verified flags**. No operation was added. These flags do not certify global executable coverage.
- The normal engineering identity actually discovers **233 scoped MCP tools**, with schemas and paginated discovery verified. Global executable/discoverable counts remain uncertified.

**Verified read capability preserved:** the existing `gcp.vm.agent.status` now executes through normal authenticated MCP → Sandy API under the standing GCP metadata class. Both target observations match enrollment/heartbeat state and succeeded audit receipts; an installation request was denied before admission. This is **readiness reporting**, not Google provider command execution: both managed agents remain disabled generation0 with no heartbeat. PR **#179** merged as `be57b3e`; guest API **16** is source-attested to `353e87bd275648798923d6a2036e7f4a6c98c285`. The existing 161-family scope remains incomplete, with Linux/Windows/graphical acceptance **0/3** and INF-01–07 unaccepted as full end-to-end scenarios. [MCP evidence](guest-status-MCP-evidence-20261022.json), [registry readback](guest-status-registry-verification-20261022.json), [seven-case checkpoint](infrastructure-acceptance-checkpoint-20261022.md).

The [current matrix](requirement-coverage-161.md) and [hashed JSON index covering all 161 families](requirement-coverage-current.json) distinguish implementation review, active handler versions, scoped discovery, actual MCP execution and blockers. The older large `requirement-coverage-161.json` is a historical constituent-mapping archive; its version and exposure totals are historical. Sections below the current checkpoint retain earlier release evidence at its actual versions.

## Standing GitHub engineering capability — current checkpoint

**Operational:** renewable normal Supabase Auth → Sandy MCP → Sandy API → GitHub for repository/source reads, broad repository and Actions metadata, engineering-branch file create/update/delete, commit/ref publication, own receipts and conditional file recovery. Standing authorization uses reviewed operation classes, fixed delegated resources, risk/budget/rate limits, expiry, revocation and provider IAM. It creates `authorized_by_policy` jobs with no fabricated Owner approval or global Controller membership.

GitHub source publication now works through MCP without the expired shell `GH_TOKEN`. The client preserves exact Git commit hashes, immutable parent history and non-forced references; larger source batches use bounded text blobs and an atomic tree. A **90,000-byte** owned canary was published, reconstructed in **two actual MCP read ranges**, and removed through a verified forward restoration commit. Provider readback confirmed cleanup. Unknown outcomes are not blindly replayed; only proven pre-dispatch failures resume the same nonce.

**Production:** `sandy-operation-api` **56** (source `f27fb982188436e61cda4cc473a7cae04c96afc8`), `sandy-provider-operation-api` **29** (source `89e597a654c391e875121a2e57918a5a9b11d423`), compatibility API **21**, private engineering runtime **15**, MCP **21**. Every uploaded source in the released gateway/provider/compatibility/runtime artifacts has an independently matched readback. JWT verification remains enabled on the public gateway/provider/compatibility functions; the existing private runtime authenticates its revocable bootstrap and then uses legitimate short-lived Auth sessions.

The shared adapter now handles nullable provider arrays and propagates provider IAM HTTP 403 accurately. Source reference publication also checks all protected workflow/credential-file hashes against the approved immutable baseline and current main, then revalidates authority before dispatch. Real MCP reference creation/update succeeded; indirect protected-source omission attempts returned **403 before mutation**, preserved the existing reference and did not create the rejected reference. The same guard uses reviewed method/path descriptors for aliases; no alias was added to the catalogue merely for testing.

Evidence: [standing authorization and recovery](standing-engineering-GitHub-MCP-evidence-20261022.json), [broad provider reads and genuine IAM denial](github-standing-broad-MCP-evidence-20261022.json), [source publication and 90 KB recovery](source-publication-MCP-evidence-20261022.json), [protected publication, successful and denied calls](github-protected-publication-MCP-evidence-20261022.json). Registry evidence links match these actual executions. Git blob/tree substeps remain **accepted**, with exact source readback, while commit/ref receipts are **succeeded**; missing durable sub-operation effect settlement is not concealed.

**Committed and source-published to PR #136:** standing-policy/admission/session-binding/recovery changes, safe source ranges and dotfile reads, common Git mutation proofs, nullable-array and HTTP-error fixes, checkpointed exact source publication and protected reference publication. PR #136 has now merged after its runtime source was reconciled and all six CI checks passed. These production releases used authorized reviewed Management deployment, not a claim that general MCP-driven Supabase deployment is complete.

**Remaining software:** binary/large artifact custody, complete immutable-object and delayed-outcome settlement, broader durable workers and production release verification/rollback; unaccepted draft-PR lifecycle, reviewed merge and higher-risk repository administration; general standing Supabase writes/releases, GCP execution and Sandy service completion. Reuse the existing provider engine and attested-release foundation. The source client currently supports bounded regular UTF-8 files, not arbitrary binary repositories.

**External dependencies:** GitHub `GET /repos/ausstyle/web-staging/actions/secrets` returned provider/API **403 `provider_authorization_refused`** under otherwise valid standing authentication. A legitimate administrator must inspect required repository **Secrets:read** permission and organization restrictions; no permission was expanded. Native GitHub authentication has recovered: actual CLI calls identify `ausstyle` with repository admin/push permissions; the normal, head-pinned merge succeeded. The earlier **401 `Bad credentials`** is historical. MCP source delivery was independently verified for both installer commits. IAP/subnet permissions and Custom Domain entitlement retain their previously recorded errors and were not re-investigated or purchased.

**Release integration:** PR #158 reconciled the runtime source into the API branch, including unique migration versions and preserved runtime 15; PR #136 then merged after all six checks passed. The protected source baseline was administratively pinned to the independently checked integration commit `384b072`, retaining exactly the existing resources/classes/risk/budget/expiry (delegation v5). No workload permission to change that baseline was added. The [earlier integration handoff](standing-release-integration-handoff-20261022.md) is historical context; do not deploy its older frozen proposal without fresh source/baseline checks.

## Historical checkpoints before the PR #136 merge

PR [#136](https://github.com/ausstyle/web-staging/pull/136) is open, draft and unmerged. Native Git writes and workflow dispatch work; repository write authorization is no longer the blocker. Current main `ad8685c` was merged into the API branch at `47695b1`. The latest verified releases are gateway 45 (`7a78ea5`), provider 22 and legacy 17 (`9c2b637`); every uploaded source is accounted for. Main-branch updates are preserved; PR #136 remains unmerged. Upstream Meetings/video code was preserved in source, not deployed by this task.

| Service | Latest observed ACTIVE metadata version | Committed deployed source |
| --- | ---: | --- |
| sandy-operation-api | 45 | `7a78ea5c6d2d519499c1698ac4b78a80c626bfee` |
| sandy-api-mcp | 21 | `a0078d526a0db94fb92857825b3b06040e084f0b` |
| sandy-engineering-runtime | 13 | `97bd82578ec0816d72343d4b1d443793313ea861` |
| sandy-provider-operation-api | 22 | `9c2b637d729b87297135ac1f17db43101b2fdf17` |
| sandy-legacy-compatibility-api | 17 | `9c2b637d729b87297135ac1f17db43101b2fdf17` |

All current uploaded sources and JWT settings are independently accounted for.
Gateway 45 also compacts a sixth committed, static contract module using the same
pinned type-erasure/whitespace-only builder, after rejected uploads left v44
unchanged. The compact artifact passed 119 gateway runtime tests. No runtime, VM,
networking, LiveKit or media component was deployed. Source snapshots and compatible
rollback preparations are retained. Historical customer/REST releases remain in
[shared release evidence](shared-execution-release-evidence-20261022.json); current
GitHub releases and actual acceptance are documented below.

- **`b4177a5`** repairs existing `agenda.pins.list` and `calendar.client.timezone.get`. Deployed legacy backends lacked private-table SELECT permissions. Two typed, normal-JWT RPC projections restore the reads without granting table access or broadening roles. Migration **20261022010000**, SHA-256 `7f1ff1866ccb6b278b7cba668c21e7f6ebd067b72ffff04d4c55697a0f4079b2`, is present with exact source in the production ledger. [Migration evidence](customer-read-projections-migration-20261022.json); [SQL boundary checks](customer-read-projections-SQL-rollback-20261022.json).
- **`e18c05a`** repairs bounded REST catalogue paging and removes a log-result projection field that violated its advertised MCP output schema. Queue acceptance remains distinct from completed execution, and possible truncation remains truthful.
- **`5f84645`** confines execution-result redaction to execution, repairing REST log contract description. The failing regression reproduced HTTP 502 before the fix.
- **`05fade9`** makes the real engineering test runner use configured GitHub CLI authorization, select independent components safely, and reject unexpected workload authority. It does not grant new provider permissions.

Source regression passed 400 checks before the first release; final API/MCP/candidate checks passed **325**, and final compact deployment artifact checks passed **322**. Thirteen real PostgreSQL boundary assertions ran inside ROLLBACK. CI at `c103bbf` passed API, native protocol, offline and applicable verification jobs. Mock/SQL boundary checks are not provider acceptance.

## Real authenticated execution

Two fresh normal Auth customer identities exercised **17 existing customer reads**, including task, calendar, Agenda, workspace, files, social and history paths. Initial real failures in pins/timezone led to the deployed fixes. A focused post-release run passed all **14 calls**, including nonempty own pin/timezone results, foreign-resource hiding and tenant-argument rejection. Independent cleanup verified no customer fixture, queue, Mission or calendar-outbox leftovers. Eight existing operations gained verified flags after nonempty resource assertions; nine other successful scoped reads retain unverified flags where nonempty business behavior was not demonstrated. [Customer MCP/registry proof](customer-service-MCP-evidence-20261022.json).

A fresh renewable engineering session, with **zero Controller memberships**, passed official MCP client schema validation, four bounded REST pages, authorized description, duplicate-query HTTP 400 and out-of-scope description HTTP 403. `supabase.logs.query` reached the real provider with HTTP 200 and admission `8263dda8-1b69-41be-8629-c2176d3c92ed`, independently read back as `succeeded`. Wrong log source was denied before admission. The queried window had zero fixture markers: query execution is verified; event delivery is not. The session was independently confirmed retired. No VM diagnostic ran. [REST/log evidence](REST-log-MCP-evidence-20261022.json).

Real MCP writes passed GitHub file update/content restoration, detached commit creation and an isolated Supabase migration up/down. Independent GitHub readback confirmed commit `785b7ace361e0cadec85b0790c63a1707a64717d`, its tree/parent and unchanged fixture branch. Independent database readback confirmed the test table was removed. Those historical admissions remained conservatively `accepted`. The new GitHub verification transition below explicitly settles only matching immutable provider readback; other mutation types retain their existing state. Fixture recovery is not general `engineering.rollback.execute` acceptance. No project-wide secret change or test-function redeployment was repeated. [Write/recovery evidence](engineering-write-MCP-evidence-20261022.json).

Earlier unchanged evidence is retained at its actual release: canonical GCP VM read, wrong-target denial, workload scope revocation, six engineering fixture operations (including isolated function/secret lifecycle), owner engineering reads and customer onboarding/workspace provisioning. No new GCP write/remote-execution claim is made. See [prior GCP evidence](canonical-vm-read-MCP-evidence-20261021.json), [scope denials](canonical-vm-read-denial-evidence-20261021.json) and Git history for earlier checkpoints.


**`c103bbf`** deploys reusable authenticated customer-read admission on gateway **43**. Migration **20261022020000**, SHA-256 `1c770ba22ea33d80fe3772676bedc790fe6212a99e8f2130537c9e64961f2a71`, adds two normal-JWT RPCs and one private policy helper, with no new tables or role memberships; only the scoped authenticated RPC execution grants are added. Owner, workload, customer-key and provider admission checks retain their existing behavior. This release passed **408** source checks, **326** compact-artifact runtime checks and **27** real PostgreSQL assertions inside ROLLBACK. Type checking runs on the readable TypeScript; artifact runtime checks exercise the five pinned JavaScript transformations.

Post-release **28/28 real customer MCP calls passed**. Independent SQL found **22 settled receipts: 18 succeeded and four failed foreign-resource lookups**, each with three audit events. Same-request replay and changed-operation reuse were denied; invalid tenant arguments were rejected before admission. All eight verified operations retained their existing registry flags. The normal engineering workload also passed strict MCP schema/REST/log/provider regression with independent successful admission and retired-session readback. [Customer receipt evidence](customer-read-receipt-MCP-evidence-20261022.json); [provider regression](gateway43-shared-log-registry-evidence-20261022.json).

A deeper fixture cleanup check found six derived temporal facts across this session's three customer-read runs. Exact synthetic markers, retained fixture IDs or the original run window, INSERT provenance and absent customer/task records established ownership. Only those synthetic facts/links were removed; execution/audit history was retained. The harness now removes and independently checks these records. [Cleanup evidence](customer-service-temporal-cleanup-20261022.json). All normal test users/sessions and ten business-fixture categories independently read back as empty.

The matrix reconciler also rejects a claimed family certificate when any reviewed required operation lacks execution evidence. A live metadata refresh also retains previously reconciled source-family candidates instead of silently dropping them when the database omits source-derived links. These changes close reporting gaps without increasing family completion figures. Full-family completion remains **0/161**.

## GitHub platform milestone — 22 October 2026

**Operational:** the existing authorized GitHub engineering fixture now works through
normal Auth → Sandy MCP → Sandy API → GitHub with independently settled execution
receipts. A file update, content restoration and detached commit all returned
`succeeded` plus verification hashes. Independent provider reads confirmed the file
bytes, tree, parent and unchanged branch after detached commit creation. The three
admissions and deployment jobs are `succeeded`; all 12 audit events and hash links
verify. Repeating verification reused the receipts without another event or write.

Commits **883ba5f, e4ac156, 7a78ea5, d17a11c and 9c2b637** are pushed to PR #136.
Production: **sandy-operation-api 45**, **sandy-provider-operation-api 22**,
**sandy-legacy-compatibility-api 17**, all ACTIVE with JWT verification enabled.
Source readback accounts for every uploaded module. MCP/runtime remain versions
21/13; the MCP adapter gained no provider execution logic. Migration
**20261022030000** adds a bounded proof column and a service-only verification
transition on the existing ledger. No new operation, role or wider delegation.
The ordinary provider output contract still describes the original acceptance;
MCP/API envelope metadata carries the later, durable verification receipt.

Two real acceptance failures exposed a decoder rejecting GitHub's trailing newline
after padded base64. Each failure left the write pending and restored the original
file through MCP. Later administrative reconciliation verified the immutable
original commits without replay. The decoder repair now passes the full live run.
Immutable GET retries are bounded; mutation retries remain disabled. Wrong branch,
path, malformed input and retired-session request replay were denied before
admission and preserved the fixture. The initial boundary harness classified a
runtime-level denial incorrectly; its correction retained the five completed MCP
checks and retried only the explicitly refused, unadmitted request.

**GitHub as a whole is still incomplete.** The standing workload grant does not
permit standalone repository/source reads, refs, PRs, Actions or administration.
Actual `github.repos.get` returned runtime **HTTP 403
`engineering_operation_scope_denied`** before MCP. Native repository push/admin
permissions are available, so this is a workload authority boundary, not missing
Git credentials. General immutable source capture/private delivery and
MCP-driven production verification/rollback also need completion; private source
candidates were preserved rather than published as working operations. Organisation
repositories, Discussions, packages, audit, security and environment-secret families
have no whole-family acceptance. Their existing contracts are not execution proof.

The two existing GitHub registry rows now carry the actual scoped MCP/provider,
receipt and audit evidence, preserving all operation and exposure flags. Original
family completion remains **0/161**; these are improvements within partial families
117/118. The next platform remains GitHub. Supabase, GCP and Sandy service evidence
is retained; no new large provider workstream or VM/video deployment began.

Source regression, compact gateway runtime tests and PostgreSQL boundary checks
passed. The official MCP client also passed normal-session, schema, REST and real
provider-log regression; no new log event delivery is claimed. Previous gateway
43/provider 18/legacy 13 artifacts and committed source were preserved for rollback.
To recover, restore those reviewed function sources under the same lease and
source/version guards, with JWT verification retained. Keep the additive proof
column/function and audit history; this is not a destructive schema rollback.
Actual fixture recovery is verified; production-function rollback and
`engineering.rollback.execute` through MCP are **not** claimed tested. The three
component leases were released after final source and receipt checks.

A subsequent real stale-SHA write confirmed an error-propagation defect: GitHub
409 was exposed as API 502. Commit `9c2b637` preserves provider conflict (409) and
precondition failure (412) through the shared adapter. Provider 22 / legacy 17
source readbacks match that commit. The targeted real MCP retry now returns
`provider_conflict`, API/provider 409, an independently failed admission/job and
three audit events, with no file or branch change. HTTP 412 is covered by shared
regression, not a claimed real-provider test. The successful file/commit receipt
path was verified on provider 21 / legacy 16 and is unchanged in this error-only
follow-up; those successful mutations were not repeated.

[Actual GitHub execution, recovery and limitations](github-platform-MCP-evidence-20261022.json). [Real provider conflict before/after](github-provider-conflict-evidence-20261022.json).

## Remaining work and external dependencies

1. **Shared execution durability:** eight existing task/calendar/Agenda reads now use normal-JWT admission, one-use grants, rate limits, settled shared receipts and digest-only audit. Other legacy customer reads still need adoption. General mutation settlement, provider polling, cancellation/retry, recovery and independently verified compensation remain incomplete.
2. **Source/release delivery:** finish immutable general source delivery and production verification/rollback through Sandy API/MCP. Cloud Run's source candidate is not deployed. The prior protected-environment approval attempt returned HTTP 403 `Resource not accessible by integration`; authorized review through `sandy-production` is required. Do not bypass it. The older waiting run was cancelled because its acceptance still invoked VM diagnostics; the replacement acceptance uses bounded logs. [Replacement run 39692384698](https://github.com/ausstyle/web-staging/actions/runs/39692384698) is waiting for protected review; its source is `e49eca5`. No production traffic was promoted.
3. **Provider and service completion:** reconcile minimum wildcard constituents on existing typed versioned adapters, and test under genuinely approved target-specific authority. Three explicit required contract gaps remain `supabase.projects.list`, `supabase.projects.create` and `supabase.functions.invoke`. Current fixture/optional VM grants do not authorize every provider operation. Do not fabricate owner approvals or give the workload global Controller ownership.
4. **Generic computer access:** SSH/IAP/WinRM candidate code exists but production transport activation, files/packages/services, guest enrollment and isolated graphical/browser session lifecycle remain incomplete. Acceptance is **0/3**. IAP relay **4033 NOT_AUTHORIZED**, and target policy reads HTTP 403, require a legitimate IAP policy administrator to inspect current policies/etags and grant only missing VM-specific tunnel access to `sandy-computer@elaborate-haven-511518-a5.iam.gserviceaccount.com` on ports 22/5986. [Precise blocker](iap-access-blocker-20261021.md). Windows heartbeat is stale and listener/credential/host-certificate execution remains unverified. Do not repeat the same denied investigation, add public IPs or weaken host controls.
5. **Separate provider dependencies:** the default-subnet Private Google Access change returned HTTP 403 for `compute.subnetworks.setPrivateIpGoogleAccess`; this is not a universal prerequisite for private access. Custom Domain entitlement is unavailable; no provider plan purchase is authorized. These do not block unrelated software work.
6. **Whole-family acceptance:** finish positive/denied authenticated MCP execution, higher-risk independent verification and constituent reconciliation. Working token issuance/renewal is distinct from target authorization. Registry exposure/counts remain evidence-neutral.

LiveKit is already deployed and is excluded from infrastructure changes. Existing operational video APIs remain in scope. No LiveKit installation, VM repair or repeated sandy-video diagnostic is part of this release.
