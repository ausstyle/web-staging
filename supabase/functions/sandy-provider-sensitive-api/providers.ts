import { type Contract, type Obj, sensitiveContracts } from "./contracts.ts";
import { sensitiveExecutionScope } from "./scope.ts";
import { SensitiveCalls } from "./transport.ts";
import {
  argumentDigest,
  bytesDigest,
  type Context,
  decode64,
  type Dependencies,
  encode64,
  fail,
  json,
  object,
  type OpaqueSave,
  Refusal,
  validate,
} from "../sandy-provider-supplement-api/runtime.ts";
const project = "projects/elaborate-haven-511518-a5/locations/europe-west1/";
const key = new RegExp(
  `^${project}keyRings/[A-Za-z0-9_-]{1,200}/cryptoKeys/[A-Za-z0-9_-]{1,200}(?:/cryptoKeyVersions/[0-9]{1,20})?$`,
);
const version = new RegExp(
  `^${project}keyRings/[A-Za-z0-9_-]{1,200}/cryptoKeys/[A-Za-z0-9_-]{1,200}/cryptoKeyVersions/[0-9]{1,20}$`,
);
const table = Uint32Array.from({ length: 256 }, (_, i) => {
  let v = i;
  for (let bit = 0; bit < 8; bit++) v = (v >>> 1) ^ (v & 1 ? 0x82f63b78 : 0);
  return v >>> 0;
});
export function crc32c(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ table[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
function responseBytes(value: unknown, max = 65536): Uint8Array {
  try {
    return decode64(value, max);
  } catch {
    return fail("provider_private_response_encoding_invalid", 502);
  }
}
function binaryFields(value: Obj): Record<string, Uint8Array> {
  const result: Record<string, Uint8Array> = {};
  for (
    const name of [
      "plaintext",
      "ciphertext",
      "additionalAuthenticatedData",
      "initializationVector",
      "data",
      "mac",
      "wrappedKey",
    ]
  ) {
    if (value[name] !== undefined) result[name] = decode64(value[name], 65536);
  }
  if (value.digest !== undefined) {
    if (!object(value.digest)) fail("invalid_crypto_digest", 400);
    const keys = Object.keys(value.digest);
    if (
      keys.length !== 1 || !["sha256", "sha384", "sha512"].includes(keys[0])
    ) fail("invalid_crypto_digest", 400);
    const bytes = decode64(value.digest[keys[0]], 64);
    if (bytes.length !== ({ sha256: 32, sha384: 48, sha512: 64 }[keys[0]])) {
      fail("invalid_crypto_digest_length", 400);
    }
    result.digest = bytes;
  }
  return result;
}
function bodyFor(
  op: Contract,
  args: Obj,
  now: number,
): { body: Obj; checks: Record<string, Uint8Array> } {
  const body = structuredClone(object(args.body) ? args.body : {});
  if (
    op.kind === "asymmetricSign" &&
    (body.data === undefined) === (body.digest === undefined)
  ) fail("exactly_one_crypto_data_or_digest_required", 400);
  for (const name of ["importingKey", "cryptoKeyVersion"]) {
    if (
      body[name] !== undefined &&
      (typeof body[name] !== "string" || !key.test(body[name]))
    ) fail("crypto_secondary_resource_scope_refused", 403);
  }
  if (
    typeof body.cryptoKeyVersion === "string" &&
    !body.cryptoKeyVersion.startsWith(
      String(args.resource) + "/cryptoKeyVersions/",
    )
  ) fail("crypto_import_target_scope_refused", 403);
  if (op.kind === "getVerificationCode") {
    const maximum = now + 5 * 60000;
    if (body.expireTime === undefined) {
      body.expireTime = new Date(maximum).toISOString();
    }
    if (
      typeof body.expireTime !== "string" ||
      !Number.isFinite(Date.parse(body.expireTime)) ||
      Date.parse(body.expireTime) <= now ||
      Date.parse(body.expireTime) > maximum
    ) fail("verification_code_short_lived_expiry_required", 400);
  }
  const checks = op.service === "cloudkms" ? binaryFields(body) : {};
  for (const field of op.provider_request_crc_fields) {
    const source = field.slice(0, -6);
    if (checks[source]) body[field] = String(crc32c(checks[source]));
  }
  return { body, checks };
}
function verifyResponse(
  op: Contract,
  value: Obj,
  args: Obj,
  checks: Record<string, Uint8Array>,
  now: number,
): void {
  if (!validate(op.provider_response_schema, value)) {
    fail("provider_private_response_contract_mismatch", 502);
  }
  const required: Record<string, string[]> = {
    getScreenshot: ["contents"],
    getJwks: ["keys"],
    getVerificationCode: ["code", "expireTime"],
    asymmetricDecrypt: ["plaintext", "plaintextCrc32c"],
    asymmetricSign: ["name", "signature", "signatureCrc32c"],
    decapsulate: ["name", "sharedSecret", "sharedSecretCrc32c"],
    exportTrustedKeyWrappedCryptoKeyVersion: ["wrappedKey", "wrappedKeyCrc32c"],
    importTrustedKeyWrappedCryptoKeyVersion: ["name", "state"],
    macSign: ["name", "mac", "macCrc32c"],
    macVerify: ["name", "success", "verifiedSuccessIntegrity"],
    rawDecrypt: ["plaintext", "plaintextCrc32c"],
    rawEncrypt: ["name", "ciphertext", "ciphertextCrc32c"],
    decrypt: ["plaintext", "plaintextCrc32c"],
    encrypt: ["name", "ciphertext", "ciphertextCrc32c"],
    getPublicKey: ["name"],
    fetchAccessToken: ["token", "expireTime"],
  };
  if ((required[op.kind] ?? []).some((name) => value[name] === undefined)) {
    fail("provider_private_response_fields_missing", 502);
  }
  if (op.kind === "getPublicKey") {
    const pem = typeof value.pem === "string" && value.pem.trim().length > 0;
    const encoded = object(value.publicKey) &&
      typeof value.publicKey.data === "string" &&
      value.publicKey.data.length > 0 &&
      value.publicKey.crc32cChecksum !== undefined;
    if (!pem && !encoded) fail("provider_private_response_fields_missing", 502);
    if (value.pem !== undefined && !pem) {
      fail("provider_private_response_fields_missing", 502);
    }
  }
  if (
    op.kind === "getShieldedInstanceIdentity" &&
    ![
      "encryptionKey",
      "signingKey",
      "eccP256EncryptionKey",
      "eccP256SigningKey",
    ].some((name) => object(value[name]))
  ) {
    fail("provider_private_response_fields_missing", 502);
  }
  if (op.kind === "getScreenshot") {
    const image = responseBytes(value.contents, 786432);
    if (!image.length) fail("provider_screenshot_empty", 502);
  }
  if (["getVerificationCode", "fetchAccessToken"].includes(op.kind)) {
    const material = op.kind === "getVerificationCode"
      ? value.code
      : value.token;
    if (
      typeof material !== "string" || !material.length ||
      typeof value.expireTime !== "string" ||
      !Number.isFinite(Date.parse(value.expireTime)) ||
      Date.parse(value.expireTime) <= now ||
      op.kind === "getVerificationCode" &&
        Date.parse(value.expireTime) > now + 5 * 60000
    ) fail("provider_private_credential_expiry_invalid", 502);
  }
  if (op.service === "cloudkms") {
    if (
      value.name !== undefined &&
      (typeof value.name !== "string" || !key.test(value.name) ||
        (String(args.resource).includes("/cryptoKeyVersions/")
          ? value.name !== args.resource
          : value.name !== args.resource &&
            !value.name.startsWith(
              String(args.resource) + "/cryptoKeyVersions/",
            )))
    ) fail("crypto_response_key_identity_mismatch", 502);
    for (const field of op.provider_response_crc_fields) {
      const source = field.slice(0, -6);
      if (value[source] === undefined) continue;
      const bytes = source === "pem"
        ? new TextEncoder().encode(String(value[source]))
        : responseBytes(value[source]);
      if (
        value[field] === undefined ||
        String(value[field]) !== String(crc32c(bytes))
      ) fail("crypto_response_integrity_failed", 502);
    }
    for (const source of Object.keys(checks)) {
      const field = "verified" + source[0].toUpperCase() + source.slice(1) +
        "Crc32c";
      if (
        op.provider_response_verified_fields.includes(field) &&
        value[field] !== true
      ) fail("crypto_request_integrity_not_verified", 502);
    }
    if (
      op.kind === "macVerify" &&
      (value.verifiedSuccessIntegrity !== true ||
        typeof value.success !== "boolean")
    ) fail("crypto_mac_verification_integrity_failed", 502);
    if (object(value.publicKey) && value.publicKey.data !== undefined) {
      if (
        String(value.publicKey.crc32cChecksum) !==
          String(crc32c(responseBytes(value.publicKey.data)))
      ) fail("crypto_public_key_integrity_failed", 502);
    }
  }
}
export async function execute(
  baseOp: Contract,
  args: Obj,
  calls: SensitiveCalls,
  deps: Dependencies,
  context: Context,
  admission: string,
): Promise<Obj> {
  const op = sensitiveContracts[baseOp.operation] ??
    fail("operation_not_implemented", 404);
  const resource = String(args.resource);
  const path = op.path.replace(
    `{+${op.resource_parameter}}`,
    resource.split("/").map(encodeURIComponent).join("/"),
  )
    .replace(`{${op.resource_parameter}}`, encodeURIComponent(resource));
  if (/[{}]/.test(path)) fail("private_provider_path_unbound", 403);
  const url = new URL(op.host + path),
    query = object(args.query) ? args.query : {};
  for (const [name, value] of Object.entries(query)) {
    if (
      name === "wrappingKey" &&
      (typeof value !== "string" || !version.test(value))
    ) fail("crypto_wrapping_key_scope_refused", 403);
    url.searchParams.set(name, String(value));
  }
  const { body, checks } = bodyFor(op, args, (deps.now ?? Date.now)());
  const reply = await calls.request(
    url,
    op.method,
    op.method === "GET" ? undefined : JSON.stringify(body),
    op.method === "GET" ? undefined : "application/json",
    [200, 201],
  );
  const value = json(reply);
  verifyResponse(op, value, args, checks, (deps.now ?? Date.now)());
  const binding: OpaqueSave = {
    actor: context.actor_id,
    admission,
    operation: op.operation,
    kind: "artifact",
    scope_sha256: await argumentDigest(sensitiveExecutionScope(op.operation)),
    input_sha256: await argumentDigest(args),
    binding_sha256: await argumentDigest({
      resource: args.resource,
      source_sha256: op.source_sha256,
      query,
    }),
    target: url.toString(),
    payload_base64: encode64(reply.bytes),
    payload_sha256: reply.sha256,
    byte_length: reply.bytes.length,
    media_type: "application/json",
  };
  const receipt = await deps.saveOpaque(binding);
  if (
    receipt.sha256 !== reply.sha256 ||
    receipt.byte_length !== reply.bytes.length ||
    receipt.media_type !== "application/json" ||
    !Number.isFinite(Date.parse(receipt.expires_at)) ||
    Date.parse(receipt.expires_at) <= (deps.now ?? Date.now)() ||
    Date.parse(receipt.expires_at) > (deps.now ?? Date.now)() + 11 * 60000
  ) {
    throw new Refusal(
      "private_response_custody_receipt_invalid",
      503,
      reply.status,
      reply.id,
      calls.mutationDispatched,
    );
  }
  return {
    ...receipt,
    content_returned: false,
    transfer_state: "captured_private",
  };
}
