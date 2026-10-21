import assert from "node:assert/strict";
import { createSensitiveHandler, sensitiveContractEnabled } from "./index.ts";
import { type Contract, type Obj, sensitiveContracts } from "./contracts.ts";
import { crc32c } from "./providers.ts";
import {
  bytesDigest,
  type Dependencies,
  encode64,
  type OpaqueSave,
  validate,
} from "../sandy-provider-supplement-api/runtime.ts";
const actor = "11111111-1111-4111-8111-111111111111",
  admission = "22222222-2222-4222-8222-222222222222";
const custody = "33333333-3333-4333-8333-333333333333",
  now = Date.parse("2026-10-21T01:00:00Z");
const base = "projects/elaborate-haven-511518-a5/locations/europe-west1/";
const cryptoKey = base + "keyRings/fixture/cryptoKeys/fixture",
  keyVersion = cryptoKey + "/cryptoKeyVersions/1";
const bytes = new TextEncoder().encode(
    "SYNTHETIC-PRIVATE-NONCREDENTIAL-FIXTURE",
  ),
  encoded = encode64(bytes),
  crc = String(crc32c(bytes));
function argsFor(op: Contract): Obj {
  const resource = op.service === "compute"
    ? "fixture"
    : op.service === "container"
    ? base + "clusters/fixture"
    : op.service === "monitoring"
    ? "projects/elaborate-haven-511518-a5/notificationChannels/123"
    : op.service === "backupdr"
    ? base + "backupVaults/fixture/dataSources/fixture"
    : ["encrypt", "decrypt", "importTrustedKeyWrappedCryptoKeyVersion"]
        .includes(op.kind)
    ? cryptoKey
    : keyVersion;
  let body: Obj | undefined;
  if (["encrypt", "rawEncrypt"].includes(op.kind)) {
    body = { plaintext: encoded };
  }
  if (
    ["decrypt", "rawDecrypt", "asymmetricDecrypt", "decapsulate"].includes(
      op.kind,
    )
  ) body = { ciphertext: encoded };
  if (op.kind === "rawDecrypt") {
    body = { ...body, initializationVector: encoded, tagLength: 16 };
  }
  if (op.kind === "asymmetricSign" || op.kind === "macSign") {
    body = { data: encoded };
  }
  if (op.kind === "macVerify") body = { data: encoded, mac: encoded };
  if (op.kind === "getVerificationCode") body = {};
  if (op.kind === "fetchAccessToken") body = { generationId: 1 };
  if (op.kind === "importTrustedKeyWrappedCryptoKeyVersion") {
    body = {
      algorithm: "AES_256_KWP",
      importingKey: keyVersion,
      wrappedKey: encoded,
    };
  }
  return {
    resource,
    ...(body ? { body } : {}),
    ...(op.kind === "exportTrustedKeyWrappedCryptoKeyVersion"
      ? { query: { wrappingKey: keyVersion } }
      : {}),
  };
}
function valueFor(op: Contract): Obj {
  if (op.kind === "getGuestAttributes") {
    return {
      kind: "compute#guestAttributes",
      queryValue: {
        items: [{
          namespace: "fixture",
          key: "fixture",
          value: "PRIVATE_FIXTURE",
        }],
      },
    };
  }
  if (op.kind === "getScreenshot") {
    return {
      contents: encode64(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])),
      kind: "compute#screenshot",
    };
  }
  if (op.kind === "getShieldedInstanceIdentity") {
    return { signingKey: { ekPub: "PRIVATE_FIXTURE" } };
  }
  if (op.kind === "getJwks") {
    return {
      keys: [{
        kty: "RSA",
        alg: "RS256",
        use: "sig",
        kid: "fixture",
        n: encoded,
        e: "AQAB",
      }],
    };
  }
  if (op.kind === "getVerificationCode") {
    return {
      code: "PRIVATE_FIXTURE",
      expireTime: new Date(now + 60000).toISOString(),
    };
  }
  if (op.kind === "fetchAccessToken") {
    return {
      token: "SYNTHETIC-NOT-A-CREDENTIAL",
      expireTime: new Date(now + 60000).toISOString(),
      readLocation: "gs://fixture/private",
    };
  }
  if (["decrypt", "rawDecrypt", "asymmetricDecrypt"].includes(op.kind)) {
    return {
      plaintext: encoded,
      plaintextCrc32c: crc,
      verifiedCiphertextCrc32c: true,
      verifiedInitializationVectorCrc32c: true,
    };
  }
  if (["encrypt", "rawEncrypt"].includes(op.kind)) {
    return {
      name: keyVersion,
      ciphertext: encoded,
      ciphertextCrc32c: crc,
      verifiedPlaintextCrc32c: true,
    };
  }
  if (op.kind === "asymmetricSign") {
    return {
      name: keyVersion,
      signature: encoded,
      signatureCrc32c: crc,
      verifiedDataCrc32c: true,
    };
  }
  if (op.kind === "decapsulate") {
    return {
      name: keyVersion,
      sharedSecret: encoded,
      sharedSecretCrc32c: crc,
      verifiedCiphertextCrc32c: true,
    };
  }
  if (op.kind === "exportTrustedKeyWrappedCryptoKeyVersion") {
    return { wrappedKey: encoded, wrappedKeyCrc32c: crc };
  }
  if (op.kind === "importTrustedKeyWrappedCryptoKeyVersion") {
    return { name: keyVersion, state: "ENABLED" };
  }
  if (op.kind === "getPublicKey") {
    return {
      name: keyVersion,
      pem: "PRIVATE_FIXTURE",
      pemCrc32c: String(crc32c(new TextEncoder().encode("PRIVATE_FIXTURE"))),
    };
  }
  if (op.kind === "macSign") {
    return {
      name: keyVersion,
      mac: encoded,
      macCrc32c: crc,
      verifiedDataCrc32c: true,
    };
  }
  if (op.kind === "macVerify") {
    return {
      name: keyVersion,
      success: true,
      verifiedDataCrc32c: true,
      verifiedMacCrc32c: true,
      verifiedSuccessIntegrity: true,
    };
  }
  throw Error("fixture_missing");
}
function setup(
  transform: (value: Obj, op: Contract) => Obj = (value) => value,
) {
  const events: string[] = [],
    stored: OpaqueSave[] = [],
    outcomes: string[] = [],
    urls: string[] = [],
    requests: RequestInit[] = [];
  let current: Contract;
  const deps: Dependencies = {
    service: "private-fixture-service",
    now: () => now,
    authorizeContext: async () => {
      events.push("authorize");
      return { allowed: true };
    },
    consumeGrant: async () => {
      events.push("consume");
      return { allowed: true, admission_id: admission };
    },
    credentialForExecution: async () => {
      events.push("credential");
      return "fixture-token";
    },
    finishExecution: async (r) => {
      outcomes.push(r.outcome);
      return { allowed: true };
    },
    fetch: (url, init) => {
      urls.push(String(url));
      requests.push(init!);
      events.push("fetch");
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer fixture-token",
      );
      assert.equal(init?.redirect, "manual");
      return Promise.resolve(
        Response.json(transform(valueFor(current), current)),
      );
    },
    saveOpaque: async (payload) => {
      stored.push(payload);
      events.push("custody");
      return {
        custody_id: custody,
        byte_length: payload.byte_length,
        sha256: payload.payload_sha256,
        media_type: payload.media_type,
        expires_at: new Date(now + 5 * 60000).toISOString(),
      };
    },
    takeOpaque: async () => {
      throw Error("must not resolve prior contents");
    },
  };
  const handler = createSensitiveHandler(deps);
  const run = async (op: Contract, args = argsFor(op), extra: Obj = {}) => {
    current = op;
    const response = await handler(
      new Request("https://synthetic.invalid", {
        method: "POST",
        headers: {
          authorization: "Bearer private-fixture-service",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          operation: op.operation,
          arguments: args,
          actor_id: actor,
          tenant_id: null,
          request_id: crypto.randomUUID(),
          grant_id: crypto.randomUUID(),
          ...extra,
        }),
      }),
    );
    return { status: response.status, body: await response.json() };
  };
  return { deps, run, events, stored, outcomes, urls, requests };
}
Deno.test("sensitive: 18 pinned private protocols have executable input/output/provider validators", () => {
  assert.equal(Object.keys(sensitiveContracts).length, 18);
  for (const op of Object.values(sensitiveContracts)) {
    assert.equal(validate(op.input_schema, argsFor(op)), true, op.operation);
    assert.equal(
      validate(op.provider_response_schema, valueFor(op)),
      true,
      op.operation,
    );
    validate(op.output_schema, {});
    assert.equal(op.requires_approval, true);
    assert.equal(op.api_key_delegable, false);
  }
});
Deno.test("sensitive: every provider path executes only after consumed grant and captures complete JSON privately", async () => {
  for (const op of Object.values(sensitiveContracts)) {
    const f = setup(), result = await f.run(op);
    assert.equal(
      result.status,
      200,
      `${op.operation}: ${JSON.stringify(result)}`,
    );
    assert.equal(f.stored.length, 1);
    assert.equal(result.body.result.sha256, f.stored[0].payload_sha256);
    assert.equal(f.stored[0].input_sha256.length, 64);
    assert.equal(f.stored[0].kind, "artifact");
    assert.equal(f.stored[0].operation, op.operation);
    assert.deepEqual(f.events, [
      "authorize",
      "consume",
      "credential",
      "fetch",
      "custody",
    ]);
    assert.equal(f.outcomes[0], op.is_mutation ? "accepted" : "succeeded");
    assert(!JSON.stringify(result).includes("PRIVATE_FIXTURE"));
    assert(!JSON.stringify(result).includes(encoded));
    assert(!JSON.stringify(result).includes("NOT-A-CREDENTIAL"));
    assert(!JSON.stringify(result).includes("fixture-token"));
    assert(f.urls[0].startsWith(op.host + "/"));
    assert(!f.urls[0].includes("{"));
  }
});
Deno.test("sensitive: CRC32C standard vector and request checksums supplied by server, never caller", async () => {
  assert.equal(crc32c(new TextEncoder().encode("123456789")), 0xe3069283);
  for (const kind of ["encrypt", "asymmetricSign", "macVerify", "rawDecrypt"]) {
    const op = Object.values(sensitiveContracts).find((o) => o.kind === kind)!;
    const f = setup();
    assert.equal((await f.run(op)).status, 200);
    const body = JSON.parse(f.requests[0].body as string);
    const field = kind === "encrypt"
      ? "plaintextCrc32c"
      : kind === "asymmetricSign"
      ? "dataCrc32c"
      : kind === "macVerify"
      ? "macCrc32c"
      : "initializationVectorCrc32c";
    assert.equal(body[field], crc);
    const input = argsFor(op);
    assert.equal(
      (await f.run(op, {
        ...input,
        body: { ...(input.body as Obj), [field]: "0" },
      })).status,
      400,
    );
  }
});
Deno.test("sensitive: getPublicKey requires actual nonempty PEM or encoded key with a verified checksum", async () => {
  const op = Object.values(sensitiveContracts).find((o) =>
    o.kind === "getPublicKey"
  )!;
  for (
    const value of [
      { name: keyVersion, publicKey: {} },
      { name: keyVersion, publicKey: { data: encoded } },
      { name: keyVersion, publicKey: { data: "", crc32cChecksum: "0" } },
      { name: keyVersion, publicKey: { data: encoded, crc32cChecksum: "0" } },
      { name: keyVersion, pem: "", pemCrc32c: "0" },
      { name: keyVersion, pem: "PRIVATE_FIXTURE" },
    ]
  ) {
    const f = setup(() => value), result = await f.run(op);
    assert.equal(result.status, 502);
    assert.equal(f.stored.length, 0);
    assert.equal(f.urls.length, 1);
  }
  const f = setup(() => ({
    name: keyVersion,
    publicKey: { data: encoded, crc32cChecksum: crc },
  }));
  assert.equal((await f.run(op)).status, 200);
  assert.equal(f.stored.length, 1);
});
Deno.test("sensitive: checksum mismatch/missing verification/key substitution fail closed with no plaintext return/retry", async () => {
  for (
    const transform of [
      (v: Obj) => ({ ...v, ciphertextCrc32c: "0" }),
      (v: Obj) => ({ ...v, verifiedPlaintextCrc32c: false }),
      (v: Obj) => ({
        ...v,
        name:
          "projects/foreign/locations/europe-west1/keyRings/key/cryptoKeys/key/cryptoKeyVersions/1",
      }),
    ]
  ) {
    const op = Object.values(sensitiveContracts).find((o) =>
        o.kind === "encrypt"
      )!,
      f = setup(transform),
      result = await f.run(op);
    assert.equal(result.status, 503);
    assert.equal(result.body.executed, null);
    assert.equal(result.body.reconciliation_required, true);
    assert.equal(f.urls.length, 1);
    assert.equal(f.stored.length, 0);
    assert.equal(f.outcomes[0], "unknown");
    assert(!JSON.stringify(result).includes(encoded));
  }
});
Deno.test("sensitive: cross-project/region and secondary wrapping/import resource escape rejected before execution", async () => {
  const exported = Object.values(sensitiveContracts).find((o) =>
    o.kind === "exportTrustedKeyWrappedCryptoKeyVersion"
  )!;
  const f = setup();
  for (
    const input of [{
      ...argsFor(exported),
      resource: keyVersion.replace("elaborate-haven-511518-a5", "foreign"),
    }, {
      ...argsFor(exported),
      resource: keyVersion.replace("europe-west1", "foreign"),
    }, {
      ...argsFor(exported),
      query: {
        wrappingKey:
          "projects/foreign/locations/europe-west1/keyRings/key/cryptoKeys/key/cryptoKeyVersions/1",
      },
    }, { ...argsFor(exported), query: { url: "https://attacker.invalid" } }]
  ) {
    assert((await f.run(exported, input)).status >= 400);
    assert.equal(f.urls.length, 0);
  }
  const imported = Object.values(sensitiveContracts).find((o) =>
    o.kind === "importTrustedKeyWrappedCryptoKeyVersion"
  )!;
  const args = argsFor(imported);
  assert.equal(
    (await f.run(imported, {
      ...args,
      body: { ...(args.body as Obj), importingKey: "foreign" },
    })).status,
    403,
  );
  assert.equal(f.urls.length, 0);
});
Deno.test("sensitive: async key signing digest/data conflict, long-lived code expiry and delegated sessions refused", async () => {
  const op = Object.values(sensitiveContracts).find((o) =>
      o.kind === "asymmetricSign"
    )!,
    f = setup();
  assert.equal((await f.run(op, { ...argsFor(op), body: {} })).status, 400);
  assert.equal(
    (await f.run(op, {
      ...argsFor(op),
      body: { data: encoded, digest: { sha256: encode64(new Uint8Array(32)) } },
    })).status,
    400,
  );
  assert.equal(
    (await f.run(op, argsFor(op), { credential_id: custody })).status,
    400,
  );
  const code = Object.values(sensitiveContracts).find((o) =>
    o.kind === "getVerificationCode"
  )!;
  assert.equal(
    (await f.run(code, {
      ...argsFor(code),
      body: { expireTime: new Date(now + 3600000).toISOString() },
    })).status,
    400,
  );
  assert.equal(f.urls.length, 0);
});
Deno.test("sensitive: metadata drift cannot remove approval or allow customer keys; active pointer failure no fallback", async () => {
  const op = Object.values(sensitiveContracts)[0],
    row = {
      handler: "sandy-provider-sensitive-api",
      api_exposed: true,
      verified: true,
      is_mutation: op.is_mutation,
      permission_scope: "infrastructure:write",
      error_contract: {
        contract_sha256: op.contract_sha256,
        requires_approval: true,
        requires_grant: true,
        api_key_delegable: false,
      },
    };
  assert(sensitiveContractEnabled(row, op));
  assert.equal(
    sensitiveContractEnabled({
      ...row,
      error_contract: { ...row.error_contract, requires_approval: false },
    }, op),
    false,
  );
  const f = setup();
  f.deps.credentialForExecution = async () => {
    throw Error("private-fixture-detail");
  };
  const result = await f.run(op);
  assert.equal(result.status, 424);
  assert.equal(result.body.executed, false);
  assert.equal(f.urls.length, 0);
  assert(!JSON.stringify(result).includes("private-fixture-detail"));
});
