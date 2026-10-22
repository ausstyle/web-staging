import assert from "node:assert/strict";
import { admitExecution, type PolicyDb } from "./access_policy.ts";
import { createRegistrySchemaValidator } from "./registry_schema_ajv_reference_test_support.ts";
import { createInterpretedRegistryValidator } from "./registry_schema_interpreter.ts";
const objectSchema = (child: unknown) => ({
  type: "object",
  properties: { value: child },
  required: ["value"],
  additionalProperties: false,
});
function compare(
  schema: unknown,
  values: unknown[],
  expected?: (boolean | null)[],
) {
  const baseline = createRegistrySchemaValidator(),
    candidate = createInterpretedRegistryValidator();
  for (const [index, value] of values.entries()) {
    const before = baseline.isValid(schema, value),
      after = candidate.isValid(schema, value);
    assert.equal(
      after,
      before,
      JSON.stringify({ schema, value, before, after }),
    );
    if (expected) assert.equal(after, expected[index]);
  }
}
Deno.test("registry interpreter matches strict schema and async refusals", () => {
  for (
    const schema of [
      null,
      true,
      [],
      { type: "string" },
      { type: "object", properties: { x: { minLength: -1 } } },
      { type: "object", madeUpKeyword: true },
      { type: "object", id: "urn:legacy-id" },
      objectSchema({ id: "urn:legacy-id" }),
      { type: "object", properties: { x: { madeUpKeyword: true } } },
      { type: "object", $schema: "https://untrusted.invalid/meta" },
      { type: "object", $ref: "https://untrusted.invalid/schema" },
      { type: "object", $ref: "#/definitions/missing" },
      { type: "object", $async: true },
      { type: "object", $async: false },
      {
        type: "object",
        properties: { child: { $ref: "#/definitions/async" } },
        definitions: { async: { type: "object", $async: true } },
      },
      objectSchema({ format: "unknown" }),
      objectSchema({ pattern: "[" }),
      objectSchema({ nullable: true }),
      objectSchema({ type: "null", nullable: false }),
      objectSchema({ if: { const: 1 } }),
      objectSchema({ then: { const: 1 } }),
      objectSchema({ additionalItems: false }),
      objectSchema({ items: [{ type: "string" }] }),
      objectSchema({
        properties: { name: { type: "string" } },
        patternProperties: { "^n": { type: "string" } },
      }),
    ]
  ) compare(schema, [{}], [null]);
});
Deno.test("registry interpreter matches primitive constraints and exact numeric division", () => {
  const samples = [
    null,
    true,
    false,
    0,
    1,
    -1,
    1.1,
    1.2,
    0.3,
    0.30000000000000004,
    1e21,
    "",
    "a",
    "ab",
    "é",
    "😀",
    [],
    {},
    [1],
  ];
  for (
    const child of [
      true,
      false,
      { type: "string" },
      { type: ["string", "null"] },
      { type: "number" },
      { type: "integer" },
      { type: "string", nullable: true },
      { const: { a: 1 } },
      { enum: [1, "a", null] },
      { type: "number", minimum: 0, exclusiveMaximum: 2 },
      { type: "number", exclusiveMinimum: 0, maximum: 1 },
      { type: "number", multipleOf: 0.1 },
      { type: "number", multipleOf: 1e-10 },
      { type: "string", minLength: 1, maxLength: 1 },
      { type: "string", pattern: "^[ab]+$" },
      { type: "object", minProperties: 1, maxProperties: 2 },
      { type: "array", minItems: 1, maxItems: 2 },
    ]
  ) compare(objectSchema(child), samples.map((value) => ({ value })));
});
Deno.test("registry interpreter matches applicators, dependencies, arrays and local reference siblings", () => {
  const cases: [unknown, unknown[]][] = [
    [{ allOf: [{ minimum: 0 }, { maximum: 2 }] }, [-1, 0, 1, 3]],
    [{ anyOf: [{ const: 1 }, { const: "one" }] }, [null, 1, "one", "two"]],
    [{ oneOf: [{ type: "number" }, { minimum: 0 }] }, [-1, 1, "one"]],
    [{ not: { const: 1 } }, [1, 2, null]],
    [
      {
        if: { type: "number" },
        then: { minimum: 1 },
        else: { type: "string" },
      },
      [0, 1, "one", true],
    ],
    [{
      type: "object",
      properties: { a: { type: "integer" } },
      additionalProperties: false,
    }, [{}, { a: 1 }, { a: "1" }, { b: 1 }]],
    [{
      type: "object",
      patternProperties: { "^a": { type: "integer" } },
      additionalProperties: { type: "boolean" },
    }, [{ a: 1, b: true }, { a: "x" }, { b: 1 }]],
    [{ type: "object", propertyNames: { pattern: "^[a-z]+$" } }, [{ ok: 1 }, {
      "not-ok": 1,
    }]],
    [{ type: "object", dependencies: { a: ["b"], b: { required: ["c"] } } }, [
      {},
      { a: 1 },
      { a: 1, b: 2 },
      { b: 2, c: 3 },
    ]],
    [{
      type: "array",
      items: { type: "integer" },
      contains: { minimum: 2 },
      uniqueItems: true,
    }, [[], [1, 2], [1, 1], ["1", 2]]],
    [{
      type: "array",
      items: [{ type: "string" }, { type: "integer" }],
      minItems: 2,
      additionalItems: false,
    }, [["a", 1], ["a"], [1, "a"], ["a", 1, 2]]],
    [{ type: "array", uniqueItems: true }, [
      [{ a: 1, b: 2 }, { b: 2, a: 1 }],
      [{ a: 1 }, { a: 2 }],
      [0, -0],
      [null, false],
    ]],
  ];
  for (const [child, values] of cases) {
    compare(objectSchema(child), values.map((value) => ({ value })));
  }
  compare(
    {
      type: "object",
      properties: { value: { $ref: "#/definitions/integer", minimum: 2 } },
      definitions: { integer: { type: "integer" } },
    },
    [{ value: 1 }, { value: 2 }, { value: "2" }],
    [false, true, false],
  );
  compare({
    type: "object",
    properties: { value: { $ref: "#/$defs/node" } },
    $defs: {
      node: {
        type: "object",
        properties: {
          next: { $ref: "#/$defs/node" },
          value: { type: "integer" },
        },
        additionalProperties: false,
      },
    },
  }, [{ value: {} }, { value: { next: { value: 1 } } }, {
    value: { next: { value: "one" } },
  }], [true, true, false]);
});
Deno.test("registry interpreter preserves all configured full formats including numeric formats", () => {
  const samples: Record<string, unknown[]> = {
    date: ["2024-02-29", "2025-02-29", "2026-02-30", "2026-10-21"],
    time: ["23:59:60Z", "12:13:14+10:00", "25:00:00Z", "12:13:14"],
    "date-time": [
      "2026-10-21T12:13:14Z",
      "2026-02-30T00:00:00Z",
      "2026-10-21T12:13:14",
    ],
    "iso-time": ["12:13:14", "25:00:00"],
    "iso-date-time": ["2026-10-21T12:13:14", "2026-02-30T00:00:00Z"],
    duration: ["P1DT2H", "PT1S", "one hour"],
    uri: [
      "https://example.invalid/a?b=1",
      "urn:example:test",
      "/relative",
      "not uri",
    ],
    "uri-reference": ["/relative", "../a", "https://example.invalid", "a b"],
    "uri-template": ["https://example.invalid/{id}", "{?q}", "{broken"],
    url: [
      "https://example.com",
      "ftp://example.com/file",
      "http://localhost",
      "nonsense",
    ],
    email: [
      "person@example.invalid",
      "not email",
      "a..b@example.com",
      "a+b@example.com",
    ],
    hostname: ["example.com", "localhost", "bad_host", "-bad.com"],
    ipv4: ["127.0.0.1", "256.0.0.1", "01.2.3.4"],
    ipv6: ["::1", "2001:db8::1", "not-ip"],
    regex: ["[a-z]+", "["],
    uuid: ["11111111-2222-4333-8444-555555555555", "bad"],
    "json-pointer": ["", "/a/~0~1", "/bad~2", "not-pointer"],
    "relative-json-pointer": ["0", "1/a", "0#", "01/x", "bad"],
    byte: ["YQ==", "a==", ""],
    int32: [0, 2147483647, 2147483648, 1.5],
    int64: [0, 2 ** 53, 1.5],
    float: [0, 1e39],
    double: [0, 1e300],
    password: ["", "anything"],
    binary: ["", "anything"],
  };
  for (const [format, values] of Object.entries(samples)) {
    compare(
      objectSchema({ type: ["string", "number"], format }),
      values.map((value) => ({ value })),
    );
  }
});
Deno.test("registry interpreter isolates mutable schema content and bounds retained cache", () => {
  const candidate = createInterpretedRegistryValidator();
  const schema = {
    type: "object",
    properties: { id: { type: "integer", minimum: 1 } },
    required: ["id"],
  };
  assert.equal(candidate.isValid(schema, { id: 1 }), true);
  schema.properties.id.minimum = 3;
  assert.equal(candidate.isValid(schema, { id: 2 }), false);
  assert.equal(
    candidate.isValid({
      ...schema,
      properties: { id: { type: "integer", minimum: 1 } },
    }, { id: 2 }),
    true,
  );
  for (let id = 0; id < 100; id++) {
    assert.equal(
      candidate.isValid({ type: "object", properties: { id: { const: id } } }, {
        id,
      }),
      true,
    );
  }
  assert.equal(candidate.stats().entries, 12);
  assert.ok(candidate.stats().schema_bytes <= 256 * 1024);
  const large = {
    type: "object",
    description: "x".repeat(300 * 1024),
    properties: { ok: { const: true } },
  };
  assert.equal(candidate.isValid(large, { ok: true }), true);
  assert.equal(candidate.isValid(large, { ok: false }), false);
  assert.ok(candidate.stats().schema_bytes <= 256 * 1024);
});

