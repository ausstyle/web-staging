import { deepStrictEqual, notEqual, throws } from "node:assert/strict";
import { CloudDomain, digest } from "./domain.ts";
const schema = Deno.readTextFileSync(new URL("./schema.sql", import.meta.url));
const actor = { id: "alice", tenantId: "tenant-a" },
  key = () => crypto.randomUUID();
function fixture() {
  const root = Deno.makeTempDirSync({ dir: "/tmp", prefix: "cloud-version-" }),
    d = new CloudDomain(root, schema);
  d.seedWorkspace("a", "tenant-a", "A", [["alice", "owner"], [
    "reader",
    "reader",
  ]]);
  d.seedWorkspace("b", "tenant-b", "B", [["bob", "owner"]]);
  function upload(text: string, nodeId?: string, revision = 0) {
    const bytes = new TextEncoder().encode(text),
      u = d.startUpload(actor, "a", key(), {
        name: "file.txt",
        nodeId,
        expectedRevision: revision,
        size: bytes.length,
        sha256: digest(bytes),
      });
    d.chunk(actor, "a", u.id, 0, bytes);
    return d.complete(actor, "a", key(), u.id).version!;
  }
  const first = upload("original"),
    second = upload("new content", first.node_id, 1);
  return {
    d,
    root,
    first,
    second,
    close() {
      d.close();
      Deno.removeSync(root, { recursive: true });
    },
  };
}
Deno.test("historical restore creates and verifies a new version; retry settles quota once", () => {
  const f = fixture();
  try {
    const k = key(),
      result = f.d.restoreVersion(actor, "a", k, f.first.id, 2),
      v = result.version!;
    notEqual(v.id, f.first.id);
    notEqual(v.id, f.second.id);
    deepStrictEqual(result.revision, 3);
    deepStrictEqual(
      f.d.download(actor, "a", v.id).bytes,
      new TextEncoder().encode("original"),
    );
    deepStrictEqual(
      f.d.download(actor, "a", f.second.id).bytes,
      new TextEncoder().encode("new content"),
    );
    deepStrictEqual(f.d.restoreVersion(actor, "a", k, f.first.id, 2), result);
    deepStrictEqual(f.d.history(actor, "a", v.node_id).length, 3);
    deepStrictEqual(f.d.one("SELECT count(*) n FROM usage_events")!.n, 3);
    deepStrictEqual(
      f.d.one("SELECT used_bytes FROM workspaces WHERE id=?", "a")!.used_bytes,
      27,
    );
  } finally {
    f.close();
  }
});
Deno.test("restore rejects stale revision, readers, foreign tenant, trash and full quota", () => {
  const f = fixture();
  try {
    throws(
      () => f.d.restoreVersion(actor, "a", key(), f.first.id, 1),
      /STALE_REVISION/,
    );
    throws(
      () =>
        f.d.restoreVersion(
          { id: "reader", tenantId: "tenant-a" },
          "a",
          key(),
          f.first.id,
          2,
        ),
      /FORBIDDEN/,
    );
    throws(
      () =>
        f.d.restoreVersion(
          { id: "bob", tenantId: "tenant-b" },
          "b",
          key(),
          f.first.id,
          2,
        ),
      /NOT_FOUND/,
    );
    f.d.run("UPDATE workspaces SET quota_bytes=used_bytes WHERE id=?", "a");
    throws(
      () => f.d.restoreVersion(actor, "a", key(), f.first.id, 2),
      /QUOTA_EXCEEDED/,
    );
    f.d.changeNode(actor, "a", key(), f.first.node_id, 2, { trashed: true });
    throws(
      () => f.d.restoreVersion(actor, "a", key(), f.first.id, 3),
      /NOT_FOUND/,
    );
    deepStrictEqual(f.d.one("SELECT count(*) n FROM versions")!.n, 2);
  } finally {
    f.close();
  }
});
Deno.test("restore refuses corrupt source and audit failure rolls back new version and usage", () => {
  const f = fixture();
  try {
    f.d.db.exec(
      "CREATE TRIGGER fail_restore BEFORE INSERT ON changes WHEN NEW.event_type='version.restored' BEGIN SELECT RAISE(ABORT,'RESTORE_AUDIT_FAILED'); END;",
    );
    throws(
      () => f.d.restoreVersion(actor, "a", key(), f.first.id, 2),
      /RESTORE_AUDIT_FAILED/,
    );
    deepStrictEqual(
      f.d.node("a", f.first.node_id).current_version_id,
      f.second.id,
    );
    deepStrictEqual(f.d.one("SELECT count(*) n FROM versions")!.n, 2);
    deepStrictEqual(f.d.one("SELECT count(*) n FROM usage_events")!.n, 2);
    f.d.db.exec("DROP TRIGGER fail_restore");
    Deno.writeTextFileSync(
      f.root + "/objects/" + f.first.object_key + "-0",
      "corrupt!",
    );
    throws(
      () => f.d.restoreVersion(actor, "a", key(), f.first.id, 2),
      /CHECKSUM_MISMATCH/,
    );
    deepStrictEqual(f.d.one("SELECT count(*) n FROM versions")!.n, 2);
  } finally {
    f.close();
  }
});
