/** Service-only consumer readback; an empty server allowlist exposes no secret. */
import { requestJson } from "../_shared/sandy_api_protocol.ts";
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export async function credentialHmac(
  value: string,
  rotation: string,
  challenge: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(value),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return Array.from(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(
          `sandy-credential-fixture-v1\n${rotation}\n${challenge}`,
        ),
      ),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function createCredentialProbe(
  deps: {
    service: string;
    bindings: Readonly<Record<string, string>>;
    getSecret: (name: string) => string | undefined;
  },
) {
  return async (req: Request) => {
    const reply = (status: number, value: unknown) =>
      new Response(JSON.stringify(value), {
        status,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      });
    if (
      req.method !== "POST" || !deps.service ||
      req.headers.get("authorization") !== `Bearer ${deps.service}`
    ) return reply(403, { ok: false, error: "service_authorization_required" });
    let body: any;
    try {
      body = await requestJson(req, 2048);
    } catch {
      return reply(400, { ok: false, error: "invalid_request" });
    }
    if (
      !body || typeof body !== "object" ||
      Object.keys(body).some((k) =>
        !["target_id", "rotation_id", "challenge"].includes(k)
      ) ||
      ![body.target_id, body.rotation_id, body.challenge].every((v) =>
        typeof v === "string" && UUID.test(v)
      )
    ) return reply(400, { ok: false, error: "invalid_request" });
    const name = deps.bindings[body.target_id];
    if (
      typeof name !== "string" || !/^[A-Z][A-Z0-9_]{2,99}$/.test(name) ||
      name.startsWith("SUPABASE_") ||
      ["SANDY_SUPABASE_MANAGEMENT_TOKEN", "SANDY_CONTROLLER_ACCESS_TOKEN"]
        .includes(name)
    ) {
      return reply(424, {
        ok: false,
        error: "verified_consumer_probe_binding_required",
      });
    }
    const secret = deps.getSecret(name);
    if (!secret) {
      return reply(424, { ok: false, error: "probe_material_unavailable" });
    }
    return reply(200, {
      ok: true,
      target_id: body.target_id,
      rotation_id: body.rotation_id,
      challenge: body.challenge,
      secret_name: name,
      hmac_sha256: await credentialHmac(
        secret,
        body.rotation_id,
        body.challenge,
      ),
    });
  };
}
if (import.meta.main) {
  let bindings: Record<string, string> = {};
  try {
    const value = JSON.parse(
      Deno.env.get("SANDY_CREDENTIAL_PROBE_BINDINGS_JSON") ?? "{}",
    );
    if (value && typeof value === "object" && !Array.isArray(value)) {
      bindings = value;
    }
  } catch { /* empty allowlist */ }
  Deno.serve(
    createCredentialProbe({
      service: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      bindings,
      getSecret: (name) => Deno.env.get(name),
    }),
  );
}
