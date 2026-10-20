import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const projectRef = process.env.SANDY_SUPABASE_PROJECT_REF || "zmqlyygzqoidkcwdysok";
if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error("Invalid Supabase project reference");
const root = "https://" + projectRef + ".supabase.co/functions/v1/";
const timeoutMs = 35_000;
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "24kb" }));

function suppliedBearer(req) {
  const h = req.headers.authorization || "";
  if (!/^Bearer [A-Za-z0-9._~-]+$/.test(h)) return null;
  return h;
}
async function invoke(endpoint, bearer, body) {
  const response = await fetch(root + endpoint, {
    method: "POST",
    headers: { authorization: bearer, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  let payload;
  try { payload = await response.json(); } catch { payload = { error: "invalid_backend_response" }; }
  return { http_status: response.status, ...payload };
}
function outcome(result) {
  return { isError: result.http_status >= 400 || result.error != null,
    content: [{ type: "text", text: JSON.stringify(result) }] };
}
function registerTools(server, bearer) {
  server.tool("sandy_model_route_readiness",
    "Read model-route readiness and delegation policy. No routing changes.",
    {}, async () => outcome(await invoke("sandy-engineering-test-api", bearer, {action:"readiness"})));
  server.tool("sandy_run_model_canary",
    "Run a bounded registered model canary with an existing Engineering Control change. No model promotion.",
    {change_id:z.string().uuid(),model_id:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,90}$/),
     case_key:z.enum(["simple_reasoning","research_uncertainty","document_summary","tool_call","routine_email"])},
    async (args) => outcome(await invoke("sandy-engineering-test-api", bearer, {...args,action:"model_canary"})));
  server.tool("sandy_engineering_change_details",
    "Read registered Engineering Control change and its tests, events, artifacts, and rollback requests.",
    {change_id:z.string().uuid()},
    async ({change_id}) => outcome(await invoke("sandy-engineering-control", bearer, {action:"get",change_id})));
}
app.post("/mcp", async (req,res) => {
  const bearer=suppliedBearer(req);
  if (!bearer) return res.status(401).json({error:"bearer_token_required"});
  // Authenticate with Sandy before exposing any MCP tool definitions.
  let preflight;
  try { preflight = await invoke("sandy-engineering-test-api",bearer,{action:"readiness"}); }
  catch { return res.status(503).json({error:"authorization_service_unavailable"}); }
  if (preflight.http_status===401) return res.status(401).json({error:"invalid_identity"});
  if (preflight.http_status!==200) return res.status(403).json({error:"engineering_admin_required"});
  // Stateless transport: a fresh server/tool set per authenticated HTTP call.
  const server = new McpServer({name:"sandy-engineering-mcp",version:"0.1.0"});
  registerTools(server,bearer);
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  try {
    await server.connect(transport);
    await transport.handleRequest(req,res,req.body);
  } catch {
    if(!res.headersSent) res.status(502).json({error:"mcp_request_failed"});
  } finally {
    await transport.close().catch(()=>{});
    await server.close().catch(()=>{});
  }
});
app.get("/healthz",(_req,res)=>res.status(200).json({ok:true,service:"sandy-engineering-mcp"}));
app.get("/mcp",(_req,res)=>res.status(405).json({error:"post_required"}));
app.delete("/mcp",(_req,res)=>res.status(405).json({error:"stateless_session"}));
const port=Number(process.env.PORT||8787);
app.listen(port,"0.0.0.0",()=>console.log("Sandy engineering MCP listening on "+port));
