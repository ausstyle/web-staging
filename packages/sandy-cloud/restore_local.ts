import { digest } from "./domain.ts";
import {
  type SnapshotManifest,
  validateManifest,
  verifyRestore,
} from "./restore.ts";
import { type ReadPolicy } from "./integrity.ts";
/** Clean-directory fixture restore; never overwrites an existing destination.
 * Only use in a private quiescent synthetic directory. Native directory-relative
 * handles/OS snapshot and ACL restore remain required before desktop release.
 */
export async function restoreLocal(
  options: {
    destination: string;
    manifest: SnapshotManifest & { entries: Array<any> };
    download: (versionId: string) => Promise<Uint8Array>;
    signal: AbortSignal;
  },
) {
  const { destination, manifest, download, signal } = options;
  const policy: ReadPolicy = {
    tenantId: manifest.tenantId,
    workspaceId: manifest.workspaceId,
    allowedBuckets: new Set(["local-fixture"]),
    maxBytes: 64 * 1024 * 1024,
    signal,
  };
  validateManifest(manifest, policy);
  signal.throwIfAborted();
  // createNew directory: an existing target (including symlink) is refused.
  Deno.mkdirSync(destination, { mode: 0o700 });
  const entries = [...manifest.entries].sort((a, b) =>
    a.path.split("/").length - b.path.split("/").length
  );
  for (const entry of entries) {
    signal.throwIfAborted();
    const path = destination + "/" + entry.path;
    if (entry.kind === "directory") {
      Deno.mkdirSync(path, { mode: 0o700 });
      continue;
    }
    const bytes = await download(entry.versionId);
    if (bytes.length !== entry.ref.size || digest(bytes) !== entry.ref.sha256) {
      throw Error("CHECKSUM_MISMATCH");
    }
    Deno.writeFileSync(path, bytes, { createNew: true, mode: 0o600 });
    const f = Deno.openSync(path, { write: true });
    try {
      f.syncSync();
    } finally {
      f.close();
    }
  }
  return await verifyRestore(manifest, policy, {
    async list() {
      const entries: Array<{ path: string; kind: "file" | "directory" }> = [];
      const visit = (prefix: string) => {
        for (const e of Deno.readDirSync(destination + "/" + prefix)) {
          if (e.isSymlink || (!e.isFile && !e.isDirectory)) {
            throw Error("UNSAFE_RESTORE_TARGET");
          }
          const path = prefix ? prefix + "/" + e.name : e.name;
          entries.push({ path, kind: e.isDirectory ? "directory" : "file" });
          if (e.isDirectory) visit(path);
        }
      };
      visit("");
      return entries;
    },
    async open(path) {
      if (Deno.lstatSync(destination + "/" + path).isSymlink) {
        throw Error("UNSAFE_RESTORE_TARGET");
      }
      return (await Deno.open(destination + "/" + path, { read: true }))
        .readable;
    },
  });
}
