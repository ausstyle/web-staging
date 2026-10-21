# Universal routing source audit

This review inventories production source readbacks from Supabase project
`zmqlyygzqoidkcwdysok` on 20 October 2026. Its inventory snapshot is
`2026-10-20T18:36:33.784802+00:00`. The source findings below retain that baseline;
the 21 October release changes are recorded separately here and in
[release validation](release-validation-20261021.json).

## Confirmed 21 October release

The published `02279e4` release initially deployed `sandy-operation-api` v8;
the published `b139a75` follow-up now runs gateway v9 with 1,021 installed IDs.
Both retain the source-attested API-only execution adapters in
`sandy-api-mcp` v4 and `sandy-operations-mcp` v71. Both Edge MCP entrypoints now
route execution only through Sandy API; the v71 release replaces the independent
v70 execution described in the historical inventory below. Downloaded runtime
source and contract modules were accounted for, with compiler-elided type-only
imports identified separately. No authenticated production session test was
established by source readback.

The Engineering Node adapter preserves its five aliases and passes 13 source
tests, but a replacement Cloud Run deployment is not attested. Consequently
universal production MCP routing remains incomplete. The active agent v4 runtime
is now v12 and uses the shared eight-operation service; router v55 and older
fallbacks remain unchanged. The broader internal application and UI migration
is still partial.

The Management metadata listed 159 functions. Of 120 successful bundle reads,
119 yielded entry source; one had no extractable entry source map. Another 39
body reads returned HTTP 429, including the two known MCP functions and the
OpenAI v4 broker. Previously archived MCP/provision/deployment sources were used
where available; a separately authorized paced read obtained the actual v4
runtime. No additional bulk requests were made after the rate limit. Thus this
is substantial source coverage, not a claim that all 159 bodies were reviewed.

Archives and per-function hashes/line matches remain outside the shared source
tree under `/workspace/sandy-api-deliverables/universal-routing-source/` and
`universal-routing-source-inventory.json`; this avoids publishing unrelated
production source or sensitive constants. Only necessary extracted runtime
application modules were added to the repository.

## MCP transports

The metadata named two Edge MCP servers: `sandy-api-mcp` and
`sandy-operations-mcp`. No additional MCP JSON-RPC, `tools/list`, `tools/call` or
MCP SDK implementation was found among the 119 extracted entries. This search
cannot exclude a protocol implementation in an unavailable body or generated
source. The externally deployed Engineering Cloud Run MCP is a third, separately
deployed transport; repository source alone cannot attest its current image.

The historical `sandy-operations-mcp` v70 archive independently authenticated a fixed
owner, executed provider/application operations and wrote deployment jobs. Its
fixed backend calls included Engineering Control at lines 441/470/1421/1893/2051,
deployment API at 569/1289/1441–1531/1761/1825, provision at 598–1271 and
1552/1677/1780/1798, customer operations API at 1322 and memory centre at 1372.
The [earlier audit](mcp-routing-audit.md) lists its sixteen named tool aliases,
underlying action families and preserved policy boundaries. Provision v52's two
`video.execution.preflight` action branches are a provision-source duplication;
that is not evidence of two equivalent legacy v70 tool implementations.

The deployed v71 legacy adapter preserves all sixteen alias names and advertises
precise compatibility gaps when the API does not expose a mapped operation.
The new Node Engineering adapter preserves its five aliases. Both dynamically
discover caller-specific Sandy API schemas/hash metadata and send every execution
through the canonical gateway with `channel:"mcp"`; neither has a provider or
legacy-backend fallback. Unknown/disabled operations fail closed. Edge deployment
and runtime source readback are confirmed; the Node changes remain source-only.
Neither source nor deployment metadata supplies owner-session test evidence.

The fixed Engineering diagnostic helper only requests `initialize` and
`tools/list` with the actual owner's credential context. It cannot call tools,
does not accept a caller host and cannot form an execution recursion through the
new transport. An older server's absent catalogue hash remains `null`.

## Active agent and fallback source

The actual `sandy-agent-runtime` v55 entry is a 30-line release router. It reads
v2 and v4 release-control tables at lines 15–19, selects a fixed runtime and
forwards existing service/QA authentication at lines 20–24. The read-only release
metadata showed v4 enabled, with `sandy-agent-runtime-v2` as rollback runtime;
the v2 control retained active v2/v1 fallback settings. The stale checked-in
runtime file must never replace this production router.

A separately preserved readback established `sandy-agent-runtime-v4` version 11,
575 lines, source SHA-256
`9c67dc1376ca14e948ce31dd02e5c172408461453d818324f0c1a58743dc5304`.
Its concrete independent action paths were:

| Active v4 source | Existing execution | Shared contract candidate |
| --- | --- | --- |
| 74–79 and imported connected-Gmail module | Explicit draft confirmation, one send claim and Sent Mail verification | `gmail.drafts.confirm_send` |
| 256–319, provider call 280 | Bounded recent Personal inbox pagination | `gmail.messages.recent` |
| 443–446 and imported connected-Gmail module | Persist exact customer-owned draft | `gmail.drafts.prepare` |
| 448–475, provider call 468 | Customer/workspace-scoped Gmail read | `gmail.messages.search` |
| 500–510 | Feature-gated paid web research via fixed v4 broker | `agent.web.research` |
| 511–524 | Feature-gated paid search of verified customer vector store | `agent.documents.search` |
| 525–533 | Feature-gated project evaluation-definition read | `agent.evaluations.list` |
| 534–543 | Feature-gated paid planning with no action execution | `agent.execution_plan.draft` |

