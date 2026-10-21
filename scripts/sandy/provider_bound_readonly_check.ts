/** One real read-only provider preflight; all policy callbacks are synthetic. */
import { createBoundHandler } from "../../supabase/functions/sandy-provider-bound-api/index.ts";
import type { Dependencies } from "../../supabase/functions/sandy-provider-supplement-api/runtime.ts";

const token = Deno.env.get("SANDY_SUPABASE_MANAGEMENT_TOKEN");
if (!token) throw Error("management_credential_unavailable");
const fixedURL =
  "https://api.supabase.com/v1/projects/zmqlyygzqoidkcwdysok/branches";
const service = crypto.randomUUID(), admission = crypto.randomUUID();
let requests = 0,
  providerStatus: number | null = null,
  inventoryCount: number | null = null,
  finalOutcome: string | null = null;
const deps: Dependencies = {
  service,
  now: () => Date.now(),
  authorizeContext: async () => ({ allowed: true }),
  consumeGrant: async () => ({ allowed: true, admission_id: admission }),
  finishExecution: async (receipt) => {
    finalOutcome = receipt.outcome;
    return { allowed: true };
  },
  credentialForExecution: async () => token,
  fetch: async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== fixedURL || (init?.method ?? "GET") !== "GET" || requests) {
      throw Error("readonly_fixed_project_preflight_boundary");
    }
    requests++;
    const reply = await fetch(url, { ...init, redirect: "manual" });
    providerStatus = reply.status;
    const bytes = new Uint8Array(await reply.arrayBuffer());
    if (bytes.byteLength > 1048576) throw Error("bounded_response_exceeded");
    if (reply.ok) {
      let inventory: unknown;
      try {
        inventory = JSON.parse(new TextDecoder().decode(bytes));
      } catch { /* no raw error */ }
      if (Array.isArray(inventory)) inventoryCount = inventory.length;
    }
    return new Response(bytes, {
      status: reply.status,
      headers: reply.headers,
    });
  },
  saveOpaque: async () => {
    throw Error("private_capture_not_authorized_in_readonly_check");
  },
  takeOpaque: async () => {
    throw Error("private_capture_not_authorized_in_readonly_check");
  },
};
const handler = createBoundHandler(deps);
const response = await handler(
  new Request("https://synthetic.invalid", {
    method: "POST",
    headers: {
      authorization: `Bearer ${service}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      operation: "supabase.branches.get_config.bound",
      arguments: { path: { branch_id_or_ref: crypto.randomUUID() } },
      actor_id: crypto.randomUUID(),
      tenant_id: null,
      request_id: crypto.randomUUID(),
      grant_id: crypto.randomUUID(),
    }),
  }),
);
const value = await response.json();
const allowedError = new Set([
  "branch_fixed_project_relationship_required",
  "provider_authorization_refused",
  "provider_request_failed",
  "provider_response_schema_mismatch",
  "provider_branch_membership_response_invalid",
  "provider_execution_state_unknown",
]);
const safeError =
  typeof value.error === "string" && allowedError.has(value.error)
    ? value.error
    : "other_refusal";
console.log(JSON.stringify({
  layer: "real_readonly_provider_with_synthetic_policy_callbacks",
  project_ref: "zmqlyygzqoidkcwdysok",
  method: "GET",
  path: "/v1/projects/zmqlyygzqoidkcwdysok/branches",
  provider_http_status: providerStatus,
  provider_requests: requests,
  branch_inventory_count: inventoryCount,
  handler_http_status: response.status,
  handler_error: safeError,
  handler_executed: value.executed === true,
  execution_receipt_outcome: finalOutcome,
  missing_target_refused:
    value.error === "branch_fixed_project_relationship_required",
  policy_callbacks_synthetic: true,
  controller_session_tested: false,
  real_approval_tested: false,
  full_operation_verified: false,
  provider_mutation_performed: false,
  database_write_performed: false,
}));
if (requests !== 1 || response.status === 200 || value.executed === true) {
  throw Error("readonly_preflight_boundary_or_refusal_invariant_failed");
}
