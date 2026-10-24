import { validateRequest } from "./contracts.ts";
import { Actor, CloudDomain, CloudError } from "./domain.ts";
/** Versioned fixture API dispatcher. Production installation must supply the
 * canonical Sandy API identity/admission wrapper; no direct provider endpoint.
 */
export const contractVersion = "sandy-cloud.fixture.v1";
export function dispatch(
  domain: CloudDomain,
  actor: Actor,
  request: Record<string, any>,
): any {
  validateRequest(request);
  const { operation, workspaceId: w, idempotencyKey: key, args = {} } = request;
  if (
    typeof operation !== "string" || typeof args !== "object" ||
    args === null || Array.isArray(args)
  ) throw new CloudError("INVALID_ARGUMENT");
  if (operation === "workspaces.list") return domain.workspaces(actor);
  if (typeof w !== "string") throw new CloudError("INVALID_WORKSPACE");
  if (request.deviceId) domain.assertDevice(actor, w, request.deviceId);
  switch (operation) {
    case "nodes.list":
      return domain.list(actor, w, args.parentId ?? null, args.trash === true);
    case "nodes.page":
      return domain.listPage(actor, w, args);
    case "nodes.folder":
      return domain.folder(actor, w, key, args.name, args.parentId ?? null);
    case "nodes.change":
      return domain.changeNode(
        actor,
        w,
        key,
        args.id,
        args.revision,
        args.patch ?? {},
      );
    case "backups.upload.start":
      return domain.startUpload(actor, w, key, args, true);
    case "backups.upload.complete":
      return domain.completeBackup(actor, w, key, args.id);
    case "backups.seal":
      return domain.sealBackup(actor, w, key, args.deviceId, args.entries);
    case "backups.manifest":
      return domain.backupManifest(actor, w, args.id);
    case "backups.download":
      return domain.backupDownload(actor, w, args.id, args.objectId);
    case "uploads.start":
      return domain.startUpload(actor, w, key, args);
    case "uploads.status": {
      const u = domain.upload(actor, w, args.id);
      return { id: u.id, offset: u.received, state: u.state };
    }
    case "uploads.chunk": {
      if (typeof args.base64 !== "string" || args.base64.length > 1400000) {
        throw new CloudError("INVALID_CHUNK");
      }
      let bytes: Uint8Array;
      try {
        bytes = Uint8Array.from(atob(args.base64), (c) => c.charCodeAt(0));
      } catch {
        throw new CloudError("INVALID_CHUNK");
      }
      return domain.chunk(actor, w, args.id, args.offset, bytes);
    }
    case "uploads.complete":
      return domain.complete(actor, w, key, args.id);
    case "uploads.expire":
      return domain.expireUploads(actor, w);
    case "versions.list":
      return domain.history(actor, w, args.nodeId);
    case "versions.download":
      return domain.download(actor, w, args.id);
    case "changes.list":
      return domain.changes(actor, w, args.after, args.epoch);
    case "snapshots.create":
      return domain.snapshot(actor, w, key);
    case "snapshots.manifest":
      return domain.snapshotManifest(actor, w, args.id);
    case "snapshots.download":
      return domain.snapshotDownload(actor, w, args.id, args.versionId);
    case "documents.consent":
      return domain.setDocumentConsent(actor, w, key, args.enabled);
    case "documents.index":
      return domain.indexText(actor, w, key, args.versionId);
    case "documents.search":
      return domain.search(actor, w, args.query);
    case "snapshots.list":
      return domain.snapshots(actor, w);
    case "snapshots.restore":
      return domain.restore(actor, w, key, args.id, args.name);
    case "shares.create":
      return domain.createShare(
        actor,
        w,
        key,
        args.versionId,
        args.recipientId,
        args.expiresAt,
      );
    case "shares.download":
      return domain.sharedDownload(actor, w, args.token);
    case "shares.revoke":
      return domain.revokeShare(actor, w, key, args.id);
    case "devices.register":
      return domain.registerDevice(actor, w, key, args.name);
    case "devices.revoke":
      return domain.revokeDevice(actor, w, key, args.id);
    default:
      throw new CloudError("UNKNOWN_OPERATION", 404);
  }
}
export function apiHandler(
  domain: CloudDomain,
  authenticate: (req: Request) => Actor | null,
  origin: string,
) {
  return async (req: Request): Promise<Response> => {
    const headers = {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    };
    try {
      if (req.method !== "POST") {
        throw new CloudError("METHOD_NOT_ALLOWED", 405);
      }
      if (req.headers.get("origin") && req.headers.get("origin") !== origin) {
        throw new CloudError("FORBIDDEN", 403);
      }
      const actor = authenticate(req);
      if (!actor) throw new CloudError("UNAUTHENTICATED", 401);
      // A streaming body cap prevents unbounded JSON allocation even without length.
      const reader = req.body?.getReader();
      if (!reader) throw new CloudError("INVALID_ARGUMENT");
      const parts: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 1500000) throw new CloudError("BODY_TOO_LARGE", 413);
          parts.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const p of parts) {
        bytes.set(p, offset);
        offset += p.length;
      }
      let request;
      try {
        request = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new CloudError("INVALID_JSON");
      }
      if (!request || typeof request !== "object" || Array.isArray(request)) {
        throw new CloudError("INVALID_ARGUMENT");
      }
      const result = dispatch(domain, actor, request);
      if (result?.bytes instanceof Uint8Array) {
        return new Response(result.bytes, {
          headers: {
            "content-type": "application/octet-stream",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
            "x-content-sha256": result.version.sha256,
            "content-disposition": 'attachment; filename="sandy-fixture.bin"',
          },
        });
      }
      return new Response(
        JSON.stringify({ contractVersion, fixtureOnly: true, result }),
        { headers },
      );
    } catch (e) {
      const known = e instanceof CloudError;
      return new Response(
        JSON.stringify({
          contractVersion,
          error: known ? e.code : "INTERNAL_ERROR",
        }),
        { status: known ? e.status : 500, headers },
      );
    }
  };
}
