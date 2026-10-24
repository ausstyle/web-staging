# Core API canonical mapping review

SANDY-ENG-0005, families1–11. The JSON companion pins the reviewed source bytes and preserves actual builtin route semantics. This review changes no gateway, shared worker or live operation.

The generic capabilities routes use caller-filtered `action=list/describe`; Google Cloud discovery is a supporting provider adapter, not the universal catalogue. Their canonical registry-operation/HTTP/MCP equivalence remains an explicit obligation. Job routing classifies actual durable versus legacy jobs after authentication. Required get/events/cancel/retry operations include both families; a durable-only candidate list previously hid the legacy path. Rollback remains an approved `system.lifecycle.compensate` with server-selected source snapshot, not an arbitrary replay.

Source review found concrete limits that block full acceptance: the audit resource filter currently accepts an operation ID rather than arbitrary target-resource identity; plan validation explicitly reports no provider dry-run, unavailable monetary pricing and read-only blast radius; plan execution supports bounded owner-read DAGs, not general tenant or mutation graphs. These are software/integration obligations, not requests for broader permissions. Actual running cancellation, uncertain-effect retry and production compensation still require independent functional proof.

The review preserves Runtime ownership of shared worker/queue/lease/cancellation implementation. API will not patch those production components in parallel. Existing API job-route and orchestration tests validate current behavior; they do not prove broader behavior or live execution. No family is marked accepted or implementation-complete.
