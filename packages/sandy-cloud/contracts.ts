/** Fixed fixture contracts; production registration must be owned by Sandy API. */
import { CloudError } from "./domain.ts";
type Field =
  | "string"
  | "integer"
  | "boolean"
  | "nullable-string"
  | "patch"
  | "backup-entries";
interface Contract {
  fields: Record<string, Field>;
  required: string[];
  idempotent?: boolean;
}
const c = (
  fields: Record<string, Field> = {},
  required: string[] = [],
  idempotent = false,
): Contract => ({ fields, required, idempotent });
export const contracts: Record<string, Contract> = {
  "workspaces.list": c(),
  "nodes.list": c({ parentId: "nullable-string", trash: "boolean" }),
  "nodes.folder": c(
    { name: "string", parentId: "nullable-string" },
    ["name"],
    true,
  ),
  "nodes.change": c({ id: "string", revision: "integer", patch: "patch" }, [
    "id",
    "revision",
    "patch",
  ], true),
  "uploads.start": c(
    {
      name: "string",
      parentId: "nullable-string",
      nodeId: "string",
      expectedRevision: "integer",
      size: "integer",
      sha256: "string",
    },
    ["name", "expectedRevision", "size", "sha256"],
    true,
  ),
  "backups.upload.start": c(
    {
      name: "string",
      expectedRevision: "integer",
      size: "integer",
      sha256: "string",
    },
    ["name", "expectedRevision", "size", "sha256"],
    true,
  ),
  "backups.upload.complete": c({ id: "string" }, ["id"], true),
  "backups.seal": c({ deviceId: "string", entries: "backup-entries" }, [
    "deviceId",
    "entries",
  ], true),
  "backups.manifest": c({ id: "string" }, ["id"]),
  "backups.download": c({ id: "string", objectId: "string" }, [
    "id",
    "objectId",
  ]),
  "uploads.status": c({ id: "string" }, ["id"]),
  "uploads.chunk": c({ id: "string", offset: "integer", base64: "string" }, [
    "id",
    "offset",
    "base64",
  ]),
  "uploads.complete": c({ id: "string" }, ["id"], true),
  "uploads.expire": c(),
  "versions.list": c({ nodeId: "string" }, ["nodeId"]),
  "versions.download": c({ id: "string" }, ["id"]),
  "changes.list": c({ after: "integer", epoch: "integer" }, ["after", "epoch"]),
  "snapshots.create": c({}, [], true),
  "snapshots.list": c(),
  "snapshots.manifest": c({ id: "string" }, ["id"]),
  "snapshots.download": c({ id: "string", versionId: "string" }, [
    "id",
    "versionId",
  ]),
  "snapshots.restore": c(
    { id: "string", name: "string" },
    ["id", "name"],
    true,
  ),
  "shares.create": c(
    { versionId: "string", recipientId: "string", expiresAt: "integer" },
    ["versionId", "recipientId", "expiresAt"],
    true,
  ),
  "shares.download": c({ token: "string" }, ["token"]),
  "shares.revoke": c({ id: "string" }, ["id"], true),
  "devices.register": c({ name: "string" }, ["name"], true),
  "devices.revoke": c({ id: "string" }, ["id"], true),
  "documents.consent": c({ enabled: "boolean" }, ["enabled"], true),
  "documents.index": c({ versionId: "string" }, ["versionId"], true),
  "documents.search": c({ query: "string" }, ["query"]),
};
function invalid(): never {
  throw new CloudError("INVALID_ARGUMENT");
}
function validateFields(value: any, contract: Contract) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  for (const name of contract.required) {
    if (!(name in value) || value[name] === undefined) invalid();
  }
  for (const [name, field] of Object.entries(value)) {
    if (field === undefined && !contract.required.includes(name)) continue;
    const kind = contract.fields[name];
    if (!kind) invalid();
    if (
      kind === "string" && (typeof field !== "string" || field.length > 1400000)
    ) invalid();
    if (
      kind === "nullable-string" && field !== null &&
      (typeof field !== "string" || field.length > 1024)
    ) invalid();
    if (
      kind === "integer" &&
      (typeof field !== "number" || !Number.isSafeInteger(field) || field < 0)
    ) {
      invalid();
    }
    if (kind === "boolean" && typeof field !== "boolean") invalid();
    if (kind === "backup-entries") {
      if (!Array.isArray(field) || field.length > 100000) invalid();
      for (const entry of field) {
        validateFields(
          entry,
          c({ path: "string", kind: "string", objectId: "string" }, [
            "path",
            "kind",
          ]),
        );
      }
    }
    if (kind === "patch") {
      validateFields(
        field,
        c({ name: "string", parentId: "nullable-string", trashed: "boolean" }),
      );
    }
  }
}
export function validateRequest(request: any) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    invalid();
  }
  const allowed = new Set([
    "operation",
    "workspaceId",
    "idempotencyKey",
    "args",
    "deviceId",
    "contractVersion",
  ]);
  if (Object.keys(request).some((k) => !allowed.has(k))) invalid();
  if (
    request.contractVersion !== undefined &&
    request.contractVersion !== "sandy-cloud.fixture.v1"
  ) throw new CloudError("CONTRACT_VERSION_UNSUPPORTED", 409);
  const contract = contracts[request.operation];
  if (!contract) throw new CloudError("UNKNOWN_OPERATION", 404);
  if (
    request.operation !== "workspaces.list" &&
    (typeof request.workspaceId !== "string" ||
      request.workspaceId.length > 1024)
  ) invalid();
  if (
    request.deviceId !== undefined &&
    (typeof request.deviceId !== "string" || request.deviceId.length > 1024)
  ) invalid();
  if (
    contract.idempotent &&
    (typeof request.idempotencyKey !== "string" ||
      request.idempotencyKey.length < 8 || request.idempotencyKey.length > 200)
  ) invalid();
  validateFields(request.args ?? {}, contract);
}
