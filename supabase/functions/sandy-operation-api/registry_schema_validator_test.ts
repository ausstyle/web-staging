import assert from "node:assert/strict";
import { createRegistrySchemaValidator } from "./registry_schema_validator.ts";

Deno.test("registry cache reuses equivalent JSON content and isolates caller schema mutations", () => {
  const cache = createRegistrySchemaValidator();
  const schema = {
    type: "object",
    required: ["id"],
    properties: { id: { type: "integer", minimum: 1 } },
    additionalProperties: false,
  };
  assert.equal(cache.isValid(schema, { id: 1 }), true);
  assert.equal(
    cache.isValid({
      additionalProperties: false,
      properties: { id: { minimum: 1, type: "integer" } },
      required: ["id"],
      type: "object",
    }, { id: 0 }),
    false,
  );
  assert.equal(cache.stats().entries, 1);
  schema.properties.id.minimum = 3;
  assert.equal(cache.isValid(schema, { id: 2 }), false);
  assert.equal(
    cache.isValid({
      ...schema,
      properties: { id: { type: "integer", minimum: 1 } },
    }, { id: 2 }),
    true,
  );
  assert.equal(cache.stats().entries, 2);
});

Deno.test("registry validators evict old content within both entry and schema byte budgets", () => {
  const cache = createRegistrySchemaValidator();
  for (let revision = 0; revision < 80; revision++) {
    const schema = {
      type: "object",
      properties: { revision: { const: revision } },
      required: ["revision"],
      additionalProperties: false,
    };
    assert.equal(cache.isValid(schema, { revision }), true);
    assert.equal(cache.isValid(schema, { revision: revision + 1 }), false);
    assert.ok(cache.stats().entries <= 12);
    assert.ok(cache.stats().schema_bytes <= 256 * 1024);
  }
  assert.equal(cache.stats().entries, 12);
  for (let revision = 0; revision < 8; revision++) {
    assert.equal(
      cache.isValid({
        type: "object",
        description: "x".repeat(100 * 1024),
        properties: { revision: { const: revision } },
      }, { revision }),
      true,
    );
    assert.ok(cache.stats().schema_bytes <= 256 * 1024);
  }
  assert.ok(cache.stats().entries <= 2);
});

Deno.test("a large registry schema validates without becoming a permanent cache entry", () => {
  const cache = createRegistrySchemaValidator();
  const schema = {
    type: "object",
    description: "x".repeat(300 * 1024),
    required: ["ok"],
    properties: { ok: { const: true } },
  };
  assert.equal(cache.isValid(schema, { ok: true }), true);
  assert.equal(cache.isValid(schema, { ok: false }), false);
  assert.equal(cache.stats().entries, 0);
  assert.equal(cache.stats().schema_bytes, 0);
});

Deno.test("registry cache preserves metaschema, strict-keyword and explicit async refusals", () => {
  const cache = createRegistrySchemaValidator();
  for (
    const schema of [
      { type: "object", properties: { id: { type: "string", minLength: -1 } } },
      { type: "object", properties: { id: { type: "imaginary" } } },
      { type: "object", unrecognizedKeyword: true },
      { type: "object", $schema: "https://untrusted.invalid/meta" },
      { type: "object", $ref: "https://untrusted.invalid/schema" },
      { type: "object", $async: true },
      { type: "object", $async: false },
      {
        type: "object",
        properties: { child: { $ref: "#/definitions/async" } },
        definitions: { async: { type: "object", $async: true } },
      },
    ]
  ) assert.equal(cache.isValid(schema, {}), null);
  assert.equal(cache.stats().entries, 0);
});

Deno.test("cached registry validators retain strict types, full formats and exact boolean results", () => {
  const cache = createRegistrySchemaValidator();
  const schema = {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      email: { type: "string", format: "email" },
      at: { type: "string", format: "date-time" },
      count: { type: ["integer", "null"], minimum: 1 },
    },
    required: ["id", "email", "at"],
    additionalProperties: false,
  };
  const valid = {
    id: "11111111-2222-4333-8444-555555555555",
    email: "person@example.invalid",
    at: "2026-10-21T00:00:00Z",
    count: 1,
  };
  assert.equal(cache.isValid(schema, valid), true);
  for (
    const patch of [
      { id: "invalid" },
      { email: "invalid" },
      { at: "2026-02-30T00:00:00Z" },
      { count: "1" },
      { extra: true },
    ]
  ) assert.equal(cache.isValid(schema, { ...valid, ...patch }), false);
  assert.equal(cache.isValid(schema, { ...valid, count: null }), true);
});
