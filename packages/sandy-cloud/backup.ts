/** Independent local protected-folder capture. No Drive node mutation. A caller
 * may invoke this from the existing worker scheduler; this module adds no queue.
 * Native snapshot consistency for live databases remains an OS acceptance gate.
 */
import { type Actor, CloudDomain, digest } from "./domain.ts";
import { portablePath } from "./restore.ts";
export async function backupFolder(
  options: {
    domain: CloudDomain;
    actor: Actor;
    workspaceId: string;
    deviceId: string;
    root: string;
    runKey: string;
  },
) {
  const { domain: d, actor, workspaceId: w, deviceId, root, runKey } = options;
  d.assertDevice(actor, w, deviceId);
  const stat = Deno.lstatSync(root);
  if (!stat.isDirectory || stat.isSymlink) throw Error("INVALID_BACKUP_ROOT");
  const entries: Array<{ path: string; kind: string; objectId?: string }> = [];
  let total = 0;
  const walk = (prefix: string, depth: number) => {
    if (depth > 64 || entries.length > 100000) throw Error("BACKUP_LIMIT");
    for (const item of Deno.readDirSync(root + "/" + prefix)) {
      if (item.isSymlink) throw Error("SYMLINK_REFUSED");
      const path = prefix ? prefix + "/" + item.name : item.name;
      portablePath(path);
      if (item.isDirectory) {
        entries.push({ path, kind: "directory" });
        walk(path, depth + 1);
        continue;
      }
      if (!item.isFile) throw Error("UNSUPPORTED_BACKUP_FILE");
      const bytes = Deno.readFileSync(root + "/" + path);
      total += bytes.length;
      if (total > 64 * 1024 * 1024) throw Error("BACKUP_LIMIT");
      const sha = digest(bytes);
      d.assertDevice(actor, w, deviceId);
      const key = "backup-" + digest(JSON.stringify([runKey, path, sha]));
      const upload = d.startUpload(actor, w, key, {
          name: item.name,
          size: bytes.length,
          sha256: sha,
          expectedRevision: 0,
        }, true),
        state = d.upload(actor, w, upload.id);
      for (
        let offset = state.received;
        offset < bytes.length;
        offset += 65536
      ) {
        d.assertDevice(actor, w, deviceId);
        d.chunk(
          actor,
          w,
          upload.id,
          offset,
          bytes.subarray(offset, offset + 65536),
        );
      }
      const object = d.completeBackup(actor, w, key + "-complete", upload.id)
        .object!;
      // Detect a changing source and fail the recovery point rather than call an
      // inconsistent live application database snapshot complete.
      if (digest(Deno.readFileSync(root + "/" + path)) !== sha) {
        throw Error("SOURCE_CHANGED_DURING_BACKUP");
      }
      entries.push({ path, kind: "file", objectId: object.id });
    }
  };
  walk("", 0);
  return d.sealBackup(
    actor,
    w,
    "seal-" + digest(runKey),
    deviceId,
    entries.sort((a, b) => a.path.localeCompare(b.path)),
  );
}
