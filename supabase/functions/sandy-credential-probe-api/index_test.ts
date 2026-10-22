import { deepStrictEqual as eq } from "node:assert/strict";
import { createCredentialProbe, credentialHmac } from "./index.ts";
const target = "10000000-0000-4000-8000-000000000001",
  rotation = "10000000-0000-4000-8000-000000000002",
  challenge = "10000000-0000-4000-8000-000000000003";
const body = { target_id: target, rotation_id: rotation, challenge };
const request = (value: unknown = body, token = "internal") =>
  new Request("https://fixture.invalid", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(value),
  });
Deno.test("probe requires internal service and a configured exact target", async () => {
  let reads = 0;
  const handler = createCredentialProbe({
    service: "internal",
    bindings: {},
    getSecret: () => {
      reads++;
      return "fixture";
    },
  });
  eq((await handler(request(body, "other"))).status, 403);
  eq((await handler(request())).status, 424);
  eq(reads, 0);
});
Deno.test("probe returns a domain-separated HMAC without plaintext", async () => {
  const handler = createCredentialProbe({
    service: "internal",
    bindings: { [target]: "SANDY_ROTATION_TEST_SECRET" },
    getSecret: () => "synthetic-fixture-material",
  });
  const response = await handler(request());
  const text = await response.text();
  eq(response.status, 200);
  eq(text.includes("synthetic-fixture-material"), false);
  eq(
    JSON.parse(text).hmac_sha256,
    await credentialHmac("synthetic-fixture-material", rotation, challenge),
  );
});
Deno.test("caller cannot choose environment name, URL or provider credentials", async () => {
  const handler = createCredentialProbe({
    service: "internal",
    bindings: { [target]: "SUPABASE_SERVICE_ROLE_KEY" },
    getSecret: () => "not-read",
  });
  eq((await handler(request())).status, 424);
  eq(
    (await handler(request({ ...body, secret_name: "anything" }))).status,
    400,
  );
  eq(
    (await handler(request({ ...body, challenge: "../../secret" }))).status,
    400,
  );
});
Deno.test("probe proof cannot be replayed across rotation or challenge", async () => {
  const proof = await credentialHmac("fixture", rotation, challenge);
  eq(proof === await credentialHmac("fixture", challenge, rotation), false);
});
