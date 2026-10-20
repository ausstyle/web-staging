# Sandy API-first MCP architecture (proposed migration)

## Invariant
**Sandy API owns the capability; Sandy MCP only exposes it.** External GitHub, Supabase Management API, Google Cloud, communications, memory and mission providers must be called by API handlers, never MCP adapters. A catalog entry or credential probe does not prove executability.

## Proposed contracts
- API entrypoint: `sandy-operation-api` accepts owner-authenticated `list`, `describe` and `execute` requests.
- MCP entrypoint: `sandy-api-mcp` exposes `tools/list` and `tools/call`, translating to those API requests only.
- Transport carries the caller's identity; the API independently checks tenant/owner permissions.
- Handler allowlisting is enforced in the API; a model cannot choose an arbitrary URL, Edge Function or provider call.
- Mutations are **not** enabled in the bootstrap implementation. Each must be added in the API with idempotency, request/operation ID, durable receipt, provider outcome reconciliation, and rollback or forward-repair plan.
- Capabilities must carry independently observable states: registered, implemented, authorised, credential-tested, executed, provider-verified, rollback-tested.
- Status labels must not change on account of registry presence alone.

## Deployment and compatibility
This is an incremental alternative adapter, **not** a replacement of active `sandy-operations-mcp` until tests have passed. The existing MCP must remain operational throughout rollout. Sandbox and production read-only discovery/execution must be tested first.

**Schema gate:** The bootstrap API references `public.sandy_api_operations`. Before deploying, reconcile this reference against the actual canonical operation-registry table/view and its columns. Do not create a competing registry merely to satisfy the bootstrap. The PR must not be deployed until this compatibility check passes.

## Acceptance
1. The gateway denies unauthenticated requests and users not in Sandy Controller.
2. Discovery shows only operations implemented and enabled by Sandy API. A registered but unimplemented operation fails closed.
3. `engineering.preflight` and `deployment.management.preflight` run through thin MCP and return API provider evidence.
4. No MCP code contacts `api.github.com`, `api.supabase.com`, or Google Cloud directly.
5. Existing MCP V2 clients and customer-facing traffic remain unchanged.
6. Backend writes are only introduced after per-operation integration tests, evidence receipts, reconciliation and rollback tests.
7. A controlled release with recorded source SHA, deployment version, functional smoke and rollback is completed before making this the production default.

## Current implementation limits
The new functions are source-level bootstrap modules, not deployed. The current production API remains in service. No assumption is made that arbitrary GitHub source editing or Supabase migration deployment is already exposed by MCP.
