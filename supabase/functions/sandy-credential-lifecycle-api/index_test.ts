import { deepStrictEqual as eq, rejects } from "node:assert/strict";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import {
  createCredentialLifecycleHandler,
  type CredentialDependencies,
  credentialRegistryAllows,
} from "./index.ts";
import { credentialContracts, credentialExecutionScope } from "./contracts.ts";
import {
  createCredentialProviders,
  CredentialProviderError,
  type Rotation,
  type Target,
} from "./providers.ts";
const ACTOR = "10000000-0000-4000-8000-000000000001",
  TARGET = "10000000-0000-4000-8000-000000000002",
  ADMISSION = "10000000-0000-4000-8000-000000000003",
  ROTATION = "10000000-0000-4000-8000-000000000004",
  VERSION = "10000000-0000-4000-8000-000000000005",
  PRIOR = "10000000-0000-4000-8000-000000000006";
async function target(): Promise<Target> {
  const resource = { secret_name: "SANDY_ROTATION_TEST_SECRET" };
  const config_sha256 = await argumentDigest({
    version: "1.0.0",
    target_id: TARGET,
    provider: "supabase_edge_secret",
    resource,
  });
  const scope = {
    sandy_project_ref: "zmqlyygzqoidkcwdysok",
    gcp_project_id: "elaborate-haven-511518-a5",
    github_repository: "ausstyle/web-staging",
    credential_target_id: TARGET,
    credential_provider: "supabase_edge_secret",
    target_config_sha256: config_sha256,
  };
  return {
    id: TARGET,
    provider: "supabase_edge_secret",
    resource,
    config_sha256,
    scope_sha256: await argumentDigest(scope),
    enabled: true,
    verified: true,
    active_version_id: PRIOR,
  };
}
async function harness(overrides: Partial<CredentialDependencies> = {}) {
  const bound = await target();
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const receipts: any[] = [];
  let consumes = 0;
  let providerWrites = 0;
  const rotation: Rotation = {
    id: ROTATION,
    target_id: TARGET,
    state: "accepted",
    probe_challenge: crypto.randomUUID(),
    provider_version_id: "provider-digest",
    prior_version_id: PRIOR,
    staged_version_id: VERSION,
    verification_admission_id: null,
    target_config_sha256: bound.config_sha256,
  };
  const providers = {
    verify: () =>
      Promise.resolve({
        provider_version_id: "provider-digest",
        probe_kind: "fixture-observation",
      }),
    rotate: () => {
      providerWrites++;
      return Promise.resolve({
        value: "new-fixture-material",
        provider_version_id: "provider-digest",
      });
    },
    dispatchProbe: () => Promise.resolve(),
    hiddenMetadata: () => Promise.resolve("provider-digest"),
    secretAccess: () =>
      Promise.resolve({
        value: "new-fixture-material",
        version:
          "projects/elaborate-haven-511518-a5/secrets/fixture/versions/1",
      }),
    restoreKey: () =>
      Promise.resolve({
        value: "old-fixture-material",
        provider_version_id: "provider-digest",
      }),
    revoke: () => Promise.resolve(),
    cleanupUnstagedKey: () => Promise.resolve(),
    createFirstVersion: () =>
      Promise.resolve({
        value: "fixture",
        provider_version_id:
          "projects/elaborate-haven-511518-a5/secrets/fixture/versions/1",
      }),
  };
  const deps: CredentialDependencies = {
    service: "internal",
    providers,
    store: {
      target: () => Promise.resolve(bound),
      rotation: () => Promise.resolve(rotation),
      rpc: (name, args) => {
        calls.push({ name, args });
        if (name === "sandy_credential_material") {
          return Promise.resolve({
            ok: true,
            value: "synthetic-material-NEVER-RETURN",
            material_sha256: "a".repeat(64),
            provider_version_id: "provider-digest",
            version_id: VERSION,
          });
        }
        if (name === "sandy_credential_store_version") {
          return Promise.resolve({
            ok: true,
            target_id: TARGET,
            version_id: VERSION,
            encrypted_at_rest: true,
            active: false,
          });
        }
        if (name === "sandy_credential_begin") {
          return Promise.resolve({
            ok: true,
            rotation_id: ROTATION,
            reused: false,
          });
        }
        if (name === "sandy_credential_stage") {
          return Promise.resolve({ ok: true, version_id: VERSION });
        }
        return Promise.resolve({ ok: true });
      },
    },
    authorize: () => Promise.resolve({ allowed: true }),
    consume: () => {
      consumes++;
      return Promise.resolve({ allowed: true, admission_id: ADMISSION });
    },
    finish: (r) => {
      receipts.push(r);
      return Promise.resolve({ allowed: true });
    },
    ...overrides,
  };
  const handler = createCredentialLifecycleHandler(deps);
  const call = (
    operation: string,
    args: Record<string, unknown>,
    context: Record<string, unknown> = {},
  ) =>
    handler(
      new Request("https://fixture.invalid", {
        method: "POST",
        headers: {
          authorization: "Bearer internal",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          operation,
          arguments: { target_id: TARGET, ...args },
          actor_id: ACTOR,
          tenant_id: null,
          request_id: crypto.randomUUID(),
          grant_id: crypto.randomUUID(),
          ...context,
        }),
      }),
    );
  return {
    call,
    handler,
    calls,
    receipts,
    rotation,
    bound,
    deps,
    consumes: () => consumes,
    providerWrites: () => providerWrites,
  };
}
Deno.test("every custody contract requires exact inputs and supports safe outputs", async () => {
  const contracts = await credentialContracts();
  eq(Object.keys(contracts).length, 14);
  for (const item of Object.values(contracts)) {
    eq(/^[a-z][a-z0-9_.-]{2,100}$/.test(item.operation), true);
    eq(/^[a-f0-9]{64}$/.test(item.contract_sha256), true);
    eq(item.input_schema.additionalProperties, false);
    eq(item.permission_scope, "infrastructure:write");
  }
});
Deno.test("verified target scope rejects changed metadata without expanding grants", async () => {
  const item = await target();
  await credentialExecutionScope(item);
  item.resource.secret_name = "DIFFERENT";
  await rejects(
    () => credentialExecutionScope(item),
    /credential_target_configuration_integrity_failed/,
  );
});
Deno.test("internal credentials and normal owner context are mandatory", async () => {
  const h = await harness();
  eq(
    (await h.handler(
      new Request("https://fixture.invalid", { method: "POST", body: "{}" }),
    )).status,
    403,
  );
  eq(
    (await h.call(
      "supabase.vault.secrets.create_version",
      { value: "fixture" },
      { credential_id: crypto.randomUUID() },
    )).status,
    403,
  );
  eq(h.consumes(), 0);
});
Deno.test("disabled target blocks independently of Controller credentials", async () => {
  const h = await harness();
  h.bound.enabled = false;
  eq(
    (await h.call("supabase.vault.secrets.create_version", {
      value: "fixture",
    }))
      .status,
    424,
  );
  eq(h.consumes(), 0);
});
Deno.test("replayed grant cannot stage or rotate any material", async () => {
  const h = await harness({
    consume: () =>
      Promise.resolve({ allowed: true, reused: true, admission_id: ADMISSION }),
  });
  eq(
    (await h.call("supabase.vault.secrets.create_version", {
      value: "fixture",
    }))
      .status,
    409,
  );
  eq(h.calls.length, 0);
});
Deno.test("Vault staging returns only an opaque encrypted version", async () => {
  const h = await harness();
  const response = await h.call("supabase.vault.secrets.create_version", {
    value: "new-secret-NEVER-RETURN",
  });
  const raw = await response.text();
  eq(response.status, 200);
  eq(raw.includes("new-secret-NEVER-RETURN"), false);
  eq(JSON.parse(raw).result.version_id, VERSION);
  eq(h.receipts[0].outcome, "accepted");
  eq(h.providerWrites(), 0);
});
Deno.test("verification emits actual observation proof and binds canonical receipt before storage", async () => {
  const h = await harness();
  const response = await h.call("system.credentials.provider.verify", {
    rotation_id: ROTATION,
  });
  const raw = await response.text();
  eq(response.status, 200);
  eq(raw.includes("synthetic-material-NEVER-RETURN"), false);
  const result = JSON.parse(raw).result;
  eq(result.provider_verified, true);
  eq(h.receipts[0].outcome, "succeeded");
  const record = h.calls.find((x) =>
    x.name === "sandy_credential_record_verification"
  )!;
  eq(await argumentDigest(record.args.p_evidence), h.receipts[0].result_sha256);
  eq(typeof record.args.p_canonical, "string");
});
Deno.test("activation cannot substitute a caller-supplied readback boolean", async () => {
  const h = await harness();
  const response = await h.call("system.credentials.provider.activate", {
    rotation_id: ROTATION,
    verification_admission_id: crypto.randomUUID(),
    acknowledge_provider_has_no_cas: true,
    provider_verified: true,
  });
  eq(response.status, 400);
  eq(h.consumes(), 0);
});
Deno.test("lost verification storage preserves its successful read receipt truthfully", async () => {
  const h = await harness();
  const original = h.deps.store.rpc;
  h.deps.store.rpc = (name, args) =>
    name === "sandy_credential_record_verification"
      ? Promise.reject(new Error("lost-proof-storage"))
      : original(name, args);
  const response = await h.call("system.credentials.provider.verify", {
    rotation_id: ROTATION,
  });
  eq(response.status, 503);
  const body = await response.json();
  eq(body.error, "credential_verification_recording_incomplete");
  eq(body.request_state, "observed");
  eq(h.receipts.length, 1);
  eq(h.receipts[0].outcome, "succeeded");
});
Deno.test("source rotation stages provider result but does not activate or revoke preimage", async () => {
  const h = await harness();
  const response = await h.call("supabase.functions.secrets.rotate", {
    source_version_id: VERSION,
    acknowledge_provider_has_no_cas: true,
  });
  const raw = await response.text();
  eq(response.status, 200);
  eq(raw.includes("new-fixture-material"), false);
  eq(h.providerWrites(), 1);
  eq(h.calls.some((x) => x.name === "sandy_credential_activate"), false);
  eq(JSON.parse(raw).result.previous_credential_revoked, false);
  eq(h.receipts[0].outcome, "accepted");
});
Deno.test("lost provider response records unknown and never repeats creation", async () => {
  const h = await harness();
  h.deps.providers.rotate = () =>
    Promise.reject(
      new CredentialProviderError(
        "credential_provider_response_unavailable",
        true,
      ),
    );
  const response = await h.call("supabase.functions.secrets.rotate", {
    source_version_id: VERSION,
    acknowledge_provider_has_no_cas: true,
  });
  eq(response.status, 502);
  eq(h.receipts.at(-1).outcome, "unknown");
  eq(h.calls.some((x) => x.name === "sandy_credential_record_unknown"), true);
  eq(h.calls.some((x) => x.name === "sandy_credential_activate"), false);
});
Deno.test("rollback refuses after a different active credential replaces captured preimage", async () => {
  const h = await harness();
  h.rotation.state = "activated";
  h.bound.active_version_id = crypto.randomUUID();
  const response = await h.call("system.credentials.provider.rollback", {
    rollback_rotation_id: ROTATION,
    acknowledge_provider_has_no_cas: true,
  });
  eq(response.status, 502);
  eq(h.providerWrites(), 0);
});
Deno.test("actual Supabase consumer probe HMAC is checked without returning secret", async () => {
  const item = await target();
  const rotation: Rotation = {
    id: ROTATION,
    target_id: TARGET,
    state: "accepted",
    probe_challenge: crypto.randomUUID(),
    provider_version_id: null,
    prior_version_id: PRIOR,
    staged_version_id: VERSION,
    verification_admission_id: null,
    target_config_sha256: item.config_sha256,
  };
  const providers = createCredentialProviders({
    service: "internal",
    management: "fixture",
    github: "",
    gcp: () => Promise.reject(new Error("unrelated GCP must not run")),
    fetch: (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            target_id: TARGET,
            rotation_id: ROTATION,
            challenge: rotation.probe_challenge,
            secret_name: "SANDY_ROTATION_TEST_SECRET",
            hmac_sha256: "wrong",
          }),
          { status: 200 },
        ),
      )) as typeof fetch,
  });
  await rejects(
    () =>
      providers.verify(item, rotation, {
        value: "fixture",
        material_sha256: "a".repeat(64),
        provider_version_id: null,
        version_id: VERSION,
      }),
    /credential_consumer_readback_failed/,
  );
});
Deno.test("key adoption and rollback storage failures never disable an existing key", async () => {
  for (
    const operation of [
      "system.credentials.provider.adopt",
      "system.credentials.provider.rollback",
    ]
  ) {
    const h = await harness();
    h.bound.provider = "gcp_service_account_key";
    h.bound.resource = {
      service_account:
        "sandy-computer@elaborate-haven-511518-a5.iam.gserviceaccount.com",
    };
    h.bound.config_sha256 = await argumentDigest({
      version: "1.0.0",
      target_id: TARGET,
      provider: h.bound.provider,
      resource: h.bound.resource,
    });
    h.bound.scope_sha256 = await argumentDigest({
      sandy_project_ref: "zmqlyygzqoidkcwdysok",
      gcp_project_id: "elaborate-haven-511518-a5",
      github_repository: "ausstyle/web-staging",
      credential_target_id: TARGET,
      credential_provider: h.bound.provider,
      target_config_sha256: h.bound.config_sha256,
    });
    h.rotation.target_config_sha256 = h.bound.config_sha256;
    h.rotation.state = "activated";
    h.bound.active_version_id = VERSION;
    let cleanups = 0;
    h.deps.providers.cleanupUnstagedKey = () => {
      cleanups++;
      return Promise.resolve();
    };
    const original = h.deps.store.rpc;
    h.deps.store.rpc = (name, args) =>
      name === "sandy_credential_stage"
        ? Promise.reject(new Error("lost-stage"))
        : original(name, args);
    const response = await h.call(operation, {
      acknowledge_provider_has_no_cas: true,
      ...(operation.endsWith("rollback")
        ? { rollback_rotation_id: ROTATION }
        : {}),
    });
    eq(response.status, 502);
    eq(cleanups, 0);
  }
});
Deno.test("compact credential descriptors match actual execution contracts", async () => {
  const manifest = await import("./gateway_manifest.json", {
    with: { type: "json" },
  });
  const contracts = await credentialContracts();
  for (const entry of manifest.default.operations) {
    eq(contracts[entry.operation].contract_sha256, entry.contract_sha256);
  }
});
Deno.test("production registry admission independently requires approval and prohibits API key delegation", async () => {
  const contract =
    (await credentialContracts())["system.credentials.provider.verify"];
  const row = {
    handler: "sandy-credential-lifecycle-api",
    permission_scope: contract.permission_scope,
    api_exposed: true,
    verified: true,
    is_mutation: contract.is_mutation,
    error_contract: {
      contract_sha256: contract.contract_sha256,
      requires_approval: true,
      api_key_delegable: false,
    },
  };
  eq(credentialRegistryAllows(row, contract), true);
  for (
    const patch of [
      { permission_scope: "infrastructure:read" },
      { api_exposed: false },
      { verified: false },
      { error_contract: { ...row.error_contract, requires_approval: false } },
      { error_contract: { ...row.error_contract, api_key_delegable: true } },
      {
        error_contract: {
          ...row.error_contract,
          contract_sha256: "0".repeat(64),
        },
      },
    ]
  ) eq(credentialRegistryAllows({ ...row, ...patch }, contract), false);
});
Deno.test("reconciliation of a staged version never repeats the provider mutation", async () => {
  const h = await harness();
  h.rotation.state = "unknown";
  const response = await h.call("system.credentials.provider.reconcile", {
    rotation_id: ROTATION,
    acknowledge_provider_has_no_cas: true,
  });
  eq(response.status, 200);
  eq(h.providerWrites(), 0);
  eq(h.calls.some((x) => x.name === "sandy_credential_stage"), false);
  eq(h.receipts.at(-1).outcome, "accepted");
});
async function bindProvider(
  h: Awaited<ReturnType<typeof harness>>,
  provider: Target["provider"],
  resource: Target["resource"],
) {
  h.bound.provider = provider;
  h.bound.resource = resource;
  h.bound.config_sha256 = await argumentDigest({
    version: "1.0.0",
    target_id: TARGET,
    provider,
    resource,
  });
  h.bound.scope_sha256 = await argumentDigest({
    sandy_project_ref: "zmqlyygzqoidkcwdysok",
    gcp_project_id: "elaborate-haven-511518-a5",
    github_repository: "ausstyle/web-staging",
    credential_target_id: TARGET,
    credential_provider: provider,
    target_config_sha256: h.bound.config_sha256,
  });
  h.rotation.target_config_sha256 = h.bound.config_sha256;
}
Deno.test("ambiguous GitHub probe dispatch is never repeated by reconciliation", async () => {
  const h = await harness();
  await bindProvider(h, "github_actions_secret", {
    secret_name: "SANDY_ROTATION_TEST_SECRET",
    repository: "ausstyle/web-staging",
    workflow_id: 1,
    workflow_ref: "main",
    workflow_head_sha: "a".repeat(40),
  });
  h.rotation.state = "unknown";
  let dispatches = 0;
  h.deps.providers.dispatchProbe = () => {
    dispatches++;
    return Promise.resolve();
  };
  const original = h.deps.store.rpc;
  h.deps.store.rpc = (name, args) =>
    name === "sandy_credential_probe_start"
      ? Promise.resolve({ ok: true, started: false, reused: true })
      : original(name, args);
  eq(
    (await h.call("system.credentials.provider.reconcile", {
      rotation_id: ROTATION,
      acknowledge_provider_has_no_cas: true,
    })).status,
    200,
  );
  eq(dispatches, 0);
  eq(h.providerWrites(), 0);
});
Deno.test("unstaged key cleanup requires independent SQL source binding before a provider action", async () => {
  const h = await harness();
  await bindProvider(h, "gcp_service_account_key", {
    service_account:
      "sandy-computer@elaborate-haven-511518-a5.iam.gserviceaccount.com",
  });
  h.rotation.state = "unknown";
  h.rotation.staged_version_id = null;
  h.rotation.provider_version_id =
    "projects/elaborate-haven-511518-a5/serviceAccounts/sandy-computer@elaborate-haven-511518-a5.iam.gserviceaccount.com/keys/" +
    "a".repeat(40);
  let cleanups = 0;
  h.deps.providers.cleanupUnstagedKey = () => {
    cleanups++;
    return Promise.resolve();
  };
  const original = h.deps.store.rpc;
  h.deps.store.rpc = (name, args) =>
    name === "sandy_credential_claim_unstaged_key"
      ? Promise.reject(
        new Error("credential_unstaged_key_identity_unconfirmed"),
      )
      : original(name, args);
  const response = await h.call("system.credentials.provider.reconcile", {
    rotation_id: ROTATION,
    acknowledge_provider_has_no_cas: true,
  });
  eq(response.status, 502);
  eq(cleanups, 0);
  eq(h.providerWrites(), 0);
});
Deno.test("reconciliation of adopted key material re-observes it without creating or disabling a key", async () => {
  const h = await harness();
  await bindProvider(h, "gcp_service_account_key", {
    service_account:
      "sandy-computer@elaborate-haven-511518-a5.iam.gserviceaccount.com",
  });
  h.rotation.state = "unknown";
  h.rotation.staged_version_id = null;
  h.rotation.source_operation = "system.credentials.provider.adopt";
  let observations = 0, cleanups = 0;
  h.deps.providers.verify = () => {
    observations++;
    return Promise.resolve({
      provider_version_id: "provider-digest",
      probe_kind: "fixture-observation",
    });
  };
  h.deps.providers.cleanupUnstagedKey = () => {
    cleanups++;
    return Promise.resolve();
  };
  const response = await h.call("system.credentials.provider.reconcile", {
    rotation_id: ROTATION,
    acknowledge_provider_has_no_cas: true,
  });
  eq(response.status, 200);
  eq(observations, 1);
  eq(cleanups, 0);
  eq(h.providerWrites(), 0);
  eq(h.calls.some((x) => x.name === "sandy_credential_stage"), true);
});
Deno.test("unknown source key staging never automatically disables a possibly late-staged key", async () => {
  const h = await harness();
  await bindProvider(h, "gcp_service_account_key", {
    service_account:
      "sandy-computer@elaborate-haven-511518-a5.iam.gserviceaccount.com",
  });
  h.rotation.staged_version_id = null;
  let cleanups = 0;
  h.deps.providers.cleanupUnstagedKey = () => {
    cleanups++;
    return Promise.resolve();
  };
  const original = h.deps.store.rpc;
  h.deps.store.rpc = (name, args) =>
    name === "sandy_credential_stage"
      ? Promise.reject(new Error("late-stage-response"))
      : original(name, args);
  const response = await h.call("gcp.service_accounts.keys.rotate", {
    acknowledge_provider_has_no_cas: true,
  });
  eq(response.status, 502);
  eq(cleanups, 0);
  eq(h.receipts.at(-1).outcome, "unknown");
});
Deno.test("reconciliation preserves an existing cleanup claim as observation only", async () => {
  const h = await harness();
  await bindProvider(h, "gcp_service_account_key", {
    service_account:
      "sandy-computer@elaborate-haven-511518-a5.iam.gserviceaccount.com",
  });
  h.rotation.state = "cleanup_claimed";
  h.rotation.staged_version_id = null;
  h.rotation.provider_version_id =
    "projects/elaborate-haven-511518-a5/serviceAccounts/sandy-computer@elaborate-haven-511518-a5.iam.gserviceaccount.com/keys/" +
    "a".repeat(40);
  const original = h.deps.store.rpc;
  h.deps.store.rpc = (name, args) =>
    name === "sandy_credential_claim_unstaged_key"
      ? Promise.resolve({
        ok: true,
        claimed: true,
        dispatch_allowed: false,
        provider_version_id: h.rotation.provider_version_id,
      })
      : original(name, args);
  let dispatched: unknown;
  h.deps.providers.cleanupUnstagedKey = (_target, _version, allowWrite) => {
    dispatched = allowWrite;
    throw new CredentialProviderError(
      "credential_key_cleanup_status_unconfirmed",
      true,
    );
  };
  const response = await h.call("system.credentials.provider.reconcile", {
    rotation_id: ROTATION,
    acknowledge_provider_has_no_cas: true,
  });
  eq(response.status, 502);
  eq(dispatched, false);
  eq(h.receipts.at(-1).outcome, "unknown");
});
