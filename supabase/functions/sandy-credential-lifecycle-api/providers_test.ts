import { deepStrictEqual as eq, rejects } from "node:assert/strict";
import sodiumImport from "npm:libsodium-wrappers-sumo@0.7.15";
import {
  createCredentialProviders,
  type Rotation,
  type Target,
} from "./providers.ts";
import { machineScope } from "../_shared/sandy_machine_identity.ts";
const targetId = "10000000-0000-4000-8000-000000000001";
const bound = (
  provider: Target["provider"],
  resource: Record<string, unknown>,
): Target => ({
  id: targetId,
  provider,
  resource,
  config_sha256: "a".repeat(64),
  scope_sha256: "b".repeat(64),
  enabled: true,
  verified: true,
  active_version_id: null,
});
const rotation: Rotation = {
  id: "10000000-0000-4000-8000-000000000002",
  target_id: targetId,
  state: "accepted",
  probe_challenge: "10000000-0000-4000-8000-000000000003",
  provider_version_id: null,
  prior_version_id: null,
  staged_version_id: null,
  verification_admission_id: null,
  target_config_sha256: "a".repeat(64),
};
Deno.test("GitHub secrets are sealed to the actual provider public key before PUT", async () => {
  const sodium = sodiumImport as any;
  await sodium.ready;
  const pair = sodium.crypto_box_keypair();
  let reads = 0;
  let encrypted = false;
  let redirected = false;
  const provider = createCredentialProviders({
    service: "internal",
    management: "management-fixture",
    github: "github-fixture",
    gcp: () => Promise.reject(new Error("unrelated auth")),
    fetch: ((url: URL | string, init: RequestInit) => {
      redirected ||= init.redirect !== "error";
      if (String(url).endsWith("/public-key")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              key_id: "public-key-fixture",
              key: sodium.to_base64(
                pair.publicKey,
                sodium.base64_variants.ORIGINAL,
              ),
            }),
            { status: 200 },
          ),
        );
      }
      if (init.method === "PUT") {
        const body = JSON.parse(String(init.body));
        eq(Object.keys(body).sort(), ["encrypted_value", "key_id"]);
        eq(String(init.body).includes("synthetic-new-material"), false);
        encrypted = new TextDecoder().decode(
          sodium.crypto_box_seal_open(
            sodium.from_base64(
              body.encrypted_value,
              sodium.base64_variants.ORIGINAL,
            ),
            pair.publicKey,
            pair.privateKey,
          ),
        ) === "synthetic-new-material";
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      reads++;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            name: "SANDY_ROTATION_TEST_SECRET",
            updated_at: reads === 1
              ? "2026-10-01T00:00:00Z"
              : "2026-10-02T00:00:00Z",
          }),
          { status: 200 },
        ),
      );
    }) as typeof fetch,
  });
  const target = bound("github_actions_secret", {
    secret_name: "SANDY_ROTATION_TEST_SECRET",
    repository: "ausstyle/web-staging",
    workflow_id: 1,
    workflow_ref: "main",
    workflow_head_sha: "a".repeat(40),
  });
  const result = await provider.rotate(target, rotation, {
    value: "synthetic-new-material",
    material_sha256: "c".repeat(64),
    provider_version_id: null,
    version_id: null,
  }, {
    value: "synthetic-old-material",
    material_sha256: "d".repeat(64),
    provider_version_id: "2026-10-01T00:00:00Z",
    version_id: null,
  });
  eq(encrypted, true);
  eq(redirected, false);
  eq(result.provider_version_id, "2026-10-02T00:00:00Z");
});
Deno.test("Secret Manager access verifies CRC32C and canonical project identity", async () => {
  const target = bound("gcp_secret", {
    name: "projects/elaborate-haven-511518-a5/secrets/fixture",
  });
  const make = (crc: string) =>
    createCredentialProviders({
      service: "internal",
      management: "fixture",
      github: "fixture",
      gcp: () => Promise.resolve("gcp-fixture"),
      fetch: ((url: URL | string, init: RequestInit) => {
        eq(
          String(url).startsWith(
            "https://secretmanager.googleapis.com/v1/projects/elaborate-haven-511518-a5/secrets/fixture/versions/",
          ),
          true,
        );
        eq(init.redirect, "error");
        return Promise.resolve(
          new Response(
            JSON.stringify({
              name: "projects/1030223524306/secrets/fixture/versions/1",
              payload: { data: "YWJj", dataCrc32c: crc },
            }),
            { status: 200 },
          ),
        );
      }) as typeof fetch,
    });
  const read = await make("910901175").secretAccess(
    target,
    "projects/elaborate-haven-511518-a5/secrets/fixture/versions/latest",
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  eq(read.value === "abc", true);
  eq(
    read.version,
    "projects/elaborate-haven-511518-a5/secrets/fixture/versions/1",
  );
  await rejects(
    () =>
      make("0").secretAccess(
        target,
        "projects/elaborate-haven-511518-a5/secrets/fixture/versions/1",
      ),
    /credential_provider_integrity_failed/,
  );
});
Deno.test("foreign Secret Manager resource is refused before credential use", async () => {
  let calls = 0;
  const provider = createCredentialProviders({
    service: "internal",
    management: "fixture",
    github: "fixture",
    gcp: () => {
      calls++;
      return Promise.resolve("fixture");
    },
    fetch: (() => {
      calls++;
      throw new Error("not reached");
    }) as typeof fetch,
  });
  await rejects(
    () =>
      provider.secretAccess(
        bound("gcp_secret", { name: "projects/foreign/secrets/fixture" }),
        "projects/foreign/secrets/fixture/versions/1",
      ),
    /verified_secret_resource_binding_required/,
  );
  eq(calls, 0);
});
Deno.test("Secret Manager revocation accepts the actual numeric identity and requires refused access", async () => {
  const target = bound("gcp_secret", {
    name: "projects/elaborate-haven-511518-a5/secrets/fixture",
  });
  let disabled = false, accesses = 0;
  const provider = createCredentialProviders({
    service: "internal",
    management: "fixture",
    github: "fixture",
    gcp: () => Promise.resolve("fixture"),
    fetch: ((url: URL | string, init: RequestInit) => {
      if (String(url).endsWith(":disable")) {
        disabled = true;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              name: "projects/1030223524306/secrets/fixture/versions/1",
              state: "DISABLED",
            }),
          ),
        );
      }
      if (String(url).endsWith(":access")) {
        accesses++;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: 400, status: "FAILED_PRECONDITION" },
            }),
            { status: 400 },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            name: "projects/1030223524306/secrets/fixture/versions/1",
            state: disabled ? "DISABLED" : "ENABLED",
            etag: "fixture-etag",
          }),
        ),
      );
    }) as typeof fetch,
  });
  await provider.revoke(target, {
    value: "fixture",
    material_sha256: "a".repeat(64),
    version_id: null,
    provider_version_id:
      "projects/elaborate-haven-511518-a5/secrets/fixture/versions/1",
  });
  eq(disabled, true);
  eq(accesses, 1);
});
Deno.test("key cleanup validates the exact returned resource identity", async () => {
  const target = bound("gcp_service_account_key", {
    service_account: machineScope.service_account,
  });
  const version =
    `projects/elaborate-haven-511518-a5/serviceAccounts/${machineScope.service_account}/keys/${
      "a".repeat(40)
    }`;
  const provider = createCredentialProviders({
    service: "internal",
    management: "fixture",
    github: "fixture",
    gcp: () => Promise.resolve("fixture"),
    fetch: ((_url: URL | string, init: RequestInit) =>
      Promise.resolve(
        new Response(
          init.method === "POST" ? null : JSON.stringify({
            name: version.replace("a".repeat(40), "b".repeat(40)),
            disabled: true,
          }),
          { status: init.method === "POST" ? 204 : 200 },
        ),
      )) as typeof fetch,
  });
  await rejects(
    () => provider.cleanupUnstagedKey(target, version),
    /credential_key_cleanup_unconfirmed/,
  );
});
Deno.test("an existing cleanup claim observes disabled state without issuing another write", async () => {
  const target = bound("gcp_service_account_key", {
    service_account: machineScope.service_account,
  });
  const version =
    `projects/elaborate-haven-511518-a5/serviceAccounts/${machineScope.service_account}/keys/${
      "a".repeat(40)
    }`;
  let writes = 0;
  const make = (disabled: boolean) =>
    createCredentialProviders({
      service: "internal",
      management: "fixture",
      github: "fixture",
      gcp: () => Promise.resolve("fixture"),
      fetch: ((_url: URL | string, init: RequestInit) => {
        if (init.method !== "GET") writes++;
        return Promise.resolve(
          new Response(JSON.stringify({ name: version, disabled })),
        );
      }) as typeof fetch,
    });
  await make(true).cleanupUnstagedKey(target, version, false);
  await rejects(
    () => make(false).cleanupUnstagedKey(target, version, false),
    /credential_key_cleanup_status_unconfirmed/,
  );
  eq(writes, 0);
});
Deno.test("private service-account key is tested through fixed OAuth and project read only", async () => {
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
  const exported = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", pair.privateKey),
  );
  const pem = "-----BEGIN PRIVATE KEY-----\n" +
    btoa(String.fromCharCode(...exported)) + "\n-----END PRIVATE KEY-----";
  const value = JSON.stringify({
    type: "service_account",
    project_id: "elaborate-haven-511518-a5",
    private_key_id: "a".repeat(40),
    private_key: pem,
    client_email: machineScope.service_account,
    token_uri: "https://oauth2.googleapis.com/token",
  });
  let signed = false;
  let projectRead = false;
  const provider = createCredentialProviders({
    service: "internal",
    management: "fixture",
    github: "fixture",
    gcp: () => Promise.reject(new Error("WIF not substituted for key proof")),
    fetch: (async (url: URL | string, init: RequestInit) => {
      eq(init.redirect, "error");
      if (String(url) === "https://oauth2.googleapis.com/token") {
        const assertion = (init.body as URLSearchParams).get("assertion")!;
        eq(String(init.body).includes("BEGIN"), false);
        const [header, payload, signature] = assertion.split(".");
        const claims = JSON.parse(
          atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
        );
        eq(claims.iss, machineScope.service_account);
        eq(claims.aud, "https://oauth2.googleapis.com/token");
        eq(claims.exp - claims.iat, 300);
        eq(claims.scope, "https://www.googleapis.com/auth/cloud-platform");
        signed = await crypto.subtle.verify(
          "RSASSA-PKCS1-v1_5",
          pair.publicKey,
          Uint8Array.from(
            atob(signature.replace(/-/g, "+").replace(/_/g, "/")),
            (c) => c.charCodeAt(0),
          ),
          new TextEncoder().encode(header + "." + payload),
        );
        return new Response(
          JSON.stringify({ access_token: "new-key-provider-fixture" }),
          { status: 200 },
        );
      }
      eq(
        String(url),
        "https://cloudresourcemanager.googleapis.com/v3/projects/elaborate-haven-511518-a5",
      );
      eq(
        (init.headers as Record<string, string>).authorization,
        "Bearer new-key-provider-fixture",
      );
      projectRead = true;
      return new Response(
        JSON.stringify({
          projectId: "elaborate-haven-511518-a5",
          name: "projects/1030223524306",
        }),
        { status: 200 },
      );
    }) as typeof fetch,
  });
  const proof = await provider.verify(
    bound("gcp_service_account_key", {
      service_account: machineScope.service_account,
    }),
    rotation,
    {
      value,
      material_sha256: "a".repeat(64),
      provider_version_id: null,
      version_id: null,
    },
  );
  eq(signed, true);
  eq(projectRead, true);
  eq(proof.probe_kind, "new_key_oauth_and_fixed_project_read");
  eq(JSON.stringify(proof).includes("PRIVATE"), false);
});
Deno.test("raw provider failure text never escapes credential administration", async () => {
  const provider = createCredentialProviders({
    service: "internal",
    management: "fixture",
    github: "fixture",
    gcp: () => Promise.resolve("fixture"),
    fetch: (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: "provider-secret-MUST-NOT-ESCAPE" }),
          { status: 401 },
        ),
      )) as typeof fetch,
  });
  await rejects(
    () =>
      provider.hiddenMetadata(
        bound("supabase_edge_secret", {
          secret_name: "SANDY_ROTATION_TEST_SECRET",
        }),
      ),
    (error: Error) =>
      error.message === "credential_provider_authorization_refused",
  );
});