Deno.test("registry interpreter matches ignored unused definitions while validating referenced definitions", () => {
  compare(
    {
      type: "object",
      definitions: { unused: { unknown: true, $async: true } },
    },
    [{}],
    [true],
  );
  compare(
    {
      type: "object",
      properties: { value: { $ref: "#/definitions/used" } },
      definitions: { used: { unknown: true } },
    },
    [{}],
    [null],
  );
  compare(
    {
      type: "object",
      properties: { value: { $ref: "#/dependencies/x" } },
      dependencies: { x: { type: "integer" } },
    },
    [{ value: 1 }, { value: "1" }],
    [true, false],
  );
  compare(
    {
      type: "object",
      properties: { value: { $ref: "urn:test:local" } },
      definitions: { value: { $id: "urn:test:local", type: "integer" } },
    },
    [{ value: 1 }, { value: "1" }],
    [true, false],
  );
});

Deno.test("registry interpreter preserves empty, escaped and URI-encoded local pointers", () => {
  for (const ref of ["", "#"]) {
    compare({ type: "object", properties: { value: { $ref: ref } } }, [{}, {
      value: {},
    }, { value: 1 }], [true, true, false]);
  }
  for (
    const [key, refs] of [["a~b", ["a%7Eb", "a~0b"]], ["a/b", [
      "a%2Fb",
      "a~1b",
    ]]] as [string, string[]][]
  ) {
    for (const ref of refs) {
      compare(
        {
          type: "object",
          properties: { value: { $ref: "#/definitions/" + ref } },
          definitions: { [key]: { type: "integer" } },
        },
        [{ value: 1 }, { value: "1" }],
        [true, false],
      );
    }
  }
});

