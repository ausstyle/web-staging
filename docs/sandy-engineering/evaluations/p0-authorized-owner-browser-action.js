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

const authorizedDeadline = Object.freeze({
  change: "07894248-0808-4ae0-a271-2fb850ec054d",
  source: "3734254e872fcb2f0b5270aac43f8540b40726a2",
  manifest: "1cd49be83211912bae2fce62bf0f0415a486e5f904a48acc65f4c852b2986017",
});

/** Execute an already authorized action in the real owner's browser. No token
 * leaves the normal Controller destination or appears in the returned result. */
async function recordAuthorizedDeadline(transport) {
  const p = authorizedDeadline;
  const read = () => transport.engineering({ action: "get", change_id: p.change });
  const before = await read();
  if (before.change?.id !== p.change || before.change.risk !== "normal" ||
      !before.change.expected_behavior?.includes(p.source) || !before.change.expected_behavior?.includes(p.manifest) ||
      !Array.isArray(before.change.scope) || before.change.scope.length !== 2 ||
      !before.change.scope.includes("sandy-agent-runtime-v4") ||
      !before.change.scope.includes("github:ausstyle/web-staging:engineering/sandy-unified-intelligence-20261021")) {
    throw Error("The recorded change differs from the owner's exact authorized release.");
  }
  if (before.change.status === "proposed") {
    await transport.engineering({ action: "status", change_id: p.change, status: "approved",
      reason: `Release ${p.source}; manifest ${p.manifest}. Record the owner's existing explicit authorization for the bounded V4 deadline correction. Preserve the existing pilot, Gmail confirmation, customer data and memory ingestion. Require guarded source/version deployment and actual overdue-task verification.` });
  } else if (!["approved", "implementing"].includes(before.change.status)) {
    throw Error("Change is not awaiting approval or ready for the authorized release.");
  }
  const after = await read(), owner = (await transport.session()).user.id;
  const audited = after.events?.some(e => e.actor === owner && e.event_type === "status_changed" &&
    e.detail?.to === "approved" && e.detail.reason?.includes(p.source) && e.detail.reason?.includes(p.manifest));
  if (!["approved", "implementing"].includes(after.change?.status) || !audited) {
    throw Error("A matching owner audit event is not verified. Do not repeat the action; have the runner read the actual database state.");
  }
  return { change_id: p.change, status: after.change.status, matching_owner_audit_verified: true,
    tokens_exported: false, deployment_started: false };
}

const {createClient}=await import("https://esm.sh/@supabase/supabase-js@2.105.0");
const sb=createClient("https://zmqlyygzqoidkcwdysok.supabase.co","sb_publishable_OVP7LUMDhtcymPRzZuCK3Q_8JkLC3ts",{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
console.info(await recordAuthorizedDeadline(createControllerTransport(sb.auth)));
})().catch(error => console.error(error.message));
