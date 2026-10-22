import { canonicalJson } from "../_shared/sandy_api_protocol.ts";
type Obj = Record<string, any>;
export const routineTargets = ["sandy-agent-runtime-v4", "sandy-workspace", "sandy-email-runtime-canary"];
export const workflowPath = ".github/workflows/sandy-runtime-release-checks.yml";
export const workflowJob = "sandy-runtime-release-checks";
const sha = (x: unknown) => typeof x === "string" && /^[a-f0-9]{40}$/.test(x);
const digest = (x: unknown) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
export function delegationConfig(value: Obj, now: number): Obj {
  if (!Array.isArray(value.targets) || !value.targets.length || value.targets.length>3 || value.targets.some((x: string) => !routineTargets.includes(x)) ||
      !Array.isArray(value.reviewers) || !value.reviewers.length || value.reviewers.length>20 || value.reviewers.some((x: string) => typeof x !== "string" || !/^[a-zA-Z0-9-]{1,39}$/.test(x)) ||
      !sha(value.baseline_commit) || !digest(value.workflow_sha256) ||
      !Number.isFinite(Date.parse(value.expires_at)) || Date.parse(value.expires_at) <= now || Date.parse(value.expires_at) > now + 30 * 86400000) {
    throw Error("bounded_routine_delegation_configuration_required");
  }
  return { targets: [...new Set(value.targets)], reviewers: [...new Set(value.reviewers)], baseline_commit: value.baseline_commit,
    workflow_sha256: value.workflow_sha256, expires_at: value.expires_at };
}
export async function routineCandidate(change: Obj, tests: Obj[], policy: Obj, actor: string, now = Date.now()) {
  if (policy.enabled !== true || policy.standing_authorized_by !== actor || policy.standing_revoked_at ||
      !Number.isFinite(Date.parse(policy.standing_expires_at)) || Date.parse(policy.standing_expires_at) <= now ||
      !["low", "normal"].includes(change.risk) || change.status !== "proposed") throw Error("routine_policy_not_eligible");
  const config = delegationConfig({ ...policy.standing_config, expires_at: policy.standing_expires_at }, now);
  if (!Array.isArray(change.scope) || change.scope.length !== 2 ||
      !change.scope.includes("github:ausstyle/web-staging:engineering/sandy-unified-intelligence-20261021")) throw Error("routine_scope_not_eligible");
  const target = change.scope.find((x: string) => config.targets.includes(x));
  if (!target || !tests.length || tests.some(t => t.outcome !== "passed" || !t.checked_at)) throw Error("passing_routine_release_evidence_required");
  // Only actual release evidence, not arbitrary prose or a claimed success flag.
  const evidence = tests.map(t => t.evidence).filter(e => e?.release_manifest?.function === target);
  if (evidence.length !== 1) throw Error("unambiguous_release_manifest_required");
  const e = evidence[0], m = e.release_manifest;
  if (!sha(m.source_commit) || e.source_commit !== m.source_commit || !digest(e.manifest_sha256) ||
      !String(change.expected_behavior).includes(m.source_commit) || !String(change.expected_behavior).includes(e.manifest_sha256) ||
      !Number.isSafeInteger(m.expected_prior_version) || m.expected_prior_version < 1 || !digest(m.prior_bundle_sha256) ||
      !m.rollback || typeof m.rollback !== "string" || m.rollback.length < 25 || !m.files || Array.isArray(m.files) || typeof m.files!=="object" || !Object.keys(m.files).length || Object.keys(m.files).length>256 ||
      Object.entries(m.files).some(([p, h]) => p.includes("..") || p.startsWith("/") || !digest(h))) throw Error("pinned_source_and_rollback_required");
  if (!/^docs\/sandy-engineering\/evaluations\/[a-z0-9-]+-source-manifest\.json$/.test(e.release_manifest_path || "")) throw Error("committed_manifest_path_required");
  return { config, target, source: m.source_commit, manifest: e.manifest_sha256, manifestPath: e.release_manifest_path,
    releaseManifest: m, priorVersion: m.expected_prior_version, priorDigest: m.prior_bundle_sha256, rollback: m.rollback };
}

/** A fresh server-side GitHub read supplies review/CI proof. Workload JSON cannot
 * assert either. No provider mutation or owner-session creation exists here. */
