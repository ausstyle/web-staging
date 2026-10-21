import assert from "node:assert/strict";
import { argumentDigest } from "./sandy_api_protocol.ts";
import { machineScope } from "./sandy_machine_identity.ts";
import {
  ConsumerCredentialError,
  createCredentialConsumer,
  exchangeCustodiedServiceAccountKey,
} from "./sandy_credential_consumer.ts";
import type { Target } from "../sandy-credential-lifecycle-api/types.ts";
const actor = "10000000-0000-4000-8000-000000000001";
const admission = "10000000-0000-4000-8000-000000000002";
const targetId = "10000000-0000-4000-8000-000000000003";
const versionId = "10000000-0000-4000-8000-000000000004";
const execution = {
  actorId: actor,
  admissionId: admission,
  operation: "supabase.project.config.auth.get",
};
const token = "sbp_synthetic_consumer_credential_not_real";
async function rawDigest(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}
async function target(
  provider: Target["provider"] = "supabase_edge_secret",
): Promise<Target> {
  const resource = provider === "gcp_service_account_key"
    ? { service_account: machineScope.service_account }
    : { secret_name: "SANDY_SUPABASE_MANAGEMENT_TOKEN" };
  const config = await argumentDigest({
    version: "1.0.0",
    target_id: targetId,
    provider,
    resource,
  });
  return {
    id: targetId,
    provider,
    resource,
    enabled: true,
    verified: true,
    active_version_id: versionId,
    config_sha256: config,
    scope_sha256: await argumentDigest({
      sandy_project_ref: "zmqlyygzqoidkcwdysok",
      gcp_project_id: machineScope.project_id,
      github_repository: "ausstyle/web-staging",
      credential_target_id: targetId,
      credential_provider: provider,
      target_config_sha256: config,
    }),
  };
}
async function activeRow() {
  return {
    ok: true,
    source: "vault_active",
    consumer: "supabase_management",
    admission_id: admission,
    active_version_id: versionId,
    target: await target(),
    value: token,
    material_sha256: await rawDigest(token),
    provider_version_id: "fixture",
  };
}
function harness(data: unknown, rpcError: unknown = null) {
  const calls: Record<string, unknown>[] = [];
  let legacyCalls = 0;
  const resolve = createCredentialConsumer({
    db: {
      rpc(name, args) {
        calls.push({ name, args });
        return Promise.resolve({ data, error: rpcError });
      },
    },
    legacy: {
      supabase_management: () => {
        legacyCalls++;
        return "legacy_fixture";
      },
      github_api: () => {
        legacyCalls++;
        return "legacy_github";
      },
      gcp_access_token: () => {
        legacyCalls++;
        return "legacy_machine";
      },
    },
  });
  return { resolve, calls, legacyCalls: () => legacyCalls };
}
Deno.test("unconfigured consumer preserves existing identity only after a real consumed-admission lookup", async () => {
  const h = harness({
    ok: true,
    source: "existing_configuration",
    active_version_id: null,
  });
  const result = await h.resolve("supabase_management", execution, (value) => {
    assert.equal(value, "legacy_fixture");
    return Promise.resolve({ metadata: true });
  });
  assert.deepEqual(result, { metadata: true });
  assert.equal(h.legacyCalls(), 1);
  assert.deepEqual(h.calls, [{
    name: "sandy_credential_resolve_consumer",
    args: {
      p_consumer: "supabase_management",
      p_actor: actor,
      p_admission: admission,
      p_operation: execution.operation,
    },
  }]);
});
Deno.test("active encrypted pointer supplies only the selected server callback and does not use legacy credentials", async () => {
  const h = harness(await activeRow());
  const result = await h.resolve("supabase_management", execution, (value) => {
    assert.equal(value, token);
    return Promise.resolve({ provider_http_status: 200 });
  });
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.equal(JSON.stringify(h.calls).includes(token), false);
  assert.equal(h.legacyCalls(), 0);
});
Deno.test("active pointer, digest, scope and database failures never fall back to the old key", async () => {
  const row = await activeRow();
  for (
    const data of [
      null,
      { ok: false },
      { ...row, material_sha256: "0".repeat(64) },
      { ...row, active_version_id: actor },
      { ...row, target: { ...row.target, config_sha256: "0".repeat(64) } },
      { ...row, target: { ...row.target, verified: false } },
      { ...row, source: "existing_configuration" },
    ]
  ) {
    const h = harness(data);
    let callback = 0;
    await assert.rejects(
      h.resolve("supabase_management", execution, () => {
        callback++;
        return Promise.resolve({});
      }),
      ConsumerCredentialError,
    );
    assert.equal(h.legacyCalls(), 0);
    assert.equal(callback, 0);
  }
  const lost = harness(null, { message: token });
  await assert.rejects(
    lost.resolve("supabase_management", execution, () => Promise.resolve({})),
    (error) =>
      error instanceof ConsumerCredentialError &&
      !error.message.includes(token),
  );
  assert.equal(lost.legacyCalls(), 0);
});
Deno.test("every request rechecks the pointer and a lost consumer response exposes only an unknown-outcome code", async () => {
  const h = harness(await activeRow());
  for (let i = 0; i < 2; i++) {
    await h.resolve(
      "supabase_management",
      execution,
      () => Promise.resolve({}),
    );
  }
  assert.equal(h.calls.length, 2);
  await assert.rejects(
    h.resolve("supabase_management", execution, () => {
      throw Error(token);
    }),
    (error) =>
      error instanceof ConsumerCredentialError &&
      error.code === "consumer_request_outcome_unknown" &&
      error.requestMayHaveExecuted && !error.message.includes(token),
  );
});
Deno.test("caller scope and mixed legacy/material responses are rejected before a credential callback", async () => {
  const h = harness({
    ok: true,
    source: "existing_configuration",
    active_version_id: null,
    value: token,
  });
  await assert.rejects(
    h.resolve("supabase_management", execution, () => Promise.resolve({})),
    ConsumerCredentialError,
  );
  await assert.rejects(
    h.resolve(
      "github_api",
      { ...execution, actorId: "not-an-auth-identity" },
      () => Promise.resolve({}),
    ),
    ConsumerCredentialError,
  );
  assert.equal(h.calls.length, 1);
  assert.equal(h.legacyCalls(), 0);
});
Deno.test("known active-pointer dependencies retain precise safe refusal codes", async () => {
  const h = harness(null, {
    message: "consumer_active_pointer_removed",
    details: token,
  });
  await assert.rejects(
    h.resolve("supabase_management", execution, () => Promise.resolve({})),
    (error) =>
      error instanceof ConsumerCredentialError &&
      error.code === "consumer_active_pointer_removed" &&
      error.status === 424 && !error.message.includes(token),
  );
  assert.equal(h.legacyCalls(), 0);
});

