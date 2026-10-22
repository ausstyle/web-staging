/** Acceptance-only recovery of a source-bound, previously deployed candidate. */
import { candidateUrl } from "./verify_mcp_candidate.ts";
type Obj = Record<string, any>;
const service = "sandy-engineering-mcp";
const identity = "sandy-mcp-runtime@elaborate-haven-511518-a5.iam.gserviceaccount.com";
function need(ok: unknown, code: string): asserts ok { if (!ok) throw Error(code); }
function active(rows: Obj[]) {
  need(Array.isArray(rows), "traffic_missing");
  const selected = rows.filter(r => r.percent > 0);
  need(selected.length > 0 && selected.every(r => typeof r.revisionName === "string" && Number.isInteger(r.percent)) &&
    selected.reduce((n, r) => n + r.percent, 0) === 100, "resolved_traffic_required");
  return selected.map(r => `${r.revisionName}=${r.percent}`).sort();
}
export function validate(before: Obj, after: Obj, live: Obj, revision: Obj, source: string, run: string, attempt: string, promoted = false) {
  need(/^[a-f0-9]{40}$/.test(source) && /^[1-9][0-9]{0,14}$/.test(run) && /^[1-9][0-9]{0,14}$/.test(attempt), "release_identifiers_invalid");
  const expected = `${service}-api-${run}-${attempt}`, target = candidateUrl(before, after, source);
  need(before.verified_runtime_identity === identity && before.region === "europe-west1", "preserved_identity_mismatch");
  need(after.status?.latestCreatedRevisionName === expected, "artifact_revision_mismatch");
  const artifactTag = after.status?.traffic?.filter((r: Obj) => r.tag === "sandy-api-review");
  need(artifactTag?.length === 1 && artifactTag[0].revisionName === expected, "artifact_tag_mismatch");
  need(revision.metadata?.name === expected && revision.metadata?.labels?.["serving.knative.dev/service"] === service &&
    revision.spec?.serviceAccountName === identity && revision.status?.conditions?.some((c: Obj) => c.type === "Ready" && c.status === "True") &&
    typeof revision.status?.imageDigest === "string" && revision.status.imageDigest.length > 0, "live_revision_identity_or_readiness_mismatch");
  need(live.spec?.template?.spec?.serviceAccountName === identity && live.status?.url === before.url, "live_service_identity_mismatch");
  const tags = live.status?.traffic?.filter((r: Obj) => r.tag === "sandy-api-review");
  need(tags?.length === 1 && tags[0].revisionName === expected && tags[0].url + "/mcp" === target, "live_candidate_tag_changed");
  const previous = active(before.traffic), current = active(live.status?.traffic);
  need(JSON.stringify(current) === JSON.stringify(promoted ? [`${expected}=100`] : previous), "production_traffic_mismatch");
  return { verified: true, source_commit: source, revision: expected, runtime_identity: identity,
    image_digest: revision.status.imageDigest, target, previous_traffic: previous,
    production_traffic: current, production_promoted: promoted, observed_at: new Date().toISOString() };
}
export function acceptanceGuard(report: Obj, proof: ReturnType<typeof validate>) {
  need(report.passed === true && report.candidate_source_commit === proof.source_commit && report.target === proof.target &&
    report.normal_Auth_user_verified === true && report.controller_memberships === 0 && report.normal_Auth_session_retired === true &&
    report.personal_Controller_token_used === false && report.service_key_used_as_customer_session === false &&
    report.provider_log_query_verified === true && report.provider_http_status === 200 && typeof report.admission_id === "string" &&
    report.wrong_log_source_API_status === 403 && report.wrong_source_denied_before_admission === true,
    "authenticated_acceptance_required_before_promotion");
}
if (import.meta.main) {
  const [mode, release, evidence] = Deno.args;
  need(["verify", "promote-guard", "promoted"].includes(mode) && release && evidence, "arguments_invalid");
  const read = async (path: string) => JSON.parse(await Deno.readTextFile(path));
  const proof = validate(await read(`${release}/before.json`), await read(`${release}/after.json`),
    await read(`${evidence}/${mode === "promoted" ? "promoted-service" : "live-service"}.json`), await read(`${evidence}/live-revision.json`),
    Deno.env.get("SANDY_CANDIDATE_SOURCE") ?? "", Deno.env.get("SANDY_RELEASE_RUN") ?? "", Deno.env.get("SANDY_RELEASE_ATTEMPT") ?? "", mode === "promoted");
  if (mode !== "verify") acceptanceGuard(await read(`${evidence}/authenticated-acceptance.json`), proof);
  await Deno.writeTextFile(`${evidence}/${mode}.json`, JSON.stringify(proof, null, 2) + "\n");
  console.log("::notice title=Existing candidate " + mode + "::" + JSON.stringify(proof));
}
