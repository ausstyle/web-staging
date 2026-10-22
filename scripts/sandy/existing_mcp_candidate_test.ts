import { strict as assert } from "node:assert";
import { validate, acceptanceGuard } from "./existing_mcp_candidate.ts";
function fixture() {
  const identity = "sandy-mcp-runtime@elaborate-haven-511518-a5.iam.gserviceaccount.com";
  const source = "a".repeat(40), name = "sandy-engineering-mcp-api-39849886412-4";
  const url = "https://sandy-engineering-mcp-fixture-ew.a.run.app";
  const tag = { tag: "sandy-api-review", revisionName: name, url: url.replace("https://", "https://sandy-api-review---") };
  const traffic = [{ revisionName: "preserved-production", percent: 100 }, tag];
  return { before: { service: "sandy-engineering-mcp", project: "elaborate-haven-511518-a5", region: "europe-west1", source_commit_candidate: source, verified_runtime_identity: identity, url, traffic },
    after: { status: { latestCreatedRevisionName: name, traffic } },
    live: { spec: { template: { spec: { serviceAccountName: identity } } }, status: { url, traffic: structuredClone(traffic) } },
    revision: { metadata: { name, labels: { "serving.knative.dev/service": "sandy-engineering-mcp" } }, spec: { serviceAccountName: identity }, status: { conditions: [{ type: "Ready", status: "True" }], imageDigest: "image@sha256:fixture" } }, source };
}
const check = (f: ReturnType<typeof fixture>, promoted = false) => validate(f.before, f.after, f.live, f.revision, f.source, "39849886412", "4", promoted);
Deno.test("existing candidate requires live exact source, tag, identity, readiness and preserved traffic", () => {
  assert.equal(check(fixture()).production_promoted, false);
  const mutations = [
    (f: any) => f.source = "b".repeat(40),
    (f: any) => f.after.status.latestCreatedRevisionName = "wrong",
    (f: any) => f.live.status.traffic[1].revisionName = "moved-tag",
    (f: any) => f.revision.spec.serviceAccountName = "administrator",
    (f: any) => f.revision.status.conditions[0].status = "False",
    (f: any) => f.revision.status.imageDigest = "",
    (f: any) => f.live.status.traffic[0].revisionName = "changed-production",
  ];
  for (const mutate of mutations) { const f = fixture(); mutate(f); assert.throws(() => check(f)); }
});
Deno.test("promotion needs normal retired customer Auth, real provider and denied authorization evidence", () => {
  const proof = check(fixture());
  const report = { passed: true, candidate_source_commit: proof.source_commit, target: proof.target,
    normal_Auth_user_verified: true, controller_memberships: 0, normal_Auth_session_retired: true,
    personal_Controller_token_used: false, service_key_used_as_customer_session: false,
    provider_log_query_verified: true, provider_http_status: 200, admission_id: "receipt", wrong_log_source_API_status: 403,
    wrong_source_denied_before_admission: true };
  acceptanceGuard(report, proof);
  for (const key of ["passed", "normal_Auth_session_retired", "provider_log_query_verified", "wrong_source_denied_before_admission"]) {
    assert.throws(() => acceptanceGuard({ ...report, [key]: false }, proof));
  }
  assert.throws(() => acceptanceGuard({ ...report, controller_memberships: 1 }, proof));
  assert.throws(() => acceptanceGuard({ ...report, target: "https://elsewhere.invalid" }, proof));
  const f = fixture(); f.live.status.traffic[0] = { revisionName: f.revision.metadata.name, percent: 100 } as any;
  assert.equal(check(f, true).production_promoted, true);
  assert.throws(() => check(f)); assert.throws(() => check(fixture(), true));
});
