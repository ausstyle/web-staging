/** Prepare an exact owner approval; this module never executes a provider write.
 * Unverified executors can be reviewed, but remain closed at API admission. */
import { argumentDigest, canonicalJson } from "../_shared/sandy_api_protocol.ts";
import { createRegistrySchemaValidator } from "../sandy-operation-api/registry_schema_validator.ts";
type Obj = Record<string, unknown>;
const object = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x);
const definitions: Record<string, { provider: string; handler: string }> = {
  "github.files.update": { provider: "github", handler: "sandy-provider-operation-api" },
  "github.commit": { provider: "github", handler: "sandy-legacy-compatibility-api" },
  "supabase.deploy_edge_function": { provider: "supabase", handler: "sandy-legacy-compatibility-api" },
  "supabase.db.migrations.apply": { provider: "supabase", handler: "sandy-provider-operation-api" },
  "supabase.functions.secrets.set": { provider: "supabase", handler: "sandy-provider-operation-api" },
};
const validate = createRegistrySchemaValidator().isValid;
export function isCanonicalEngineeringOperation(x: string) { return Object.hasOwn(definitions, x); }
export async function prepareCanonicalEngineeringRequest(
  provider: string, operation: string, target: string, payload: unknown, entry: unknown, scope: unknown,
) {
  const definition = definitions[operation];
  if (!definition || provider !== definition.provider || !object(entry) || entry.operation !== operation ||
    entry.handler !== definition.handler || entry.is_mutation !== true || !object(entry.error_contract) ||
    !/^[a-f0-9]{64}$/.test(String(entry.error_contract.contract_sha256))) throw Error("canonical_executor_contract_required");
  if (!object(payload) || !object(payload.arguments) || validate(entry.input_schema, payload.arguments) !== true) throw Error("invalid_canonical_operation_arguments");
  const args = payload.arguments;
  const expected = operation === "github.files.update"
    ? object(args.path) && typeof args.path.path === "string" ? "ausstyle/web-staging:" + args.path.path : null
    : operation === "github.commit" ? "ausstyle/web-staging:git-objects"
    : "zmqlyygzqoidkcwdysok:" + operation;
  if (target !== expected || !Array.isArray(scope) || !scope.includes(provider + ":" + target)) throw Error("exact_approved_engineering_scope_required");
  if (typeof payload.rollback_plan !== "string" || payload.rollback_plan.trim().length < 25 ||
    typeof payload.before_ref !== "string" || payload.before_ref.length < 7 || payload.before_ref.length > 500) throw Error("concrete_source_and_rollback_required");
  const executionScope = provider === "github"
    ? { provider, repository: "ausstyle/web-staging" }
    : { provider, project_ref: "zmqlyygzqoidkcwdysok" };
  // Hash secret values without persisting their plaintext in jobs or audit rows.
  const result = {
    rollback_plan: payload.rollback_plan.trim().slice(0, 2000), before_ref: payload.before_ref,
    sandy_api_execution: {
      operation, input_sha256: await argumentDigest(args), contract_sha256: entry.error_contract.contract_sha256,
      scope_sha256: await argumentDigest(executionScope), maximum_declared_cost_units: 0,
    },
  };
  return { payload: result, fingerprint: canonicalJson(result) };
}
export function sameCanonicalRequest(prior: Obj, actor: string, change: string, provider: string, operation: string, target: string, payload: Obj) {
  return prior.requested_by === actor && prior.engineering_change_id === change && prior.provider === provider &&
    prior.operation === operation && prior.target === target && canonicalJson(prior.payload) === canonicalJson(payload);
}