Deno.test("custodied key exchange signs a real fixed-scope JWT without a customer session", async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const encoded = btoa(
    String.fromCharCode(
      ...new Uint8Array(
        await crypto.subtle.exportKey("pkcs8", pair.privateKey),
      ),
    ),
  );
  const material = JSON.stringify({
    type: "service_account",
    project_id: machineScope.project_id,
    client_email: machineScope.service_account,
    token_uri: "https://oauth2.googleapis.com/token",
    private_key_id: "a".repeat(40),
    private_key:
      `-----BEGIN PRIVATE KEY-----\n${encoded}\n-----END PRIVATE KEY-----`,
  });
  const keyTarget = await target("gcp_service_account_key");
  const version =
    `projects/${machineScope.project_id}/serviceAccounts/${machineScope.service_account}/keys/${
      "a".repeat(40)
    }`;
  let fetches = 0;
  const fetcher = (async (url: unknown, init?: RequestInit) => {
    fetches++;
    assert.equal(url, "https://oauth2.googleapis.com/token");
    assert.equal(init?.redirect, "error");
    const assertion = new URLSearchParams(String(init?.body)).get("assertion")!;
    const [header, body, signature] = assertion.split(".");
    const bytes = (value: string) =>
      Uint8Array.from(
        atob(value.replace(/-/g, "+").replace(/_/g, "/")),
        (x) => x.charCodeAt(0),
      );
    assert.equal(
      await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        pair.publicKey,
        bytes(signature),
        new TextEncoder().encode(`${header}.${body}`),
      ),
      true,
    );
    const claims = JSON.parse(new TextDecoder().decode(bytes(body)));
    assert.equal(claims.iss, machineScope.service_account);
    assert.equal(claims.aud, "https://oauth2.googleapis.com/token");
    assert.equal(claims.exp - claims.iat, 300);
    assert.equal("sub" in claims, false);
    return Response.json({
      access_token: "ya29.synthetic_access_token",
      expires_in: 1800,
      token_type: "Bearer",
    });
  }) as typeof fetch;
  assert.equal(
    await exchangeCustodiedServiceAccountKey(
      keyTarget,
      material,
      version,
      fetcher,
      Date.UTC(2026, 9, 21),
    ),
    "ya29.synthetic_access_token",
  );
  assert.equal(fetches, 1);
  await assert.rejects(
    exchangeCustodiedServiceAccountKey(
      keyTarget,
      material.replace(machineScope.project_id, "foreign-project"),
      version,
      fetcher,
    ),
    Error,
  );
  assert.equal(fetches, 1);
  await assert.rejects(
    exchangeCustodiedServiceAccountKey(
      keyTarget,
      material,
      version,
      (() =>
        Promise.resolve(
          Response.json({ error: "synthetic_sensitive_provider_error" }, {
            status: 400,
          }),
        )) as typeof fetch,
    ),
    (error) =>
      error instanceof ConsumerCredentialError &&
      error.code === "consumer_key_exchange_refused" &&
      error.providerHttpStatus === 400 &&
      !error.message.includes("synthetic_sensitive_provider_error"),
  );
});
