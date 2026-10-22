const BASE = "https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/";
const authDenied = value => value && ["Unauthorized", "authentication_required", "sign_in_required"].includes(value.error);

/** Uses the existing browser's Supabase Auth refresh session. Never exports a
 * refresh token, mints a user, or treats a workload session as an owner session. */
export function createControllerTransport(auth, { request = fetch, now = Date.now } = {}) {
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