Deno.test("registry interpreter invalidates nested reference and format revisions by actual content", () => {
  const cache = createInterpretedRegistryValidator();
  const schema = {
    type: "object",
    properties: { value: { $ref: "#/$defs/item" } },
    $defs: { item: { type: "string", format: "uuid" } },
  };
  const before = JSON.parse(JSON.stringify(schema));
  assert.equal(
    cache.isValid(schema, { value: "11111111-2222-4333-8444-555555555555" }),
    true,
  );
  assert.equal(cache.stats().entries, 1);
  schema.$defs.item.format = "uri";
  assert.equal(
    cache.isValid(schema, { value: "https://example.invalid" }),
    true,
  );
  assert.equal(
    cache.isValid(before, { value: "https://example.invalid" }),
    false,
  );
  assert.equal(cache.stats().entries, 2);
  assert.equal(
    cache.isValid({ ...schema, unknownKeyword: true }, {
      value: "https://example.invalid",
    }),
    null,
  );
  assert.equal(cache.stats().entries, 2);
});

Deno.test("registry interpreter intentionally refuses async or unknown keywords hidden after an always-valid union", () => {
  // AJV's optimizer skips these later branches. This prototype deliberately
  // preserves an unconditional fail-closed preflight instead of that quirk.
  const cache = createInterpretedRegistryValidator();
  for (const child of [{ $async: true }, { unknownKeyword: true }]) {
    assert.equal(
      cache.isValid({ type: "object", anyOf: [true, child] }, {}),
      null,
    );
  }
});

