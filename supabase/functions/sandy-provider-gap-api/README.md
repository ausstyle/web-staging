# Fixed provider requirement follow-up

This independent executor adds 35 operation IDs for scope requirements 33, 75,
85/110, 123, 126, 136 and 140. It does not replace the existing 595-operation
provider executor. The two logs names are aliases for one implementation;
operation count must not be presented as completed requirement count.

| Requirement | Implementation                                                                                                                                                                           | Provider verification                                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 33          | Fixed-project/zone typed serial output, int64 cursor/ports, bounded credential-pattern redaction and raw-content digest                                                                  | Component fixtures; approved VM serial fixture and authenticated integration pending                                                             |
| 75          | Project metadata establishes organization relationship; organization list/get never disclose other memberships                                                                           | Actual bound project200, organization list200/empty, direct organization403. Correct organization visibility remains an authorization dependency |
| 85/110      | Fixed `logs` table, source enum, selected columns, bounded time/limit, redacted projection; no caller SQL                                                                                | Actual ClickHouse query and handler's provider component200 with valid projected result. Controller/MCP integration pending                      |
| 123         | Sixteen discussion/category/comment/reply query and mutation operations using seventeen immutable GraphQL documents; server identity resolution precedes mutation                        | Full pinned official GraphQL schema validation and component fixtures; real GitHub access and mutation attestation pending                       |
| 126         | Eight package/version operations; authoritative repository/owner discovery, package association and expected identity checks, stored pre-delete identities, guarded restore and readback | Pinned public REST schema and component fixtures; live GitHub access and authorized lifecycle fixture pending                                    |
| 136         | Five environment-secret operations; metadata projection and encrypted-only update, matching current provider public-key ID                                                               | Pinned REST schema and component fixtures; live GitHub access and authorized secret fixture pending                                              |
| 140         | Organization audit query generated for the fixed repository/time; verified organization owner and repository-only projection                                                             | Pinned GHEC schema and component fixtures; actual organization ownership/authorization/entitlement remain to be observed                         |

No broad wildcard completion or provider lifecycle verification is asserted.
Unsupported discussion capabilities are not invented from absent GraphQL input
types. Organization listing is deliberately limited to the organization proved
by the configured project. An empty provider organization response is not proof
that the bound organization is accessible.

## Authority and state

Production accepts only an internal service request that includes the actor
already authenticated by Sandy API. It independently rechecks current enabled
Controller owner, exact registry contract, exposure, and verification for every
sensitive read/mutation. Tenant contexts are refused. The common single-use
admission binds actor, request, exact arguments, registry revision, contract and
fixed provider scope. Managed credential resolution uses the existing consumer
boundary; no provider credential is an operation result.

All 25 mutations/sensitive reads start disabled and unverified. Ten narrow
metadata reads may be registered as exposed while remaining unverified. All35
operations require a normal Controller owner session; none is API-key-delegable
until the common issuance/admission policy explicitly supports this handler.
Migration installation, schema validation, mocked policies and HTTP acceptance
cannot mark a provider lifecycle verified. Mutations return `accepted` with
`effect_confirmed:false`; provider/network/receipt ambiguity remains `unknown`
and cannot automatically redispatch. A restore's acceptance receipt retains the
actual mutation HTTP status even when its subsequent identity readback is200.
Explicit provider4xx refusals are recorded as failures, without inferring a
missing provider plan from403.

The service must deploy with platform JWT verification disabled as for other
internal Sandy executors; the handler enforces its service bearer itself.
`gateway.ts` is the lightweight admission adapter and never imports executors.
It exports `gapGatewayOperations`, `isGapOperation`, `gapExecutionScope`, and
`parsePackageRestoreBindings`. The executor exports `createGapHandler` and owns
grant consumption. Its internal request envelope is the same as provider595.

## Package restore prerequisites

GitHub name-based restoration cannot prove a deleted package's repository from
an HTTP404. It requires an immutable pre-delete provider observation tied to a
consumed, approved, current-contract admission and an accepted deletion receipt
within30days. Private proof RPCs recheck owner/admission/argument digest and
deny all direct service table privileges. Neither user-supplied expected IDs nor
an unaccepted deletion receipt are sufficient proof.

Restoration also requires an independently attested, expiring, exclusive
namespace binding in server-only `SANDY_GITHUB_PACKAGE_RESTORE_BINDINGS_JSON`:
`verified`, fixed `repository`/`owner`, numeric `repository_id`, `package_type`,
`package_name`, `exclusive_namespace:true`, `expires_at`, and
`attestation_sha256`. The complete binding array participates in the admission
scope digest in both gateway and executor. The default is empty. GitHub does not
offer CAS for these name-based endpoints; an expected-ID preflight and
post-restore readback do not create a native atomic guarantee. No binding,
provider purchase, upgrade, mutation or session credential was created here.

## Reproducible validation

Run from the repository with Deno and Node onPATH:

```sh
deno test --allow-env supabase/functions/sandy-provider-gap-api/index_test.ts
node supabase/functions/sandy-provider-gap-api/package_identity_postgres_check.mjs
deno run --allow-write=supabase/migrations,supabase/functions/sandy-provider-gap-api supabase/functions/sandy-provider-gap-api/generate_registry.ts
```

The PostgreSQL/WASM check uses an isolated database and synthetic policy
records; it is not a Controller session test. Configure
`SANDY_TEST_PGLITE_MODULE` if the PGlite package is installed elsewhere.
`package_identity_test.sql` and `registry_test.sql` also passed on the real
project's PostgreSQL with both new migrations inside fullROLLBACK transactions;
no test record persisted.

`verify_sources.ts` hashes five downloaded authoritative source files and
validates all17 fixed GraphQL documents and26 REST/Compute methods. Run with
`--allow-read=/workspace/sandy-api-deliverables --allow-env=NODE_ENV`. Source
locations/hashes are pinned in `contracts.ts`; the official Octokit tarball
entry is `package/schema.graphql` at version15.26.1. Its npm SHA512 integrity
was verified before extraction. The pinned upstream SDL contains two identical
EnterpriseOwnerInfo field duplicates; the verifier removes only structurally
identical repeats and rejects contradictory definitions before normal full
schema validation. No discussion field was added or assumed.

`provider_smoke.ts` performs only the actual read-only Supabase provider
component, using the Management token from the environment; it never constructs
or emulates an authenticated user session. It prints only response status,
digests and projection checks, and returns no credential or log content. The
checked-in `docs/sandy-api/provider-gap-provider-evidence.json` distinguishes
this from missing authenticated Sandy API/MCP end-to-end evidence.

No GitHub API proxy workaround is used. Runtime egress, Controller session
availability, provider organization visibility and unobserved provider
entitlements remain separate dependencies. Custom Domain is outside this module;
no entitlement or purchase is assumed.
