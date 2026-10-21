/** Fixed legacy workflow names reuse the same supplement one-use execution engine. */
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import { validateGithubBatchMaterial } from "../_shared/sandy_github_batch.ts";
import {
  createSupplementHandler,
  type Dependencies,
} from "../sandy-provider-supplement-api/index.ts";
import { validateFunctionDeploymentMaterial } from "../sandy-provider-supplement-api/providers.ts";
import {
  JsonRequestError,
  object,
  requestJson,
  validate,
} from "../sandy-provider-supplement-api/runtime.ts";
import { legacyWorkflowContracts } from "./workflow_contracts.ts";
type Obj = Record<string, unknown>;
const fail = (status: number, error: string) =>
  Response.json({ ok: false, error, executed: false }, { status });
export async function functionArtifactDigest(args: Obj) {
  const { prepared } = await validateFunctionDeploymentMaterial(args);
  return await argumentDigest({
    project_id: args.project_id,
    slug: args.slug,
    name: args.name,
    entrypoint_path: args.entrypoint_path,
    verify_jwt: true,
    ...(args.import_map_path === undefined
      ? {}
      : { import_map_path: args.import_map_path }),
    files: prepared.map((f) => ({ path: f.path, sha256: f.sha256 })).sort((
      a,
      b,
    ) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  });
}
export function createLegacyWorkflowHandler(deps: Dependencies) {
  const handler = createSupplementHandler(deps, legacyWorkflowContracts);
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return fail(405, "method_not_allowed");
    if (
      !deps.service ||
      request.headers.get("authorization") !== `Bearer ${deps.service}` ||
      request.headers.has("x-api-key")
    ) return fail(403, "internal_service_transport_required");
    let body: unknown;
    try {
      body = await requestJson(request.clone(), 1550000);
    } catch (e) {
      return fail(
        e instanceof JsonRequestError ? e.status : 400,
        e instanceof JsonRequestError ? e.code : "invalid_request",
      );
    }
    if (
      !object(body) || body.tenant_id !== null || body.credential_id !== null
    ) return fail(403, "actual_owner_session_admission_required");
    const op = typeof body.operation === "string"
      ? legacyWorkflowContracts[body.operation]
      : undefined;
    if (!op) return fail(404, "operation_not_implemented");
    const args = body.arguments;
    if (!object(args) || !validate(op.input_schema, args)) {
      return fail(400, "invalid_operation_arguments");
    }
    try {
      if (op.operation === "github.push_files") {
        await validateGithubBatchMaterial(args);
      } else if (
        args.name !== args.slug ||
        args.artifact_ref !== await functionArtifactDigest(args)
      ) {
        return fail(
          400,
          "artifact_ref_must_match_exact_source_manifest_sha256",
        );
      }
    } catch (e) {
      return fail(
        object(e) && typeof e.status === "number" ? e.status : 400,
        e instanceof Error ? e.message : "invalid_source_material",
      );
    }
    return handler(request);
  };
}
