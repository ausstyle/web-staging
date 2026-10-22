import express from "express";
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { callTool, createApiInvoker, discover, describeTool, DiscoveryFailure, executionMetadataHeaders, isPublicAnonJwt } from "./api-adapter.mjs";
import { createAdminReadWorker } from "./gcp-admin-worker.mjs";

export function createApp({ publicAnon = process.env.SANDY_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "",
  api = createApiInvoker(
  process.env.SANDY_SUPABASE_PROJECT_REF || "zmqlyygzqoidkcwdysok",
  fetch,
  publicAnon
) } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: 1550000 }));
  app.use((_req, res, next) => {
    res.set("cache-control", "no-store");
    res.set("x-content-type-options", "nosniff");
    next();
  });
  app.post("/internal/gcp-admin/preflight", createAdminReadWorker());
  app.post("/mcp", async (req, res) => {
    let userToken = (req.headers.authorization || "").match(/^Bearer ([A-Za-z0-9._~-]+)$/i)?.[1];
    if (!userToken) return res.status(401).json({ error: "bearer_token_required" });
    let apiKey = req.get("x-sandy-api-key");
    if (apiKey === "") return res.status(401).json({ error: "api_key_context_required" });
    if (userToken.startsWith("sandyop_") || userToken.startsWith("sandy_api_")) {
      if (!isPublicAnonJwt(publicAnon)) return res.status(503).json({ error: "public_anon_jwt_required" });
      if (apiKey !== undefined && apiKey !== userToken) return res.status(400).json({ error: "ambiguous_api_key_context" });
      apiKey = userToken;
      userToken = publicAnon;
    }
    const metadata = {
      ...(req.get("x-sandy-approval-id") === undefined ? {} : { approvalId: req.get("x-sandy-approval-id") }),
      ...(req.get("x-sandy-request-id") === undefined ? {} : { requestId: req.get("x-sandy-request-id") })
    };
    if (!executionMetadataHeaders(metadata)) return res.status(400).json({ error: "invalid_execution_metadata" });
    // API discovery authenticates and authorizes the actual caller on every
    // request. No user-specific catalogue or token survives this request.
    let catalogue;
    try {
      catalogue = req.body?.method === "tools/call" && typeof req.body?.params?.name === "string"
        ? await describeTool(api, userToken, req.body.params.name, apiKey, metadata)
        : await discover(api, userToken, apiKey, metadata,
          req.body?.method === "tools/list" ? req.body?.params?.cursor : undefined);
    }
    catch (error) {
      const known = error instanceof DiscoveryFailure;
      return res.status(known ? error.status : 503).json({
        error: known ? error.code : "sandy_api_discovery_unavailable"
      });
    }
    const server = new Server({ name: "sandy-engineering-mcp", version: "0.3.0" }, {
      capabilities: { tools: {} }
    });
    server.setRequestHandler(ListToolsRequestSchema, request => {
      return { tools: catalogue.tools, ...(catalogue.nextCursor ? { nextCursor: catalogue.nextCursor } : {}), _meta: catalogue.metadata };
    });
    server.setRequestHandler(CallToolRequestSchema, request =>
      callTool(api, userToken, catalogue, request.params.name, request.params.arguments ?? {}, apiKey, metadata));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(502).json({ error: "mcp_request_failed" });
    } finally {
      await transport.close().catch(() => {});
      await server.close().catch(() => {});
    }
  });
  app.get("/healthz", (_req, res) => res.status(200).json({ ok: true, service: "sandy-engineering-mcp" }));
  app.get("/mcp", (_req, res) => res.status(405).json({ error: "post_required" }));
  app.delete("/mcp", (_req, res) => res.status(405).json({ error: "stateless_session" }));
  app.use((error, _req, res, _next) => res.status(error?.type === "entity.too.large" ? 413 : 400)
    .json({ error: "invalid_request_body" }));
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8787);
  createApp().listen(port, "0.0.0.0", () => console.log("Sandy engineering MCP listening on " + port));
}
