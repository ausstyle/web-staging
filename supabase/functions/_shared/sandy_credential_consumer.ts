/** Internal-only consumer cutover. No credential is an HTTP operation result.
 * A configured active pointer never falls back to an older environment key.
 */
import {
  credentialExecutionScope,
  gcpKey,
  keyCredential,
} from "../sandy-credential-lifecycle-api/scope.ts";
import type { Target } from "../sandy-credential-lifecycle-api/types.ts";
import { machineScope } from "./sandy_machine_identity.ts";

export type CredentialConsumer =
  | "supabase_management"
  | "github_api"
  | "gcp_access_token";
export type ConsumerExecution = {
  actorId: string;
  admissionId: string;
  operation: string;
};
type Db = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
};
type Dependencies = {
  db: Db;
  legacy: Record<CredentialConsumer, () => Promise<string> | string>;
  fetch?: typeof fetch;
  now?: () => number;
};
const consumers = new Set([
  "supabase_management",
  "github_api",
  "gcp_access_token",
]);
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
    .test(v);
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const digest = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export class ConsumerCredentialError extends Error {
  constructor(
    public code: string,
    public requestMayHaveExecuted = false,
    public status = 424,
    public providerHttpStatus: number | null = null,
  ) {
    super(code);
  }
}
const sqlRefusals: Readonly<Record<string, number>> = {
  consumer_execution_context_invalid: 400,
  consumer_scoped_admission_required: 403,
  consumer_current_contract_required: 409,
  consumer_delegated_scope_refused: 403,
  consumer_provider_scope_mismatch: 403,
  consumer_configured_target_missing: 424,
  consumer_active_pointer_removed: 424,
  consumer_active_binding_refused: 424,
  consumer_active_version_refused: 424,
  consumer_active_readback_required: 424,
  consumer_pointer_changed_during_execution: 409,
  consumer_material_integrity_failed: 424,
};
async function materialDigest(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-")
    .replace(/\//g, "_");
const encodedJson = (value: unknown) =>
  base64url(new TextEncoder().encode(JSON.stringify(value)));

/** The same fixed service-account identity used by custody verification. The
 * returned token is private to a trusted server callback, never a user session.
 */
export async function exchangeCustodiedServiceAccountKey(
  target: Target,
  material: string,
  providerVersion: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<string> {
  const key = keyCredential(target, material);
  const expected =
    `projects/${machineScope.project_id}/serviceAccounts/${machineScope.service_account}/keys/${key.private_key_id}`;
  if (gcpKey(target, providerVersion) !== expected) {
    throw new ConsumerCredentialError("consumer_key_identity_mismatch");
  }
  const issued = Math.floor(now / 1000);
  const unsigned = `${
    encodedJson({ alg: "RS256", typ: "JWT", kid: key.private_key_id })
  }.${
    encodedJson({
      iss: machineScope.service_account,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      iat: issued,
      exp: issued + 300,
    })
  }`;
  let privateKey: CryptoKey;
  try {
    privateKey = await crypto.subtle.importKey(
      "pkcs8",
      Uint8Array.from(
        atob(
          key.private_key.replace(
            /-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,
            "",
          ),
        ),
        (c) => c.charCodeAt(0),
      ),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    throw new ConsumerCredentialError("consumer_key_format_invalid");
  }
  const signature = base64url(
    new Uint8Array(
      await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        privateKey,
        new TextEncoder().encode(unsigned),
      ),
    ),
  );
  let response: Response;
  try {
    response = await fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${signature}`,
      }),
    });
  } catch {
    throw new ConsumerCredentialError("consumer_key_exchange_unavailable");
  }
  let raw: unknown;
  try {
    const reader = response.body?.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    if (reader) {
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 16384) {
            await reader.cancel();
            throw Error();
          }
          chunks.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of chunks) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ConsumerCredentialError("consumer_key_exchange_invalid");
  }
  if (!response.ok) {
    throw new ConsumerCredentialError(
      "consumer_key_exchange_refused",
      false,
      424,
      response.status,
    );
  }
  if (
    !object(raw) || typeof raw.access_token !== "string" ||
    !/^[A-Za-z0-9._~-]{16,8192}$/.test(raw.access_token) ||
    !Number.isInteger(raw.expires_in) || Number(raw.expires_in) < 1 ||
    Number(raw.expires_in) > 3600 || typeof raw.token_type !== "string" ||
    raw.token_type.toLowerCase() !== "bearer"
  ) throw new ConsumerCredentialError("consumer_key_exchange_refused");
  return raw.access_token;
}

/** Pass credentials only to the fixed provider's private request code. The
 * database reports legacy explicitly; an error or active-key refusal cannot
 * silently cause fallback. Every invocation obtains the current pointer anew.
 */
export function createCredentialConsumer(deps: Dependencies) {
  return async function withCredential<T>(
    consumer: CredentialConsumer,
    execution: ConsumerExecution,
    use: (credential: string) => Promise<T>,
  ): Promise<T> {
    if (
      !consumers.has(consumer) || !uuid(execution.actorId) ||
      !uuid(execution.admissionId) ||
      !/^[a-z][a-z0-9_.-]{2,100}$/.test(execution.operation)
    ) {
      throw new ConsumerCredentialError(
        "consumer_execution_context_invalid",
        false,
        400,
      );
    }
    let result: { data: unknown; error: unknown };
    try {
      result = await deps.db.rpc("sandy_credential_resolve_consumer", {
        p_consumer: consumer,
        p_actor: execution.actorId,
        p_admission: execution.admissionId,
        p_operation: execution.operation,
      });
    } catch {
      throw new ConsumerCredentialError("consumer_custody_unavailable");
    }
    if (result.error) {
      const code =
        object(result.error) && typeof result.error.message === "string"
          ? result.error.message
          : "";
      if (Object.hasOwn(sqlRefusals, code)) {
        throw new ConsumerCredentialError(code, false, sqlRefusals[code]);
      }
      throw new ConsumerCredentialError("consumer_custody_unavailable");
    }
    if (!object(result.data) || result.data.ok !== true) {
      throw new ConsumerCredentialError("consumer_custody_refused");
    }
    const row = result.data;
    let credential: string;
    if (
      row.source === "existing_configuration" && row.active_version_id === null
    ) {
      if (
        Object.hasOwn(row, "value") || Object.hasOwn(row, "material_sha256")
      ) {
        throw new ConsumerCredentialError("consumer_custody_response_invalid");
      }
      try {
        credential = await deps.legacy[consumer]();
      } catch {
        throw new ConsumerCredentialError(
          "consumer_legacy_identity_unavailable",
        );
      }
      if (!credential) {
        throw new ConsumerCredentialError(
          "consumer_legacy_identity_unavailable",
        );
      }
    } else {
      if (
        row.source !== "vault_active" || row.consumer !== consumer ||
        row.admission_id !== execution.admissionId ||
        !uuid(row.active_version_id) || !object(row.target) ||
        !uuid(row.target.id) || typeof row.value !== "string" ||
        new TextEncoder().encode(row.value).length > 65536 ||
        !digest(row.material_sha256) ||
        await materialDigest(row.value) !== row.material_sha256 ||
        row.target.active_version_id !== row.active_version_id
      ) throw new ConsumerCredentialError("consumer_custody_response_invalid");
      try {
        await credentialExecutionScope(row.target as Target);
      } catch {
        throw new ConsumerCredentialError("consumer_custody_response_invalid");
      }
      if (consumer === "gcp_access_token") {
        if (
          typeof row.provider_version_id !== "string" ||
          row.target.provider !== "gcp_service_account_key"
        ) throw new ConsumerCredentialError("consumer_key_identity_mismatch");
        credential = await exchangeCustodiedServiceAccountKey(
          row.target as Target,
          row.value,
          row.provider_version_id,
          deps.fetch ?? fetch,
          (deps.now ?? Date.now)(),
        );
      } else {
        if (!/^[A-Za-z0-9._~-]{1,8192}$/.test(row.value)) {
          throw new ConsumerCredentialError("consumer_token_format_invalid");
        }
        credential = row.value;
      }
    }
    try {
      return await use(credential);
    } catch {
      throw new ConsumerCredentialError(
        "consumer_request_outcome_unknown",
        true,
        502,
      );
    }
  };
}
