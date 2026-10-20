import "jsr:@supabase/functions-js/edge-runtime.d.ts";
/**
 * Sandy MCP thin adapter: HTTP JSON-RPC transport only.
 * No direct GitHub, Supabase Management API or Google Cloud calls.
 * All operation discovery, permission checks and dispatch are owned by sandy-operation-api.
 */
const base = Deno.env.get("SUPABASE_URL") ?? "";
const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const rpc = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const error = (id: unknown, code: number, message: string) =>
  ({ jsonrpc: "2.0", id, error: { code, message } });
async function api(token: string, body: unknown) {
  const response = await fetch(`${base}/functions/v1/sandy-operation-api`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, apikey: anon, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(23000),
  });
  const result = await response.json().catch(() => ({ error: "invalid_api_response" }));
  return { status: response.status, result };
}
Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return Response.json({ error: "authentication_required" }, { status: 401 });
  let msg: Record<string, unknown>;
  try { msg = await req.json(); if (!msg || Array.isArray(msg) || typeof msg !== "object") throw Error(); }
  catch { return Response.json(error(null, -32700, "Invalid JSON"), { status: 400 }); }
  const id = msg.id ?? null;
  try {
    if (msg.method === "initialize") {
      return Response.json(rpc(id, { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "sandy-api-mcp", version: "0.1.0" } }));
    }
    if (msg.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (msg.method === "tools/list") {
      const a = await api(bearer, { action: "list" });
      if (a.status !== 200) return Response.json(error(id, -32000, "Sandy API discovery unavailable"));
      const entries = Array.isArray(a.result.operations) ? a.result.operations : [];
      // Only API-advertised, nonmutating, explicitly implemented operations appear in v1.
      const implemented = new Set(["engineering.preflight","deployment.management.release"]);
      const tools = entries.filter((x: any) => x.ai_exposed && implemented.has(x.operation))
        .map((x: any) => ({ name: x.operation, description: `Sandy API operation: ${x.operation}`, inputSchema: x.operation==="deployment.management.release" ? {type:"object",properties:{function_slug:{type:"string",enum:["sandy-operation-api","sandy-api-mcp"]},source_ref:{type:"string",const:"main"},change_id:{type:"string"}},required:["function_slug","source_ref","change_id"],additionalProperties:false} : { type: "object", properties: {}, additionalProperties: false } }));
      return Response.json(rpc(id, { tools }));
    }
    if (msg.method === "tools/call") {
      const p = msg.params as Record<string, unknown> | undefined;
      const name = p?.name;
      if (typeof name !== "string") return Response.json(error(id, -32602, "Tool name required"));
      const a = await api(bearer, { action: "execute", operation: name, arguments: p?.arguments ?? {} });
      if (a.status !== 200 || a.result?.executed !== true) {
        return Response.json(rpc(id, { isError: true, content: [{ type: "text", text: JSON.stringify({ error: a.result?.error ?? "Sandy API operation failed", status: a.status }) }] }));
      }
      return Response.json(rpc(id, { isError: false, content: [{ type: "text", text: JSON.stringify(a.result) }] }));
    }
    return Response.json(error(id, -32601, "Method not found"));
  } catch {
    return Response.json(error(id, -32000, "Sandy API unavailable"));
  }
});
