/** Selective folder-tree sync engine for fixture acceptance. Not an OS installer,
 * watcher, native snapshot engine or production device-identity implementation.
 */
import { digest } from "./domain.ts";
import { portablePath } from "./restore.ts";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
export interface SyncTransport {
  call(operation: string, args?: any, key?: string): Promise<any>;
  download(versionId: string): Promise<Uint8Array>;
}
interface Entry {
  nodeId: string;
  revision: number;
  sha256: string;
  versionId: string;
}
interface Journal {
  files: Record<string, Entry>;
}
function readSafe(path: string): Uint8Array {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) {
      throw Error("UNSUPPORTED_LOCAL_FILE");
    }
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}
function safeName(name: string) {
  portablePath(name);
  if (name.split("/").some((part) => part.startsWith(".sandy-"))) {
    throw Error("UNSUPPORTED_SYNC_NAME");
  }
  return name;
}
async function keyFor(bytes: Uint8Array) {
  return await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(bytes),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
export async function readJournal(
  path: string,
  key: Uint8Array,
): Promise<Journal> {
  try {
    const envelope = Deno.readFileSync(path);
    if (envelope.length < 29) throw Error("INVALID_JOURNAL");
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: envelope.subarray(0, 12) },
      await keyFor(key),
      envelope.subarray(12),
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return { files: {} };
    throw Error("JOURNAL_DECRYPT_FAILED");
  }
}
async function saveJournal(path: string, key: Uint8Array, journal: Journal) {
  const iv = crypto.getRandomValues(new Uint8Array(12)),
    encrypted = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        await keyFor(key),
        new TextEncoder().encode(JSON.stringify(journal)),
      ),
    );
  const envelope = new Uint8Array(iv.length + encrypted.length);
  envelope.set(iv);
  envelope.set(encrypted, iv.length);
  const temp = path + "." + crypto.randomUUID();
  Deno.writeFileSync(temp, envelope, { createNew: true, mode: 0o600 });
  const fd = Deno.openSync(temp, { write: true });
  try {
    fd.syncSync();
  } finally {
    fd.close();
  }
  Deno.renameSync(temp, path);
}
function ensureLocalParent(root: string, path: string) {
  const parts = path.split("/").slice(0, -1);
  let current = root;
  for (const part of parts) {
    current += "/" + part;
    try {
      Deno.mkdirSync(current, { mode: 0o700 });
    } catch (e) {
      if (!(e instanceof Deno.errors.AlreadyExists)) throw e;
    }
    const stat = Deno.lstatSync(current);
    if (!stat.isDirectory || stat.isSymlink) throw Error("SYMLINK_REFUSED");
  }
}
const leaf = (path: string) => path.split("/").at(-1)!;
const parentPath = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
function writeTarget(root: string, name: string, bytes: Uint8Array) {
  safeName(name);
  ensureLocalParent(root, name);
  const temp = root + "/.sandy-" + crypto.randomUUID();
  Deno.writeFileSync(temp, bytes, { createNew: true, mode: 0o600 });
  const f = Deno.openSync(temp, { write: true });
  try {
    f.syncSync();
  } finally {
    f.close();
  }
  // Preserve the target atomically before installing incoming bytes. A local
  // edit racing the earlier scan is retained, never overwritten out of existence.
  const recovery = root + "/.sandy-recovery";
  try {
    const existing = Deno.lstatSync(root + "/" + name);
    if (!existing.isFile || existing.isSymlink) {
      throw Error("UNSAFE_SYNC_TARGET");
    }
    Deno.mkdirSync(recovery, { recursive: true, mode: 0o700 });
    if (Deno.lstatSync(recovery).isSymlink) throw Error("SYMLINK_REFUSED");
    Deno.renameSync(
      root + "/" + name,
      recovery + "/" + crypto.randomUUID() + "-" + name.replaceAll("/", "__"),
    );
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  try {
    Deno.linkSync(temp, root + "/" + name);
  } finally {
    Deno.removeSync(temp);
  }
}
async function syncPass(
  options: {
    root: string;
    journalPath: string;
    journalKey: Uint8Array;
    deviceId: string;
    transport: SyncTransport;
  },
) {
  const { root, journalPath, journalKey, deviceId, transport: t } = options;
  const stat = Deno.lstatSync(root);
  if (!stat.isDirectory || stat.isSymlink) throw Error("INVALID_SYNC_ROOT");
  if (journalKey.length !== 32 || journalPath.startsWith(root + "/")) {
    throw Error("INVALID_JOURNAL_CONFIGURATION");
  }
  const journal = await readJournal(journalPath, journalKey);
  let uploaded = 0, downloaded = 0, conflicts = 0, retainedDeletes = 0;
  const call = async (op: string, args: any = {}, key?: string) =>
    await t.call(op, args, key);
  // Device eligibility must be rechecked on every server request by transport.
  const listTree = async () => {
    const found: any[] = [];
    const visit = async (
      parentId: string | null,
      prefix: string,
      depth: number,
    ) => {
      if (depth > 64 || found.length > 100000) throw Error("TREE_LIMIT");
      for (const n of await call("nodes.list", { parentId })) {
        const path = prefix ? prefix + "/" + n.name : n.name;
        safeName(path);
        found.push({ ...n, path });
        if (n.kind === "directory") await visit(n.id, path, depth + 1);
      }
    };
    await visit(null, "", 0);
    return found;
  };
  let remote: any[] = await listTree();
  const byId = () => new Map(remote.map((n) => [n.id, n]));
  const ensureFolder = async (path: string): Promise<string | null> => {
    if (!path) return null;
    const existing = remote.find((n) => n.path === path);
    if (existing) {
      if (existing.kind !== "directory") throw Error("REMOTE_PATH_CONFLICT");
      return existing.id;
    }
    const parentId = await ensureFolder(parentPath(path));
    const created = await call(
      "nodes.folder",
      { name: leaf(path), parentId },
      "sync-folder-" + deviceId + "-" + digest(path),
    );
    remote.push({ ...created, path });
    return created.id;
  };
  const local = new Map<string, Uint8Array>();
  let localBytes = 0;
  const scan = async (prefix: string, depth: number) => {
    if (depth > 64 || local.size > 100000) throw Error("TREE_LIMIT");
    for (const e of Deno.readDirSync(root + "/" + prefix)) {
      if (e.name.startsWith(".sandy-")) continue;
      if (e.isSymlink) throw Error("SYMLINK_REFUSED");
      const path = prefix ? prefix + "/" + e.name : e.name;
      safeName(path);
      if (e.isDirectory) {
        await scan(path, depth + 1);
        continue;
      }
      if (!e.isFile) throw Error("UNSUPPORTED_LOCAL_FILE");
      const bytes = readSafe(root + "/" + path);
      localBytes += bytes.length;
      if (localBytes > 64 * 1024 * 1024) throw Error("SYNC_COHORT_LIMIT");
      local.set(path, bytes);
    }
  };
  await scan("", 0);
  // Reconcile server renames without leaving a second stale local path.
  for (const [name, prior] of Object.entries(journal.files)) {
    const node = byId().get(prior.nodeId), bytes = local.get(name);
    if (node && node.path !== name && bytes && digest(bytes) === prior.sha256) {
      safeName(node.path);
      if (local.has(node.path)) throw Error("LOCAL_RENAME_COLLISION");
      if (digest(readSafe(root + "/" + name)) !== prior.sha256) {
        throw Error("LOCAL_FILE_CHANGED_DURING_SYNC");
      }
      ensureLocalParent(root, node.path);
      Deno.linkSync(root + "/" + name, root + "/" + node.path);
      Deno.removeSync(root + "/" + name);
      local.delete(name);
      local.set(node.path, bytes);
      delete journal.files[name];
      journal.files[node.path] = { ...prior, revision: node.revision };
    }
  }
  // A unique unchanged content match identifies a local rename. Ambiguous
  // duplicates remain independent create/delete operations instead of guessing.
  for (const [name, bytes] of local) {
    if (journal.files[name]) continue;
    const matches = Object.entries(journal.files).filter(([old, entry]) =>
      !local.has(old) && entry.sha256 === digest(bytes)
    );
    if (matches.length !== 1) continue;
    const [old, entry] = matches[0], node = byId().get(entry.nodeId);
    if (!node || node.revision !== entry.revision) continue;
    const changed = await call(
      "nodes.change",
      {
        id: node.id,
        revision: node.revision,
        patch: {
          name: leaf(name),
          parentId: await ensureFolder(parentPath(name)),
        },
      },
      "rename-" + deviceId + "-" +
        digest(JSON.stringify([node.id, node.revision, name])),
    );
    delete journal.files[old];
    journal.files[name] = { ...entry, revision: changed.revision };
    remote = remote.map((n) =>
      n.id === changed.id ? { ...changed, path: name } : n
    );
  }
  const upload = async (name: string, bytes: Uint8Array, node?: any) => {
    const sha = digest(bytes),
      key = "sync-" + deviceId + "-" +
        digest(
          JSON.stringify([name, sha, node?.id ?? null, node?.revision ?? 0]),
        );
    const u = await call("uploads.start", {
      name: leaf(name),
      parentId: await ensureFolder(parentPath(name)),
      size: bytes.length,
      sha256: sha,
      nodeId: node?.id,
      expectedRevision: node?.revision ?? 0,
    }, key);
    const status = await call("uploads.status", { id: u.id });
    if (status.state !== "COMMITTED") {
      for (let offset = status.offset; offset < bytes.length; offset += 65536) {
        const chunk = bytes.subarray(offset, offset + 65536);
        let binary = "";
        for (const b of chunk) {
          binary += String.fromCharCode(b);
        }
        await call("uploads.chunk", { id: u.id, offset, base64: btoa(binary) });
      }
    }
    const result = await call(
      "uploads.complete",
      { id: u.id },
      key + "-complete",
    );
    uploaded++;
    return {
      nodeId: result.version.node_id,
      revision: (node?.revision ?? 0) + 1,
      sha256: sha,
      versionId: result.version.id,
    };
  };
  // Upload local changes before processing remote changes. Conflicting edits are
  // retained as separate visible files, never silently chosen as the winner.
  for (const [name, bytes] of local) {
    const prior = journal.files[name],
      remoteNode = prior
        ? byId().get(prior.nodeId)
        : remote.find((n) => n.path === name);
    const sha = digest(bytes);
    if (prior && sha === prior.sha256) continue;
    if (remoteNode && prior && remoteNode.revision === prior.revision) {
      try {
        journal.files[name] = await upload(name, bytes, remoteNode);
        continue;
      } catch (e) {
        if (!String(e).includes("STALE_REVISION")) throw e;
      }
    }
    if (!remoteNode && !prior) {
      journal.files[name] = await upload(name, bytes);
      continue;
    }
    // Stable content-derived conflict name makes retry after local crash safe.
    const conflict = (parentPath(name) ? parentPath(name) + "/" : "") +
      leaf(name).slice(0, 100) + " (conflict " + deviceId.slice(0, 8) +
      " " + sha.slice(0, 8) + ")";
    journal.files[conflict] = await upload(conflict, bytes);
    conflicts++;
    if (digest(readSafe(root + "/" + name)) !== sha) {
      throw Error("LOCAL_FILE_CHANGED_DURING_SYNC");
    }
    Deno.linkSync(root + "/" + name, root + "/" + conflict);
    Deno.removeSync(root + "/" + name);
    local.delete(name);
    local.set(conflict, bytes);
    delete journal.files[name];
  }
  // A local deletion is conditional on the last observed remote revision.
  for (const [name, prior] of Object.entries(journal.files)) {
    if (local.has(name)) continue;
    const node = byId().get(prior.nodeId);
    if (node) {
      try {
        await call("nodes.change", {
          id: node.id,
          revision: prior.revision,
          patch: { trashed: true },
        }, "delete-" + deviceId + "-" + node.id + "-" + prior.revision);
      } catch (e) {
        if (!String(e).includes("STALE_REVISION")) throw e;
        continue;
      }
    }
    delete journal.files[name];
  }
  remote = await listTree();
  // Retain remote-deleted local bytes outside the active root file set.
  for (const [name, prior] of Object.entries(journal.files)) {
    if (!remote.some((n) => n.id === prior.nodeId) && local.has(name)) {
      const recovery = root + "/.sandy-recovery";
      Deno.mkdirSync(recovery, { recursive: true, mode: 0o700 });
      if (Deno.lstatSync(recovery).isSymlink) throw Error("SYMLINK_REFUSED");
      Deno.renameSync(
        root + "/" + name,
        recovery + "/" + crypto.randomUUID() + "-" + name.replaceAll("/", "__"),
      );
      retainedDeletes++;
      delete journal.files[name];
    }
  }
  for (const node of remote) {
    if (node.kind !== "file") continue;
    safeName(node.path);
    const prior = journal.files[node.path];
    if (prior?.versionId === node.current_version_id) continue;
    const bytes = await t.download(node.current_version_id);
    // If user changed a local file after the scan, keep it and retry next pass.
    try {
      const current = readSafe(root + "/" + node.path);
      const scanned = local.get(node.path);
      if (!scanned || digest(current) !== digest(scanned)) {
        throw Error("LOCAL_FILE_CHANGED_DURING_SYNC");
      }
    } catch (e) {
      if (
        !(e instanceof Deno.errors.NotFound) &&
        !(e instanceof Error && "code" in e && e.code === "ENOENT")
      ) throw e;
    }
    writeTarget(root, node.path, bytes);
    journal.files[node.path] = {
      nodeId: node.id,
      revision: node.revision,
      sha256: digest(bytes),
      versionId: node.current_version_id,
    };
    downloaded++;
  }
  await saveJournal(journalPath, journalKey, journal);
  return {
    uploaded,
    downloaded,
    conflicts,
    retainedDeletes,
    scope: "local-selective-folder-tree",
  };
}

/** One writer per encrypted journal. A process killed while holding the lock
 * leaves a visible stale lock: recovery requires checking its process, never a
 * timeout-based lock steal that could run two clients concurrently. */
export async function syncOnce(options: Parameters<typeof syncPass>[0]) {
  const path = options.journalPath + ".lock";
  let lock: Deno.FsFile;
  try {
    lock = Deno.openSync(path, { write: true, createNew: true, mode: 0o600 });
  } catch (e) {
    if (e instanceof Deno.errors.AlreadyExists) {
      throw Error("SYNC_ALREADY_RUNNING_OR_RECOVERY_REQUIRED");
    }
    throw e;
  }
  try {
    lock.writeSync(
      new TextEncoder().encode(
        JSON.stringify({ pid: Deno.pid, createdAt: Date.now() }),
      ),
    );
    lock.syncSync();
    return await syncPass(options);
  } finally {
    lock.close();
    Deno.removeSync(path);
  }
}
