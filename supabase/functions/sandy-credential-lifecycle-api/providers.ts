/** Fixed credential administration; no customer JWT, caller URL, host or token. */
import sodiumImport from "npm:libsodium-wrappers-sumo@0.7.15";
import { machineScope } from "../_shared/sandy_machine_identity.ts";
import {
  ConsumerCredentialError,
  exchangeCustodiedServiceAccountKey,
} from "../_shared/sandy_credential_consumer.ts";
import { credentialHmac } from "../sandy-credential-probe-api/index.ts";
export {
  CredentialProviderError,
  GCP_PROJECT,
  type Material,
  PROJECT,
  type ProviderCredentials,
  REPOSITORY,
  type Rotation,
  type Target,
} from "./types.ts";
import {
  CredentialProviderError,
  GCP_PROJECT,
  type Material,
  PROJECT,
  type ProviderCredentials,
  REPOSITORY,
  type Rotation,
  type Target,
} from "./types.ts";
import { gcpKey, gcpSecret, keyCredential, secretName } from "./scope.ts";
export { validateTarget } from "./scope.ts";
const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const base64 = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes));
const bytes64 = (value: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
function crc32c(bytes: Uint8Array): string {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0x82f63b78 : 0);
    }
  }
  return String((crc ^ 0xffffffff) >>> 0);
}
export function createCredentialProviders(credentials: ProviderCredentials) {
  const fetcher = credentials.fetch ?? fetch;
  const credential = (value: string | (() => Promise<string>)) =>
    typeof value === "string" ? Promise.resolve(value) : value();
  async function request(
    url: string,
    method: string,
    token: string,
    body?: unknown,
    mutation = false,
  ): Promise<{ status: number; value: any }> {
    if (
      !/^https:\/\/(?:api\.supabase\.com|api\.github\.com|secretmanager\.googleapis\.com|iam\.googleapis\.com|oauth2\.googleapis\.com|cloudresourcemanager\.googleapis\.com|zmqlyygzqoidkcwdysok\.supabase\.co)\//
        .test(url)
    ) throw new CredentialProviderError("credential_provider_host_refused");
    if (!token && !url.startsWith("https://oauth2.googleapis.com/")) {
      throw new CredentialProviderError("provider_credential_unavailable");
    }
    let response: Response;
    let text: string;
    try {
      response = await fetcher(url, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(22000),
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          accept: "application/json",
          ...(body !== undefined
            ? {
              "content-type": body instanceof URLSearchParams
                ? "application/x-www-form-urlencoded"
                : "application/json",
            }
            : {}),
          ...(url.startsWith("https://api.github.com/")
            ? { "x-github-api-version": "2022-11-28" }
            : {}),
        },
        ...(body !== undefined
          ? {
            body: body instanceof URLSearchParams ? body : JSON.stringify(body),
          }
          : {}),
      });
      if (Number(response.headers.get("content-length")) > 2097152) {
        throw new Error("bounded");
      }
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let count = 0;
      if (reader) {
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            count += part.value.byteLength;
            if (count > 2097152) {
              await reader.cancel();
              throw new Error("bounded");
            }
            chunks.push(part.value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      const data = new Uint8Array(count);
      let offset = 0;
      for (const part of chunks) {
        data.set(part, offset);
        offset += part.length;
      }
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        data,
      );
    } catch {
      throw new CredentialProviderError(
        "credential_provider_response_unavailable",
        mutation,
      );
    }
    if (!response.ok) {
      throw new CredentialProviderError(
        response.status === 401 || response.status === 403
          ? "credential_provider_authorization_refused"
          : response.status === 429
          ? "credential_provider_rate_limited"
          : "credential_provider_request_failed",
        mutation && response.status >= 500,
        response.status,
      );
    }
    try {
      return { status: response.status, value: text ? JSON.parse(text) : null };
    } catch {
      throw new CredentialProviderError(
        "credential_provider_contract_mismatch",
        mutation,
        response.status,
      );
    }
  }
  async function secretAccess(
    target: Target,
    version: string,
    expected?: string,
  ): Promise<{ value: string; version: string }> {
    const prefix = gcpSecret(target) + "/versions/";
    version = version.replace(
      /^projects\/1030223524306\//,
      `projects/${GCP_PROJECT}/`,
    );
    if (
      !version.startsWith(prefix) ||
      !/^[-A-Za-z0-9_]+$/.test(version.slice(prefix.length))
    ) throw new CredentialProviderError("credential_version_scope_mismatch");
    const raw = (await request(
      `https://secretmanager.googleapis.com/v1/${version}:access`,
      "GET",
      await credentials.gcp(),
    )).value;
    if (object(raw) && typeof raw.name === "string") {
      raw.name = raw.name.replace(
        /^projects\/1030223524306\//,
        `projects/${GCP_PROJECT}/`,
      );
    }
    if (
      !object(raw) || typeof raw.name !== "string" ||
      !raw.name.startsWith(prefix) ||
      !/^\d+$/.test(raw.name.slice(prefix.length)) || !object(raw.payload) ||
      typeof raw.payload.data !== "string" || raw.payload.data.length > 90000
    ) {
      throw new CredentialProviderError(
        "credential_provider_contract_mismatch",
      );
    }
    const data = bytes64(raw.payload.data);
    if (
      data.length > 65536 || String(raw.payload.dataCrc32c) !== crc32c(data)
    ) {
      throw new CredentialProviderError(
        "credential_provider_integrity_failed",
      );
    }
    if (expected && await digest(data) !== expected) {
      throw new CredentialProviderError("credential_provider_value_mismatch");
    }
    try {
      return {
        value: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
          .decode(data),
        version: raw.name,
      };
    } catch {
      throw new CredentialProviderError("credential_text_encoding_required");
    }
  }
  async function hiddenMetadata(target: Target): Promise<string> {
    if (target.provider === "github_actions_secret") {
      const value = (await request(
        `https://api.github.com/repos/${REPOSITORY}/actions/secrets/${
          encodeURIComponent(secretName(target))
        }`,
        "GET",
        await credential(credentials.github),
      )).value;
      if (
        !object(value) || value.name !== secretName(target) ||
        typeof value.updated_at !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(
          value.updated_at,
        )
      ) {
        throw new CredentialProviderError(
          "credential_provider_contract_mismatch",
        );
      }
      return value.updated_at;
    }
    const value = (await request(
      `https://api.supabase.com/v1/projects/${PROJECT}/secrets`,
      "GET",
      await credential(credentials.management),
    )).value;
    if (!Array.isArray(value)) {
      throw new CredentialProviderError(
        "credential_provider_contract_mismatch",
      );
    }
    const found = value.find((v) => object(v) && v.name === secretName(target));
    if (
      !found || typeof found.digest !== "string" ||
      !/^[a-f0-9]{64}$/.test(found.digest)
    ) {
      throw new CredentialProviderError("credential_provider_secret_not_found");
    }
    return found.digest;
  }
  async function keyAccessToken(
    target: Target,
    value: string,
    providerVersion: string | null,
  ): Promise<{ token: string; version: string }> {
    const credential = keyCredential(target, value);
    const version =
      `projects/${GCP_PROJECT}/serviceAccounts/${machineScope.service_account}/keys/${credential.private_key_id}`;
    if (providerVersion && gcpKey(target, providerVersion) !== version) {
      throw new CredentialProviderError("credential_key_identity_mismatch");
    }
    gcpKey(target, version);
    try {
      return {
        token: await exchangeCustodiedServiceAccountKey(
          target,
          value,
          version,
          fetcher,
        ),
        version,
      };
    } catch (error) {
      if (error instanceof ConsumerCredentialError) {
        throw new CredentialProviderError(
          error.providerHttpStatus === 401 || error.providerHttpStatus === 403
            ? "credential_provider_authorization_refused"
            : error.providerHttpStatus
            ? "credential_provider_request_failed"
            : "credential_key_exchange_unavailable",
          false,
          error.providerHttpStatus,
        );
      }
      throw new CredentialProviderError("credential_key_exchange_unavailable");
    }
  }
  async function verifyKey(
    target: Target,
    value: string,
    providerVersion: string | null,
  ): Promise<string> {
    const authenticated = await keyAccessToken(target, value, providerVersion);
    const project = (await request(
      `https://cloudresourcemanager.googleapis.com/v3/projects/${GCP_PROJECT}`,
      "GET",
      authenticated.token,
    )).value;
    if (
      !object(project) || project.projectId !== GCP_PROJECT ||
      ![`projects/${GCP_PROJECT}`, "projects/1030223524306"].includes(
        project.name,
      )
    ) {
      throw new CredentialProviderError(
        "credential_provider_project_readback_failed",
      );
    }
    return authenticated.version;
  }
  async function dispatchProbe(
    target: Target,
    rotation: Rotation,
  ): Promise<void> {
    if (target.provider !== "github_actions_secret") return;
    await request(
      `https://api.github.com/repos/${REPOSITORY}/actions/workflows/${target.resource.workflow_id}/dispatches`,
      "POST",
      await credential(credentials.github),
      {
        ref: target.resource.workflow_ref,
        inputs: {
          rotation_id: rotation.id,
          challenge: rotation.probe_challenge,
        },
      },
      true,
    );
  }
  async function verify(
    target: Target,
    rotation: Rotation,
    material: Material,
  ): Promise<{ provider_version_id: string; probe_kind: string }> {
    if (target.provider === "gcp_secret") {
      const version = material.provider_version_id ??
        gcpSecret(target) + "/versions/latest";
      const read = await secretAccess(
        target,
        version,
        material.material_sha256,
      );
      const latest = await secretAccess(
        target,
        gcpSecret(target) + "/versions/latest",
        material.material_sha256,
      );
      if (read.version !== latest.version) {
        throw new CredentialProviderError("credential_default_version_changed");
      }
      return {
        provider_version_id: read.version,
        probe_kind: "secret_manager_access_crc32c_and_latest",
      };
    }
    if (target.provider === "gcp_service_account_key") {
      return {
        provider_version_id: await verifyKey(
          target,
          material.value,
          material.provider_version_id,
        ),
        probe_kind: "new_key_oauth_and_fixed_project_read",
      };
    }
    const expected = await credentialHmac(
      material.value,
      rotation.id,
      rotation.probe_challenge,
    );
    if (target.provider === "supabase_edge_secret") {
      const value = (await request(
        `https://${PROJECT}.supabase.co/functions/v1/sandy-credential-probe-api`,
        "POST",
        credentials.service,
        {
          target_id: target.id,
          rotation_id: rotation.id,
          challenge: rotation.probe_challenge,
        },
      )).value;
      if (
        !object(value) || value.ok !== true || value.target_id !== target.id ||
        value.rotation_id !== rotation.id ||
        value.challenge !== rotation.probe_challenge ||
        value.secret_name !== secretName(target) ||
        value.hmac_sha256 !== expected
      ) {
        throw new CredentialProviderError(
          "credential_consumer_readback_failed",
        );
      }
    } else {
      const runs = (await request(
        `https://api.github.com/repos/${REPOSITORY}/actions/workflows/${target.resource.workflow_id}/runs?event=workflow_dispatch&per_page=100`,
        "GET",
        await credential(credentials.github),
      )).value;
      const matches = object(runs) && Array.isArray(runs.workflow_runs)
        ? runs.workflow_runs.filter((run: any) =>
          object(run) &&
          run.display_title === `sandy-credential-fixture-${rotation.id}` &&
          run.head_sha === target.resource.workflow_head_sha &&
          run.event === "workflow_dispatch"
        )
        : [];
      if (matches.length !== 1 || matches[0].status !== "completed") {
        throw new CredentialProviderError("credential_consumer_probe_pending");
      }
      const run = matches[0];
      if (run.conclusion !== "success" || !Number.isSafeInteger(run.id)) {
        throw new CredentialProviderError("credential_consumer_probe_failed");
      }
      const jobs = (await request(
        `https://api.github.com/repos/${REPOSITORY}/actions/runs/${run.id}/jobs?per_page=100`,
        "GET",
        await credential(credentials.github),
      )).value;
      const valid = object(jobs) && Array.isArray(jobs.jobs) &&
        jobs.jobs.some((job: any) =>
          object(job) && job.conclusion === "success" &&
          Array.isArray(job.steps) && job.steps.some((step: any) =>
            object(step) &&
            step.name === `sandy-secret-${secretName(target)}` &&
            step.conclusion === "success"
          ) && job.steps.some((step: any) =>
            object(step) && step.name === `sandy-proof-${expected}` &&
            step.conclusion === "success"
          )
        );
      if (!valid) {
        throw new CredentialProviderError(
          "credential_consumer_readback_failed",
        );
      }
    }
    const version = await hiddenMetadata(target);
    if (
      material.provider_version_id && version !== material.provider_version_id
    ) throw new CredentialProviderError("credential_provider_preimage_changed");
    return {
      provider_version_id: version,
      probe_kind: target.provider === "github_actions_secret"
        ? "pinned_workflow_hmac_consumer_readback"
        : "fixed_edge_hmac_consumer_readback",
    };
  }
  async function addSecretVersion(
    target: Target,
    source: Material,
  ): Promise<{ value: string; provider_version_id: string }> {
    const data = new TextEncoder().encode(source.value);
    const raw = (await request(
      `https://secretmanager.googleapis.com/v1/${gcpSecret(target)}:addVersion`,
      "POST",
      await credentials.gcp(),
      { payload: { data: base64(data), dataCrc32c: crc32c(data) } },
      true,
    )).value;
    if (object(raw) && typeof raw.name === "string") {
      raw.name = raw.name.replace(
        /^projects\/1030223524306\//,
        `projects/${GCP_PROJECT}/`,
      );
    }
    if (
      !object(raw) || typeof raw.name !== "string" ||
      !raw.name.startsWith(gcpSecret(target) + "/versions/") ||
      !/^\d+$/.test(raw.name.split("/").pop()!)
    ) {
      throw new CredentialProviderError(
        "credential_provider_contract_mismatch",
        true,
      );
    }
    return { value: source.value, provider_version_id: raw.name };
  }
  async function createFirstVersion(
    target: Target,
    source: Material,
  ): Promise<{ value: string; provider_version_id: string }> {
    const metadata = (await request(
      `https://secretmanager.googleapis.com/v1/${
        gcpSecret(target)
      }/versions?pageSize=1`,
      "GET",
      await credentials.gcp(),
    )).value;
    if (
      !object(metadata) ||
      (metadata.versions !== undefined &&
        (!Array.isArray(metadata.versions) || metadata.versions.length)) ||
      metadata.nextPageToken
    ) throw new CredentialProviderError("verified_custodied_preimage_required");
    return await addSecretVersion(target, source);
  }
  async function rotate(
    target: Target,
    rotation: Rotation,
    source: Material,
    prior: Material | null,
  ): Promise<{ value: string; provider_version_id: string }> {
    if (!prior) {
      throw new CredentialProviderError("verified_custodied_preimage_required");
    }
    if (target.provider === "gcp_service_account_key") {
      await verifyKey(target, prior.value, prior.provider_version_id);
      const raw = (await request(
        `https://iam.googleapis.com/v1/projects/${GCP_PROJECT}/serviceAccounts/${machineScope.service_account}/keys`,
        "POST",
        await credentials.gcp(),
        {
          privateKeyType: "TYPE_GOOGLE_CREDENTIALS_FILE",
          keyAlgorithm: "KEY_ALG_RSA_2048",
        },
        true,
      )).value;
      if (
        !object(raw) || typeof raw.privateKeyData !== "string" ||
        typeof raw.name !== "string"
      ) {
        throw new CredentialProviderError(
          "credential_provider_contract_mismatch",
          true,
        );
      }
      try {
        gcpKey(target, raw.name);
      } catch {
        throw new CredentialProviderError(
          "credential_key_identity_mismatch",
          true,
        );
      }
      let value: string;
      try {
        value = new TextDecoder("utf-8", { fatal: true }).decode(
          bytes64(raw.privateKeyData),
        );
      } catch {
        throw new CredentialProviderError(
          "credential_provider_contract_mismatch",
          true,
        );
      }
      let credential: Record<string, string>;
      try {
        credential = keyCredential(target, value);
      } catch {
        throw new CredentialProviderError(
          "credential_key_identity_mismatch",
          true,
        );
      }
      const version =
        `projects/${GCP_PROJECT}/serviceAccounts/${machineScope.service_account}/keys/${credential.private_key_id}`;
      if (
        gcpKey(target, raw.name) !== version
      ) {
        throw new CredentialProviderError(
          "credential_key_identity_mismatch",
          true,
        );
      }
      if (
        prior.provider_version_id &&
        gcpKey(target, prior.provider_version_id) === version
      ) {
        throw new CredentialProviderError(
          "credential_new_key_not_distinct",
          true,
        );
      }
      return { value, provider_version_id: version };
    }
    if (target.provider === "gcp_secret") {
      const old = await secretAccess(
        target,
        gcpSecret(target) + "/versions/latest",
        prior.material_sha256,
      );
      if (
        prior.provider_version_id && old.version !== prior.provider_version_id
      ) {
        throw new CredentialProviderError(
          "credential_provider_preimage_changed",
        );
      }
      return await addSecretVersion(target, source);
    }
    const current = await hiddenMetadata(target);
    if (!prior.provider_version_id || current !== prior.provider_version_id) {
      throw new CredentialProviderError("credential_provider_preimage_changed");
    }
    if (target.provider === "supabase_edge_secret") {
      await request(
        `https://api.supabase.com/v1/projects/${PROJECT}/secrets`,
        "POST",
        await credential(credentials.management),
        [{ name: secretName(target), value: source.value }],
        true,
      );
    } else {
      const key = (await request(
        `https://api.github.com/repos/${REPOSITORY}/actions/secrets/public-key`,
        "GET",
        await credential(credentials.github),
      )).value;
      if (
        !object(key) || typeof key.key !== "string" ||
        typeof key.key_id !== "string"
      ) {
        throw new CredentialProviderError(
          "credential_provider_contract_mismatch",
        );
      }
      const sodium = sodiumImport as any;
      await sodium.ready;
      const publicKey = sodium.from_base64(
        key.key,
        sodium.base64_variants.ORIGINAL,
      );
      if (publicKey.length !== 32) {
        throw new CredentialProviderError(
          "credential_provider_contract_mismatch",
        );
      }
      const encrypted = sodium.to_base64(
        sodium.crypto_box_seal(
          new TextEncoder().encode(source.value),
          publicKey,
        ),
        sodium.base64_variants.ORIGINAL,
      );
      await request(
        `https://api.github.com/repos/${REPOSITORY}/actions/secrets/${
          encodeURIComponent(secretName(target))
        }`,
        "PUT",
        await credential(credentials.github),
        { encrypted_value: encrypted, key_id: key.key_id },
        true,
      );
    }
    try {
      return {
        value: source.value,
        provider_version_id: await hiddenMetadata(target),
      };
    } catch {
      throw new CredentialProviderError(
        "credential_provider_metadata_readback_failed",
        true,
      );
    }
  }
  async function restoreKey(
    target: Target,
    material: Material,
  ): Promise<{ value: string; provider_version_id: string }> {
    return {
      value: material.value,
      provider_version_id: await verifyKey(
        target,
        material.value,
        material.provider_version_id,
      ),
    };
  }
  async function revoke(target: Target, material: Material): Promise<void> {
    if (!material.provider_version_id) {
      throw new CredentialProviderError("retained_provider_version_required");
    }
    if (!["gcp_service_account_key", "gcp_secret"].includes(target.provider)) {
      throw new CredentialProviderError(
        "provider_credential_issuer_revoke_required",
      );
    }
    const token = await credentials.gcp();
    if (target.provider === "gcp_service_account_key") {
      const version = gcpKey(target, material.provider_version_id);
      const metadata = (await request(
        `https://iam.googleapis.com/v1/${version}`,
        "GET",
        token,
      )).value;
      if (
        !object(metadata) || typeof metadata.name !== "string" ||
        gcpKey(target, metadata.name) !== version
      ) {
        throw new CredentialProviderError(
          "credential_provider_contract_mismatch",
        );
      }
      if (metadata.disabled !== true) {
        await request(
          `https://iam.googleapis.com/v1/${version}:disable`,
          "POST",
          token,
          {},
          true,
        );
      }
      const observed = (await request(
        `https://iam.googleapis.com/v1/${version}`,
        "GET",
        token,
      )).value;
      if (
        !object(observed) || typeof observed.name !== "string" ||
        gcpKey(target, observed.name) !== version || observed.disabled !== true
      ) {
        throw new CredentialProviderError(
          "credential_key_disable_readback_failed",
          true,
        );
      }
      let issuanceRejected = false;
      try {
        await keyAccessToken(
          target,
          material.value,
          material.provider_version_id,
        );
      } catch (error) {
        if (
          error instanceof CredentialProviderError &&
          [400, 401, 403].includes(error.status ?? 0)
        ) issuanceRejected = true;
        else throw error;
      }
      if (!issuanceRejected) {
        throw new CredentialProviderError(
          "credential_key_disable_not_effective",
          true,
        );
      }
      return;
    }
    if (target.provider === "gcp_secret") {
      const prefix = gcpSecret(target) + "/versions/";
      const version = material.provider_version_id;
      if (
        !version.startsWith(prefix) ||
        !/^\d+$/.test(version.slice(prefix.length))
      ) throw new CredentialProviderError("credential_version_scope_mismatch");
      const metadata = (await request(
        `https://secretmanager.googleapis.com/v1/${version}`,
        "GET",
        token,
      )).value;
      if (
        !object(metadata) || typeof metadata.name !== "string" ||
        metadata.name.replace(
            /^projects\/1030223524306\//,
            `projects/${GCP_PROJECT}/`,
          ) !== version
      ) {
        throw new CredentialProviderError(
          "credential_provider_contract_mismatch",
        );
      }
      if (metadata.state !== "DISABLED") {
        await request(
          `https://secretmanager.googleapis.com/v1/${version}:disable`,
          "POST",
          token,
          { etag: metadata.etag },
          true,
        );
      }
      const observed = (await request(
        `https://secretmanager.googleapis.com/v1/${version}`,
        "GET",
        token,
      )).value;
      if (
        !object(observed) || typeof observed.name !== "string" ||
        observed.name.replace(
            /^projects\/1030223524306\//,
            `projects/${GCP_PROJECT}/`,
          ) !== version ||
        observed.state !== "DISABLED"
      ) {
        throw new CredentialProviderError(
          "credential_version_disable_readback_failed",
          true,
        );
      }
      let accessRejected = false;
      try {
        await secretAccess(target, version);
      } catch (error) {
        if (
          error instanceof CredentialProviderError &&
          [400, 401, 403].includes(error.status ?? 0)
        ) accessRejected = true;
        else throw error;
      }
      if (!accessRejected) {
        throw new CredentialProviderError(
          "credential_version_disable_not_effective",
          true,
        );
      }
      return;
    }
    throw new CredentialProviderError(
      "provider_credential_issuer_revoke_required",
    );
  }
  async function cleanupUnstagedKey(
    target: Target,
    providerVersion: string,
    allowWrite = false,
  ): Promise<void> {
    const version = gcpKey(target, providerVersion);
    const before = (await request(
      `https://iam.googleapis.com/v1/${version}`,
      "GET",
      await credentials.gcp(),
    )).value;
    if (
      !object(before) || typeof before.name !== "string" ||
      gcpKey(target, before.name) !== version
    ) {
      throw new CredentialProviderError(
        "credential_key_cleanup_unconfirmed",
        true,
      );
    }
    if (before.disabled === true) return;
    if (!allowWrite) {
      throw new CredentialProviderError(
        "credential_key_cleanup_status_unconfirmed",
        true,
      );
    }
    await request(
      `https://iam.googleapis.com/v1/${providerVersion}:disable`,
      "POST",
      await credentials.gcp(),
      {},
      true,
    );
    const result = (await request(
      `https://iam.googleapis.com/v1/${providerVersion}`,
      "GET",
      await credentials.gcp(),
    )).value;
    if (
      !object(result) || typeof result.name !== "string" ||
      gcpKey(target, result.name) !== gcpKey(target, providerVersion) ||
      result.disabled !== true
    ) {
      throw new CredentialProviderError(
        "credential_key_cleanup_unconfirmed",
        true,
      );
    }
  }
  return {
    verify,
    rotate,
    dispatchProbe,
    hiddenMetadata,
    secretAccess,
    restoreKey,
    revoke,
    cleanupUnstagedKey,
    createFirstVersion,
  };
}
