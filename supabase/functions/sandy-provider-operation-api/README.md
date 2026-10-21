The provider executor preserves the shipped 595 contracts and adds 1,143
constituent JSON actions in independently loaded schema shards. These actions
cover managed instance groups, regional networking/load balancing, platform
resource descendants, and repository subresources that family-level coverage
previously missed. All additions require an exact verified approval-bearing
contract and start unexposed and unverified. No source fixture establishes a
customer session, real provider outcome or full 161-requirement completion.

`contracts.json`, `catalogue.ts` and `gateway_manifest.json` retain their shipped
595 contents. `expansion_contracts.json` is complete reviewable source and is
never imported by the runtime. `expansion.ts` uses literal local dynamic imports
for the generated `expansion_shards` files. Each shard is limited to 1 MiB of
plaintext and 48 contracts, with a fixed byte count, SHA-256 digest and exact
operation/hash membership checks before use. There are no remote artifact URLs.
The loader retains at most two decoded shards (2 MiB) and allows two concurrent
decodes. An integrity failure returns a structured 503 without provider dispatch.

AJV validators use a separate engine per cache entry. Removing a schema from one
shared AJV engine does not release its code-generation scope. The cache retains
at most 12 validators and 256 KiB of source schemas; eviction drops the complete
engine graph. Reference inlining is disabled, and projection alternatives use
the same bounded cache. Runtime schemas are trusted generated source; authoring
validation includes a separate draft-7 metaschema check. Data validation remains
strict, with no coercion, defaults or remote schema resolution.

The separate `expansion_gateway.ts` exports `providerExpansionOperations` and
`expandedProviderExecutionScope`. The shipped gateway export remains unchanged
until the reviewed API release explicitly merges these descriptors. The
executor uses the same consumed grant, fixed provider hosts, exact project or
repository scope, credential consumer, bounded response parsing, redaction and
finish receipts as the original contracts. Metadata projections deliberately
exclude credential material, arbitrary bodies/content and signed URLs. Writes
return acceptance receipts, not claims of completed provider lifecycle effects.

Regenerate all outputs, including only additive registry rows, with:

```sh
PYTHONDONTWRITEBYTECODE=1 python scripts/sandy/build_provider_operations.py \
  --schemas /workspace/sandy-api-deliverables/provider-schemas \
  --output supabase/functions/sandy-provider-operation-api/contracts.json \
  --include-expansion \
  --migration supabase/migrations/20261021008200_sandy_provider_constituent_expansion.sql
```

Never regenerate the applied `20261020232000` migration. The schema-cache path
is an execution workspace input; every source is checked against the committed
provider manifest before generation. `scripts/sandy/provider_scope_expansion.py`
records every considered provider method and its exact coverage/dependency in
`docs/sandy-api/provider-wildcard-coverage.json`. Media transport, sensitive
cryptographic output, filtered discovery and additional resource relationships
remain explicit engineering work. Missing bindings, IAM/fixtures, Controller
authentication, runtime egress and paid entitlements are separate dependencies.
No provider plan is purchased or upgraded by this generator or executor.
