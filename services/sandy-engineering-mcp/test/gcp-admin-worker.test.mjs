import test from "node:test";
import assert from "node:assert/strict";
import { metadataConnection, readAdministrator, createAdminReadWorker, runtimeAccount, administratorAccount, workerAudience } from "../src/gcp-admin-worker.mjs";
const ticket = { admission_id: "11111111-1111-4111-8111-111111111111", grant_id: "22222222-2222-4222-8222-222222222222", request_id: "33333333-3333-4333-8333-333333333333" };
function fixture() {
  const calls = [], now = Date.now(); let issued = 0;
  const admin = { credentials: { expiry_date: now + 1800000 },
    getAccessToken: async () => { issued++; return { token: "PRIVATE_OAUTH_MUST_NOT_LEAK" }; },
    request: async options => {
      calls.push(options);
      if (options.url.startsWith("https://run.googleapis.com/")) return { status: 200, data: { template: { serviceAccount: runtimeAccount }, latestReadyRevision: "fixture-revision" } };
      if (options.url.startsWith("https://compute.googleapis.com/")) {
        const windows = options.url.endsWith("sandy-windows");
        return { status: 200, data: { name: windows ? "sandy-windows" : "sandy-video", id: windows ? "8120150462304566315" : "6831598645020395570" } };
      }
      assert.ok(options.url.startsWith("https://iap.googleapis.com/")); assert.ok(options.url.endsWith(":getIamPolicy"));
      return { status: 200, data: { etag: "fixture-etag", version: 3, bindings: [] } };
    } };
  return { admin, calls, issued: () => issued, connection: { principal: runtimeAccount, identityToken: async () => "PRIVATE_ID_TOKEN_MUST_NOT_LEAK", administrator: () => admin } };
}
function response() { return { code: null, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }

test("metadata source identity is checked before fixed SDK impersonation; keys and ADC are never selected", async () => {
  let options;
  const source = { fetchIdToken: async audience => { assert.equal(audience, workerAudience); return "private-identity"; } };
  const connect = metadataConnection(async (url, init) => {
    assert.equal(url, "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email");
    assert.equal(init.headers["Metadata-Flavor"], "Google");
    return new Response(runtimeAccount, { headers: { "Metadata-Flavor": "Google" } });
  }, source, value => { options = value; return "fixture"; });
  const c = await connect(); assert.equal(await c.identityToken(), "private-identity"); assert.equal(c.administrator(), "fixture");
  assert.equal(options.sourceClient, source); assert.equal(options.targetPrincipal, administratorAccount);
  assert.equal(options.lifetime, 1800); assert.deepEqual(options.delegates, []);
  await assert.rejects(metadataConnection(async () => new Response("wrong@example.test", { headers: { "Metadata-Flavor": "Google" } }), source), /deployed_runtime_identity_mismatch/);
});
test("connection performs only fixed reads and reports actual expiry without disclosing access tokens", async () => {
  const f = fixture(), proof = await readAdministrator(f.connection);
  assert.equal(f.issued(), 1); assert.equal(proof.token_issuance_verified, true);
  assert.equal(proof.targets.length, 2); assert.equal(proof.IAM_changes, 0); assert.equal(proof.agents_enrolled, 0);
  assert.equal(JSON.stringify(proof).includes("PRIVATE"), false);
  assert.equal(f.calls.length, 5);
  for (const c of f.calls) { assert.equal(c.retry, false); assert.equal(c.maxRedirects, 0); assert.ok(c.method === "GET" || c.url.endsWith(":getIamPolicy")); }
});
test("protected worker refuses missing/extra context and denied admissions before administrator issuance", async () => {
  const f = fixture(); let claimed = 0;
  const run = createAdminReadWorker({ connect: async () => f.connection, request: async () => { claimed++; return Response.json({ ok: false }, { status: 403 }); } });
  for (const body of [{}, { ...ticket, url: "https://evil.invalid" }]) {
    const r = response(); await run({ get: () => "Bearer owner-fixture", body }, r); assert.equal(r.code, 403);
  }
  assert.equal(claimed, 0);
  const r = response(); await run({ get: () => "Bearer owner-fixture", body: ticket }, r);
  assert.equal(r.code, 403); assert.equal(f.issued(), 0);
});
test("worker claim binds caller and admission; successful result and failures redact all credentials", async () => {
  const f = fixture();
  const run = createAdminReadWorker({ connect: async () => f.connection, request: async (url, init) => {
    assert.equal(url, "https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-engineering-control");
    assert.equal(init.headers.authorization, "Bearer owner-fixture");
    assert.deepEqual(JSON.parse(init.body), { action: "gcp_admin_read_claim", ...ticket, worker_identity: "PRIVATE_ID_TOKEN_MUST_NOT_LEAK" });
    return Response.json({ ok: true, admission_id: ticket.admission_id });
  } });
  const r = response(); await run({ get: () => "Bearer owner-fixture", body: ticket }, r);
  assert.equal(r.code, 200); assert.equal(r.body.admission_id, ticket.admission_id); assert.equal(JSON.stringify(r.body).includes("PRIVATE"), false);
  f.admin.request = async () => { throw Object.assign(new Error("PRIVATE_PROVIDER_BODY"), { response: { status: 403 } }); };
  const failed = response(); await run({ get: () => "Bearer owner-fixture", body: ticket }, failed);
  assert.equal(failed.code, 424); assert.equal(failed.body.provider_http_status, 403); assert.equal(JSON.stringify(failed.body).includes("PRIVATE"), false);
  f.admin.credentials.expiry_date = Date.now() + 3600000;
  await assert.rejects(() => readAdministrator(f.connection), /administrator_token_expiry_invalid/);
});
test("metadata ID tokens accept only the two protected fixed audiences", async () => {
  const audiences=[];
  const connect=metadataConnection(async()=>new Response(runtimeAccount,{headers:{"Metadata-Flavor":"Google"}}),{fetchIdToken:async value=>{audiences.push(value);return "fixture";}});
  const c=await connect();
  await c.identityToken();await c.identityToken("sandy-gcp-iap-repair-zmqlyygzqoidkcwdysok");
  assert.throws(()=>c.identityToken("https://unapproved.example.invalid"),/protected_worker_audience_required/);
  assert.deepEqual(audiences,[workerAudience,"sandy-gcp-iap-repair-zmqlyygzqoidkcwdysok"]);
});
