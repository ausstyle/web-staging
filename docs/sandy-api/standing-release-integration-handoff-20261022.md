# API and runtime release integration handoff

Observed 22 October 2026 UTC. This is a source/release integration dependency within SANDY-ENG-0005 and the existing runtime task, not another architecture project.

PR #136's source branch is `engineering/sandy-api-project-reads-20261020`. Main `54d6d26` was normally merged into the API branch; no source history was force-pushed. The API releases preserve the independent runtime/customer work.

Production API gateway 56 and provider 29 have exact committed/uploaded source readback. The renewable private engineering runtime is **15**, source `152db5e381f2dd709c6f3f7dabe6b4dcd406af7e`. MCP remains 21. Keep those actual baselines when preparing another release.

Main's `.github/workflows/sandy-runtime-release-checks.yml` references executive and delegated-release modules absent from main/API source. Those modules exist in the separate `engineering/sandy-unified-intelligence-20261021` source at `2994c411bf84d5e9b31f0a403c722c7f07565238`. Do not weaken, skip or falsely mark the checks passed; reconcile the intended source before claiming green CI or merging.

The frozen `docs/sandy-engineering/evaluations/p0-amendment-b-release.json` pins that separate candidate and manifest `c37cc7b377c4f7284ac6c81e032464583dd7388b096b8681a6c32f655efa100b`, and describes preserving runtime **14**. Production is now **15**. Refresh/review the precise source manifest and baseline before executing it; do not silently overwrite the current Auth/session/transport fixes with the old artifact.

The separate candidate contains `20261022020000_sandy_autonomous_engineering_policy.sql`. API migration `20261022020000_sandy_customer_read_admissions.sql` is already committed and deployed under the same version. Renumber the **undeployed** migration and update its reviewed manifest before applying it; do not rewrite the deployed migration ledger.

Reuse the existing `autonomous_release.ts`/`routine_delegation.ts` attested-release design from that task after source reconciliation. Current deployed Control's workload actions are metadata (`register/get/list/test/artifact`); it does not yet admit the proposed general unattended release action. The API standing provider envelope is not proof that this separate release protocol has been installed or accepted.

Initial/delegation administration must use legitimate administrator authority, with immutable provenance and revocation. Never manufacture an Owner approval/session or let the workload change its own grant. Routine actions already inside the active API envelope do not need another human approval.

The previously recorded worker workflow `39692384698` waited at `sandy-production`; its approval attempt returned **403 Resource not accessible by integration**. This session did not retry approval or bypass the protected environment. Verify the actual current source, job and safe rollback before any authorized promotion; the historical `e49eca5` candidate must not be blindly released.

No LiveKit, VM networking, customer runtime, email/WhatsApp/voice processing or commercial entitlement was changed by these API releases. IAP and Custom Domain dependencies remain separate from executable GitHub/Supabase engineering work.
