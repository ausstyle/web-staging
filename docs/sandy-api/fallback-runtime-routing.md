# Fallback runtime application service extraction

The v2 and v1-backup-r50 candidates reuse the eight governed agent operations:
customer-owned Gmail search/recent/draft/confirmed send, web research, private
document search, evaluation listing and planning. They call the same application
executor as `sandy-agent-operation-api` and the active v4 runtime. This is a source
candidate; deployment and positive production session/provider tests are separate.
The shared-eight extraction was committed as `6e0354f` and deployed as ACTIVE
v2 version 15 and backup version 5. Release receipts account for all seven/six
uploaded source modules respectively; authenticated runtime execution was not
established. Eight registry evidence rows were updated while verification fields
were preserved. Conversation extraction was subsequently committed as
`65f331b`, migration `10000` applied, and the fallbacks deployed as v2 version 16
and backup version 6 with exact source readbacks. The active-v4 follow-on below
is a separate source candidate.

The archived v2 source was observed at version 13 with SHA-256
`d4354d6202851117b36b5e507bfecf52b0497524fb260f29c72f124d36986b78`.
The archived v1-backup source was observed at version 3 with SHA-256
`f4bfcd9191660fb4f2784d1e9d30151f204bee5eca096d49d02fa9fe330ab993`.
Secret-only configuration updates can increment numeric deployment versions.
Before release, compare current production source against these exact hashes;
resolve the actual numeric versions independently. The release router and its
fallback/feature controls are unchanged by this extraction.

The shared authentication resolver preserves the existing service or hashed,
expiring QA credential policy. Its process-local runtime proof is bound to the
task the handler actually reserved, including customer, channel and request ID.
It never creates a customer or Controller session from a service credential.
The compatibility transport capability is bound to that exact trusted task
principal through a WeakMap and selected by a fixed server adapter. Public JSON,
serialized objects and user headers cannot select it. Normal customer API calls
continue using the default v4 broker behavior and public verified exposure gates.

The original fallback actions used the OpenAI Responses API directly with the
existing OpenAI credential. Their private profiles preserve that fixed transport,
`gpt-4.1-mini`, web/file tool payloads, token limits and 65/45-second deadlines.
They add no broker-token dependency. Common provider execution and business rules
remain in the shared service, including tenant store lookup, feature flags,
durable operation claims, no automatic replay of unknown paid outcomes, and
planning-only results. Their Gmail module is byte-identical to the archive and
retains immutable draft contents, explicit confirmation, atomic send admission,
and independent Sent Mail readback. The compatibility adapter retains the empty
Gmail query default `in:anywhere`.

The source guards record hashes of unchanged request validation, tool schemas,
customer context, model selection, conversation instructions/rounds, task/history operations,
image-approval creation and result persistence. They also pin the unchanged
version-awareness dependency. Run:

```sh
python3 scripts/sandy/verify_fallback_source.py
deno test --allow-env --allow-read=supabase/functions,scripts/sandy/testing \
  --import-map=scripts/sandy/testing/fallback_import_map.json \
  scripts/sandy/fallback_runtime_test.ts \
  supabase/functions/_shared/sandy-agent-operations/runtime_conversation_v4_transport_test.ts \
  supabase/functions/_shared/sandy-agent-operations/runtime_profiles_test.ts \
  supabase/functions/sandy-agent-operation-api/index_test.ts
```

The adapter tests execute the actual handlers, identity capabilities,
contracts, Gmail code and shared executor with fake database/fetch transports.
The test-only import map replaces Supabase transport and Edge declarations; it
is not deployed. All provider hosts are intercepted and no network permission is
granted. Six profile regressions additionally verify transport restrictions and
the default v4 broker, alongside the existing 19 service/API regressions. The
active-v4 candidate passes 56 tests in total (29 adapter/capability tests,
two v4 transport tests, six profile tests and 19 existing service/API tests).

The follow-on `agent.runtime.conversation.respond` operation has a concrete
versioned contract and a process-local capability bound to the actual persisted
task, channel, request ID and nullable customer. This capability cannot pass
`isAgentPrincipal` or authorize customer operations. A no-customer task retains
the original empty tool list. The source adapter captures the existing selected
model, instructions, initial input and exact archived tool-schema hash; its JSON
operation arguments contain only the round number and provider-bound tool
results. It makes model requests only and never executes a tool. Public callers
cannot serialize the capability or select its legacy transport.

All three runtime candidates delegate conversation-model requests to this operation and
share the fixed provider transport with the legacy action profiles. The original
100-second timeout, initial/continuation payloads, history framing, adaptive
model policy and three tool rounds remain. A private audit claim precedes every
round; duplicate claims, interrupted responses and missing completion receipts
prevent redispatch. A successful operation receipt means that the bounded
provider envelope was received; the actual provider status, including an
incomplete/failed status, is preserved and is not proof of model, tool or task
completion. Audit rows contain response
hashes and IDs, without retaining prompts or model content.

Migration `20261021010000_sandy_runtime_conversation.sql` registers the operation
with `internal:agent.runtime.conversation.respond@1.0.0`; all public/UI/AI
exposure and verified flags stay false. No public HTTP handler readiness is
claimed. Its table/trigger and metadata passed 19 actual PostgreSQL checks in a
full rollback, without model requests or permanent registry changes.

The active v4 source is pinned to SHA-256
`3aadfb520f651e9a6807cbb24b5d4409fcfbb25fb69fe5d72036916e44db8679`.
Its private profile retains the fixed v4 broker, existing automation service
credential, integration token, `web` purpose and sanitized task header. These
authenticate an internal runtime call and never establish a customer or
Controller session. Its original 13-tool schema, extra narrow context lookup,
non-sensitive temporal context, adaptive model selection and 100-second deadline
remain. The three runtime sources contain no independent conversation-model
transport after extraction; the v4 provider-call implementation lives in the
shared profile module. Additive migration `10010` admits only that exact source
profile, preserving both fallback profiles and every exposure/verified flag. It
passed eight actual PostgreSQL checks in a full rollback, with no broker/model
requests. The source guards verify 24 unchanged archived sections and three
exact dependencies across the three runtimes.

Other internal workers, runtime task/context/history branches, connection
preflight and existing UI endpoints remain distinct migration work. Source
extraction does not establish universal production routing or verified
customer/provider operations.
