# Private sensitive provider protocols

These18 fixed-project/region handlers cover the sensitive methods identified by
the pinned constituent inventory. They execute only with a normal enabled owner,
current verified contract, exact approved one-use admission and server-side
credential resolution after grant consumption. All new registry rows remain
closed and unverified. No provider invocation or credential activation is
evidence of this source change.

Compute guest attributes/screenshot/vTPM identity, GKE JWKS, Monitoring
verification codes, KMS crypto/wrapped-key protocols and BackupDR downscoped
tokens are captured only as complete bounded JSON bytes in existing private
encrypted Vault custody. Results contain an operation-bound opaque
ID/digest/size/type/expiry. There is no public raw payload retrieval and no
general signing endpoint, customer-session replacement, token activation or
authentication bypass. An opaque capture does not attest successful
cryptography, a provider entitlement or a usable credential.

KMS requests compute documented CRC32C fields server-side, validate response
CRCs and request-integrity flags, and check the returned key identity where
provided. MAC verification also checks the success-integrity flag. Secondary
wrapping and import keys must stay in the same fixed project/region; an existing
import target must be under the exact parent key. Input bytes are canonical
base64 and bounded to64KiB per crypto field; private response JSON is bounded
to1MiB. Verification codes are requested for at most5minutes. Raw provider
responses, plaintext, key material, signed URLs, codes and tokens are never
operation results or logs.

08500 preserves the applied08400 source exactly. It requires exact SHA256 of the
reviewed context and credential resolver, extends only the two handler/resource
allowlists and registers18 closed contracts. Vault ACLs, actor/operation/input/
scope/revision bindings, quotas, expiry and one-use cursor rules remain shared.
Sensitive artifacts cannot be resolved as pagination cursors. Provider error or
receipt uncertainty propagates `executed:null` and requires reconciliation
without automatic redispatch. The canonical gateway integration is separate and
must use the compact `sensitiveOperations` and `sensitiveExecutionScope`
exports.

Generate contracts and metadata without applying anything:

```sh
PYTHONDONTWRITEBYTECODE=1 python scripts/sandy/build_provider_sensitive.py --schemas /workspace/sandy-api-deliverables/provider-schemas
DENO_DIR=/workspace/.cloud-setup/deno-cache /workspace/.cloud-setup/toolchain/node_modules/.bin/deno run --allow-read --allow-write scripts/sandy/build_provider_sensitive_metadata.ts
```

Tests use dummy noncredential material and synthetic policy/provider fixtures.
Real PostgreSQL/Vault tests end in fullROLLBACK and exercise only administrative
components. They do not create Auth sessions, real approvals, keys or provider
credentials. Actual resource bindings, IAM, Controller Auth and Edge egress are
separate verification dependencies.
