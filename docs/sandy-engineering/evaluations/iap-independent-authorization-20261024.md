# Independent IAP proposal authorization

Submission approval is not IAM execution authority. The existing engineering identity's general high-risk registration request returned HTTP 403 `engineering_registration_scope_denied`; its allowed risks were not changed or disguised.

The new private administration RPC `sandy_engineering_submit_iap_repair_proposal()` accepts no caller-selected scope. It requires a fresh normal authenticated engineering session, active scoped registration authority and current Owner relationship. It records only the exact reviewed two-target request as **high risk / proposed**, idempotently, with an authenticated submission event. It creates no grant, Owner event, command or provider effect. It adds no operation-catalogue entries.

The existing Engineering Delegation page gains a separate Owner review section. Only a genuine current Owner with a live normal Supabase Auth session can establish or revoke this separate policy using revision concurrency. The workload and service transport cannot call the setter successfully or update the new policy columns. The proposal remains proposed; it is not converted into a routine source-release approval.

The new policy fixes project, machine principal, role, two numeric VM IDs and ports, with expiry capped at 30 October 2026, 21:17 UTC. It authorizes no guest commands, credentials, agent enrolment or graphical input. The protected resolver independently requires the current policy, live workload identity/session, current Owner, and immutable matching Owner authorization audit. Read delegation revision 1 and canary v6 are preserved; their source and audit guards are unchanged. A separate audit guard protects the IAP Owner events.

The installation workflow applies only a forward authorization migration and verifies source/ACLs. It establishes **no grant** and calls **no Google API**. Source and disable-new-entrypoint rollback artifacts are retained. It then submits the proposal with the actual normal workload and verifies self-authorization and Owner-review requests return HTTP 403, followed by session retirement.

Isolated PostgreSQL tests cover idempotent proposal submission, high-risk classification, absent-grant denial, anonymous/service/workload rejection, actual separate Owner fixture authorization, wrong revision/expiry/proposal rejection, immutable audit, revocation and retired-session denial. These fixture sessions are not real Owner sessions or production acceptance. The migration also compiles with its privilege assertions in a fully rolled-back live database transaction.

Provider IAM application still needs a protected one-use write admission and runtime transport that honors the independent grant, fresh full policy/etag preservation, provider-enforced expiry, independent readback and recovery. The existing Cloud Run candidate remains read-only. No tunnel or OS execution is certified by this authorization foundation.
