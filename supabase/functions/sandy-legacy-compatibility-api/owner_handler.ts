import type { ProviderDependencies } from "../sandy-provider-operation-api/index.ts";
import type { Dependencies as WorkflowDependencies } from "../sandy-provider-supplement-api/index.ts";
import {
  JsonRequestError,
  requestJson,
} from "../_shared/sandy_api_protocol.ts";
import { createLegacyProviderHandler } from "./provider_handler.ts";
import { createLegacyWorkflowHandler } from "./workflow_handler.ts";
import { legacyWorkflowContracts } from "./workflow_contracts.ts";
export function createLegacyOwnerHandler(
  provider: ProviderDependencies,
  workflow: WorkflowDependencies,
) {
  const simple = createLegacyProviderHandler(provider),
    advanced = createLegacyWorkflowHandler(workflow);
  return async (request: Request) => {
    let body: unknown;
    try {
      body = await requestJson(request.clone(), 1550000);
    } catch (error) {
      return Response.json({
        ok: false,
        error: error instanceof JsonRequestError
          ? error.code
          : "invalid_request",
        executed: false,
      }, { status: error instanceof JsonRequestError ? error.status : 400 });
    }
    const operation = body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).operation
      : null;
    return typeof operation === "string" &&
        Object.hasOwn(legacyWorkflowContracts, operation)
      ? advanced(request)
      : simple(request);
  };
}
