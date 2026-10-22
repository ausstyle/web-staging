import { strict as assert } from "node:assert";
import { createEngineeringSessionClient } from "./sandy_engineering_session_client.ts";
const base = "https://zmqlyygzqoidkcwdysok.supabase.co";
const uid = "10000000-0000-4000-8000-000000000001", sid = "10000000-0000-4000-8000-000000000002";

Deno.test("shared issuer keeps the service DB client separate from the normal user Auth session and retires its exact session", async () => {
  const service = "fixture-service-only", meta = { sandy_engineering_test: true, sandy_engineering_epoch: 2 };
  const user = { id: uid, email: "sandy-engineering-test@sandy-ai.internal", role: "authenticated", app_metadata: meta };
  const token = btoa('{"alg":"HS256"}') + "." + btoa(JSON.stringify({ sub: uid, role: "authenticated", aud: "authenticated",
    session_id: sid, exp: Math.floor(Date.now() / 1000) + 3600, app_metadata: meta })) + ".fixture";
  const paths: string[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), headers = new Headers(init?.headers); paths.push(url.pathname);
    assert.equal(url.origin, base); assert.equal(headers.get("apikey"), service);
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      // verifyOtp signs in its own Auth client. It must never replace this bearer.
      assert.equal(headers.get("authorization"), "Bearer " + service);
      return Response.json({ ok: true, ...(url.pathname.endsWith("claim_auth_issue") ? { lease_id: sid } : {}) });
    }
    if (url.pathname === "/auth/v1/admin/generate_link") return Response.json({ hashed_token: "fixture-otp", ...user });
    if (url.pathname === "/auth/v1/verify") return Response.json({ access_token: token, refresh_token: "fixture-refresh",
      token_type: "bearer", expires_in: 3600, user });
    if (url.pathname === "/auth/v1/user") { assert.equal(headers.get("authorization"), "Bearer " + token); return Response.json(user); }
    if (url.pathname === "/auth/v1/logout") {
      assert.equal(url.searchParams.get("scope"), "local"); assert.equal(headers.get("authorization"), "Bearer " + token);
      return new Response(null, { status: 204 });
    }
    throw Error("unexpected_fixture_request");
  };
  const sessions = createEngineeringSessionClient(base, service, request), issued = await sessions.get({ userId: uid, epoch: 2, bootstrapGeneration: 2 });
  assert.equal(issued.token, token); assert.equal(issued.sessionId, sid);
  await sessions.retireIssued(issued);
  assert.deepEqual(paths, ["/rest/v1/rpc/sandy_engineering_claim_auth_issue", "/auth/v1/admin/generate_link", "/auth/v1/verify",
    "/auth/v1/user", "/rest/v1/rpc/sandy_engineering_register_session", "/rest/v1/rpc/sandy_engineering_release_auth_issue",
    "/rest/v1/rpc/sandy_engineering_retire_session", "/auth/v1/logout"]);
});
