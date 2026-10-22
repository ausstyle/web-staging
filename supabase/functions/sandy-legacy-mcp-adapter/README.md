# Legacy Sandy MCP adapter candidate

This is replacement transport source for the existing `sandy-operations-mcp`
endpoint. It contains no database client, service credential, provider endpoint or
independent executor. Every authenticated request refreshes Sandy API discovery;
every operation invocation calls `sandy-operation-api` with `channel:"mcp"`.
The gateway independently authorizes the caller and validates the current schemas.
This source change does not itself replace the production v70 function.

The adapter publishes current API tools with their original input/output schemas
and preserves all 16 legacy alias translations. Unavailable aliases appear in
`_meta.sandy_compatibility_gaps`; calls return `canonical_operation_unavailable`
with the exact operation and `executed:false`. There is no legacy or privileged
fallback. `deployment_request` also reports unavailable canonical request forms
in its tool metadata. Existing API exposure and verification policy remains
authoritative, including AI-disabled status reads and unverified mutations.

| Existing alias | API contract or discovery action |
| --- | --- |
| `operations_list` | API capabilities, filtered locally by domain/limit |
| `operations_describe` | API describe with MCP exposure enforced |
| `operations_execute` | Selected registered operation; API validates its schema |
| `operations_status` | `deployment.jobs.get` |
| `deployment_status` | `deployment.jobs.status` |
| `cloud_vm_status` | `google_cloud.vm.status` |
| `cloud_run_status` | `google_cloud.cloud_run.status` |
| `deployment_approve_read` | `deployment.jobs.approve_read` |
| `deployment_execute` | `deployment.jobs.execute` |
| `vm_bootstrap_status` | `google_cloud.vm.bootstrap_status` |
| `vm_service_status` | `google_cloud.vm.service_status` |
| `vm_install_worker` | `deployment.jobs.request`, with the original fixed worker-install scope |
| `cloud_targets` | `cloud.targets.list` |
| `engineering_change_register` | `engineering.change.register` |
| `engineering_change_approve` | `engineering.change.status`, fixed `status:"approved"` |
| `deployment_request` | Generic request, engineering implementation request, or the original three Engineering Control special forms |

Schema transformations only wrap canonical schemas and hide injected constants;
local references and schema resource IDs are rebased for legacy envelopes.
The adapter preserves the legacy JSON-RPC text-content result envelope, projects
target arrays and job records for their old aliases, and keeps the complete
canonical result in `_meta.sandy_api`. `structuredContent` uses the canonical
output shape. Recorded admission remains `executed:false`; lost execution
responses report `executed:null` and require reconciliation. No automatic retry
occurs. Current external-deployment reconciliation fields are projected from the
API job record rather than inferred by the transport.

Two compatibility differences are explicit:

- `operations_list` lists caller-authorized executable MCP operations. It reports
  that raw uninstalled registry rows and edge-function inventory are absent;
  it does not fabricate empty inventory results.
- The old transport hardcoded one owner identity. This adapter delegates identity
  and operation permission checks to the shared API. Sensitive owner operations
  still require the gateway's owner authorization; tenant operations require
  independent tenant access. No transport-specific ownership bypass is added.

Clients normally send their actual Supabase JWT. For delegated keys behind the
existing Supabase platform JWT check, clients send public anon JWT authorization
plus the private issued key in `x-sandy-api-key`. Both headers are forwarded
unchanged to the API. Only the API resolves the principal and scopes. The adapter
does not create sessions, read credential tables or substitute a service key.
An opaque bearer-only key must be translated by an upstream transport configured
with the public anon JWT; this Edge endpoint retains platform JWT verification.

Clients can also supply `x-sandy-approval-id` and `x-sandy-request-id` as optional
UUID headers. The adapter forwards them unchanged to Sandy API beside the same
caller credentials. Empty, malformed or duplicate values are refused before API
discovery or execution. Use a new request ID for each distinct execution and
retain it for retries of that execution. The API binds an existing approval to
the actual caller, operation, arguments and scope; transport metadata adds no
permission and does not change the API-derived tool schemas.

When packaging this source as the existing function, retain slug
`sandy-operations-mcp`, `verify_jwt:true`, its public OAuth resource URL and issuer.
The self-contained entrypoint requires only `SUPABASE_URL` and the existing public
`SUPABASE_ANON_KEY`. Archive the prior deployed source, record actual versions,
and run authenticated compatibility regressions through the canonical API.
Do not infer a Cloud Run or Edge deployment from a source commit.

Run `deno test supabase/functions/sandy-legacy-mcp-adapter/`. Tests cover all aliases,
canonical schemas and schema-reference transformations, exposure changes, private
key transport, legacy result projections, malformed RPC/auth requests, truthful
queued/unknown outcomes, and composition with the actual API handler. Provider
responses and identities are fixtures; these tests are not production integration
or new registry-verification evidence.
