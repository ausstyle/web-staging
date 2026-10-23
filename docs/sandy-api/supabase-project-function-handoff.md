# Missing Supabase project/function contracts

SANDY-ENG-0001 / 0005, 23 October 2026. This implements three previously absent
canonical operations in the existing provider-gap executor. It preserves the
35 existing contract digests. It does not change an approval, standing grant,
customer record, deployed function, provider credential or acceptance flag.

| Operation | Implemented boundary | Remaining production acceptance |
|---|---|---|
| `supabase.projects.list` | Official Management list, projected to the already authorised bound project; other projects are omitted. | Protected source/registry installation and a new scoped API/MCP/provider read. |
| `supabase.projects.create` | Exact engineering name/region, fresh bound-project/organisation relationship, no adoption of existing projects, existing per-project password custody, consumed current contract and positive cost admission. One material claim per admission/name; ambiguous results are never automatically retried. | Applicable restricted resource/cost authority, existing custody material, protected installation, actual owned-resource creation/readback and separately authorised cleanup. No project or password was created for this implementation. |
| `supabase.functions.invoke` | Installed JWT-protected function only; independently revalidated same-caller normal Auth session, fixed project/host, bounded JSON request, no redirects, response digest without content disclosure. Management/service credentials are never sent as the function caller. | Protected installation and exact authorised fixture invocation, independent function result/log readback and invocation admission/recovery acceptance. A response digest or HTTP 2xx alone does not certify a business effect. |

The project routes use the existing checksum-pinned Supabase Management schema.
Invocation follows `FunctionsClient.invoke` in pinned `@supabase/functions-js`
2.4.6; it is deliberately not described as a Management API endpoint. The
existing runtime SDK dependency and lockfile pin that public package. The new
PostgreSQL test dependency is pinned separately in `deno.lock`.

`scripts/sandy/build_supabase_missing_contracts.ts` produces the additive migration
and compact gateway descriptors without connecting to a provider. All three
registry rows start **unexposed and unverified**. The migration establishes no
authorization grant or approval. Existing admissions, credential-consumer
revocation rules, audit and receipt settlement remain authoritative. These new
source contracts are not included in production acceptance counts.

The existing API contract workflow covers provider credential boundaries,
parent/tenant isolation, reused grants, uncertain outcomes, same-caller session
selection and actual local PostgreSQL custody/ACL checks. Those isolated tests
do not substitute for protected deployment or real provider acceptance.

Production installation must preserve newer deployed gateway/source modules,
take compatible rollback artifacts and use an applicable authorised release
path. The working-tree gateway must not overwrite a newer source-preserving
production release. The private 23 October completion register and its provider
receipts remain the programme baseline; this source publication cannot promote
a family to accepted.
