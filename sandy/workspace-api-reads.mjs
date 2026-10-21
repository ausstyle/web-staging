// Fixed UI actions use the same installed Sandy API contracts as MCP clients.
// Authentication remains the browser's real Supabase session.
const endpoint = "https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-operation-api";
export const workspaceReadOperations = Object.freeze({
  overview: "workspace.overview",
  command_centre: "workspace.command_centre",
  global_search: "workspace.search",
  history: "workspace.history",
  mission_overview: "workspace.missions.list",
});
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
export function createWorkspaceReadClient(auth, { request = fetch, publicKey, onSessionExpired = () => {} } = {}) {
  const handles = action => Object.hasOwn(workspaceReadOperations, action);
  return Object.freeze({
    handles,
    async call(action, payload = {}) {
      if (!handles(action) || !object(payload)) throw Error("Unsupported workspace read");
      const operation = workspaceReadOperations[action];
      const args = { ...payload };
      // The existing UI uses null to mean the first page. The API cursor is
      // optional and accepts a real cursor object only.
      if (action === "history" && args.cursor === null) delete args.cursor;
      const { data, error } = await auth.getSession();
      if (error) throw Error("Sandy could not read your session. Please retry.");
      let token = data?.session?.access_token;
      const expired = () => {
        onSessionExpired("Your Sandy session expired. Please sign in again.");
        return Error("Session expired — sign in again to continue");
      };
      if (!token) throw expired();
      const send = () => request(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token,
          ...(publicKey ? { apikey: publicKey } : {}) },
        body: JSON.stringify({ action: "execute", operation, arguments: args, channel: "api" }),
        cache: "no-store",
      });
      let response = await send();
      if (response.status === 401) {
        const refreshed = await auth.refreshSession();
        token = refreshed.data?.session?.access_token;
        if (refreshed.error || !token) throw expired();
        response = await send();
      }
      if (response.status === 401) throw expired();
      const body = await response.json().catch(() => null);
      if (!response.ok || !object(body) || body.ok !== true ||
          body.operation !== operation || body.executed !== true ||
          body.reconciliation_required === true || !object(body.result) ||
          body.result.ok !== true || body.result.contract_version !== "1.0.0" ||
          body.result.error != null) {
        throw Error(object(body) && typeof body.error === "string"
          ? body.error.slice(0, 200) : "Sandy could not load this workspace view. Please retry.");
      }
      return body.result;
    },
  });
}
