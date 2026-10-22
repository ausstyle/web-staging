/** Synthetic local transport fixtures only; never provider/Auth verification. */
import { type Contract, type Obj } from "./contracts.ts";
const PROJECT = "elaborate-haven-511518-a5",
  NUMBER = "1030223524306",
  SB = "zmqlyygzqoidkcwdysok",
  branchRef = "aaaaaaaaaaaaaaaaaaaa",
  branchId = "11111111-1111-4111-8111-111111111111";
const prefix = `projects/${PROJECT}/locations/europe-west1/`,
  now = Date.parse("2026-10-21T01:00:00Z");
function fixture(schema: Obj, defs: Obj, name = "", depth = 0): unknown {
  if (depth > 20) return {};
  if (typeof schema.$ref === "string") {
    return fixture(
      defs[schema.$ref.split("/").pop()!] as Obj,
      defs,
      name,
      depth + 1,
    );
  }
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  for (const keyword of ["anyOf", "oneOf"]) {
    if (Array.isArray(schema[keyword])) {
      return fixture((schema[keyword] as Obj[])[0], defs, name, depth + 1);
    }
  }
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === "object" || schema.properties) {
    const result: Obj = {};
    for (
      const key of Array.isArray(schema.required)
        ? schema.required as string[]
        : []
    ) {
      result[key] = fixture(
        (schema.properties as Obj)[key] as Obj,
        defs,
        key,
        depth + 1,
      );
    }
    return result;
  }
  if (type === "array") return [];
  if (type === "boolean") return false;
  if (type === "integer" || type === "number") {
    return typeof schema.minimum === "number" ? Math.max(schema.minimum, 1) : 1;
  }
  if (schema.format === "uuid") return branchId;
  if (schema.format === "date-time") return new Date(now).toISOString();
  if (name === "project_ref" || name === "ref") return branchRef;
  if (name === "parent_project_ref") return SB;
  if (name === "id") return branchId;
  if (name === "db_host") return "fixture.supabase.co";
  return "fixture";
}
export function argsFor(op: Contract): Obj {
  const args = fixture(op.input_schema, op.input_schema.$defs as Obj) as Obj;
  const paths: Record<string, string> = {
    bucket: "fixture-bucket",
    sourceBucket: "fixture-source",
    destinationBucket: "fixture-destination",
    object: "fixture-object",
    sourceObject: "fixture-source-object",
    destinationObject: "fixture-object",
    folder: "fixture-folder/",
    managedFolder: "fixture-folder/",
    firewallPolicy: "123",
    branch_id_or_ref: branchId,
    repository: prefix + "repositories/fixture",
    sinkName: `projects/${PROJECT}/sinks/fixture`,
    dataSource: prefix + "backupVaults/fixture/dataSources/fixture",
  };
  const properties = (op.input_schema.properties as Obj).path as
    | Obj
    | undefined;
  if (properties) {
    args.path = {};
    for (const name of Object.keys(properties.properties as Obj)) {
      (args.path as Obj)[name] = paths[name] ?? "fixture";
    }
  }
  const q: Obj = object(args.query) ? args.query : {};
  if (op.service === "storage") {
    const fields =
      (((op.input_schema.properties as Obj).query as Obj)?.properties ??
        {}) as Obj;
    for (
      const field of [
        "ifGenerationMatch",
        "ifSourceGenerationMatch",
        "ifMetagenerationMatch",
        "generation",
      ]
    ) if (fields[field]) q[field] = field === "ifGenerationMatch" ? "0" : "1";
    if (op.method_name === "compose") {
      args.body = {
        sourceObjects: [{ name: "fixture-source-object", generation: "1" }],
      };
    }
  }
  if (op.service === "compute") {
    if (op.method_name === "cloneRules") q.sourceFirewallPolicy = "456";
    if (["getRule", "patchRule", "removeRule"].includes(op.method_name)) {
      q.priority = 1000;
    }
    if (["getAssociation", "removeAssociation"].includes(op.method_name)) {
      q.name = "fixture";
    }
    if (op.method_name === "addAssociation") {
      args.body = { attachmentTarget: "folders/200", name: "fixture" };
    }
  }
  if (op.service === "artifactregistry") {
    args.body = {
      version: prefix + "repositories/fixture/packages/fixture/versions/v1",
    };
  }
  if (op.service === "backupdr" && op.method_name === "initiateBackup") {
    args.body = {
      ...(object(args.body) ? args.body : {}),
      backupId: "fixture",
    };
  }
  if (op.service === "logging") {
    args.body = { filter: 'resource.type="gce_instance"' };
    q.updateMask = "filter";
  }
  if (Object.keys(q).length) args.query = q;
  return args;
}
const object = (v: unknown): v is Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v);
export function finalValue(op: Contract, args: Obj): Obj {
  const path = object(args.path) ? args.path : {};
  if (op.provider === "supabase") {
    const schema = op.response_schemas[Object.keys(op.response_schemas)[0]],
      value = schema ? fixture(schema, op.$defs) as Obj : {};
    return value;
  }
  if (op.service === "compute") {
    return op.method_name === "list"
      ? { items: [{ id: "123", parent: "folders/200", name: "fixture" }] }
      : { id: "123", parent: "folders/200", name: "fixture" };
  }
  if (op.service === "storage") {
    return {
      bucket: String(path.destinationBucket ?? path.bucket),
      name: String(
        path.destinationObject ?? path.object ?? path.bucket ?? "fixture",
      ),
      projectNumber: NUMBER,
      generation: "1",
    };
  }
  if (op.service === "pubsub") {
    return {
      snapshots: [{
        name: `projects/${PROJECT}/snapshots/fixture`,
        topic: `projects/${PROJECT}/topics/fixture`,
      }],
    };
  }
  if (op.service === "artifactregistry") {
    return op.method_name === "checkPrewarmedArtifact"
      ? { isPrewarmed: true }
      : { name: prefix + "operations/fixture" };
  }
  if (op.service === "backupdr") {
    return op.method_name === "initiateBackup"
      ? {
        backup: prefix +
          "backupVaults/fixture/dataSources/fixture/backups/fixture",
        newBackupGenerationId: 1,
      }
      : { name: prefix + "operations/fixture" };
  }
  return {
    name: `projects/${PROJECT}/sinks/fixture`,
    filter: "PRIVATE_FILTER",
  };
}
