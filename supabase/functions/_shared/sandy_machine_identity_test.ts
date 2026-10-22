import { deepStrictEqual as eq, rejects } from "node:assert/strict";
import {
  createMachineAccessToken,
  type MachineAuth,
  machineScope,
} from "./sandy_machine_identity.ts";
const email = "sandy-gcp-machine@sandy-ai.internal",
  id = "10000000-0000-4000-8000-000000000001";
function fixture(tag = true) {
  const machine = { id, email, app_metadata: { sandy_gcp_machine: tag } };
  let links = 0;
  let verified = 0;
  const jwt = [
    "header",
    btoa(
      JSON.stringify({
        sub: id,
        aud: "authenticated",
        exp: Date.now() / 1000 + 300,
        app_metadata: { sandy_gcp_machine: true },
      }),
    ),
    "signature",
  ].join(".");
  const auth: MachineAuth = {
    admin: {
      listUsers: () =>
        Promise.resolve({ data: { users: [machine] }, error: null }),
      generateLink: (args) => {
        links++;
        eq(args, { type: "magiclink", email });
        return Promise.resolve({
          data: { properties: { hashed_token: "hash-fixture" } },
          error: null,
        });
      },
    },
    verifyOtp: () =>
      Promise.resolve({
        data: { session: { access_token: jwt } },
        error: null,
      }),
    getUser: () => {
      verified++;
      return Promise.resolve({ data: { user: machine }, error: null });
    },
  };
  return { auth, links: () => links, verified: () => verified };
}
Deno.test("untagged account cannot become a machine principal", async () => {
  const f = fixture(false);
  await rejects(
    createMachineAccessToken(f.auth),
    /dedicated_machine_identity_required/,
  );
  eq(f.links(), 0);
});
Deno.test("server verification prevents substitution of human identity", async () => {
  const f = fixture();
  f.auth.getUser = () =>
    Promise.resolve({
      data: { user: { id, email: "human@example.test", app_metadata: {} } },
      error: null,
    });
  let requests = 0;
  await rejects(
    createMachineAccessToken(
      f.auth,
      (() => {
        requests++;
        throw new Error("not reached");
      }) as typeof fetch,
    ),
    /machine_identity_verification_failed/,
  );
  eq(requests, 0);
});
Deno.test("federation and impersonation use only fixed deployed audience and service account", async () => {
  const f = fixture();
  const requests: { url: string; init: RequestInit }[] = [];
  const fetcher = ((url: string, init: RequestInit) => {
    requests.push({ url, init });
    return Promise.resolve(
      requests.length === 1
        ? new Response(JSON.stringify({ access_token: "sts-fixture" }), {
          status: 200,
        })
        : new Response(
          JSON.stringify({
            accessToken: "provider-fixture",
            expireTime: new Date(Date.now() + 1800000).toISOString(),
          }),
          { status: 200 },
        ),
    );
  }) as typeof fetch;
  const get = createMachineAccessToken(f.auth, fetcher);
  eq(await get(), "provider-fixture");
  eq(await get(), "provider-fixture");
  eq(f.links(), 1);
  eq(f.verified(), 1);
  eq(requests.length, 2);
  eq(requests[0].url, "https://sts.googleapis.com/v1/token");
  eq(
    (requests[0].init.body as URLSearchParams).get("audience"),
    machineScope.audience,
  );
  eq(
    requests[1].url,
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${machineScope.service_account}:generateAccessToken`,
  );
  eq(requests[0].init.redirect, "error");
  eq(JSON.parse(String(requests[1].init.body)), {
    scope: ["https://www.googleapis.com/auth/cloud-platform"],
    lifetime: "1800s",
  });
});
Deno.test("provider errors never echo returned credential/error bodies", async () => {
  const f = fixture();
  const get = createMachineAccessToken(
    f.auth,
    (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error_description: "secret-token-value" }),
          { status: 403 },
        ),
      )) as typeof fetch,
  );
  await rejects(get, /^Error: machine_federation_rejected_403$/);
});
