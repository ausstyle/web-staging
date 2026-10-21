# Fallback runtime application service extraction

The v2 and v1-backup-r50 candidates reuse the eight governed agent operations:
customer-owned Gmail search/recent/draft/confirmed send, web research, private
document search, evaluation listing and planning. They call the same application
executor as `sandy-agent-operation-api` and the active v4 runtime. This is a source
candidate; deployment and positive production session/provider tests are separate.

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
customer context, model selection, conversation rounds, task/history operations,
image-approval creation and result persistence. They also pin the unchanged
version-awareness dependency. Run:

```sh
python3 scripts/sandy/verify_fallback_source.py
deno test --allow-env --allow-read=supabase/functions,scripts/sandy/testing \
  --import-map=scripts/sandy/testing/fallback_import_map.json \
  scripts/sandy/fallback_runtime_test.ts \
  supabase/functions/_shared/sandy-agent-operations/runtime_profiles_test.ts \
  supabase/functions/sandy-agent-operation-api/index_test.ts
```

The 13 adapter tests execute the actual handlers, identity capabilities,
contracts, Gmail code and shared executor with fake database/fetch transports.
The test-only import map replaces Supabase transport and Edge declarations; it
is not deployed. All provider hosts are intercepted and no network permission is
granted. Six profile regressions additionally verify transport restrictions and
the default v4 broker, alongside the existing 19 service/API regressions.

The baseline conversation-model transport, other internal workers and existing
UI direct endpoints remain distinct migration work. Source extraction does not
establish universal production routing or verified customer/provider operations.