export async function verifyRoutineReview(candidate: Obj, read: (path: string) => Promise<any>) {
  const root = "/repos/ausstyle/web-staging";
  const prs = await read(`${root}/commits/${candidate.source}/pulls?per_page=100`);
  if (!Array.isArray(prs) || prs.length >= 100) throw Error("routine_review_unavailable");
  const matching = prs.filter(p => sha(p.head?.sha) && p.head?.repo?.full_name === "ausstyle/web-staging" && p.state === "open");
  if (matching.length !== 1) throw Error("exact_reviewed_pull_request_required");
  const pr = matching[0], head = pr.head.sha, reviews = await read(`${root}/pulls/${pr.number}/reviews?per_page=100`);
  if (head !== candidate.source) {
    const tail = await read(`${root}/compare/${candidate.source}...${head}`);
    if (tail.status !== "ahead" || !Array.isArray(tail.files) || !tail.files.length || tail.files.length >= 300 ||
        tail.files.some((f: Obj) => [f.filename, f.previous_filename].filter(Boolean).some((p: string) => !/^docs\/sandy-engineering\/evaluations\/[a-z0-9-]+\.(json|md)$/.test(p)))) throw Error("source_changed_after_release_pin");
  }
  if (!Array.isArray(reviews) || reviews.length >= 100) throw Error("routine_review_unavailable");
  const latest = new Map<string, Obj>();
  for (const review of reviews) if ((candidate.autonomous || candidate.config.reviewers.includes(review.user?.login)) && review.commit_id === head &&
    ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state)) latest.set(review.user.login, review);
  const accepted = [...latest.values()].filter(r => r.state === "APPROVED" && r.user.login !== pr.user?.login);
  // Amendment B's separate workload gate supplies this server-derived flag.
  // External branch/environment protection remains authoritative at delivery.
  if ((!candidate.autonomous && !accepted.length) || [...latest.values()].some(r => r.state === "CHANGES_REQUESTED")) throw Error("independent_review_required");
  const checks = await read(`${root}/commits/${head}/check-runs?per_page=100`);
  const runs = checks?.check_runs;
  if (!Array.isArray(runs) || checks.total_count > 100) throw Error("routine_checks_unavailable");
  const required = runs.filter((r: Obj) => r.name === workflowJob && r.app?.slug === "github-actions" && r.head_sha === head)
    .sort((a: Obj, b: Obj) => b.id - a.id)[0];
  if (!required || required.status !== "completed" || required.conclusion !== "success") throw Error("successful_runtime_ci_required");
  const executions = await read(`${root}/actions/runs?head_sha=${head}&per_page=100`);
  if (!Array.isArray(executions.workflow_runs) || executions.total_count > 100 ||
      !executions.workflow_runs.some((r: Obj) => r.head_sha === head && r.check_suite_id === required.check_suite?.id &&
        r.path === workflowPath && r.event === "pull_request" && r.status === "completed" && r.conclusion === "success")) throw Error("trusted_ci_run_required");
  const file = await read(`${root}/contents/${workflowPath}?ref=${head}`);
  if (file?.encoding !== "base64" || typeof file.content !== "string") throw Error("trusted_workflow_required");
  const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, "")), c => c.charCodeAt(0));
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(x => x.toString(16).padStart(2, "0")).join("");
  if (hash !== candidate.config.workflow_sha256) throw Error("trusted_workflow_changed");
  const manifestFile = await read(`${root}/contents/${candidate.manifestPath}?ref=${head}`);
  if (manifestFile?.encoding !== "base64" || typeof manifestFile.content !== "string") throw Error("committed_manifest_required");
  const manifestBytes = Uint8Array.from(atob(manifestFile.content.replace(/\s/g, "")), c => c.charCodeAt(0));
  const manifestDigest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", manifestBytes))].map(x => x.toString(16).padStart(2, "0")).join("");
  if (manifestDigest !== candidate.manifest || canonicalJson(JSON.parse(new TextDecoder().decode(manifestBytes))) !== canonicalJson(candidate.releaseManifest)) throw Error("committed_manifest_mismatch");
  const diff = await read(`${root}/compare/${candidate.config.baseline_commit}...${candidate.source}`);
  if (!Array.isArray(diff.files) || !diff.files.length || diff.files.length >= 300 || diff.status !== "ahead") throw Error("bounded_source_diff_required");
  for (const f of diff.files) for (const name of [f.filename, f.previous_filename].filter(Boolean)) {
    if (/^docs\/sandy-engineering\/evaluations\/[a-z0-9-]+\.(json|md)$/.test(name)) continue;
    if (!name.startsWith(`supabase/functions/${candidate.target}/`) && !name.startsWith("supabase/functions/_shared/sandy-executive/")) throw Error("protected_or_unreviewed_scope_change");
    if (/(?:auth|identity|credential|permission|secret|billing|migration|delegation|security)/i.test(name)) throw Error(candidate.autonomous?"restricted_security_policy_required":"higher_risk_manual_owner_action_required");
    if (candidate.autonomous) {
      // A self-declared normal risk cannot authorize edits to credential,
      // customer-isolation, consent, pilot or confirmation enforcement.
      // Missing/truncated patch evidence requires a restricted policy instead.
      if (typeof f.patch !== "string" || !f.patch.length || f.patch.length > 100000) throw Error("bounded_source_patch_required");
      const changed = f.patch.split("\n").filter((line: string) => /^[+-](?![+-])/.test(line)).join("\n");
      if (/(?:auth|credential|permission|secret|service.role|customer_id|tenant_id|consent|canary|allowlist|confirmation|memory_settings|Deno\.env)/i.test(changed)) throw Error("restricted_security_policy_required");
    }
  }
  return { repository: "ausstyle/web-staging", pull_request: pr.number, source_commit: candidate.source,
    review_head: head, manifest_sha256: manifestDigest, review_ids: accepted.map(r => r.id), check_run_id: required.id, workflow_sha256: hash,
    compared_from: candidate.config.baseline_commit, changed_files: diff.files.map((f: Obj) => f.filename) };
}

