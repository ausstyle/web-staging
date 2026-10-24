import {
  argumentDigest,
  canonicalJson,
} from "../_shared/sandy_api_protocol.ts";
import { boundedPayload } from "./task_cancellation_certification.ts";
import {
  customerMutationContracts,
  isCustomerMutationOperation,
  validateCustomerMutationArguments,
} from "./customer_mutations.ts";
type Row = Record<string, unknown>;
const object = (v: unknown): v is Row =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
export const customerMutationContractShas = {
  "tasks.create":
    "adf9fc55cfdd23f7cab23864a3ff9d811bc1008eda718efd1780c0e61d314f3d",
  "tasks.update":
    "d14a757c041f6f6658d50093aa6de841f8300da480a7db76e6936dd8f44ddedf",
  "tasks.complete":
    "cdea3fa30e988574a2684e3529abd2bb4df38ca19c6d1edc2728a1251afc3a30",
  "tasks.archive":
    "ef688481fef6ae638aea0f046c3ebab0c7241a32c95d61761046d1bddaaa0ee6",
  "calendar.create":
    "cfa3ec3b0f209edd438af98546a6ff2659e2f48bcca08cdf0bd9c8c3ae3b9af6",
  "calendar.update":
    "3de2256cf563456ab345af428495bf5d5186c389db288eb9a1f020bdb281d9f3",
  "calendar.cancel":
    "44a3bf8dec3e699ae425a6408407e8cd80672e64dc31cf7a6bdedfe6ce26c368",
  "files.rename":
    "cfc7e70a32a2fef57c401a4db0b172009962f95ed98d3f2eedf2a549cc0e5ef9",
  "files.set_description":
    "5a25bda4e07d5b98cf0a012653029f7b81caf8a32134dadef2d3d484ad634d01",
  "files.archive":
    "f187e978f4d18a23a2a14ea97bc6096476cfd2513ae68940925171696cae325d",
} as const;
export type CustomerMutationCertification = {
  id: string;
  apiDeploymentId: string;
  profile: "customer_mutations_v1";
  operation: string;
};
export function literalTaskTitle(value: unknown): boolean {
  return typeof value === "string" && value.length >= 3 &&
    value.length <= 240 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("“") && value.endsWith("”")));
}
/** Rollout quality only. The real user, fixed typed operation and original
 * transactional customer rights remain independently mandatory. */
export async function resolveCustomerMutationCertification(
  input: {
    base: string;
    anon: string;
    token: string;
    readinessId: string;
    deploymentId: string;
    entry: Row;
    args: unknown;
    customerId: string | null;
    request?: typeof fetch;
  },
): Promise<
  { ok: true; value: CustomerMutationCertification } | {
    ok: false;
    status: number;
    error: string;
  }
> {
  const fail = (status: number, error: string) => ({
    ok: false as const,
    status,
    error,
  });
  const op = input.entry.operation;
  if (
    !uuid(input.readinessId) || !uuid(input.customerId) ||
    !/^zmqlyygzqoidkcwdysok_6e50ff35-5878-42e2-982c-c205df6cac2e_[1-9][0-9]{0,8}$/
      .test(input.deploymentId) ||
    !object(input.args)
  ) return fail(403, "private_readiness_context_required");
  if (!isCustomerMutationOperation(op)) {
    return fail(403, "private_readiness_operation_class_denied");
  }
  if (!validateCustomerMutationArguments(op, input.args)) {
    return fail(400, "invalid_customer_mutation_arguments");
  }
  if (op === "tasks.create" && !literalTaskTitle(input.args.title)) {
    return fail(403, "private_readiness_literal_task_required");
  }
  const e = input.entry, c = customerMutationContracts[op];
  if (
    e.handler !== c.handler || e.permission_scope !== c.permission_scope ||
    e.is_mutation !== true || e.api_exposed !== true || e.ai_exposed !== true ||
    e.verified !== false ||
    canonicalJson(e.input_schema) !== canonicalJson(c.input_schema) ||
    canonicalJson(e.output_schema) !== canonicalJson(c.output_schema)
  ) return fail(403, "private_readiness_contract_mismatch");
  let origin: URL;
  try {
    origin = new URL(input.base);
  } catch {
    return fail(503, "private_readiness_unavailable");
  }
  if (
    origin.origin !== "https://zmqlyygzqoidkcwdysok.supabase.co" ||
    origin.pathname !== "/" || origin.search || origin.hash ||
    origin.username || origin.password || !input.token ||
    !(/^[A-Za-z0-9._~-]+$/).test(input.token)
  ) return fail(503, "private_readiness_unavailable");
  const actual = await argumentDigest({
    operation: op,
    handler: c.handler,
    permission_scope: c.permission_scope,
    is_mutation: true,
    input_schema: c.input_schema,
    output_schema: c.output_schema,
  });
  if (actual !== customerMutationContractShas[op]) {
    return fail(503, "private_readiness_compiled_contract_changed");
  }
  try {
    const response = await (input.request ?? fetch)(
      origin.origin +
        "/rest/v1/rpc/sandy_api_customer_mutation_private_readiness",
      {
        method: "POST",
        redirect: "error",
        headers: {
          authorization: "Bearer " + input.token,
          apikey: input.anon,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          p_artifact_id: input.readinessId,
          p_api_deployment_id: input.deploymentId,
          p_contract_sha256: actual,
          p_operation: op,
          p_arguments: Object.fromEntries(
            Object.entries(input.args).filter(([k]) => k !== "idempotency_key"),
          ),
          p_idempotency_key: input.args.idempotency_key,
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    const body = await boundedPayload(response);
    if (!response.ok || !object(body)) {
      return fail(503, "private_readiness_unavailable");
    }
    if (body.ok !== true) {
      return fail(
        [401, 403, 429, 503].includes(Number(body.http_status))
          ? Number(body.http_status)
          : 403,
        typeof body.error === "string" &&
          /^private_readiness_[a-z_]+$/.test(body.error)
          ? body.error
          : "private_readiness_denied",
      );
    }
    if (
      body.readiness_id !== input.readinessId ||
      body.customer_id !== input.customerId || body.operation !== op ||
      typeof body.expires_at !== "string" ||
      !(Date.parse(body.expires_at) > Date.now())
    ) return fail(403, "private_readiness_binding_mismatch");
    return {
      ok: true,
      value: {
        id: input.readinessId,
        apiDeploymentId: input.deploymentId,
        profile: "customer_mutations_v1",
        operation: op,
      },
    };
  } catch {
    return fail(503, "private_readiness_unavailable");
  }
}
