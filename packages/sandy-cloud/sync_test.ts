import { deepStrictEqual, ok, rejects } from "node:assert/strict";
import { type Actor, CloudDomain } from "./domain.ts";
import { dispatch } from "./api.ts";
import { readJournal, syncOnce, type SyncTransport } from "./sync.ts";
Deno.test("two local devices preserve offline conflicting edits, deletion history and encrypted journals", async () => {
  const root = Deno.makeTempDirSync({ dir: "/tmp", prefix: "cloud-sync-" }),
    schema = Deno.readTextFileSync(new URL("./schema.sql", import.meta.url));
  const d = new CloudDomain(root + "/server", schema),
    actor: Actor = { id: "alice", tenantId: "a" };
  d.seedWorkspace("w", "a", "Personal", [["alice", "owner"]]);
  try {
    const device = (name: string) => {
      const id = d.registerDevice(actor, "w", crypto.randomUUID(), name).id,
        dir = root + "/" + name;
      Deno.mkdirSync(dir);
      const key = crypto.getRandomValues(new Uint8Array(32));
      const transport: SyncTransport = {
        call: async (
          operation,
          args = {},
          idempotencyKey = crypto.randomUUID(),
        ) =>
          dispatch(d, actor, {
            operation,
            args,
            idempotencyKey,
            workspaceId: "w",
            deviceId: id,
          }),
        download: async (version) => {
          d.assertDevice(actor, "w", id);
          return d.download(actor, "w", version).bytes;
        },
      };
      return {
        root: dir,
        journalPath: root + "/" + name + ".journal",
        journalKey: key,
        deviceId: id,
        transport,
      };
    };
    const a = device("device-a"), b = device("device-b");
    Deno.writeTextFileSync(a.root + "/note.txt", "original");
    await syncOnce(a);
    await syncOnce(b);
    deepStrictEqual(Deno.readTextFileSync(b.root + "/note.txt"), "original");
    Deno.writeTextFileSync(a.root + "/note.txt", "edit A offline");
    Deno.writeTextFileSync(b.root + "/note.txt", "edit B offline");
    await syncOnce(a);
    const outcome = await syncOnce(b);
    deepStrictEqual(outcome.conflicts, 1);
    await syncOnce(a);
    const versions = d.list(actor, "w").map((n) =>
      new TextDecoder().decode(
        d.download(actor, "w", n.current_version_id).bytes,
      )
    );
    ok(versions.includes("edit A offline"));
    ok(versions.includes("edit B offline"));
    const snap = d.snapshot(actor, "w", crypto.randomUUID());
    Deno.removeSync(a.root + "/note.txt");
    await syncOnce(a);
    const deletion = await syncOnce(b);
    deepStrictEqual(deletion.retainedDeletes, 1);
    const restored = d.restore(
      actor,
      "w",
      crypto.randomUUID(),
      snap.id,
      "Recovered",
    );
    ok(d.list(actor, "w", restored.folder).length >= 2);
    const journal = Deno.readFileSync(a.journalPath);
    ok(!new TextDecoder().decode(journal).includes("note.txt"));
    await rejects(
      readJournal(a.journalPath, crypto.getRandomValues(new Uint8Array(32))),
      /JOURNAL_DECRYPT_FAILED/,
    );
    d.revokeDevice(actor, "w", crypto.randomUUID(), b.deviceId);
    await rejects(syncOnce(b), /DEVICE_REVOKED/);
  } finally {
    d.close();
    Deno.removeSync(root, { recursive: true });
  }
});
Deno.test("local and remote renames preserve stable node identity without stale duplicate paths", async () => {
  const root = Deno.makeTempDirSync({ dir: "/tmp", prefix: "cloud-rename-" }),
    d = new CloudDomain(
      root + "/server",
      Deno.readTextFileSync(new URL("./schema.sql", import.meta.url)),
    ),
    actor: Actor = { id: "a", tenantId: "a" };
  d.seedWorkspace("w", "a", "Personal", [["a", "owner"]]);
  try {
    const id = d.registerDevice(actor, "w", crypto.randomUUID(), "fixture").id,
      dir = root + "/files";
    Deno.mkdirSync(dir);
    const options = {
      root: dir,
      journalPath: root + "/journal",
      journalKey: crypto.getRandomValues(new Uint8Array(32)),
      deviceId: id,
      transport: {
        call: async (
          operation: string,
          args: any = {},
          key = crypto.randomUUID(),
        ) =>
          dispatch(d, actor, {
            operation,
            args,
            workspaceId: "w",
            deviceId: id,
            idempotencyKey: key,
          }),
        download: async (version: string) =>
          d.download(actor, "w", version).bytes,
      },
    };
    Deno.writeTextFileSync(dir + "/before.txt", "same");
    await syncOnce(options);
    const first = d.list(actor, "w")[0];
    Deno.renameSync(dir + "/before.txt", dir + "/local.txt");
    await syncOnce(options);
    const renamed = d.list(actor, "w")[0];
    deepStrictEqual(renamed.id, first.id);
    deepStrictEqual(renamed.name, "local.txt");
    d.changeNode(
      actor,
      "w",
      crypto.randomUUID(),
      renamed.id,
      renamed.revision,
      { name: "remote.txt" },
    );
    await syncOnce(options);
    deepStrictEqual(
      [...Deno.readDirSync(dir)].filter((e) => !e.name.startsWith(".sandy-"))
        .map((e) => e.name),
      ["remote.txt"],
    );
  } finally {
    d.close();
    Deno.removeSync(root, { recursive: true });
  }
});
Deno.test("nested files and local folder moves sync without changing file identity", async () => {
  const root = Deno.makeTempDirSync({ dir: "/tmp", prefix: "cloud-move-" }),
    d = new CloudDomain(
      root + "/server",
      Deno.readTextFileSync(new URL("./schema.sql", import.meta.url)),
    ),
    actor: Actor = { id: "a", tenantId: "a" };
  d.seedWorkspace("w", "a", "Personal", [["a", "owner"]]);
  try {
    const make = (name: string) => {
      const id = d.registerDevice(actor, "w", crypto.randomUUID(), name).id,
        dir = root + "/" + name;
      Deno.mkdirSync(dir);
      return {
        root: dir,
        journalPath: root + "/" + name + ".journal",
        journalKey: crypto.getRandomValues(new Uint8Array(32)),
        deviceId: id,
        transport: {
          call: async (
            operation: string,
            args: any = {},
            key = crypto.randomUUID(),
          ) =>
            dispatch(d, actor, {
              operation,
              args,
              workspaceId: "w",
              deviceId: id,
              idempotencyKey: key,
            }),
          download: async (version: string) =>
            d.download(actor, "w", version).bytes,
        },
      };
    };
    const a = make("a"), b = make("b");
    Deno.mkdirSync(a.root + "/Folder");
    Deno.writeTextFileSync(a.root + "/Folder/file.txt", "nested");
    await syncOnce(a);
    await syncOnce(b);
    deepStrictEqual(
      Deno.readTextFileSync(b.root + "/Folder/file.txt"),
      "nested",
    );
    const old = d.all("SELECT id FROM nodes WHERE kind='file'")[0].id;
    Deno.mkdirSync(a.root + "/Moved");
    Deno.renameSync(a.root + "/Folder/file.txt", a.root + "/Moved/file.txt");
    await syncOnce(a);
    await syncOnce(b);
    deepStrictEqual(
      Deno.readTextFileSync(b.root + "/Moved/file.txt"),
      "nested",
    );
    deepStrictEqual(d.all("SELECT id FROM nodes WHERE kind='file'")[0].id, old);
    deepStrictEqual([...Deno.readDirSync(b.root + "/Folder")].length, 0);
  } finally {
    d.close();
    Deno.removeSync(root, { recursive: true });
  }
});
Deno.test("concurrent journal writers fail closed while the first sync owns its lock", async () => {
  const root = Deno.makeTempDirSync({ dir: "/tmp", prefix: "cloud-lock-" });
  Deno.mkdirSync(root + "/files");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => release = resolve);
  let entered!: () => void;
  const started = new Promise<void>((resolve) => entered = resolve);
  const options = {
    root: root + "/files",
    journalPath: root + "/journal",
    journalKey: crypto.getRandomValues(new Uint8Array(32)),
    deviceId: "synthetic-device",
    transport: {
      call: async () => {
        entered();
        await gate;
        return [];
      },
      download: async () => new Uint8Array(),
    },
  };
  try {
    const first = syncOnce(options);
    await started;
    await rejects(
      syncOnce(options),
      /SYNC_ALREADY_RUNNING_OR_RECOVERY_REQUIRED/,
    );
    release();
    await first;
    deepStrictEqual(Deno.statSync(root + "/journal").isFile, true);
  } finally {
    release();
    Deno.removeSync(root, { recursive: true });
  }
});
Deno.test("a local edit during remote download is retained and never overwritten", async () => {
  const root = Deno.makeTempDirSync({ dir: "/tmp", prefix: "cloud-race-" }),
    d = new CloudDomain(
      root + "/server",
      Deno.readTextFileSync(new URL("./schema.sql", import.meta.url)),
    ),
    actor: Actor = { id: "a", tenantId: "a" };
  d.seedWorkspace("w", "a", "Personal", [["a", "owner"]]);
  try {
    const id = d.registerDevice(actor, "w", crypto.randomUUID(), "fixture").id,
      dir = root + "/files";
    Deno.mkdirSync(dir);
    const transport = {
      call: async (
        operation: string,
        args: any = {},
        key = crypto.randomUUID(),
      ) =>
        dispatch(d, actor, {
          operation,
          args,
          workspaceId: "w",
          deviceId: id,
          idempotencyKey: key,
        }),
      download: async (version: string) =>
        d.download(actor, "w", version).bytes,
    };
    const options = {
      root: dir,
      journalPath: root + "/journal",
      journalKey: crypto.getRandomValues(new Uint8Array(32)),
      deviceId: id,
      transport,
    };
    Deno.writeTextFileSync(dir + "/note.txt", "first");
    await syncOnce(options);
    const n = d.list(actor, "w")[0],
      bytes = new TextEncoder().encode("server revision");
    const u = d.startUpload(actor, "w", crypto.randomUUID(), {
      name: "note.txt",
      nodeId: n.id,
      expectedRevision: n.revision,
      size: bytes.length,
      sha256: (await import("./domain.ts")).digest(bytes),
    });
    d.chunk(actor, "w", u.id, 0, bytes);
    d.complete(actor, "w", crypto.randomUUID(), u.id);
    transport.download = async (version) => {
      Deno.writeTextFileSync(dir + "/note.txt", "unsaved local edit");
      return d.download(actor, "w", version).bytes;
    };
    await rejects(syncOnce(options), /LOCAL_FILE_CHANGED_DURING_SYNC/);
    deepStrictEqual(
      Deno.readTextFileSync(dir + "/note.txt"),
      "unsaved local edit",
    );
  } finally {
    d.close();
    Deno.removeSync(root, { recursive: true });
  }
});
