import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";

const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "sandy-autonomous-engineering";
const WORKFLOW = "ausstyle/web-staging/.github/workflows/sandy-autonomous-dispatch.yml@refs/heads/main";
const JWK = createRemoteJWKSet(new URL(ISSUER + "/.well-known/jwks"));
const root = Deno.env.get("SUPABASE_URL") || "";
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const db = createClient(root, key, { auth: {persistSession: false} });
const respond = (code: number, value: unknown) =>
  new Response(JSON.stringify(value), {status: code, headers: {"content-type":"application/json","cache-control":"no-store"}});

Deno.serve(async (req) => {
  if (req.method !== "POST") return respond(405, {error:"post_required"});
  if (!root || !key) return respond(503, {error:"server_unconfigured"});
  const bearer = req.headers.get("authorization") || "";
  if (!bearer.startsWith("Bearer ")) return respond(401,{error:"identity_required"});
  try {
    const {payload} = await jwtVerify(bearer.slice(7), JWK, {
      issuer: ISSUER, audience: AUDIENCE, algorithms: ["RS256"], clockTolerance: 10
    });
    if (payload.repository !== "ausstyle/web-staging" ||
        String(payload.repository_id) !== "1416227508" ||
        payload.ref !== "refs/heads/main" ||
        payload.workflow_ref !== WORKFLOW)
      return respond(403,{error:"workflow_not_authorized"});
  } catch {
    return respond(401,{error:"identity_invalid"});
  }
  let input: Record<string,unknown>;
  try {
    input=await req.json();
    if(!input || typeof input !== "object" || Array.isArray(input)) throw Error("shape");
  } catch { return respond(400,{error:"invalid_json"}); }
  if (input.action === "claim") {
    const {data,error} = await db.rpc("sandy_autonomous_engineering_claim_dispatch");
    if (error) return respond(503,{error:"claim_unavailable"});
    return respond(200,{ok:true,...data});
  }
  if (input.action === "confirm") {
    const issue=input.issue_key, lease=input.lease;
    if (typeof issue !== "string" || !/^[a-z0-9:_-]{5,160}$/i.test(issue) ||
        typeof lease !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lease) ||
        typeof input.succeeded !== "boolean") return respond(400,{error:"invalid_confirmation"});
    const {data,error} = await db.rpc("sandy_autonomous_engineering_confirm_dispatch", {
      p_issue_key:issue, p_lease:lease, p_succeeded:input.succeeded,
      p_error:String(input.error || "").slice(0,120)
    });
    if(error) return respond(409,{error:"confirmation_rejected"});
    return respond(200,{ok:true,...data});
  }
  return respond(400,{error:"unsupported_action"});
});