The deployed `sandy-agent-runtime-v4` v12 calls the same shared application
service as the new `sandy-agent-operation-api`, preserving the original runtime
identity as `trusted_runtime` bound to its persisted task/customer. The customer
HTTP route derives an actual confirmed portal user and independently enforces
registry exposure, exact contracts and verified mutation gates. Neither uses a
service key as a customer session. The runtime's existing hashed/expiring QA auth
and the release router/feature flags are preserved. The extracted connected-Gmail
module is byte-identical to the original, retaining its atomic claim, no resend
policy and independently verified success criteria. See the handler's
[rollout/identity notes](../../supabase/functions/sandy-agent-operation-api/README.md).

This release does not migrate the baseline v4 conversation-model call at 330,
customer task/context/history DB operations, image-approval task creation, or
fallback runtimes. The v2 version 13 fallback still directly calls Composio at
279/457 and OpenAI Responses at 329/476/490/510. The v1-backup-r50 version 3
fallback does so at 257/431 and 307/450/464/484 respectively. Their fallback
semantics require separate source-based extraction and regression coverage;
retargeting the release router would not satisfy universal execution contracts.

## Other direct internal execution

These source matches identify work still requiring contract/shared-service
reconciliation. They are not all MCP bypasses: a provider adapter or authorized
job consumer behind Sandy API legitimately executes a provider. The relevant
question is whether callers share governed contracts and principal context.

| Function snapshot | Concrete independent provider path |
| --- | --- |
| `sandy-examiner-live-review` v7 | Service-authenticated at 15; persists run at 18; direct OpenAI Responses at 90 for customer-turn quality review |
| `sandy-computer-worker` v45 | Direct Responses at 81; separate Edge dispatch at 14 |
| `sandy-mission-runner` v17 / `sandy-mission-executor` v7 | Direct Responses at 31/56 and 39 |
| `sandy-memory-centre` v28 / `sandy-memory-operations` v12 | Direct Responses at 93/141/289/322/352 and 15 |
| `sandy-api` v29 | Direct Responses at 37/91; separate application API entry |
| `sandy-gmail-send-verification` v6 | Fixed Composio execution helper at 37, send/readback at 46/60; receipt workflow distinct from the extracted customer draft service |
| `sandy-composio-gateway` v32 | Tool execution at 382; central customer adapter can legitimately delegate after independent tenant authorization |
| `sandy-openai-agent-planner` v6 | Context guard at 14 and fixed model broker at 16; existing internal integration auth, planning-only output |
| `sandy-openai-file-search` v7 / `sandy-openai-research` v6 | Existing guard/broker paths at 30/32 and 15/17 |

Further direct Responses matches were found in email-ai-learn v27:66,
email-ai-send-reply v126:206/397/885, sandy-auto-improve v11:36,
sandy-feature-discovery v8:155, sandy-knowledge-engine v7:95,
sandy-life-classify v8:12, sandy-qa-engineering-investigator v4:29,
sandy-qa-generate-cases v5:17, sandy-qualitative-qa v17:9,
sandy-shared-artifact-worker v5:20, sandy-universal-file-intelligence v11:36/71,
sandy-voice-memory-review v11:57, sandy-whatsapp-learn v7:18 and
sandy-windows-ai v21:57. Those paths need preserved event/customer/worker identity
and shared budget/context controls, not invented owner sessions. The
engineering OIDC-ingest v79 matches at 137/170/426/680/886 include embedded source
and deployment generators; literal matches alone do not prove reachable provider
execution by the ingest handler itself.

## Existing UI clients

Existing UI endpoint references remain for compatibility. They include chat and
app `sandy-workspace`, agenda/tasks `sandy-agenda` and `sandy-promote-mission`,
calendar `sandy-calendar-api`/Composio/import, memory centre/social graph,
files/task-files, Controller API, temporal API and v3 portal. Representative
repository references are chat/index.html:6, app/index.html:172,
agenda/index.html:637/1655/2469, calendar/index.html:54/283/327,
memory/app.js:5, files/index.html:12 and controller/index.html:74.

These UI references were not changed or presented as migrated. Fixed canonical
API adapters for the existing application services can preserve these backend
business rules while API/MCP coverage is completed; later UI adoption still
needs explicit compatibility tests. A simple endpoint search cannot establish
that every user flow already traverses Sandy API.

## Evidence still required

The deployed release preserved actual source versions and authentication
settings and recorded runtime source hashes. Real API→MCP calls still need an
appropriately scoped session and reachable endpoint. Source fixtures and
registry registration are not production verification. Missing owner/customer sessions defer their exact
authenticated tests, not independent implementation. Unverified sends and paid
models stay disabled at the public API. Provider credentials are neither test
user credentials nor substitutes for tenant identity.

The 39 rate-limited bodies, actual Cloud Run image/source, v4 broker policy,
older fallback migrations and the remaining internal model/event workers are
explicit review gaps. They must not be counted as completed merely because
canonical catalogue entries or adapter source exist.