export async function handleStandingDelegation(db: any, user: Obj, admin: Obj, body: Obj, githubToken: string) {
  if (admin.role !== "owner" || user.app_metadata?.sandy_engineering_test === true) throw Error("authenticated_owner_session_required");
  if (body.action === "delegation_policy") {
    const p = await db.from("sandy_engineering_delegation_policy").select("*").eq("id", 1).single();
    if (p.error) throw Error("delegation_policy_unavailable");
    return { policy: p.data, automatic_execution_requires_active_owner_session: true };
  }
  if (body.action === "set_delegation_policy") {
    const enabled = body.enabled === true;
    const config = enabled ? delegationConfig(body.config, Date.now()) : {};
    const saved = await db.rpc("sandy_engineering_set_standing_delegation", { p_actor: user.id, p_enabled: enabled, p_config: config });
    if (saved.error || saved.data?.ok !== true) throw Error("standing_delegation_update_failed");
    return saved.data;
  }
  const [policy, change, tests] = await Promise.all([
    db.from("sandy_engineering_delegation_policy").select("*").eq("id", 1).single(),
    db.from("sandy_engineering_changes").select("*").eq("id", body.change_id).single(),
    db.from("sandy_engineering_tests").select("outcome,evidence,checked_at").eq("change_id", body.change_id),
  ]);
  if (policy.error || change.error || tests.error) throw Error("routine_policy_evidence_unavailable");
  const candidate = await routineCandidate(change.data, tests.data || [], policy.data, user.id);
  if (!githubToken) throw Error("existing_github_review_transport_unavailable");
  const proof = await verifyRoutineReview(candidate, async path => {
    const response = await fetch("https://api.github.com" + path, { headers: { authorization: "Bearer " + githubToken,
      accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" }, redirect: "error", signal: AbortSignal.timeout(15000) });
    if (!response.ok) { await response.body?.cancel(); throw Error("routine_github_evidence_unavailable"); }
    return response.json();
  });
  // Locks/rechecks policy revision, current owner, unchanged change and test
  // evidence. Approval and its real owner audit event commit atomically.
  const result = await db.rpc("sandy_engineering_apply_standing_delegation", { p_actor: user.id, p_change: body.change_id,
    p_policy_revision: policy.data.standing_revision, p_change_updated_at: change.data.updated_at,
    p_source: candidate.source, p_manifest: candidate.manifest, p_proof: proof });
  if (result.error || result.data?.ok !== true) throw Error("routine_approval_recheck_failed");
  return result.data;
}
