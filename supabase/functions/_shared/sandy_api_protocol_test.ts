import assert from "node:assert/strict";
import {
  argumentDigest,
  canonicalJson,
  JsonRequestError,
  requestJson,
} from "./sandy_api_protocol.ts";

Deno.test("canonical protocol binds semantic JSON while preserving ordered arrays and primitive types", async () => {
  assert.equal(
    canonicalJson({ z: [2, { b: -0, a: "é" }], a: true }),
    '{"a":true,"z":[2,{"a":"é","b":0}]}',
  );
  assert.equal(
    await argumentDigest({ b: 2, a: 1 }),
    await argumentDigest({ a: 1, b: 2 }),
  );
  assert.notEqual(await argumentDigest([1, 2]), await argumentDigest([2, 1]));
  assert.notEqual(await argumentDigest(1), await argumentDigest("1"));
  assert.equal(
    await argumentDigest({}),
    "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
  );
  assert.equal(
    canonicalJson(JSON.parse('{"__proto__":{"x":1}}')),
    '{"__proto__":{"x":1}}',
  );
});

Deno.test("canonical protocol refuses unsupported values and excessive complexity", () => {
  for (
    const value of [undefined, NaN, Infinity, new Date(), { x: undefined }, 1n, Array(2)]
  ) {
    assert.throws(() => canonicalJson(value));
  }
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalJson(cyclic), /json_complexity_limit/);
  assert.throws(
    () => canonicalJson(Array(100001).fill(null)),
    /json_complexity_limit/,
  );
});

Deno.test("JSON request limit uses actual bytes and rejects corrupt UTF8 without echoing content", async () => {
  assert.deepEqual(
    await requestJson(
      new Request("https://local.invalid", {
        method: "POST",
        body: '{"ok":true}',
      }),
    ),
    { ok: true },
  );
  for (
    const request of [
      new Request("https://local.invalid", {
        method: "POST",
        body: '{"private":"content"}',
        headers: { "content-length": "1" },
      }),
      new Request("https://local.invalid", {
        method: "POST",
        body: "{}",
        headers: { "content-length": "9999999" },
      }),
    ]
  ) {
    await assert.rejects(
      () => requestJson(request, 4),
      (error: unknown) =>
        error instanceof JsonRequestError && error.status === 413 &&
        !error.message.includes("private"),
    );
  }
  await assert.rejects(
    () =>
      requestJson(
        new Request("https://local.invalid", {
          method: "POST",
          body: new Uint8Array([255]),
        }),
      ),
    (error: unknown) =>
      error instanceof JsonRequestError && error.status === 400,
  );
});
