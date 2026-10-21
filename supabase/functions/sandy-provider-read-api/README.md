# Original provider metadata reader

The v5 runtime accepts only the internal `consumed-admission-v1` envelope from Sandy API. It verifies the actual canonical argument digest, actor, request, grant, credential, fixed project scope and current registry revision against a consumed admission. A private immutable claim prevents repeating dispatch with the same admission. The current credential consumer is resolved afterward; an active-pointer refusal cannot fall back to an environment credential. Sandy API owns grant consumption and the final execution receipt.

Deploy the API that sends this context before deploying this reader. The old v4 reader tolerates the additional context fields during rollout. Apply additive migration `20261021006200` before reader v5. Read output schemas and all 26 fixed routes retain their public v1 contracts. The trusted `x-sandy-provider-http-status` response header carries the actual Management status without confusing it with the handler's HTTP status.

`createProviderReadHandler` is the existing isolated core used by local direct-provider verification and injected unit tests. Production `Deno.serve` exposes only `createGovernedProviderReadHandler`; the local factory does not provide an HTTP legacy path. `scripts/sandy/verify_project_reads.ts` exercises this local core and real read-only Management endpoints, without asserting Controller or deployed authorization coverage.

`scripts/sandy/verify_deployed_api.py` first checks project reachability before looking up internal transport keys. It tests that a service credential without an admission is refused. Positive deployed provider reads go through Sandy API using an actual Controller session. Missing Controller authentication defers these specific checks; the script never fabricates an admission or substitutes an administrative key for a session.

Run `deno test supabase/functions/sandy-provider-read-api`. `test_governed_read.sql` is an administrative PostgreSQL component fixture whose synthetic private records are fully rolled back; it neither creates an Auth session nor calls a provider.
