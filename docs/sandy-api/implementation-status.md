# Sandy API implementation status

Updated 21 October 2026 following the dedicated engineering workload production tests.
The earlier 05:12 report is retained in [the historical snapshot](implementation-status-20261021-0512.md). Its write-credential blocker and zero newly verified operations are superseded by the evidence below. This report does not certify completion of the 161 requirement families.

## Source and production delivery

GitHub push authorization works. Remote branch `engineering/sandy-api-project-reads-20261020` was independently read back at `545fa35afd2af4ded680dc85cc0491bdd03a018f`. [PR #136](https://github.com/ausstyle/web-staging/pull/136) remains a draft; no merge is established.

Gateway source `545fa35` deployed successfully as code version 24, with `verify_jwt=true`. Its compiled, whitespace-compacted entrypoint and all 116 uploaded dependencies were read back and accounted for against preserved Git sources. Test secret creation/removal subsequently advanced metadata versions without changing function sources.

The latest observed ACTIVE metadata versions are gateway 26, MCP 14, private engineering runtime 3, engineering control 43, provider operation API 12, provider gap API 7, and isolated test fixture 9. Gateway/MCP/provider JWT verification remains enabled. The private engineering runtime validates its revocable Vault bootstrap credential before obtaining a genuine short-lived Auth workload session; it returns no credentials.

## Verified engineering execution

The dedicated normal Supabase Auth identity has no Controller membership. An explicit owner-authorized fixture policy permits six operations. It obtains legitimate fresh sessions independently of `SANDY_CONTROLLER_ACCESS_TOKEN`; normal API Auth verification and immutable provider approvals remain enforced.

All six are discovered with input schemas and executed through Sandy MCP → Sandy API → provider:

- `github.files.update`: isolated branch file updated, provider contents checked, original contents restored through MCP.
- `github.commit`: detached Git commit object created; branch reference preserved. This operation does not advance a branch.
- `supabase.db.migrations.apply`: isolated RLS-protected fixture table created, marker checked, table removed by a forward rollback migration through MCP.
- `supabase.functions.secrets.set`: isolated noncredential test value set, provider digest checked, test secret removed.
- `supabase.deploy_edge_function`: reviewed fixture version two deployed and preserved version one redeployed through MCP; the restored function returned its expected response to a genuine normal Auth session.
- `supabase.logs.query`: real fixture console marker retrieved through MCP; the engineering scope filters out other project log entries.

Live session retirement caused fresh authenticated sessions. Bootstrap rotation advanced epoch/generation to two, denied the old credential with HTTP 403, and accepted the replacement. Invalid credentials and out-of-scope operations failed closed. Natural expiry/renewal is covered by clock-based tests; the live renewal test used supported session retirement rather than waiting an hour. Eight ordinary nonowner boundary tests passed after deployment and their fixtures were cleaned up.

Validation: 164 committed-source regression tests passed; all 109 gateway tests also passed against the exact uploaded compact entrypoint. Earlier broad candidate validation comprised 530 passing tests, not an additional independent operation count. PostgreSQL rollback checks and six credential-handling Python tests are preserved in the engineering evidence artifacts.

[Registry evidence and exact observed versions](engineering-workload-evidence-20261021.json) records genuine production outcomes. Registered operations: **2,573**; API exposure flags: **435**; AI exposure flags: **418**; verified flags: **21**. These flags are not executable/discoverable/end-to-end counts. This engineering pathway has **11 distinct operations with actual MCP end-to-end evidence**: six provider operations and five supporting change-management operations. Its dedicated identity discovers and provider-verifies exactly six. Global universal MCP access is not certified.

The requested identifiers `supabase.functions.logs`, `engineering.deploy.verify`, and `engineering.rollback.execute` remain absent from the registry. Actual log retrieval uses `supabase.logs.query`. Concrete source, migration and function rollback was demonstrated; a generic recovery identifier is not claimed.

## Customer onboarding and provisioning extension

The extension is being implemented within the existing Sandy API architecture. Inspection confirmed canonical `email_customers`, unique normalized customer email addresses, verified WhatsApp identity links, portal accounts, commerce entitlements/plans, and the existing Drive provisioning queue. These records must be reused rather than replaced.

Three new operations are deployed and verified through MCP: `customer.onboarding.ensure`, `customer.onboarding.update` and `customer.identity.get`. They reuse canonical customer IDs, verified Auth email ownership and the existing verified WhatsApp links; unverified contacts remain provisional. Revocation is checked before receipt replay, and profile changes use optimistic concurrency. An organisation name is profile metadata and grants no organisation membership.

Gateway **28** and customer provisioning service **2** are ACTIVE with JWT verification enabled, from preserved source `dd824bf`; all uploaded sources were accounted for in production readback. The additive ledger migrations are `20261021130000`, `20261021130010` and `20261021131000`. The last corrects an actual result-propagation defect found during live testing; the initial MCP failure and fixture cleanup are retained as failed evidence rather than counted as success.

[Onboarding evidence](customer-onboarding-evidence-20261021.json): **20 live checks passed**, using two normal password Auth sessions with no Controller membership. All three operations succeeded through MCP; discovery before enrollment, duplicate requests, cross-customer input, stale updates and revoked receipt replay were tested. Both users were logged out/deleted and all customer, portal, email-address, onboarding, receipt, memory and Drive-queue fixtures were independently confirmed absent. Existing customer tests passed **23/23** and engineering nonowner denials **8/8**. The reviewed source passed **175** focused tests, the exact compiled gateway **113**, and PostgreSQL rollback checks **31**. These suites overlap and are not operation counts.

The dedicated engineering identity still discovers only its six authorized fixture tools. Adding the three genuinely verified customer operations brings this session's distinct engineering-plus-onboarding MCP evidence to **14 operations**. Global executable/discoverable coverage and complete wildcard families are not certified. Feature definitions, provisioning templates, quota/budget policies, resource jobs/registry/reconciliation, organisation membership and the remaining provider adapters are the next implementation work. No new external provider resources were provisioned by onboarding.

## Remaining dependencies and incomplete work

The dedicated engineering identity authorizes isolated engineering fixtures only. It does not grant general owner/customer/provider authority. Other required operations must retain their actual authorizations and receive separate execution evidence.

Runtime Google Cloud egress, authenticated remote VM administration, LiveKit installation and a demonstrated two-participant conference remain unverified. Custom Domain provider entitlement is a separate dependency; no plan purchase or upgrade is authorized. Repository source delivery, SSH/WinRM, durable execution/lifecycle work and the full 161 constituent-operation reconciliation remain incomplete. Uncommitted next-release adapters are not represented as production capabilities.
