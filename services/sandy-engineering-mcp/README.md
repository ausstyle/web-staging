# Sandy Engineering MCP

Version 0.2.0 is a thin, stateless adapter to canonical Sandy API. Every authenticated
request refreshes the caller's API catalogue. Tool discovery uses its exact input
and output schemas and includes `sandy_catalogue_version` in result metadata.
Execution calls only `sandy-operation-api` with `channel:"mcp"`; API owns permissions,
schema validation, installed handlers and provider execution.

## Compatibility tools

| Existing name | Canonical operation |
| --- | --- |
| `sandy_model_route_readiness` | `engineering.models.readiness` |
| `sandy_run_model_canary` | `engineering.models.canary` |
| `sandy_video_install_preflight` | `video.install.preflight` |
| `sandy_video_execution_preflight` | `video.execution.preflight` |
| `sandy_engineering_change_details` | `engineering.change.get` |

These aliases appear when their API operation is executable and exposed to MCP for
the caller. Other exposed canonical operations are discovered dynamically. The
alias table translates names; it supplies no separate schemas or executor policy.
Unavailable aliases are listed explicitly in `_meta.sandy_unavailable_aliases`.
Calling an unavailable alias or operation returns `canonical_operation_unavailable`
with its operation ID and `executed:false`. There is no legacy or provider fallback.

Successful calls retain the MCP text-content envelope and `http_status` compatibility
field. The two video aliases retain their former nested JSON-RPC text envelope as
formatting. They no longer invoke a second MCP. `structuredContent` contains the
API-owned handler payload, and `_meta.sandy_api` preserves the canonical execution
envelope. Domain failures remain errors even when HTTP is 200. A typed `202` receipt
can represent successful admission with a recorded retry or existing job identity,
current state and `executed:false`; it never becomes a completed provider operation. A lost response
reports `executed:null` and requires reconciliation.

## Authentication and runtime

Clients supply a real Supabase user access token in `Authorization: Bearer <token>`.
The adapter forwards it only to Sandy API, which independently authenticates and
authorizes the user. An incoming `x-sandy-api-key` also travels unchanged on discovery
and execution; API must validate all supplied context. The adapter does not derive
a principal or permissions from the key.

For clients that send a `sandyop_...` or issued `sandy_api_...` key in the bearer header, configure the public
project anon JWT. The adapter then sends that public JWT as gateway authorization
and the original opaque key in `x-sandy-api-key`. This transport translation does
not create a user session or authenticate the key. Missing public JWT configuration
and conflicting opaque keys fail explicitly. A service-role JWT is rejected for
this configuration. No service-role credential is used as a customer session. No
tokens, catalogue bodies or provider payloads are persisted or logged. Redirects
are rejected and API responses have an explicit size limit.

`SANDY_SUPABASE_PROJECT_REF` defaults to `zmqlyygzqoidkcwdysok`; `PORT` defaults to
8787. `SANDY_SUPABASE_ANON_KEY` (fallback `SUPABASE_ANON_KEY`) supplies optional
public project-key configuration; a public anon JWT is required for opaque bearer
translation. Supabase JWT verification remains enabled at the API gateway. Serve
HTTPS `POST /mcp` behind the production reverse proxy. `GET /healthz` is liveness
only and does not attest API or provider access.

From this directory run `npm install --package-lock=false --ignore-scripts`,
`npm run check`, `npm test`, and `npm start`. Existing dependency ranges remain
unlocked; perform the container's checks against the resolved versions when
releasing. Local tests exercise real HTTP/MCP transport against an injected
canonical API fixture, including every alias. They are not deployed user-session
or provider integration evidence.

This source change does not deploy the Cloud Run service. Before replacing an
existing instance, verify the canonical operations, compare successful legacy
envelopes, and run authenticated deployed regressions. Missing model readiness or
canary contracts are explicit compatibility gaps; the adapter does not replace
them with direct backend calls. The model canary's existing bounded content checks
do not establish general model quality or authorize routing changes.
