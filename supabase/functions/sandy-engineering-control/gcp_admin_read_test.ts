import assert from "node:assert/strict";
import { handleGcpAdminRead, verifyRuntime } from "./gcp_admin_read.ts";
import { generateKeyPair, SignJWT } from "npm:jose@5.10.0";
const owner = { id: "11111111-1111-4111-8111-111111111111" };
const ticket = {
  admission_id: "22222222-2222-4222-8222-222222222222",
  grant_id: "33333333-3333-4333-8333-333333333333",
  request_id: "44444444-4444-4444-8444-444444444444",
};
const body = { action: "preflight", connection: "sandy-gcp-admin" };
const worker =
  "https://sandy-api-review---sandy-engineering-mcp-fixture-ew.a.run.app";

Deno.test("successful administrator proof requires fixed provider reads and rejects unexpected credential fields", async () => {
  const runtime =
    "sandy-mcp-runtime@elaborate-haven-511518-a5.iam.gserviceaccount.com";
  const targets = ["sandy-video", "sandy-windows"].map((vm_name, i) => ({
    vm_name,
    instance_id: ["6831598645020395570", "8120150462304566315"][i],
    port: [22, 5986][i],
    policy_read_verified: true,
    etag: "fixture-etag",
    target_bindings: [],
  }));
  const urls = [
    "https://run.googleapis.com/v2/projects/elaborate-haven-511518-a5/locations/europe-west1/services/sandy-engineering-mcp",
    ...targets.flatMap(
      (t) => [
        "https://compute.googleapis.com/compute/v1/projects/elaborate-haven-511518-a5/zones/europe-west1-b/instances/" +
        t.vm_name,
        "https://iap.googleapis.com/v1/projects/1030223524306/iap_tunnel/zones/europe-west1-b/instances/" +
        t.instance_id + ":getIamPolicy",
      ],
    ),
  ];
  const proof = {
    ok: true,
    connection: "sandy-gcp-admin",
    read_only: true,
    runtime_identity: runtime,
    deployed_runtime_identity: runtime,
    administrator_identity:
      "sandy-cloud-administrator@elaborate-haven-511518-a5.iam.gserviceaccount.com",
    admission_id: ticket.admission_id,
    token_issuance_verified: true,
    token_recorded: false,
    token_expires_at: new Date(Date.now() + 1800000).toISOString(),
    targets,
    provider_receipts: urls.map((endpoint) => ({ endpoint, http_status: 200 })),
    IAM_changes: 0,
    agents_enrolled: 0,
  };
  let shouldSucceed = true;
  const db = {
    rpc: async (name: string, args: any) => {
      if (name.endsWith("admit")) return { data: ticket };
      assert.equal(args.p_succeeded, shouldSucceed);
      return { data: { ok: true } };
    },
  };
  assert.equal(
    (await handleGcpAdminRead(
      db,
      owner,
      { role: "owner" },
      "private-owner",
      body,
      worker,
      async () => Response.json(proof),
    )).status,
    200,
  );
  shouldSucceed = false;
  const denied = await handleGcpAdminRead(
    db,
    owner,
    { role: "owner" },
    "private-owner",
    body,
    worker,
    async () =>
      Response.json({ ...proof, access_token: "PRIVATE_MUST_NOT_LEAK" }),
  );
  assert.equal(denied.status, 424);
  assert.equal((await denied.text()).includes("PRIVATE_MUST"), false);
});
Deno.test("Google worker identity verifies signature, issuer, audience, expiry and exact verified email", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const sign = (
    patch: any = {},
    issuer = "https://accounts.google.com",
    audience = "sandy-gcp-admin-readonly-zmqlyygzqoidkcwdysok",
  ) =>
    new SignJWT({
      email:
        "sandy-mcp-runtime@elaborate-haven-511518-a5.iam.gserviceaccount.com",
      email_verified: true,
      ...patch,
    })
      .setProtectedHeader({ alg: "RS256" }).setIssuer(issuer).setAudience(
        audience,
      ).setIssuedAt().setExpirationTime("5m").sign(privateKey);
  assert.equal(await verifyRuntime(await sign(), publicKey), true);
  assert.equal(
    await verifyRuntime(await sign({ email_verified: false }), publicKey),
    false,
  );
  assert.equal(
    await verifyRuntime(await sign({ email: "other@example.test" }), publicKey),
    false,
  );
  await assert.rejects(() =>
    sign({}, "https://evil.invalid").then((t) => verifyRuntime(t, publicKey))
  );
  await assert.rejects(() =>
    sign({}, undefined, "wrong-audience").then((t) =>
      verifyRuntime(t, publicKey)
    )
  );
  const another = await generateKeyPair("RS256");
  await assert.rejects(() =>
    sign().then((t) => verifyRuntime(t, another.publicKey))
  );
});
Deno.test("administrator read retains Owner Auth and refuses workload authority, arbitrary URLs and extra arguments", async () => {
  let calls = 0;
  const db = {
    rpc: () => {
      calls++;
      throw Error();
    },
  };
  for (
    const [user, admin, args, url] of [
      [owner, { role: "engineering" }, body, worker],
      [
        { ...owner, app_metadata: { sandy_engineering_test: true } },
        { role: "owner" },
        body,
        worker,
      ],
      [
        owner,
        { role: "owner" },
        { ...body, url: "https://evil.invalid" },
        worker,
      ],
      [owner, { role: "owner" }, body, "https://evil.invalid"],
    ] as const
  ) {
    assert.notEqual(
      (await handleGcpAdminRead(db, user, admin, "private-owner", args, url))
        .status,
      200,
    );
  }
  assert.equal(calls, 0);
});
Deno.test("runtime claim requires Google's verified worker identity and one-use central admission", async () => {
  let calls = 0;
  const db = {
    rpc: async (name: string, args: any) => {
      calls++;
      assert.equal(name, "sandy_gcp_admin_read_claim");
      assert.equal(args.p_actor, owner.id);
      return { data: { ok: true, admission_id: ticket.admission_id } };
    },
  };
  const b = {
    action: "gcp_admin_read_claim",
    ...ticket,
    worker_identity: "PRIVATE_ID_TOKEN",
  };
  assert.equal(
    (await handleGcpAdminRead(
      db,
      owner,
      { role: "owner" },
      "private-owner",
      b,
      worker,
      fetch,
      async () => false,
    )).status,
    403,
  );
  assert.equal(calls, 0);
  assert.equal(
    (await handleGcpAdminRead(
      db,
      owner,
      { role: "owner" },
      "private-owner",
      b,
      worker,
      fetch,
      async () => true,
    )).status,
    200,
  );
  assert.equal(calls, 1);
});
Deno.test("preflight forwards only the admitted read, settles the shared receipt and preserves unknown outcome", async () => {
  const calls: string[] = [];
  const db = {
    rpc: async (name: string, args: any) => {
      calls.push(name);
      if (name.endsWith("admit")) return { data: ticket };
      assert.equal(args.p_actor, owner.id);
      assert.equal(args.p_succeeded, false);
      assert.match(args.p_result_sha256, /^[a-f0-9]{64}$/);
      return { data: { ok: true } };
    },
  };
  const r = await handleGcpAdminRead(
    db,
    owner,
    { role: "owner" },
    "private-owner",
    body,
    worker,
    async (url, init) => {
      assert.equal(url, worker + "/internal/gcp-admin/preflight");
      assert.equal(
        (init?.headers as any).authorization,
        "Bearer private-owner",
      );
      assert.deepEqual(JSON.parse(String(init?.body)), ticket);
      throw Error("PRIVATE_NETWORK_EXCEPTION");
    },
  );
  assert.equal(r.status, 424);
  const proof = await r.json();
  assert.equal(proof.executed, null);
  assert.equal(JSON.stringify(proof).includes("PRIVATE"), false);
  assert.deepEqual(calls, [
    "sandy_gcp_admin_read_admit",
    "sandy_gcp_admin_read_finish",
  ]);
});
