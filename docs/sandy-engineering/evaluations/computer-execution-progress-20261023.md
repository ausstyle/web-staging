# Infrastructure execution checkpoint — 23 October 2026

Read-only acceptance run 40026102410 is complete and unchanged. No repeat acceptance, deployment, IAM write, agent enrolment or promotion was performed for this checkpoint.

Targeted authenticated Edge MCP → Sandy API → existing administrator worker reconciliation returned both fixed IAP policies HTTP 200, etag `ACAB`, with no instance-level binding for `sandy-computer@elaborate-haven-511518-a5.iam.gserviceaccount.com`. Admission: `dc930102-1130-4493-b6f4-8d020d17cab3`. Inherited access was not enumerated; this observation alone does not establish effective tunnel denial. The historical 4033 probes were not repeated.

Independent database reads show zero native host bindings, three native execution contracts still closed/unverified, and standing delegation v6 without native-command authority. The legacy Windows heartbeat remains 19 October 2026 at 23:43:45 UTC. None is evidence of guest execution.

The [restricted authority proposal](computer-execution-authority-20261023.json) separates IAP changes, harmless command authority and enrolment. It is not an installed grant. The existing trusted Cloud Run worker exposes reads only; applying a separately approved repair requires its own protected write admission, not reuse of a read admission or an unprotected privileged call.

## Software changes

The existing IAP repair planner now requires a canonical future UTC expiry within 30 days and embeds it in the provider IAM condition alongside the fixed port. Apply rejects expired and legacy unbounded plans before provider access. Full preimage checks, one-shot writes, independent readback and rollback preimages remain. Seventeen focused tests passed; they do not prove an IAM mutation or working tunnel.

The existing pending runtime computer identity module is preserved from the shared runtime checkout and now rejects terminal, expired, invalid and unbounded graphical sessions before task binding. Paused/stopped sessions remain eligible for separately authorized resume. Three lifecycle tests cover terminal states, exact expiry, human takeover and target identity. This module is a source foundation for the pending worker, not an activated graphical execution path. The other checkout's unpublished worker code is unchanged. Dispatch-time lifecycle rechecks and provider state readback remain required; this check does not replace them.

## Remaining execution gates

- Explicit, separately established IAP write authority for the exact proposed two-target, port-and-time-limited addition.
- Protected runtime repair operation and admission integration; current worker remains read-only.
- Separate native command delegation plus trusted host bindings and legitimate guest credentials. v6 and read-only revision 1 do not confer them.
- Separate enrolment authority if using managed agents; no enrolment has been authorized or performed here.
- Graphical worker integration, dispatch-time revocation/expiry checks, lifecycle receipts and authenticated provider/MCP acceptance.

Linux, Windows and graphical OS acceptance remain **0/3**. No new operating capability is claimed from source tests or policy inspection.
