import assert from "node:assert/strict";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createProviderMachineCredential } from "./index.ts";
import {
  createMachineAccessToken,
  type MachineAuth,
} from "../_shared/sandy_machine_identity.ts";

Deno.test("real Supabase SDK machine login cannot change the service identity used for engineering policy and receipts", async () => {
  const base = "https://machine-session.fixture.invalid";
  const service = "synthetic-service-key";
  const user = {
    id: "10000000-0000-4000-8000-000000000001",
    email: "sandy-gcp-machine@sandy-ai.internal",
    role: "authenticated",
    app_metadata: { sandy_gcp_machine: true },
  };
  const jwt = [
    btoa('{"alg":"HS256"}'),
    btoa(JSON.stringify({
      sub: user.id,
      aud: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3600,
      app_metadata: user.app_metadata,
    })),
    "synthetic-signature",
  ].join(".");
  const observed: string[] = [];
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/auth/v1/admin/users") {
      return Response.json({ users: [user], nextPage: null, lastPage: 1 });
    }
    if (url.pathname === "/auth/v1/admin/generate_link") {
      return Response.json({
        ...user,
        action_link: "https://fixture.invalid/unused",
        hashed_token: "synthetic-hash",
        email_otp: "000000",
        verification_type: "magiclink",
        redirect_to: base,
      });
    }
    if (url.pathname === "/auth/v1/verify") {
      return Response.json({
        access_token: jwt,
        refresh_token: "synthetic-refresh",
        expires_in: 3600,
        token_type: "bearer",
        user,
      });
    }
    if (url.pathname === "/auth/v1/user") {
      assert.equal(request.headers.get("authorization"), "Bearer " + jwt);
      return Response.json(user);
    }
    if (url.hostname === "sts.googleapis.com") {
      return Response.json({ access_token: "synthetic-sts" });
    }
    if (url.hostname === "iamcredentials.googleapis.com") {
      return Response.json({
        accessToken: "synthetic-gcp",
        expireTime: new Date(Date.now() + 1800000).toISOString(),
      });
    }
    if (url.pathname === "/rest/v1/rpc/engineering_receipt_fixture") {
      observed.push(request.headers.get("authorization") ?? "");
      return Response.json({ ok: true });
    }
    throw Error("Unexpected fixture request " + url.pathname);
  };
  const options = {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: transport },
  };
  const unsafeShared = createClient(base, service, options);
  await createMachineAccessToken(
    unsafeShared.auth as unknown as MachineAuth,
    transport,
  )();
  await unsafeShared.rpc("engineering_receipt_fixture");
  assert.equal(
    observed.pop(),
    "Bearer " + jwt,
    "Reproduce SDK mutation even with session persistence disabled",
  );
  const protectedService = createClient(base, service, options);
  const mint = createProviderMachineCredential(base, service, transport);
  assert.equal(await mint(), "synthetic-gcp");
  assert.equal(await mint(), "synthetic-gcp");
  await protectedService.rpc("engineering_receipt_fixture");
  assert.equal(observed.pop(), "Bearer " + service);
});
