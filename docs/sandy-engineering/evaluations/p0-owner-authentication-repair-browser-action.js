// Run only in the already signed-in Sandy Controller owner's browser.
// No credential is displayed, copied, exported, or sent outside this project.
(async () => {
if (location.origin !== "https://ausstyle.github.io" || !location.pathname.includes("/sandy/controller")) throw Error("Open the normal Sandy Controller page first.");
const BASE = "https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/";
const authDenied = value => value && ["Unauthorized", "authentication_required", "sign_in_required"].includes(value.error);

/** Uses the existing browser's Supabase Auth refresh session. Never exports a
 * refresh token, mints a user, or treats a workload session as an owner session. */
function createControllerTransport(auth, { request = fetch, now = Date.now } = {}) {
  let renewing;
  async function renew(userId) {
    if (!renewing) renewing = auth.refreshSession().finally(() => { renewing = undefined; });
    const result = await renewing;
    const session = result.data?.session;
    if (result.error || !session?.access_token || session.user?.id !== userId ||
        !Number.isFinite(session.expires_at) || session.expires_at * 1000 <= now() + 1000) {
      throw Error("Owner session renewal failed. Sign in with the existing Sandy owner account.");
    }
    return session;
  }
  async function session() {
    const result = await auth.getSession();
    const saved = result.data?.session;
    if (result.error || !saved?.access_token || !saved.user?.id) throw Error("Sign in required");
    return !Number.isFinite(saved.expires_at) || saved.expires_at * 1000 <= now() + 60000
      ? renew(saved.user.id) : saved;
  }
  async function call(component, payload) {
    // No caller-selected destination can receive an owner credential.
    if (!["sandy-controller-api", "sandy-engineering-control"].includes(component)) throw Error("Invalid Controller destination");
    let current = await session();
    const send = async () => {
      const response = await request(BASE + component, { method: "POST", headers: {
        "content-type": "application/json", authorization: "Bearer " + current.access_token,
      }, body: JSON.stringify(payload), redirect: "error", signal: AbortSignal.timeout(45000) });
      let value;
      try { value = await response.json(); } catch { throw Error("Controller result unavailable; refresh the recorded state before repeating an action."); }
      return { response, value };
    };
    let result = await send();
    // These fixed endpoints reject Auth before dispatch. An uncertain request,
    // policy denial, provider error or malformed reply must never be replayed.
    if (result.response.status === 401 && authDenied(result.value)) {
      current = await renew(current.user.id);
      result = await send();
    }
    if (!result.response.ok) throw Error(result.value?.error || "Controller request failed");
    return result.value;
  }
  return { session, controller: (op, args = {}) => call("sandy-controller-api", { op, ...args }),
    engineering: body => call("sandy-engineering-control", body) };
}

/** A browser-only execution handoff for the separately requested high-risk
 * authentication repair. Keeps the configured owner's refresh session private. */
async function registerAuthorizedAuthRepair(transport, request) {
  const pins = /^Release ([a-f0-9]{40}); manifest ([a-f0-9]{64})\./.exec(request.expected_behavior || "");
  if (request.action !== "register" || request.risk !== "high" || !pins ||
      !request.scope?.includes("sandy-engineering-control") || !request.scope.includes("security:standing-owner-delegation")) {
    throw Error("The fixed, separately authorized security repair request is required.");
  }
  const registered = await transport.engineering(request), change = registered.change;
  if (!change?.id || !change.expected_behavior.includes(pins[1]) || !change.expected_behavior.includes(pins[2]) || change.risk !== "high") throw Error("Registered security-repair pins are not verified.");
  if (change.status === "proposed") await transport.engineering({ action: "status", change_id: change.id, status: "approved",
    reason: `Release ${pins[1]}; manifest ${pins[2]}. Record the owner's explicit instruction to repair the existing Controller owner-session path and separately implement protected standing routine delegation. No approval impersonation, workload self-approval or customer-channel source expansion.` });
  const after = await transport.engineering({ action: "get", change_id: change.id });
  const owner = (await transport.session()).user.id;
  if (after.change?.status !== "approved" || !after.events?.some(e => e.actor === owner && e.event_type === "status_changed" &&
      e.detail?.to === "approved" && e.detail.reason?.includes(pins[1]) && e.detail.reason?.includes(pins[2]))) {
    throw Error("The authenticated owner audit event is not verified. Read the actual record before repeating any action.");
  }
  return { security_repair_change_id: change.id, status: after.change.status, matching_owner_audit_verified: true,
    tokens_exported: false, deadline_change_attested: false, deployment_started: false };
}

const {createClient}=await import("https://esm.sh/@supabase/supabase-js@2.105.0");
const sb=createClient("https://zmqlyygzqoidkcwdysok.supabase.co","sb_publishable_OVP7LUMDhtcymPRzZuCK3Q_8JkLC3ts",{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
console.info(await registerAuthorizedAuthRepair(createControllerTransport(sb.auth),{"action": "register", "title": "Repair real Controller session use and bound standing routine release delegation", "problem": "The runner has only an expired exported owner access JWT; its normal owner refresh session exists only in the browser. The current Controller has no direct pinned engineering approval UI, and existing generic automatic approval lacks the protections needed for standing routine release authorization.", "expected_behavior": "Release f9958d50b4fd4ebd82f97c8e3be76ad49250a192; manifest 24b113ab99c422ab4394ea7895b7679476c38863e259e4c9172ef9647a83a573. Use only the current owner browser Supabase Auth refresh session, preserve non-owner workload approval denial, record explicit approval atomically with its genuine audit event, and enable revocable expiring routine-only delegation gated by exact manifest, independent review, trusted CI and bounded source diff. Keep the already authorized V4 source 3734254e872fcb2f0b5270aac43f8540b40726a2 and manifest 1cd49be83211912bae2fce62bf0f0415a486e5f904a48acc65f4c852b2986017 separate and unchanged.", "change_purpose": "Implement the owner-requested authentication repair and separately authorized standing routine release policy using the existing Controller, Auth and delegation policy.", "feature_improvement": "Eliminate stale browser session dispatch, uncertain mutation replay and repeated manual approvals for eligible routine releases; retain explicit owner action for higher-risk work.", "scope": ["github:ausstyle/web-staging:engineering/sandy-unified-intelligence-20261021", "sandy-engineering-control", "controller:owner-session", "security:standing-owner-delegation"], "risk": "high", "idempotency_key": "sandy-owner-session-standing-policy-f9958d50b4fd", "regression_rules": ["No owner impersonation, permanent JWT, approval database write by Codex, workload grant expansion or exported refresh credential.", "Preserve existing customer communications, data, Gmail confirmation, workspace memory ingestion and pilot allowlist.", "Keep source, test, review, CI, rollback and actual owner/delegation audit evidence separate from deployment and customer acceptance."], "acceptance_criteria": ["175 local composed tests and 13 isolated PostgreSQL assertions passed; typecheck uses the existing offline SDK fallback.", "Verify actual owner browser renewal, genuine pinned approval event and standing revocation/expiry through the deployed workflow before claiming production verification.", "Register this high-risk change using an authenticated owner session; never downgrade its risk to fit the engineering workload.", "Do not apply its migration or deploy Controller/frontend as part of the independently pinned V4 deadline correction."]}));
})().catch(error => console.error(error.message));
