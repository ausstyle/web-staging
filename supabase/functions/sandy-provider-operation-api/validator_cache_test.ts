import assert from "node:assert/strict";
import { Ajv } from "npm:ajv@8.17.1";
import { createBoundedValidatorCache } from "./validator_cache.ts";
Deno.test("bounded validator eviction releases an isolated AJV engine and its schema cache", () => {
  const engines: Ajv[] = [];
  const cache = createBoundedValidatorCache(() => {
    const engine = new Ajv({ meta: false, validateSchema: false });
    engines.push(engine);
    return engine;
  });
  for (let i = 0; i < 150; i++) {
    const fn = cache.get(String(i), {
      type: "object",
      properties: { id: { const: i } },
      required: ["id"],
      additionalProperties: false,
    });
    assert.equal(fn({ id: i }), true);
    assert.equal(fn({ id: i + 1 }), false);
  }
  assert.equal(cache.stats().entries, 12);
  assert.equal(engines.length, 150);
  for (const engine of engines.slice(0, -12)) {
    assert.equal(
      (engine as unknown as { _cache: Map<unknown, unknown> })._cache.size,
      0,
    );
  }
  cache.clear();
  for (const engine of engines) {
    assert.equal(
      (engine as unknown as { _cache: Map<unknown, unknown> })._cache.size,
      0,
    );
  }
});
Deno.test("a single large source schema executes without becoming a permanent cache allocation", () => {
  const cache = createBoundedValidatorCache(() =>
    new Ajv({ meta: false, validateSchema: false })
  );
  const fn = cache.get("large", {
    type: "string",
    description: "x".repeat(2 * 1024 * 1024),
  });
  assert.equal(fn("value"), true);
  assert.equal(cache.stats().entries, 0);
});
