/** Amendment B: policy admission by the existing authenticated workload.
 * Provisioning and execution are separate. No owner session is synthesized,
 * no policy is enabled by installing this code, and no provider is bypassed.
 */
import { verifyRoutineReview } from "./routine_delegation.ts";
type Obj = Record<string, any>;
const sha = (s: unknown, n: number) => typeof s === "string" && new RegExp(`^[a-f0-9]{${n}}$`).test(s);
const uuid = (s: unknown) => typeof s === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s);
export const autonomousTargets = ["sandy-agent-runtime-v4", "sandy-workspace", "sandy-email-runtime-canary", "email-ai-generate-draft", "sandy-whatsapp-webhook", "sandy-voice-account-context"];
export function autonomousConfig(c: Obj, now = Date.now()): Obj {
  const durable=c?.expires_at === "infinity" && c?.expiry_mode === "until_revoked";
  if (!c || c.repository !== "ausstyle/web-staging" || c.project !== "zmqlyygzqoidkcwdysok" || c.environment !== "canary" ||
    !/^engineering\/[a-z0-9-]+$/.test(c.branch || "") || !Array.isArray(c.targets) || !c.targets.length || c.targets.length > 6 ||
    c.targets.some((x: unknown) => !autonomousTargets.includes(String(x))) || !sha(c.baseline_commit, 40) || !sha(c.workflow_sha256, 64) ||
    (!durable && (!Number.isFinite(Date.parse(c.expires_at)) || Date.parse(c.expires_at) <= now || Date.parse(c.expires_at) > now + 30 * 86400000)) ||
    c.maximum_cost_units !== 0 || !Number.isSafeInteger(c.max_releases_per_day) || c.max_releases_per_day < 1 || c.max_releases_per_day > 10) throw Error("bounded_autonomous_policy_required");
  return { repository:c.repository, project:c.project, environment:c.environment, branch:c.branch,
    targets:[...new Set(c.targets)], baseline_commit:c.baseline_commit, workflow_sha256:c.workflow_sha256,
    expires_at:c.expires_at, ...(durable?{expiry_mode:"until_revoked"}:{}), maximum_cost_units:0, max_releases_per_day:c.max_releases_per_day };
}
export function autonomousCandidate(change: Obj, tests: Obj[], grant: Obj, actor: string, now = Date.now()) {
  if (!uuid(actor) || grant.identity_user_id !== actor || change.requested_by !== actor || grant.enabled !== true || grant.revoked_at ||
    !grant.autonomous_config || (!(grant.autonomous_config.expires_at === "infinity" && grant.autonomous_config.expiry_mode === "until_revoked") && (!Number.isFinite(Date.parse(grant.autonomous_config.expires_at)) || Date.parse(grant.autonomous_config.expires_at) <= now)) || !(grant.expires_at === "infinity" || Date.parse(grant.expires_at) > now) ||
    !grant.allowed_actions?.includes("authorize_release") || !["low","normal"].includes(change.risk) || !grant.allowed_risks?.includes(change.risk) ||
    !["proposed","approved","authorized_by_policy"].includes(change.status)) throw Error("policy_blocked");
  const config=autonomousConfig(grant.autonomous_config,now);
  if (!Array.isArray(change.scope) || change.scope.length !== 2 || !change.scope.includes(`github:${config.repository}:${config.branch}`)) throw Error("policy_target_denied");
  const target=change.scope.find((s:string)=>config.targets.includes(s));
  if (!target || !grant.scope_prefixes?.includes(target) || !tests.length || tests.some(t=>t.outcome!=="passed" || !t.checked_at)) throw Error("passing_scoped_test_evidence_required");
  const evidence=tests.map(t=>t.evidence).filter(e=>e?.release_manifest?.function===target);
  if(evidence.length!==1)throw Error("unambiguous_release_manifest_required");
  const e=evidence[0],m=e.release_manifest;
  if(!sha(m.source_commit,40) || e.source_commit!==m.source_commit || !sha(e.manifest_sha256,64) ||
    !String(change.expected_behavior).includes(m.source_commit) || !String(change.expected_behavior).includes(e.manifest_sha256) ||
    !Number.isSafeInteger(m.expected_prior_version) || m.expected_prior_version<1 || !sha(m.prior_bundle_sha256,64) || m.verify_jwt!==false ||
    typeof m.rollback!=="string" || m.rollback.length<25 || !m.files || Array.isArray(m.files) || !Object.keys(m.files).length || Object.keys(m.files).length>256 ||
    Object.entries(m.files).some(([p,h])=>!/^[-a-zA-Z0-9_/.]+$/.test(p)||p.includes("..")||p.startsWith("/")||!sha(h,64)) ||
    !/^docs\/sandy-engineering\/evaluations\/[a-z0-9-]+-source-manifest\.json$/.test(e.release_manifest_path||""))throw Error("pinned_source_and_rollback_required");
  return {config:{...config,reviewers:[]},autonomous:true,target,source:m.source_commit,manifest:e.manifest_sha256,
    manifestPath:e.release_manifest_path,releaseManifest:m,priorVersion:m.expected_prior_version,priorDigest:m.prior_bundle_sha256,rollback:m.rollback};
}
export async function handleAutonomousRelease(db:any,user:Obj,admin:Obj,body:Obj,read:(path:string)=>Promise<any>){
  if(body.action==="set_autonomous_policy"){
    if(admin.role!=="owner" || user.app_metadata?.sandy_engineering_test===true || !uuid(body.identity_user_id))throw Error("legitimate_policy_administrator_required");
    const config=body.enabled===true?autonomousConfig(body.config):null;
    const r=await db.rpc("sandy_engineering_set_autonomous_policy",{p_actor:user.id,p_identity:body.identity_user_id,p_config:config});
    if(r.error||r.data?.ok!==true)throw Error("autonomous_policy_update_denied");return r.data;
  }
  if(user.app_metadata?.sandy_engineering_test!==true || !uuid(body.change_id))throw Error("authenticated_engineering_identity_required");
  const [g,c,t]=await Promise.all([
    db.from("sandy_engineering_control_grants").select("*").eq("identity_user_id",user.id).single(),
    db.from("sandy_engineering_changes").select("*").eq("id",body.change_id).single(),
    db.from("sandy_engineering_tests").select("outcome,evidence,checked_at").eq("change_id",body.change_id),
  ]);
  if(g.error||c.error||t.error)throw Error("policy_evidence_unavailable");
  const candidate=autonomousCandidate(c.data,t.data||[],g.data,user.id);
  // Source, workflow and manifest proof comes from server-side GitHub reads.
  const proof=await verifyRoutineReview(candidate,read);
  // Full module hashes and dependency closure are checked before authorization.
  const files=candidate.releaseManifest.files, contents=new Map<string,string>();
  let total=0;
  for(const [path,expected] of Object.entries(files)){
    const f=await read(`/repos/ausstyle/web-staging/contents/supabase/functions/${path}?ref=${candidate.source}`);
    if(f?.encoding!=="base64"||typeof f.content!=="string")throw Error("immutable_source_unavailable");
    const bytes=Uint8Array.from(atob(f.content.replace(/\s/g,"")),x=>x.charCodeAt(0));total+=bytes.length;
    if(total>5000000 || [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(x=>x.toString(16).padStart(2,"0")).join("")!==expected)throw Error("source_manifest_mismatch");
    contents.set(path,new TextDecoder().decode(bytes));
  }
  const visited=new Set<string>();
  function visit(path:string){
    if(visited.has(path))return;
    const source=contents.get(path);if(source===undefined)throw Error("dependency_missing");visited.add(path);
    if(path.endsWith(".json"))return;
    for(const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](\.[^"']+)["']/g)){
      const resolved=new URL(match[1],`https://source.invalid/${path}`).pathname.slice(1);visit(resolved);
    }
  }
  visit(candidate.target+"/index.ts");if(visited.size!==contents.size)throw Error("unused_manifest_module");
  const result=await db.rpc("sandy_engineering_authorize_release",{p_actor:user.id,p_change:body.change_id,
    p_revision:g.data.autonomous_revision,p_change_updated_at:c.data.updated_at,p_source:candidate.source,p_manifest:candidate.manifest,p_proof:{...proof,target:candidate.target}});
  if(result.error||result.data?.ok!==true)throw Error("policy_recheck_denied");
  return {...result.data,owner_approval_event_created:false};
}
