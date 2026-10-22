/** Interpreted registry value validation; fixed Draft7 schema checks and bounded snapshot cache. */
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import {
  dereference,
  type Schema,
  Validator,
} from "npm:@cfworker/json-schema@4.1.1";
import { canonicalJson } from "../_shared/sandy_api_protocol.ts";
type Obj = Record<string, unknown>;
type Node = Obj | boolean;
const object = (v: unknown): v is Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const singleton = [
  "additionalProperties",
  "additionalItems",
  "contains",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
];
const maps = ["properties", "patternProperties"];
const arrays = ["allOf", "anyOf", "oneOf"];
const primitives = [
  "type",
  "enum",
  "const",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minProperties",
  "maxProperties",
  "required",
];
function createMetaValidator() {
  const a = new Ajv({
    strict: true,
    strictTypes: false,
    strictRequired: false,
    allowUnionTypes: true,
    allErrors: false,
    validateFormats: true,
    inlineRefs: false,
  });
  for (const [name, format] of Object.entries(fullFormats)) {
    a.addFormat(name, format);
  }
  return a;
}
function exactFormat(name: string, value: unknown): boolean {
  const definition = fullFormats[name as keyof typeof fullFormats];
  const wrapped = object(definition) && !(definition instanceof RegExp);
  const type = wrapped ? definition.type ?? "string" : "string";
  if (typeof value !== type) return true;
  const validator = wrapped ? definition.validate : definition;
  if (validator === true) return true;
  if (validator instanceof RegExp) return validator.test(String(value));
  if (typeof validator === "function") {
    return validator(value as never) === true;
  }
  throw Error("unknown_format");
}
function interpreted(
  snapshot: Obj,
  known: Record<string, boolean>,
) {
  const lookup = dereference(snapshot as Schema);
  const seen = new WeakSet<object>();
  const leaves = new WeakMap<object, Validator>();
  const stringPatterns = new WeakMap<object, RegExp>();
  const propertyPatterns = new WeakMap<object, [RegExp, Node][]>();
  // Preserve the pinned AJV keyword table's harmless Object.prototype names
  // explicitly, rather than trusting an inherited dictionary lookup.
  const legacyAnnotationNames = new Set(
    Object.getOwnPropertyNames(Object.prototype).filter((k) =>
      k !== "__proto__"
    ),
  );
  const resolve = (node: Obj): Node => {
    const base = typeof node.__absolute_uri__ === "string"
      ? node.__absolute_uri__
      : String(snapshot.__absolute_uri__);
    const uri = typeof node.__absolute_ref__ === "string"
      ? node.__absolute_ref__
      : new URL(String(node.$ref), base).href;
    const normalized = uri.endsWith("#") ? uri.slice(0, -1) : uri;
    let target: unknown = lookup[normalized];
    // AJV decodes each URI fragment segment before JSON Pointer escaping.
    // Resolve only against resources already in this private local snapshot;
    // an absolute HTTP reference never causes an HTTP request.
    if (target === undefined) {
      const boundary = normalized.indexOf("#");
      const resource = boundary < 0
        ? normalized
        : normalized.slice(0, boundary);
      const pointer = boundary < 0 ? "" : normalized.slice(boundary + 1);
      target = lookup[resource];
      if (target !== undefined && pointer.startsWith("/")) {
        for (const encoded of pointer.slice(1).split("/")) {
          const key = decodeURIComponent(encoded).replaceAll("~1", "/")
            .replaceAll("~0", "~");
          if (
            (!object(target) && !Array.isArray(target)) ||
            !Object.hasOwn(target, key)
          ) throw Error("local_ref_unavailable");
          target = (target as Obj)[key];
        }
      } else if (pointer) target = undefined;
    }
    if (typeof target !== "boolean" && !object(target)) {
      throw Error("local_ref_unavailable");
    }
    return target;
  };
  const visit = (node: unknown): void => {
    if (typeof node === "boolean") return;
    if (!object(node)) throw Error("bad_schema");
    if (seen.has(node)) return;
    seen.add(node);
    for (const key of Object.keys(node)) {
      if (
        (!Object.hasOwn(known, key) && !legacyAnnotationNames.has(key)) ||
        key === "$async" || key === "id"
      ) {
        throw Error("unknown_or_async_keyword");
      }
    }
    if (node.nullable !== undefined) {
      if (
        typeof node.nullable !== "boolean" || node.type === undefined ||
        node.nullable === false &&
          (node.type === "null" ||
            Array.isArray(node.type) && node.type.includes("null"))
      ) {
        throw Error("invalid_nullable");
      }
    }
    if (
      node.format !== undefined &&
      (typeof node.format !== "string" ||
        !Object.hasOwn(fullFormats, node.format))
    ) {
      throw Error("unknown_format");
    }
    if (node.pattern !== undefined) {
      stringPatterns.set(node, new RegExp(String(node.pattern), "u"));
    }
    if (object(node.patternProperties)) {
      const patterns: [RegExp, Node][] = [];
      for (
        const pattern of Object.keys(node.patternProperties).filter((k) =>
          k !== "__proto__"
        )
      ) {
        const re = new RegExp(pattern, "u");
        patterns.push([re, node.patternProperties[pattern] as Node]);
        if (
          object(node.properties) &&
          Object.keys(node.properties).some((k) => re.test(k))
        ) {
          throw Error("overlapping_property_pattern");
        }
      }
      propertyPatterns.set(node, patterns);
    }
    if (
      node.if !== undefined && node.then === undefined &&
        node.else === undefined ||
      node.if === undefined &&
        (node.then !== undefined || node.else !== undefined)
    ) {
      throw Error("ignored_conditional");
    }
    if (node.additionalItems !== undefined && !Array.isArray(node.items)) {
      throw Error("ignored_additional_items");
    }
    if (Array.isArray(node.items)) {
      const size = node.items.length;
      if (
        node.minItems !== size ||
        node.maxItems !== size && node.additionalItems !== false
      ) {
        throw Error("strict_tuple");
      }
      node.items.forEach(visit);
    } else if (node.items !== undefined) visit(node.items);
    for (const key of singleton) if (node[key] !== undefined) visit(node[key]);
    for (const key of arrays) {
      if (Array.isArray(node[key])) node[key].forEach(visit);
    }
    for (const key of maps) {
      if (object(node[key])) {
        Object.entries(node[key]).filter(([k]) => k !== "__proto__").forEach((
          [, child],
        ) => visit(child));
      }
    }
    if (object(node.dependencies)) {
      for (const [key, dep] of Object.entries(node.dependencies)) {
        if (key === "__proto__") continue;
        if (!Array.isArray(dep)) visit(dep);
      }
    }
    if (node.$ref !== undefined) visit(resolve(node));
  };
  visit(snapshot);
  const leaf = (node: Obj, value: unknown): boolean => {
    let validator = leaves.get(node);
    if (!validator) {
      const schema = Object.fromEntries(
        primitives.filter((k) => node[k] !== undefined).map(
          (k) => [k, node[k]],
        ),
      );
      if (node.nullable === true) {
        schema.type = [
          ...new Set([
            ...(Array.isArray(node.type) ? node.type : [node.type]),
            "null",
          ]),
        ];
      }
      validator = new Validator(schema as Schema, "7", true);
      leaves.set(node, validator);
    }
    return validator.validate(value).valid === true;
  };
  return (value: unknown): boolean => {
    let calls = 0;
    const charge = () => {
      if (++calls > 200000) throw Error("validation_complexity");
    };
    const matches = (pattern: RegExp, text: string) => {
      charge();
      return pattern.test(text);
    };
    // Iterative structural keys preserve JSON object-key independence without
    // imposing the separate admission canonicalizer's depth64 limit on data.
    const structuralKey = (value: unknown): string => {
      const stack: ({ value: unknown } | { text: string })[] = [{ value }],
        parts: string[] = [];
      while (stack.length) {
        charge();
        const item = stack.pop()!;
        if ("text" in item) {
          parts.push(item.text);
          continue;
        }
        const v = item.value;
        if (v === null || typeof v === "string" || typeof v === "boolean") {
          parts.push(JSON.stringify(v));
          continue;
        }
        if (typeof v === "number") {
          parts.push(
            Number.isFinite(v) ? JSON.stringify(v) : "number:" + String(v),
          );
          continue;
        }
        if (Array.isArray(v)) {
          stack.push({ text: "]" });
          for (let i = v.length - 1; i >= 0; i--) {
            if (!Object.hasOwn(v, i)) throw Error("non_json_item");
            stack.push({ value: v[i] });
            if (i) stack.push({ text: "," });
          }
          stack.push({ text: "[" });
          continue;
        }
        if (
          object(v) &&
          [Object.prototype, null].includes(Object.getPrototypeOf(v))
        ) {
          const keys = Object.keys(v).sort();
          stack.push({ text: "}" });
          for (let i = keys.length - 1; i >= 0; i--) {
            stack.push({ value: v[keys[i]] });
            stack.push({ text: JSON.stringify(keys[i]) + ":" });
            if (i) stack.push({ text: "," });
          }
          stack.push({ text: "{" });
          continue;
        }
        throw Error("non_json_item");
      }
      return parts.join("");
    };
    const check = (node: Node, data: unknown, depth = 0): boolean => {
      charge();
      if (depth > 256) throw Error("validation_complexity");
      if (typeof node === "boolean") return node;
      const next = (schema: unknown, item = data) =>
        check(schema as Node, item, depth + 1);
      if (node.$ref !== undefined && !next(resolve(node))) return false;
      if (!leaf(node, data)) return false;
      const pattern = stringPatterns.get(node);
      if (typeof data === "string" && pattern && !matches(pattern, data)) {
        return false;
      }
      if (typeof data === "number") {
        if (!Number.isFinite(data)) return false;
        if (typeof node.multipleOf === "number") {
          const quotient = data / node.multipleOf;
          // Preserve AJV's default IEEE-754 division semantics, not the
          // interpreter package's more permissive floating-point tolerance.
          if (
            node.multipleOf === 0 ||
            quotient !== Number.parseInt(String(quotient))
          ) return false;
        }
      }
      if (typeof node.format === "string" && !exactFormat(node.format, data)) {
        return false;
      }
      if (Array.isArray(node.allOf) && !node.allOf.every((s) => next(s))) {
        return false;
      }
      if (Array.isArray(node.anyOf) && !node.anyOf.some((s) => next(s))) {
        return false;
      }
      if (
        Array.isArray(node.oneOf) &&
        node.oneOf.filter((s) => next(s)).length !== 1
      ) return false;
      if (node.not !== undefined && next(node.not)) return false;
      if (node.if !== undefined) {
        const selected = next(node.if) ? node.then : node.else;
        if (selected !== undefined && !next(selected)) return false;
      }
      if (object(data)) {
        const properties = object(node.properties) ? node.properties : {};
        const patterns = propertyPatterns.get(node) ?? [];
        for (const [key, child] of Object.entries(properties)) {
          if (key === "__proto__") continue;
          if (data[key] !== undefined && !next(child, data[key])) return false;
        }
        for (const key in data) {
          let matched = key !== "__proto__" && Object.hasOwn(properties, key);
          for (const [pattern, child] of patterns) {
            if (matches(pattern, key)) {
              matched = true;
              if (!next(child, data[key])) return false;
            }
          }
          if (
            !matched && node.additionalProperties !== undefined &&
            !next(node.additionalProperties, data[key])
          ) return false;
          if (
            node.propertyNames !== undefined && !next(node.propertyNames, key)
          ) return false;
        }
        if (object(node.dependencies)) {
          for (const [key, dependency] of Object.entries(node.dependencies)) {
            if (key === "__proto__" || data[key] === undefined) continue;
            if (Array.isArray(dependency)) {
              if (
                !dependency.every((k) =>
                  typeof k === "string" && data[k] !== undefined
                )
              ) return false;
            } else if (!next(dependency)) return false;
          }
        }
      } else if (Array.isArray(data)) {
        if (Array.isArray(node.items)) {
          for (let i = 0; i < data.length; i++) {
            const child = i < node.items.length
              ? node.items[i]
              : node.additionalItems;
            if (child !== undefined && !next(child, data[i])) return false;
          }
        } else if (
          node.items !== undefined && !data.every((v) => next(node.items, v))
        ) return false;
        if (
          node.contains !== undefined &&
          !data.some((v) => next(node.contains, v))
        ) return false;
        if (node.uniqueItems === true) {
          const keys = new Set<string>();
          for (const item of data) {
            const key = structuralKey(item);
            if (keys.has(key)) return false;
            keys.add(key);
          }
        }
      }
      return true;
    };
    return check(snapshot, value);
  };
}
export function createInterpretedRegistryValidator() {
  const meta = createMetaValidator();
  const known =
    (meta as unknown as { RULES: { keywords: Record<string, boolean> } }).RULES
      .keywords;
  const entries = new Map<
    string,
    { validate: (value: unknown) => boolean; bytes: number }
  >();
  let bytes = 0;
  return {
    isValid(schema: unknown, value: unknown): boolean | null {
      if (
        !object(schema) || schema.type !== "object" ||
        schema.$async !== undefined
      ) return null;
      try {
        const key = canonicalJson(schema);
        let entry = entries.get(key);
        if (entry) {
          entries.delete(key);
          entries.set(key, entry);
        } else {
          const snapshot = JSON.parse(key) as Obj;
          if (meta.validateSchema(snapshot) !== true) return null;
          entry = {
            validate: interpreted(snapshot, known),
            bytes: new TextEncoder().encode(key).byteLength * 4,
          };
          while (
            entries.size &&
            (entries.size >= 12 || bytes + entry.bytes > 256 * 1024)
          ) {
            const oldest = entries.keys().next().value!;
            bytes -= entries.get(oldest)!.bytes;
            entries.delete(oldest);
          }
          if (entry.bytes <= 256 * 1024) {
            entries.set(key, entry);
            bytes += entry.bytes;
          }
        }
        return entry.validate(value) === true;
      } catch {
        return null;
      }
    },
    stats: () => ({
      entries: entries.size,
      schema_bytes: bytes,
      max_entries: 12,
      max_schema_bytes: 256 * 1024,
    }),
  };
}
