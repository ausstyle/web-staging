import {
  IntegrityError,
  type ObjectRef,
  type ReadPolicy,
  validateRef,
  verifyObject,
} from "./integrity.ts";

export interface SnapshotEntry {
  path: string;
  kind: "file" | "directory";
  ref?: ObjectRef;
}
export interface SnapshotManifest {
  id: string;
  tenantId: string;
  workspaceId: string;
  entries: SnapshotEntry[];
}
function invalid(): never {
  throw new IntegrityError("INVALID_MANIFEST");
}

/** Portable restore paths. Never follow an absolute path, device name, ADS,
 * traversal, symlink or Unicode/case alias. Preserve original spelling on disk.
 * Native restore writer must also use no-follow, directory-relative file opens;
 * string validation alone cannot prevent a concurrent symlink substitution.
 */
export function portablePath(path: string): string {
  if (
    typeof path !== "string" || path.length === 0 || path.length > 2048 ||
    /[\\:\u0000-\u001f\u007f<>"|?*]/u.test(path)
  ) invalid();
  const parts = path.split("/");
  if (
    parts.length > 64 ||
    parts.some((part) =>
      !part || part === "." || part === ".." || /[ .]$/u.test(part) ||
      new TextEncoder().encode(part).length > 255 ||
      /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part)
    )
  ) invalid();
  return path.normalize("NFC").toLowerCase();
}

export function validateManifest(
  manifest: SnapshotManifest,
  policy: ReadPolicy,
): void {
  if (
    manifest.tenantId !== policy.tenantId ||
    manifest.workspaceId !== policy.workspaceId
  ) {
    throw new IntegrityError("NOT_FOUND");
  }
  if (
    !manifest.id || !Array.isArray(manifest.entries) ||
    manifest.entries.length > 100000
  ) invalid();
  const paths = new Map<string, SnapshotEntry>();
  let total = 0;
  for (const entry of manifest.entries) {
    const key = portablePath(entry.path);
    if (paths.has(key) || !["file", "directory"].includes(entry.kind)) {
      invalid();
    }
    if (entry.kind === "directory" && entry.ref !== undefined) invalid();
    if (entry.kind === "file") {
      if (!entry.ref) invalid();
      validateRef(entry.ref, policy);
      if (!Number.isSafeInteger(entry.ref.size) || entry.ref.size < 0) {
        invalid();
      }
      total += entry.ref.size;
      if (!Number.isSafeInteger(total) || total > policy.maxBytes) invalid();
    }
    paths.set(key, entry);
  }
  for (const key of paths.keys()) {
    const parent = key.slice(0, key.lastIndexOf("/"));
    if (key.includes("/") && paths.get(parent)?.kind !== "directory") invalid();
  }
}

export interface RestoreTarget {
  /** Enumerate exact target tree with lstat/no-follow, not the source manifest. */
  list(): Promise<Array<{ path: string; kind: "file" | "directory" }>>;
  /** Independently reopen restored bytes with no-follow, relative to target root.
   * Source object reader must never be passed as the restore target reader.
   */
  open(path: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array>>;
}

/** Pure verification; does not overwrite/delete a target, set a backup protection
 * flag or claim immutable retention. The native caller must ensure a quiescent
 * clean target and persist this evidence through the canonical receipt service.
 */
export async function verifyRestore(
  input: SnapshotManifest,
  policy: ReadPolicy,
  target: RestoreTarget,
): Promise<
  {
    state: "RESTORE_BYTES_VERIFIED";
    snapshotId: string;
    files: number;
    bytes: number;
  }
> {
  const manifest = structuredClone(input);
  validateManifest(manifest, policy);
  policy.signal.throwIfAborted();
  const actual = await target.list();
  const expected = new Map(manifest.entries.map((e) => [e.path, e]));
  const seen = new Set<string>();
  if (actual.length !== expected.size) {
    throw new IntegrityError("RESTORE_TREE_MISMATCH");
  }
  for (const entry of actual) {
    if (seen.has(entry.path) || expected.get(entry.path)?.kind !== entry.kind) {
      throw new IntegrityError("RESTORE_TREE_MISMATCH");
    }
    seen.add(entry.path);
  }
  let files = 0, bytes = 0;
  for (const entry of manifest.entries) {
    if (entry.kind !== "file") continue;
    const ref = entry.ref!;
    await verifyObject(ref, policy, async (reference, signal) => ({
      ref: { ...reference },
      body: await target.open(entry.path, signal),
    }));
    files++;
    bytes += ref.size;
  }
  policy.signal.throwIfAborted();
  return {
    state: "RESTORE_BYTES_VERIFIED",
    snapshotId: manifest.id,
    files,
    bytes,
  };
}