Deno.test("registry interpreter preserves permissive deep JSON and pinned reserved-name behavior", () => {
  for (const depth of [63, 64, 65, 128]) {
    let data: unknown = {};
    for (let i = 0; i < depth; i++) data = { next: data };
    compare({ type: "object" }, [data], [true]);
  }
  for (
    const name of [
      "constructor",
      "toString",
      "hasOwnProperty",
      "__defineGetter__",
      "valueOf",
    ]
  ) {
    compare({ type: "object", [name]: true }, [{}], [true]);
  }
  const data = JSON.parse('{"__proto__":1}');
  compare(
    {
      type: "object",
      dependencies: JSON.parse('{"__proto__":{"type":"integer"}}'),
    },
    [data],
    [true],
  );
  compare(
    {
      type: "object",
      properties: JSON.parse('{"__proto__":{"type":"string"}}'),
    },
    [data],
    [true],
  );
  compare(
    {
      type: "object",
      properties: JSON.parse('{"__proto__":{"type":"string"}}'),
      additionalProperties: false,
    },
    [data],
    [false],
  );
});

Deno.test("registry interpreter precompiles patterns and charges nonmatching property scans", () => {
  const cache = createInterpretedRegistryValidator();
  const patterns = Object.fromEntries(
    Array.from(
      { length: 500 },
      (_, i) => ["^never_" + i + "$", { type: "integer" }],
    ),
  );
  const data = Object.fromEntries(
    Array.from({ length: 500 }, (_, i) => ["key_" + i, i]),
  );
  assert.equal(
    cache.isValid({ type: "object", patternProperties: patterns }, data),
    null,
  );
  compare(
    { type: "object", patternProperties: { "^never$": { type: "integer" } } },
    [data],
    [true],
  );
  compare(objectSchema({ type: "string", pattern: "(?<=a)b" }), [{
    value: "ab",
  }, { value: "cb" }], [true, false]);
  compare(objectSchema({ type: "string", pattern: "^\\p{Letter}+$" }), [{
    value: "é漢",
  }, { value: "123" }], [true, false]);
});

Deno.test("registry interpreter compares deeply nested unique items without a new data-depth cap", () => {
  const make = (value: number) => {
    let data: unknown = value;
    for (let i = 0; i < 128; i++) data = { next: data };
    return data;
  };
  compare(objectSchema({ type: "array", uniqueItems: true }), [{
    value: [make(1), make(1)],
  }, { value: [make(1), make(2)] }], [false, true]);
});

Deno.test("permissive deep validation preserves the independent production admission bound before RPC", async () => {
  let argumentsValue: unknown = {};
  for (let i = 0; i < 65; i++) argumentsValue = { next: argumentsValue };
  let rpcCalls = 0;
  const db = {
    rpc() {
      rpcCalls++;
      throw Error("unexpected_policy_RPC");
    },
  } as unknown as PolicyDb;
  for (
    const validator of [
      createRegistrySchemaValidator(),
      createInterpretedRegistryValidator(),
    ]
  ) {
    assert.equal(validator.isValid({ type: "object" }, argumentsValue), true);
    const result = await admitExecution(db, {
      actorId: "11111111-2222-4333-8444-555555555555",
      tenantId: null,
      operation: "supabase.functions.list",
      arguments: argumentsValue,
      requestId: "22222222-3333-4444-8555-666666666666",
      contractSha256: "a".repeat(64),
      scope: { provider: "supabase" },
    });
    assert.deepEqual(result, {
      ok: false,
      status: 400,
      error: "invalid_execution_admission",
    });
  }
  assert.equal(rpcCalls, 0);
});

Deno.test("differential reference remains the exact pre-promotion AJV implementation", async () => {
  const bytes = await Deno.readFile(
    new URL("./registry_schema_ajv_reference_test_support.ts", import.meta.url),
  );
  const sha = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  ).map((v) => v.toString(16).padStart(2, "0")).join("");
  assert.equal(
    sha,
    "650b512c69590fac1e7cc9c369bee4a65988ffc5cfaa64ed054a97d349f6cb18",
  );
  assert.notEqual(
    createRegistrySchemaValidator,
    createInterpretedRegistryValidator,
  );
});
