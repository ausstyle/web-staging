import { Ajv, type ValidateFunction } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import { canonicalJson } from "../_shared/sandy_api_protocol.ts";

const maxEntries = 12, maxSchemaBytes = 256 * 1024;
function engine(meta: boolean) {
  const ajv = new Ajv({
    strict: true,
    strictTypes: false,
    strictRequired: false,
    allowUnionTypes: true,
    allErrors: false,
    validateFormats: true,
    inlineRefs: false,
    meta,
    validateSchema: meta,
  });
  for (const [name, format] of Object.entries(fullFormats)) {
    ajv.addFormat(name, format);
  }
  return ajv;
}

/** Keep mutable registry schemas out of a shared AJV generated-function scope. */
export function createRegistrySchemaValidator() {
  // This engine compiles only fixed JSON-schema metaschemas. Registry schemas
  // are validated as data, never compiled into its long-lived value scope.
  const metaValidator = engine(true);
  const entries = new Map<string, {
    validator: ValidateFunction;
    engine: Ajv;
    schema: Record<string, unknown>;
    bytes: number;
  }>();
  let bytes = 0;
  const evict = () => {
    const key = entries.keys().next().value!;
    const entry = entries.get(key)!;
    entry.engine.removeSchema(entry.schema);
    entries.delete(key);
    bytes -= entry.bytes;
  };
  return {
    isValid(schema: unknown, value: unknown): boolean | null {
      if (
        !schema || typeof schema !== "object" || Array.isArray(schema) ||
        (schema as Record<string, unknown>).type !== "object" ||
        (schema as Record<string, unknown>).$async !== undefined
      ) return null;
      try {
        const key = canonicalJson(schema);
        let cached = entries.get(key);
        if (cached) {
          entries.delete(key);
          entries.set(key, cached);
        } else {
          // Compile a private snapshot so later object mutations cannot change
          // an existing entry or the values captured by its generated code.
          const snapshot = JSON.parse(key) as Record<string, unknown>;
          if (metaValidator.validateSchema(snapshot) !== true) return null;
          // Charge both the retained key and snapshot string content at their
          // conservative UTF-16 size, alongside the independent entry bound.
          const size = new TextEncoder().encode(key).byteLength * 4;
          while (
            entries.size &&
            (entries.size >= maxEntries || bytes + size > maxSchemaBytes)
          ) evict();
          const ajv = engine(false);
          const validator = ajv.compile(snapshot);
          if (
            (validator as ValidateFunction & { $async?: unknown }).$async !==
              undefined
          ) return null;
          cached = { validator, engine: ajv, schema: snapshot, bytes: size };
          if (size <= maxSchemaBytes) {
            entries.set(key, cached);
            bytes += size;
          } else ajv.removeSchema(snapshot);
        }
        return cached.validator(value) === true;
      } catch {
        return null;
      }
    },
    stats: () => ({
      entries: entries.size,
      schema_bytes: bytes,
      max_entries: maxEntries,
      max_schema_bytes: maxSchemaBytes,
    }),
  };
}
