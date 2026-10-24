import {
  argumentDigest,
  canonicalJson,
} from "../_shared/sandy_api_protocol.ts";
import {
  memoryCorrectionContractSha256,
  memoryCorrectionMutationContract,
} from "./customer_mutations.ts";
type Row = Record<string, unknown>;
const object = (v: unknown): v is Row =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
export type MemoryCertification = { id: string; apiDeploymentId: string };
async function boundedPayload(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw Error("missing_response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 16000) {
        await reader.cancel();
        throw Error("response_limit");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
const deployment =
  /^zmqlyygzqoidkcwdysok_6e50ff35-5878-42e2-982c-c205df6cac2e_[1-9][0-9]{0,8}$/;
/** Private rollout-quality check. This never supplies customer authority or
 * substitutes a service identity: the same real JWT reaches PostgREST again. */
export async function resolveMemoryCertification(
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
  { ok: true; value: MemoryCertification } | {
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
  if (
    !uuid(input.readinessId) || !deployment.test(input.deploymentId) ||
    !uuid(input.customerId) || !object(input.args) || !uuid(input.args.id) ||
    typeof input.args.idempotency_key !== "string"
  ) return fail(403, "private_readiness_context_required");
  const e = input.entry, c = memoryCorrectionMutationContract;
  if (
    e.operation !== "memory.fact_correct" || e.handler !== c.handler ||
    e.permission_scope !== c.permission_scope || e.is_mutation !== true ||
    e.api_exposed !== false || e.ai_exposed !== false || e.verified !== false ||
    !object(e.error_contract) ||
    e.error_contract.contract_sha256 !== memoryCorrectionContractSha256 ||
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
  // Verify the configured fixed digest against the actual compiled contract;
  // catalogue metadata cannot introduce a different executable contract.
  const actual = await argumentDigest({
    operation: "memory.fact_correct",
    handler: c.handler,
    permission_scope: c.permission_scope,
    is_mutation: true,
    input_schema: c.input_schema,
    output_schema: c.output_schema,
  });
  if (actual !== memoryCorrectionContractSha256) {
    return fail(503, "private_readiness_compiled_contract_changed");
  }
  try {
    const response = await (input.request ?? fetch)(
      origin.origin + "/rest/v1/rpc/sandy_api_memory_private_readiness",
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
          p_fact_id: input.args.id,
          p_idempotency_key: input.args.idempotency_key,
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    const body: unknown = await boundedPayload(response);
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
      body.customer_id !== input.customerId ||
      typeof body.expires_at !== "string" ||
      !(Date.parse(body.expires_at) > Date.now())
    ) return fail(403, "private_readiness_binding_mismatch");
    return {
      ok: true,
      value: { id: input.readinessId, apiDeploymentId: input.deploymentId },
    };
  } catch {
    return fail(503, "private_readiness_unavailable");
  }
}
