import { strict as assert } from "node:assert";
import { createOnboardingHandler } from "./index.ts";
import { provisioningOperations } from "./provisioning_operations.ts";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import observed from "./provisioning_component_outputs.json" with {
  type: "json",
};
const actor = "10000000-0000-4000-8000-000000000001",
  rid = "10000000-0000-4000-8000-000000000002",
  resource = "10000000-0000-4000-8000-000000000003";
const args: Record<string, Record<string, unknown>> = {
  "customer.provisioning.features.list": {},
  "customer.provisioning.templates.list": {},
  "customer.provisioning.plan": { template_key: "customer.workspace" },
  "customer.provisioning.execute": {
    plan_id: rid,
    plan_sha256: "a".repeat(64),
  },
  "customer.provisioning.jobs.get": { job_id: rid },
  "customer.resources.list": {},
  "customer.resources.reconcile": { resource_id: resource },
  "customer.resources.recover": { resource_id: resource, expected_version: 1 },
  "customer.resources.decommission": {
    resource_id: resource,
    expected_version: 1,
    delete_data: true,
  },
  "customer.workspace.records.get": { resource_id: resource, key: "fixture" },
  "customer.workspace.records.upsert": {
    resource_id: resource,
    key: "fixture",
    value: { hello: "Sandy" },
    expected_version: 0,
  },
  "customer.workspace.records.delete": {
    resource_id: resource,
    key: "fixture",
    expected_version: 1,
  },
};
for (const [operation, payload] of Object.entries(observed.outputs)) {
  Deno.test(
    "actual rolled-back PostgreSQL output matches typed handler: " + operation,
    async () => {
      const calls: { url: string; init: RequestInit }[] = [];
      const handler = createOnboardingHandler({
        base: "https://zmqlyygzqoidkcwdysok.supabase.co",
        anon: "synthetic-anon",
        fetch: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
          const url = String(input);
          calls.push({ url, init });
          return Response.json(
            url.endsWith("/auth/v1/user")
              ? {
                id: actor,
                role: "authenticated",
                email: "fixture@example.invalid",
                email_confirmed_at: "2026-10-21T00:00:00Z",
              }
              : payload,
          );
        }) as typeof fetch,
      });
      const response = await handler(
        new Request("https://project.invalid", {
          method: "POST",
          headers: {
            authorization: "Bearer synthetic.normal-customer-session",
          },
          body: JSON.stringify({
            operation,
            arguments: args[operation],
            request_id: payload.request_id,
            channel: "mcp",
          }),
        }),
      );
      assert.equal(response.status, 200, await response.clone().text());
      assert.deepEqual(await response.json(), payload);
      assert.equal(calls.length, 2);
      assert.ok(
        calls[1].url.endsWith("/rpc/sandy_customer_provisioning_execute"),
      );
      assert.equal(
        new Headers(calls[1].init.headers).get("authorization"),
        "Bearer synthetic.normal-customer-session",
      );
    },
  );
}
Deno.test("all twelve manifests reconstruct exactly their immutable schema pins", async () => {
  assert.equal(Object.keys(provisioningOperations).length, 12);
  assert.equal(Object.keys(observed.outputs).length, 12);
  for (const c of Object.values(provisioningOperations)) {
    const { contract_sha256, ...source } = c;
    assert.equal(await argumentDigest(source), contract_sha256, c.operation);
  }
});
Deno.test("provisioning transport loss stays unknown and is never automatically replayed", async () => {
  let calls = 0;
  const handler = createOnboardingHandler({
    base: "https://zmqlyygzqoidkcwdysok.supabase.co",
    anon: "synthetic-anon",
    fetch: (async () => {
      if (calls++ === 0) {
        return Response.json({
          id: actor,
          role: "authenticated",
          email: "fixture@example.invalid",
          email_confirmed_at: "2026-10-21T00:00:00Z",
        });
      }
      throw Error("private_provider_material");
    }) as typeof fetch,
  });
  const response = await handler(
    new Request("https://project.invalid", {
      method: "POST",
      headers: { authorization: "Bearer synthetic.normal-customer-session" },
      body: JSON.stringify({
        operation: "customer.provisioning.execute",
        arguments: args["customer.provisioning.execute"],
        request_id: rid,
      }),
    }),
  );
  assert.equal(response.status, 503);
  const value = await response.json();
  assert.equal(value.executed, null);
  assert.equal(value.automatic_retry, false);
  assert.equal(value.request_id, rid);
  assert.equal(calls, 2);
  assert.equal(
    JSON.stringify(value).includes("private_provider_material"),
    false,
  );
});
