/** Local Linux filesystem integration only: not GCS or native OS acceptance. */
import { deepStrictEqual, rejects } from "node:assert/strict";
import { createHash } from "node:crypto";
import { type ObjectRef, type ReadPolicy } from "./integrity.ts";
import { type RestoreTarget, verifyRestore } from "./restore.ts";

Deno.test("independent clean-target readback checks a 32 MiB synthetic file on disk", async () => {
  const root = await Deno.makeTempDir({
    dir: "/tmp",
    prefix: "sandy-cloud-fixture-",
  });
  try {
    await Deno.mkdir(`${root}/Folder`);
    const targetPath = `${root}/Folder/fixture.bin`;
    const file = await Deno.open(targetPath, { createNew: true, write: true });
    const hash = createHash("sha256");
    const block = new Uint8Array(64 * 1024);
    for (let i = 0; i < block.length; i++) block[i] = i % 251;
    try {
      for (let i = 0; i < 512; i++) {
        hash.update(block);
        let offset = 0;
        while (offset < block.length) {
          offset += await file.write(block.subarray(offset));
        }
      }
      await file.sync();
    } finally {
      file.close();
    }
    const ref: ObjectRef = {
      tenantId: "synthetic-tenant",
      workspaceId: "synthetic-workspace",
      bucket: "synthetic-provider",
      key: "fixture",
      generation: "1",
      size: block.length * 512,
      sha256: hash.digest("hex"),
    };
    const policy: ReadPolicy = {
      tenantId: ref.tenantId,
      workspaceId: ref.workspaceId,
      allowedBuckets: new Set([ref.bucket]),
      maxBytes: ref.size,
      signal: new AbortController().signal,
    };
    const target: RestoreTarget = {
      async list() {
        const paths: Array<{ path: string; kind: "file" | "directory" }> = [];
        async function visit(prefix: string) {
          for await (const entry of Deno.readDir(`${root}/${prefix}`)) {
            if (entry.isSymlink) throw Error("symlink refused");
            const path = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (!entry.isDirectory && !entry.isFile) {
              throw Error("special file refused");
            }
            paths.push({
              path,
              kind: entry.isDirectory ? "directory" : "file",
            });
            if (entry.isDirectory) await visit(path);
          }
        }
        await visit("");
        return paths;
      },
      async open(path) {
        // The test owns an isolated, quiescent directory. This is NOT a native
        // no-follow production adapter and makes no concurrent attacker claim.
        const restored = await Deno.open(`${root}/${path}`, { read: true });
        return restored.readable;
      },
    };
    const manifest = {
      id: "synthetic-snapshot",
      tenantId: ref.tenantId,
      workspaceId: ref.workspaceId,
      entries: [
        { path: "Folder", kind: "directory" as const },
        { path: "Folder/fixture.bin", kind: "file" as const, ref },
      ],
    };
    deepStrictEqual(await verifyRestore(manifest, policy, target), {
      state: "RESTORE_BYTES_VERIFIED",
      snapshotId: manifest.id,
      files: 1,
      bytes: ref.size,
    });
    const corrupt = await Deno.open(targetPath, { write: true });
    try {
      await corrupt.write(new Uint8Array([255]));
    } finally {
      corrupt.close();
    }
    await rejects(verifyRestore(manifest, policy, target), /CHECKSUM_MISMATCH/);
    await Deno.writeTextFile(`${root}/extra`, "not in manifest");
    await rejects(
      verifyRestore(manifest, policy, target),
      /RESTORE_TREE_MISMATCH/,
    );
  } finally {
    // Only this test-created synthetic directory is removed.
    await Deno.remove(root, { recursive: true });
  }
});
