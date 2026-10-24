import { deepStrictEqual, ok, throws } from "node:assert/strict";
import { type Actor, CloudDomain } from "./domain.ts";
import { backupFolder } from "./backup.ts";
import { restoreLocal } from "./restore_local.ts";
Deno.test("independent protected-folder backup survives deletion and mass modification without Drive nodes", async () => {
  const root = Deno.makeTempDirSync({ dir: "/tmp", prefix: "cloud-backup-" }),
    d = new CloudDomain(
      root + "/server",
      Deno.readTextFileSync(new URL("./schema.sql", import.meta.url)),
    ),
    actor: Actor = { id: "a", tenantId: "a" };
  d.seedWorkspace("w", "a", "Personal", [["a", "owner"]]);
  try {
    const device =
      d.registerDevice(actor, "w", crypto.randomUUID(), "synthetic").id;
    Deno.mkdirSync(root + "/protected");
    Deno.mkdirSync(root + "/protected/Folder");
    Deno.writeTextFileSync(
      root + "/protected/Folder/one.txt",
      "historical one",
    );
    Deno.writeTextFileSync(root + "/protected/two.txt", "historical two");
    const options = {
        domain: d,
        actor,
        workspaceId: "w",
        deviceId: device,
        root: root + "/protected",
        runKey: "synthetic-run-one",
      },
      first = await backupFolder(options);
    deepStrictEqual(await backupFolder(options), first);
    deepStrictEqual(d.list(actor, "w"), []);
    Deno.removeSync(root + "/protected/Folder/one.txt");
    Deno.writeTextFileSync(
      root + "/protected/two.txt",
      "corrupt current bytes",
    );
    const second = await backupFolder({
      ...options,
      runKey: "synthetic-run-two",
    });
    ok(first.id !== second.id);
    const manifest = d.backupManifest(actor, "w", first.id);
    const result = await restoreLocal({
      destination: root + "/clean",
      manifest,
      download: async (id) => d.backupDownload(actor, "w", first.id, id).bytes,
      signal: new AbortController().signal,
    });
    deepStrictEqual(result.state, "RESTORE_BYTES_VERIFIED");
    deepStrictEqual(
      Deno.readTextFileSync(root + "/clean/Folder/one.txt"),
      "historical one",
    );
    deepStrictEqual(
      Deno.readTextFileSync(root + "/clean/two.txt"),
      "historical two",
    );
    throws(
      () => d.run("DELETE FROM backup_snapshots WHERE id=?", first.id),
      /IMMUTABLE_BACKUP_SNAPSHOT/,
    );
    throws(
      () => d.run("DELETE FROM backup_objects"),
      /IMMUTABLE_BACKUP_OBJECT/,
    );
    const secondManifest = d.backupManifest(actor, "w", second.id);
    const extra = manifest.entries.find((e: any) =>
      e.path === "Folder/one.txt"
    ).versionId;
    throws(() => d.backupDownload(actor, "w", second.id, extra), /NOT_FOUND/);
    ok(secondManifest.entries.length < manifest.entries.length);
  } finally {
    d.close();
    Deno.removeSync(root, { recursive: true });
  }
});
