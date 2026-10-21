# Sandy API implementation status

Updated 22 October 2026 (client timezone Europe/Rome). This checkpoint covers the existing 161-family mandate; the programme is incomplete.

- **0/161 families fully operational and accepted.** Representative operation successes do not certify whole wildcard families.
- **33 families have reviewed implementation awaiting real whole-family acceptance.**
- **128 families need software, integration or constituent reconciliation.** This does not mean all their existing code is missing.
- **6 families have external dependencies, including 5 with permission denials and one entitlement.** These overlap implementation work.
- **19 families have partial required-operation MCP evidence: 51 distinct positive operations and 17 operations with denial evidence.**
- Production registry: **2,585 registered, 447 API flags, 430 AI flags, 46 verified flags**. No catalogue rows were added. Flags are not global executable or discoverable counts.

The [complete matrix](requirement-coverage-161.md), [machine-readable evidence](requirement-coverage-161.json) and [reviewed operation disposition](scope-operation-disposition.json) distinguish code, deployed routes, exposure, authorized execution, real evidence and blockers. Global executable/MCP-discoverable coverage is not yet verified. Actual scoped discovery returned 63 tools for each synthetic customer and 16 for the engineering workload.

## Committed implementation and production delivery

PR [#136](https://github.com/ausstyle/web-staging/pull/136) is open, draft and unmerged. Native Git writes and workflow dispatch work; repository write authorization is no longer the blocker. Current main `ae40d92` was merged into the API branch at `8555388`. All 121 gateway source files are byte-identical to the deployed `5f84645` release after that merge. Upstream Meetings/video code was preserved in source, not deployed by this task.

| Service | Latest observed ACTIVE metadata version | Committed deployed source |
| --- | ---: | --- |
| sandy-operation-api | 40 | `5f8464553b9fc78e83e35f166a046748a70c5984` |
| sandy-api-mcp | 19 | `a0078d526a0db94fb92857825b3b06040e084f0b` |
| sandy-engineering-runtime | 11 | `97bd82578ec0816d72343d4b1d443793313ea861` |
| sandy-provider-operation-api | 16 | `0334a878406663b8a683b519bc79c9c4d5e2abb6` |

This session explicitly uploaded gateway versions **35, 38 and 39**. Later metadata increments were independently reconciled to the same uploaded source/artifacts; their cause is not assumed. No runtime, provider engine, VM, LiveKit or media deployment was performed in this slice. JWT configuration and every uploaded source are accounted for in the [release evidence](shared-execution-release-evidence-20261022.json). Existing source snapshots and compatible rollback SQL are preserved. The gateway component leases were released after verification.

- **`b4177a5`** repairs existing `agenda.pins.list` and `calendar.client.timezone.get`. Deployed legacy backends lacked private-table SELECT permissions. Two typed, normal-JWT RPC projections restore the reads without granting table access or broadening roles. Migration **20261022010000**, SHA-256 `7f1ff1866ccb6b278b7cba668c21e7f6ebd067b72ffff04d4c55697a0f4079b2`, is present with exact source in the production ledger. [Migration evidence](customer-read-projections-migration-20261022.json); [SQL boundary checks](customer-read-projections-SQL-rollback-20261022.json).
- **`e18c05a`** repairs bounded REST catalogue paging and removes a log-result projection field that violated its advertised MCP output schema. Queue acceptance remains distinct from completed execution, and possible truncation remains truthful.
- **`5f84645`** confines execution-result redaction to execution, repairing REST log contract description. The failing regression reproduced HTTP 502 before the fix.
- **`05fade9`** makes the real engineering test runner use configured GitHub CLI authorization, select independent components safely, and reject unexpected workload authority. It does not grant new provider permissions.

Source regression passed 400 checks before the first release; final API/MCP/candidate checks passed **325**, and final compact deployment artifact checks passed **322**. Thirteen real PostgreSQL boundary assertions ran inside ROLLBACK. CI at `05fade9` passed API, native protocol, offline and both verification jobs; deployment was skipped for the PR event. Mock/SQL boundary checks are not provider acceptance.

## Real authenticated execution

Two fresh normal Auth customer identities exercised **17 existing customer reads**, including task, calendar, Agenda, workspace, files, social and history paths. Initial real failures in pins/timezone led to the deployed fixes. A focused post-release run passed all **14 calls**, including nonempty own pin/timezone results, foreign-resource hiding and tenant-argument rejection. Independent cleanup verified no customer fixture, queue, Mission or calendar-outbox leftovers. Eight existing operations gained verified flags after nonempty resource assertions; nine other successful scoped reads retain unverified flags where nonempty business behavior was not demonstrated. [Customer MCP/registry proof](customer-service-MCP-evidence-20261022.json).

A fresh renewable engineering session, with **zero Controller memberships**, passed official MCP client schema validation, four bounded REST pages, authorized description, duplicate-query HTTP 400 and out-of-scope description HTTP 403. `supabase.logs.query` reached the real provider with HTTP 200 and admission `8263dda8-1b69-41be-8629-c2176d3c92ed`, independently read back as `succeeded`. Wrong log source was denied before admission. The queried window had zero fixture markers: query execution is verified; event delivery is not. The session was independently confirmed retired. No VM diagnostic ran. [REST/log evidence](REST-log-MCP-evidence-20261022.json).

Real MCP writes passed GitHub file update/content restoration, detached commit creation and an isolated Supabase migration up/down. Independent GitHub readback confirmed commit `785b7ace361e0cadec85b0790c63a1707a64717d`, its tree/parent and unchanged fixture branch. Independent database readback confirmed the test table was removed. Durable mutation admissions remain conservatively `accepted`; independently observed effects do not silently rewrite that lifecycle state. Fixture recovery is not general `engineering.rollback.execute` acceptance. No project-wide secret change or test-function redeployment was repeated. [Write/recovery evidence](engineering-write-MCP-evidence-20261022.json).

Earlier unchanged evidence is retained at its actual release: canonical GCP VM read, wrong-target denial, workload scope revocation, six engineering fixture operations (including isolated function/secret lifecycle), owner engineering reads and customer onboarding/workspace provisioning. No new GCP write/remote-execution claim is made. See [prior GCP evidence](canonical-vm-read-MCP-evidence-20261021.json), [scope denials](canonical-vm-read-denial-evidence-20261021.json) and Git history for earlier checkpoints.

## Remaining work and external dependencies

1. **Shared execution durability:** ordinary nonowner customer reads still lack the owner-oriented admission receipt. Reuse the existing admission/audit infrastructure, preserving current customer grants and actual Auth verification. General mutation settlement, provider polling, cancellation/retry, recovery and independently verified compensation remain incomplete.
2. **Source/release delivery:** finish immutable general source delivery and production verification/rollback through Sandy API/MCP. Cloud Run's source candidate is not deployed. The prior protected-environment approval attempt returned HTTP 403 `Resource not accessible by integration`; authorized review through `sandy-production` is required. Do not bypass it. The older waiting run was cancelled because its acceptance still invoked VM diagnostics; the replacement acceptance uses bounded logs. No production traffic was promoted.
3. **Provider and service completion:** reconcile minimum wildcard constituents on existing typed versioned adapters, and test under genuinely approved target-specific authority. Three explicit required contract gaps remain `supabase.projects.list`, `supabase.projects.create` and `supabase.functions.invoke`. Current fixture/optional VM grants do not authorize every provider operation. Do not fabricate owner approvals or give the workload global Controller ownership.
4. **Generic computer access:** SSH/IAP/WinRM candidate code exists but production transport activation, files/packages/services, guest enrollment and isolated graphical/browser session lifecycle remain incomplete. Acceptance is **0/3**. IAP relay **4033 NOT_AUTHORIZED**, and target policy reads HTTP 403, require a legitimate IAP policy administrator to inspect current policies/etags and grant only missing VM-specific tunnel access to `sandy-computer@elaborate-haven-511518-a5.iam.gserviceaccount.com` on ports 22/5986. [Precise blocker](iap-access-blocker-20261021.md). Windows heartbeat is stale and listener/credential/host-certificate execution remains unverified. Do not repeat the same denied investigation, add public IPs or weaken host controls.
5. **Separate provider dependencies:** the default-subnet Private Google Access change returned HTTP 403 for `compute.subnetworks.setPrivateIpGoogleAccess`; this is not a universal prerequisite for private access. Custom Domain entitlement is unavailable; no provider plan purchase is authorized. These do not block unrelated software work.
6. **Whole-family acceptance:** finish positive/denied authenticated MCP execution, higher-risk independent verification and constituent reconciliation. Working token issuance/renewal is distinct from target authorization. Registry exposure/counts remain evidence-neutral.

LiveKit is already deployed and is excluded from infrastructure changes. Existing operational video APIs remain in scope. No LiveKit installation, VM repair or repeated sandy-video diagnostic is part of this release.
