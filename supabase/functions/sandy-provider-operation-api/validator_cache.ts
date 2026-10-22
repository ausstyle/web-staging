/** Bound compiled AJV validators as well as decoded schema shards. */
import type { ValidateFunction } from "npm:ajv@8.17.1";
type Engine = {
  compile(schema: Record<string, unknown>): ValidateFunction;
  removeSchema(schema: unknown): unknown;
};
export function createBoundedValidatorCache(createEngine: () => Engine) {
  const maxEntries = 12, maxSchemaBytes = 256 * 1024;
  const entries = new Map<
    unknown,
    {
      validator: ValidateFunction;
      bytes: number;
      schema: Record<string, unknown>;
      engine: Engine;
    }
  >();
  let bytes = 0;
  const evict = () => {
    const key = entries.keys().next().value!;
    const entry = entries.get(key)!;
    entry.engine.removeSchema(entry.schema);
    entries.delete(key);
    bytes -= entry.bytes;
  };
  return {
    get(key: unknown, schema: Record<string, unknown>): ValidateFunction {
      const cached = entries.get(key);
      if (cached) {
        entries.delete(key);
        entries.set(key, cached);
        return cached.validator;
      }
      const size = new TextEncoder().encode(JSON.stringify(schema)).byteLength;
      while (
        entries.size &&
        (entries.size >= maxEntries || bytes + size > maxSchemaBytes)
      ) evict();
      // AJV's code-generation ValueScope retains compiled functions even after
      // removeSchema(). Each cache entry owns its entire engine; eviction drops
      // that graph as well as the public schema/cache reference.
      const engine = createEngine();
      const validator = engine.compile(schema);
      // Even a large reviewed single contract can execute; it does not become
      // a permanent cache allocation beyond the source-schema budget.
      if (size <= maxSchemaBytes) {
        entries.set(key, { validator, bytes: size, schema, engine });
        bytes += size;
      } else engine.removeSchema(schema);
      return validator;
    },
    clear() {
      while (entries.size) evict();
    },
    stats: () => ({
      entries: entries.size,
      schema_bytes: bytes,
      max_entries: maxEntries,
      max_schema_bytes: maxSchemaBytes,
    }),
  };
}
