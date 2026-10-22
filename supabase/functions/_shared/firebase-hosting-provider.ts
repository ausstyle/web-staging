/**
 * Firebase Hosting provider adapter, intended for Sandy API gateway (SANDY-ENG-0005).
 * This module is NOT an independently exposed HTTP endpoint or MCP executor.
 * Caller must enforce Sandy admission, tenant IAM, approval, idempotency and audit.
 * Google credentials must be supplied by the approved workload identity broker.
 */
export type FirebaseHostingAction =
  | "firebase.hosting.sites.list"
  | "firebase.hosting.sites.create"
  | "firebase.hosting.versions.list"
  | "firebase.hosting.channels.list"
  | "firebase.hosting.domains.list";

const PROJECT = "elaborate-haven-511518-a5";
const API = "https://firebasehosting.googleapis.com/v1beta1";
const safeId = (s: string) => /^[a-z0-9][a-z0-9-]{0,62}$/.test(s);
const safeDomain = (s: string) => /^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(s) && s.length <= 253;
export type FirebaseCall = {
  operation: FirebaseHostingAction;
  projectId: string;
  siteId?: string;
  domain?: string;
  requestId?: string;
};
export async function callFirebaseHosting(
  call: FirebaseCall,
  ctx: {
    accessToken: string;
    approvedMutation: boolean;
    fetcher?: typeof fetch;
  },
): Promise<{ status: number; body: unknown }> {
  if (call.projectId !== PROJECT) throw new Error("firebase_project_not_allowlisted");
  if (!ctx.accessToken) throw new Error("google_workload_identity_required");
  if (call.siteId && !safeId(call.siteId)) throw new Error("invalid_site_id");
  if (call.domain && !safeDomain(call.domain)) throw new Error("invalid_domain");
  const base = `${API}/projects/${encodeURIComponent(call.projectId)}/sites`;
  let url: string, method = "GET", body: string | undefined;
  switch (call.operation) {
    case "firebase.hosting.sites.list":
      url = base;
      break;
    case "firebase.hosting.sites.create":
      if (!ctx.approvedMutation) throw new Error("sandy_approval_required");
      if (!call.siteId || !call.requestId || !/^[a-f0-9-]{16,64}$/i.test(call.requestId)) throw new Error("site_id_and_idempotency_required");
      url = `${base}?siteId=${encodeURIComponent(call.siteId)}`;
      method = "POST";
      body = JSON.stringify({});
      break;
    case "firebase.hosting.versions.list":
      if (!call.siteId) throw new Error("site_id_required");
      url = `${API}/sites/${encodeURIComponent(call.siteId)}/versions`;
      break;
    case "firebase.hosting.channels.list":
      if (!call.siteId) throw new Error("site_id_required");
      url = `${API}/sites/${encodeURIComponent(call.siteId)}/channels`;
      break;
    case "firebase.hosting.domains.list":
      if (!call.siteId) throw new Error("site_id_required");
      url = `${API}/sites/${encodeURIComponent(call.siteId)}/customDomains`;
      break;
    default:
      throw new Error("unsupported_firebase_operation");
  }
  const res = await (ctx.fetcher ?? fetch)(url, {
    method,
    headers: {
      authorization: `Bearer ${ctx.accessToken}`,
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body,
    signal: AbortSignal.timeout(20000),
  });
  const responseText = await res.text();
  let result: unknown;
  try { result = JSON.parse(responseText); } catch { result = { error: "invalid_provider_response" }; }
  return { status: res.status, body: result };
}
