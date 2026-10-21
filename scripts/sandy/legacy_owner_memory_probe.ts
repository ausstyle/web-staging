/** Synthetic bounded-memory probe; no Auth/DB/provider call or live deployment. */
import { createLegacyOwnerHandler } from "../../supabase/functions/sandy-legacy-compatibility-api/owner_handler.ts";
import { functionArtifactDigest } from "../../supabase/functions/sandy-legacy-compatibility-api/workflow_handler.ts";
import {
  bytesDigest,
  encode64,
} from "../../supabase/functions/sandy-provider-supplement-api/runtime.ts";
const start = Deno.memoryUsage(), files = [];
for (const path of ["index.ts", "fixture.json"]) {
  const bytes = new TextEncoder().encode(
    path === "index.ts"
      ? "//" + "x".repeat(524239) +
        "\nDeno.serve(()=>Response.json({fixture:true}));"
      : '"' + "x".repeat(524286) + '"',
  );
  files.push({
    path,
    content_base64: encode64(bytes),
    sha256: await bytesDigest(bytes),
  });
}
const args: Record<string, unknown> = {
  project_id: "zmqlyygzqoidkcwdysok",
  name: "compat-memory-fixture",
  slug: "compat-memory-fixture",
  entrypoint_path: "index.ts",
  verify_jwt: true,
  files,
};
args.artifact_ref = await functionArtifactDigest(args);
let providerCalls = 0, consume = 0, finish = 0;
const common = {
  service: "fixture",
  authorizeContext: async () => ({ allowed: true }),
  consumeGrant: async () => {
    consume++;
    return {
      allowed: true,
      admission_id: "40000000-0000-4000-8000-000000000001",
    };
  },
  finishExecution: async () => {
    finish++;
    return { allowed: true };
  },
  credentialForExecution: async () => "synthetic-token",
  fetch: (async () => {
    providerCalls++;
    return Response.json({
      id: "40000000-0000-4000-8000-000000000001",
      slug: "compat-memory-fixture",
      name: "compat-memory-fixture",
      status: "ACTIVE",
      version: 1,
      verify_jwt: true,
    });
  }) as typeof fetch,
};
const handler = createLegacyOwnerHandler(common, {
  ...common,
  saveOpaque: async () => {
    throw Error("No opaque material");
  },
  takeOpaque: async () => {
    throw Error("No opaque material");
  },
});
const body = JSON.stringify({
  operation: "supabase.deploy_edge_function",
  arguments: args,
  actor_id: "10000000-0000-4000-8000-000000000001",
  tenant_id: null,
  credential_id: null,
  request_id: "20000000-0000-4000-8000-000000000001",
  grant_id: "30000000-0000-4000-8000-000000000001",
  admission_id: "40000000-0000-4000-8000-000000000001",
});
const response = await handler(
  new Request("https://fixture.invalid", {
    method: "POST",
    headers: { authorization: "Bearer fixture" },
    body,
  }),
);
if (response.status !== 200) throw Error(await response.text());
console.log(JSON.stringify({
  passed: true,
  request_bytes: new TextEncoder().encode(body).length,
  decoded_source_bytes: files.reduce(
    (sum, f) => sum + atob(f.content_base64).length,
    0,
  ),
  provider_calls_mocked: providerCalls,
  consume,
  finish,
  start_memory: start,
  end_memory: Deno.memoryUsage(),
  real_provider_calls: 0,
  actual_auth_session: false,
}));
