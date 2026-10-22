# Internal reliability diagnosis routing

The `sandy-auto-improve` compatibility endpoint now calls the named private
application operation `agent.reliability.diagnosis.propose@1.0.0`. This source
candidate has not been committed or deployed. The public agent API remains an
eight-operation catalogue; this operation has no public JSON route and all
API/UI/AI/verified flags remain false. It is sensitive, mutates proposal records
and consumes model resources.

The authorized read-only production inspection found ACTIVE version 12 with
`verify_jwt=false`, bundle SHA-256
`539abd9d3ae90bcc94b53f8ad7e9e17eb3267e9fd9db35cd0cbc0d011a2455d9`
and original entrypoint SHA-256
`7b66252c752cfd9fb4e74c6e44f325ec83aea29a3eecaaf04250b4d120080c74`.
That source is identical to archived version 11. Numeric versions may change
with secret-only configuration refreshes; deployment must guard the source hash.

The adapter preserves the existing dedicated `SANDY_AUTO_IMPROVE_KEY`, with
`EMAIL_AI_INTERNAL_KEY` fallback, and the existing service credential solely for
database transport. A customer, Controller, runtime/QA, or generic service bearer
does not grant this automation proof. A process-local capability binds the exact
stored job, source type/reference and problem; it cannot pass the customer or
runtime-principal checks and cannot be reconstructed from JSON. No customer,
Auth UUID or owner role is generated.

The fixed shared Responses transport preserves the original `gpt-5.2` model,
high reasoning, `store:false`, JSON-object format, 4,500 output-token limit,
instructions, input and 65-second timeout. No broker token or alternate profile
is introduced. The model can propose investigation steps and changes; no code,
migration, deployment, payment, customer tool or connection repair is executed.
Response text and provider diagnostics are not logged on failure.

Migration `10050` adds a separate one-use receipt because the existing job status
constraint supports `queued`, `analysing`, `proposed`, `failed` and `resolved`,
without an unknown value. An atomic RPC locks the actual queued job, checks its
stored source/problem and exact adapter source hash, inserts the unique claim,
and changes the job to analysing before a paid request. Another RPC verifies the
actual saved proposal and any QA handoff before recording success. Receipts keep
hashes and a model response ID, without failure text, credentials or proposal
bodies. Public and customer roles cannot access them; service transport can read
receipts and execute the narrow RPCs, with no direct receipt insert/update grant.

A lost result, invalid response, interrupted save or unavailable final receipt
cannot repeat the model call. The legacy automatic retry of failed jobs after an
hour is removed, including historical failed jobs whose model outcome is not
known. A received/saved proposal remains saved if a later handoff fails; its
receipt remains unknown or started and requires reconciliation. A model response
receipt does not prove a root cause, regression, deployment or provider action.

QA proposals retain the exact approval-required, unverified engineering handoff
and its existing trigger. The actual database also enforces a foreign key to
`sandy_evidence_improvement_queue`; a missing real QA issue is rejected before
model consumption. The operation does not invent a queue entry or approval.

Eight Deno compatibility tests cover actual adapter authentication and original
response shapes, exact archived policy/timeout, nonserializable capabilities,
concurrent/unknown/repeated requests, historical failed jobs, missing provider
configuration, lost claims/save receipts, and real-issue/approval-handoff scope.
The real PostgreSQL component rollback exercises 24 metadata, privilege,
claim/state-transition, scope, saved-proposal and handoff checks. All fixture
jobs and handoffs are rolled back. The initial SQL fixture attempted a scope
change without a terminal transition and was correctly rejected by the earlier
transition guard; the fixture was corrected to reach the scope guard.
No model/provider/customer execution is claimed. Parent release controls the
final source hash, permanent migration, deployment and source readback.

Other workers, Controller/portal entrypoints and UI clients remain independent
routing work. This private extraction does not establish universal production
Sandy MCP routing.
