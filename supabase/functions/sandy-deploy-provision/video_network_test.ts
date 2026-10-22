import { prepareVideoNetwork } from "./video_network.ts";
type Obj = Record<string, unknown>;
const P = "elaborate-haven-511518-a5", Z = "europe-west1-b", R = "europe-west1";
const SELF = `https://www.googleapis.com/compute/v1/projects/${P}`;
const BASE = `https://compute.googleapis.com/compute/v1/projects/${P}`;
const ref = `${SELF}/regions/${R}/subnetworks/default`;
const input = { action: "video_network_prepare", change_id: "232d8d7e-ac98-4669-9907-93302303a7c1", request_id: "11111111-1111-4111-8111-111111111111" };
const vm = () => ({ id: "6831598645020395570", name: "sandy-video", status: "RUNNING", zone: `${SELF}/zones/${Z}`, networkInterfaces: [{ subnetwork: ref }], metadata: { private: "never disclose" } });
const subnet = (enabled: boolean) => ({ name: "default", selfLink: ref, region: `${SELF}/regions/${R}`, privateIpGoogleAccess: enabled });
const operation = () => ({ name: "operation-fixture-123", region: `${SELF}/regions/${R}`, targetLink: ref });
const assert = (value: unknown) => { if (!value) throw Error("assertion failed"); };
type Reply = { value?: Obj; status?: number; fail?: boolean };
function harness(replies: Reply[] = [{ value: vm() }, { value: subnet(false) }, { value: operation() }, { value: subnet(true) }], admission: unknown = { ok: true, admission_id: 1 }, audit = true) {
  const calls: { url: string; method: string; body?: string }[] = [], records: Obj[] = [];
  const deps = {
    token: "private-fixture-google-token",
    db: { rpc: (name: string, args: Obj) => {
      if (name === "sandy_video_network_prepare_authorize") return Promise.resolve({ data: admission, error: null });
      assert(name === "sandy_video_network_prepare_record"); records.push(args);
      return Promise.resolve({ data: { ok: audit }, error: null });
    } },
    fetch: ((url: unknown, options: RequestInit) => {
      calls.push({ url: String(url), method: options.method || "GET", body: options.body as string | undefined });
      assert(new Headers(options.headers).get("authorization") === "Bearer private-fixture-google-token");
      assert(options.redirect === "error");
      const next = replies.shift(); assert(next);
      if (next!.fail) return Promise.reject(Error("private-fixture-google-token"));
      return Promise.resolve(Response.json(next!.value, { status: next!.status ?? 200 }));
    }) as typeof fetch,
  };
  return { deps, calls, records };
}
async function run(h: ReturnType<typeof harness>, args: Obj = input) {
  const response = await prepareVideoNetwork(h.deps, args), body = await response.json();
  assert(!JSON.stringify(body).includes(h.deps.token) && !JSON.stringify(body).includes("never disclose"));
  return { status: response.status, body };
}
Deno.test("network preparation only enables Private Google Access on the proven existing VM subnet", async () => {
  const h = harness(), r = await run(h);
  assert(r.status === 200 && r.body.configuration_verified === true && r.body.mutation_attempted === true);
  assert(h.calls.length === 4 && h.calls[2].url === `${BASE}/regions/${R}/subnetworks/default/setPrivateIpGoogleAccess` && h.calls[2].body === '{"privateIpGoogleAccess":true}');
  assert(h.calls.filter(x => x.method !== "GET").length === 1 && h.records.length === 1);
  assert(r.body.iam_changed === false && r.body.nat_created === false && r.body.firewall_changed === false && r.body.paid_resource_created === false);
});
Deno.test("existing desired state is independently verified without a mutation", async () => {
  const h = harness([{ value: vm() }, { value: subnet(true) }]), r = await run(h);
  assert(r.status === 200 && r.body.configuration_verified === true && r.body.mutation_attempted === false && h.calls.length === 2);
});
for (const args of [{ ...input, provider_url: "https://attacker.invalid" }, { ...input, change_id: "invalid" }, { ...input, request_id: undefined }]) {
  Deno.test("caller-selected or malformed configuration arguments are refused", async () => {
    const h = harness(), r = await run(h, args);
    assert(r.status === 400 && h.calls.length === 0 && h.records.length === 0);
  });
}
Deno.test("actual owner approval is mandatory before provider reads or writes", async () => {
  const h = harness([], { ok: false }), r = await run(h);
  assert(r.status === 403 && h.calls.length === 0 && r.body.mutation_attempted === false);
});
Deno.test("unavailable authority fails closed", async () => {
  const h = harness([], null), r = await run(h);
  assert(r.status === 503 && h.calls.length === 0);
});
for (const bad of [{ ...vm(), id: "different" }, { ...vm(), status: "TERMINATED" }, { ...vm(), zone: "other" }, { ...vm(), networkInterfaces: [{ subnetwork: ref }, { subnetwork: ref }] }]) {
  Deno.test("fixed VM identity, running state and unique NIC are required", async () => {
    const h = harness([{ value: bad }]), r = await run(h);
    assert(r.status === 409 && h.calls.length === 1 && r.body.mutation_attempted === false);
  });
}
Deno.test("cross-project subnet references are refused", async () => {
  const h = harness([{ value: { ...vm(), networkInterfaces: [{ subnetwork: ref.replace(P, "foreign-project") }] } }]), r = await run(h);
  assert(r.status === 409 && h.calls.length === 1);
});
Deno.test("subnet readback must prove its actual identity", async () => {
  const h = harness([{ value: vm() }, { value: { ...subnet(false), selfLink: "foreign" } }]), r = await run(h);
  assert(r.status === 409 && h.calls.length === 2 && r.body.mutation_attempted === false);
});
Deno.test("Google write permission denial is reported without a success claim or retry", async () => {
  const h = harness([{ value: vm() }, { value: subnet(false) }, { value: { error: { status: "PERMISSION_DENIED", message: "Required compute.subnetworks.setPrivateIpGoogleAccess permission" } }, status: 403 }]), r = await run(h);
  assert(r.status === 502 && r.body.phase === "failed" && r.body.google_http === 403 && r.body.configuration_verified === false && r.body.automatic_retry === false && h.calls.length === 3);
});
Deno.test("lost write response remains unknown and is not retried", async () => {
  const h = harness([{ value: vm() }, { value: subnet(false) }, { fail: true }]), r = await run(h);
  assert(r.status === 503 && r.body.phase === "unknown" && r.body.reconciliation_required === true && h.calls.length === 3);
});
Deno.test("accepted provider operation is not completed configuration", async () => {
  const h = harness([{ value: vm() }, { value: subnet(false) }, { value: operation() }, { value: subnet(false) }]), r = await run(h);
  assert(r.status === 202 && r.body.phase === "accepted" && r.body.configuration_verified === false && r.body.reconciliation_required === true);
});
Deno.test("readback denial after an accepted change remains unknown", async () => {
  const h = harness([{ value: vm() }, { value: subnet(false) }, { value: operation() }, { value: { error: { status: "PERMISSION_DENIED" } }, status: 403 }]), r = await run(h);
  assert(r.status === 502 && r.body.phase === "unknown" && r.body.accepted === true && r.body.reconciliation_required === true);
});
Deno.test("foreign operation is never followed or reported as success", async () => {
  const h = harness([{ value: vm() }, { value: subnet(false) }, { value: { ...operation(), targetLink: "foreign" } }]), r = await run(h);
  assert(r.status === 503 && r.body.phase === "unknown" && h.calls.length === 3);
});
Deno.test("failed final audit prevents a misleading provider success", async () => {
  const h = harness(undefined, undefined, false), r = await run(h);
  assert(r.status === 503 && r.body.error === "network_audit_outcome_unknown" && r.body.configuration_verified === false && r.body.reconciliation_required === true);
});
Deno.test("provider errors redact known credentials", async () => {
  const h = harness([{ value: { error: { status: "PERMISSION_DENIED", message: "Rejected private-fixture-google-token Bearer unknown-secret" } }, status: 403 }]), r = await run(h);
  assert(r.status === 502 && !r.body.google_error_message.includes("unknown-secret") && r.body.mutation_attempted === false);
});
