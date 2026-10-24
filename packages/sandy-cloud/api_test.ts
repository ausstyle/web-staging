import { deepStrictEqual } from "node:assert/strict";
import { CloudDomain } from "./domain.ts";
import { apiHandler } from "./api.ts";
Deno.test("HTTP fixture boundary enforces identity, origin, tenant and input limits", async () => {
  const root = Deno.makeTempDirSync({ dir: "/tmp", prefix: "cloud-http-" }),
    d = new CloudDomain(
      root,
      Deno.readTextFileSync(new URL("./schema.sql", import.meta.url)),
    );
  d.seedWorkspace("w", "a", "Personal", [["alice", "owner"]]);
  const h = apiHandler(
    d,
    (r) =>
      r.headers.get("authorization") === "Bearer fixture"
        ? { id: "alice", tenantId: "a" }
        : null,
    "http://127.0.0.1:8787",
  );
  const call = (
    value: any,
    headers: Record<string, string> = { "authorization": "Bearer fixture" },
  ) =>
    h(
      new Request("http://127.0.0.1:8787/api", {
        method: "POST",
        headers,
        body: JSON.stringify(value),
      }),
    );
  try {
    deepStrictEqual(
      (await call({ operation: "nodes.list", workspaceId: "w" }, {})).status,
      401,
    );
    deepStrictEqual(
      (await call({ operation: "nodes.list", workspaceId: "w" }, {
        authorization: "Bearer fixture",
        origin: "https://attacker.invalid",
      })).status,
      403,
    );
    deepStrictEqual(
      (await call({
        operation: "nodes.list",
        workspaceId: "other",
        actorId: "alice",
        tenantId: "other",
      })).status,
      400,
    );
    deepStrictEqual(
      (await call({
        operation: "nodes.list",
        workspaceId: "w",
        actorId: "attacker",
        tenantId: "other",
      })).status,
      400,
    );
    deepStrictEqual(
      (await call({ operation: "unknown", workspaceId: "w" })).status,
      404,
    );
    deepStrictEqual(
      (await call({
        operation: "nodes.list",
        workspaceId: "w",
        padding: "x".repeat(1500001),
      })).status,
      413,
    );
  } finally {
    d.close();
    Deno.removeSync(root, { recursive: true });
  }
});
