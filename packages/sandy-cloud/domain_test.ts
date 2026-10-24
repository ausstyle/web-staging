import { deepStrictEqual, ok, throws } from "node:assert/strict";
import { type Actor, CloudDomain, digest } from "./domain.ts";
const schema = Deno.readTextFileSync(new URL("./schema.sql", import.meta.url));
const a: Actor = { id: "alice", tenantId: "tenant-a" },
  b: Actor = { id: "bob", tenantId: "tenant-b" },
  r: Actor = { id: "reader", tenantId: "tenant-a" };
const key = () => crypto.randomUUID();
function fixture() {
  const root = Deno.makeTempDirSync({ dir: "/tmp", prefix: "cloud-domain-" });
  let domain = new CloudDomain(root, schema);
  domain.seedWorkspace("a", "tenant-a", "Personal", [["alice", "owner"], [
    "reader",
    "reader",
  ]]);
  domain.seedWorkspace("company", "tenant-a", "Company", [["reader", "owner"]]);
  domain.seedWorkspace("b", "tenant-b", "Personal", [["bob", "owner"]]);
  return {
    get d() {
      return domain;
    },
    root,
    restart() {
      domain.close();
      domain = new CloudDomain(root, schema);
    },
    close() {
      domain.close();
      Deno.removeSync(root, { recursive: true });
    },
  };
}
function upload(
  d: CloudDomain,
  bytes = new TextEncoder().encode("original"),
  nodeId?: string,
  revision = 0,
) {
  const u = d.startUpload(a, "a", key(), {
    name: "fixture.txt",
    expectedRevision: revision,
    nodeId,
    size: bytes.length,
    sha256: digest(bytes),
  });
  if (bytes.length) d.chunk(a, "a", u.id, 0, bytes);
  return d.complete(a, "a", key(), u.id).version!;
}
Deno.test("namespace isolation, company boundaries, reader denial and idempotency", () => {
  const f = fixture();
  try {
    const k = key();
    const folder = f.d.folder(a, "a", k, "Folder");
    deepStrictEqual(f.d.folder(a, "a", k, "Folder"), folder);
    throws(() => f.d.folder(a, "a", k, "Other"), /IDEMPOTENCY_CONFLICT/);
    for (let i = 0; i < 100; i++) {
      throws(() => f.d.list({ ...b, id: "other-" + i }, "a"), /NOT_FOUND/);
      throws(() => f.d.list(a, "company"), /NOT_FOUND/);
    }
    throws(() => f.d.folder(r, "a", key(), "No"), /FORBIDDEN/);
    deepStrictEqual(f.d.list(r, "a").length, 1);
  } finally {
    f.close();
  }
});
Deno.test("resumable upload survives restart, verifies bytes and settles once", () => {
  const f = fixture();
  try {
    const bytes = new TextEncoder().encode("chunked-content"),
      u = f.d.startUpload(a, "a", key(), {
        name: "file.txt",
        expectedRevision: 0,
        size: bytes.length,
        sha256: digest(bytes),
      });
    deepStrictEqual(f.d.chunk(a, "a", u.id, 0, bytes.subarray(0, 5)).offset, 5);
    f.restart();
    deepStrictEqual(f.d.chunk(a, "a", u.id, 0, bytes.subarray(0, 5)).offset, 5);
    throws(
      () => f.d.chunk(a, "a", u.id, 0, new Uint8Array(5)),
      /CHUNK_CONFLICT/,
    );
    f.d.chunk(a, "a", u.id, 5, bytes.subarray(5));
    const result = f.d.complete(a, "a", key(), u.id);
    f.restart();
    deepStrictEqual(f.d.complete(a, "a", key(), u.id), result);
    deepStrictEqual(f.d.download(a, "a", result.version!.id).bytes, bytes);
    deepStrictEqual(f.d.one("SELECT count(*) n FROM usage_events")!.n, 1);
    deepStrictEqual(
      f.d.one("SELECT reserved_bytes FROM workspaces WHERE id=?", "a")!
        .reserved_bytes,
      0,
    );
  } finally {
    f.close();
  }
});
Deno.test("corruption and short uploads never become visible versions", () => {
  const f = fixture();
  try {
    const u = f.d.startUpload(a, "a", key(), {
      name: "file",
      expectedRevision: 0,
      size: 3,
      sha256: digest("abc"),
    });
    f.d.chunk(a, "a", u.id, 0, new TextEncoder().encode("ab"));
    throws(() => f.d.complete(a, "a", key(), u.id), /TRANSFER_INCOMPLETE/);
    f.d.chunk(a, "a", u.id, 2, new TextEncoder().encode("x"));
    throws(() => f.d.complete(a, "a", key(), u.id), /CHECKSUM_MISMATCH/);
    deepStrictEqual(f.d.list(a, "a").length, 0);
    deepStrictEqual(f.d.one("SELECT count(*) n FROM versions")!.n, 0);
  } finally {
    f.close();
  }
});
Deno.test("concurrent revision conflicts retain original and new committed version", () => {
  const f = fixture();
  try {
    const v = upload(f.d), n = f.d.node("a", v.node_id);
    const input = {
      name: "fixture.txt",
      nodeId: n.id,
      expectedRevision: n.revision,
      size: 3,
      sha256: digest("new"),
    };
    const u1 = f.d.startUpload(a, "a", key(), input),
      u2 = f.d.startUpload(a, "a", key(), input);
    for (const u of [u1, u2]) {
      f.d.chunk(a, "a", u.id, 0, new TextEncoder().encode("new"));
    }
    f.d.complete(a, "a", key(), u1.id);
    throws(() => f.d.complete(a, "a", key(), u2.id), /STALE_REVISION/);
    deepStrictEqual(f.d.history(a, "a", n.id).length, 2);
    deepStrictEqual(
      new TextDecoder().decode(f.d.download(a, "a", v.id).bytes),
      "original",
    );
  } finally {
    f.close();
  }
});
Deno.test("move cycle, case collision, trash ancestor and cursor epoch checks", () => {
  const f = fixture();
  try {
    const p = f.d.folder(a, "a", key(), "Parent"),
      c = f.d.folder(a, "a", key(), "Child", p.id);
    throws(
      () => f.d.changeNode(a, "a", key(), p.id, 1, { parentId: c.id }),
      /FOLDER_CYCLE/,
    );
    throws(() => f.d.folder(a, "a", key(), "parent"), /CONFLICT/);
    f.d.changeNode(a, "a", key(), p.id, 1, { trashed: true });
    throws(() => f.d.list(a, "a", c.id), /NOT_FOUND/);
    throws(() => f.d.changes(a, "a", 0, 0), /CURSOR_RESET_REQUIRED/);
    ok(f.d.changes(a, "a", 0, 1).events.length > 0);
  } finally {
    f.close();
  }
});
Deno.test("snapshot survives live deletion and restores hashes into a separate folder", () => {
  const f = fixture();
  try {
    const v = upload(f.d), s = f.d.snapshot(a, "a", key());
    f.d.changeNode(a, "a", key(), v.node_id, 1, { trashed: true });
    throws(() => f.d.download(a, "a", v.id), /NOT_FOUND/);
    f.restart();
    const restored = f.d.restore(a, "a", key(), s.id, "Recovered");
    const child = f.d.list(a, "a", restored.folder)[0];
    deepStrictEqual(
      new TextDecoder().decode(
        f.d.download(a, "a", child.current_version_id).bytes,
      ),
      "original",
    );
    throws(
      () => f.d.run("DELETE FROM snapshots WHERE id=?", s.id),
      /IMMUTABLE_SNAPSHOT/,
    );
    throws(
      () => f.d.run("DELETE FROM versions WHERE id=?", v.id),
      /IMMUTABLE_VERSION/,
    );
    throws(() => f.d.restore(b, "b", key(), s.id, "Stolen"), /NOT_FOUND/);
  } finally {
    f.close();
  }
});
Deno.test("quota reservations are atomic and replay cannot reserve twice", () => {
  const f = fixture();
  try {
    f.d.run("UPDATE workspaces SET quota_bytes=3 WHERE id=?", "a");
    const k = key(),
      input = {
        name: "one",
        expectedRevision: 0,
        size: 3,
        sha256: digest("abc"),
      };
    f.d.startUpload(a, "a", k, input);
    f.d.startUpload(a, "a", k, input);
    throws(() => f.d.startUpload(a, "a", key(), input), /QUOTA_EXCEEDED/);
    deepStrictEqual(
      f.d.one("SELECT reserved_bytes FROM workspaces WHERE id=?", "a")!
        .reserved_bytes,
      3,
    );
  } finally {
    f.close();
  }
});
Deno.test("shares bind exact versions, recipients, expiry, revocation and policy epoch", () => {
  const f = fixture();
  try {
    const v = upload(f.d),
      share = f.d.createShare(a, "a", key(), v.id, r.id, Date.now() + 60000);
    deepStrictEqual(
      new TextDecoder().decode(f.d.sharedDownload(r, "a", share.token!).bytes),
      "original",
    );
    throws(() => f.d.sharedDownload(a, "a", share.token!), /NOT_FOUND/);
    throws(() => f.d.sharedDownload(b, "b", share.token!), /NOT_FOUND/);
    f.d.revokeShare(a, "a", key(), share.id);
    throws(() => f.d.sharedDownload(r, "a", share.token!), /NOT_FOUND/);
    const other = f.d.createShare(
      a,
      "a",
      key(),
      v.id,
      r.id,
      Date.now() + 60000,
    );
    f.d.run(
      "UPDATE workspaces SET policy_epoch=policy_epoch+1 WHERE id=?",
      "a",
    );
    throws(() => f.d.sharedDownload(r, "a", other.token!), /NOT_FOUND/);
    const expired = f.d.createShare(
      a,
      "a",
      key(),
      v.id,
      r.id,
      Date.now() + 60000,
    );
    f.d.run("UPDATE shares SET expires_at=0 WHERE id=?", expired.id);
    throws(() => f.d.sharedDownload(r, "a", expired.token!), /NOT_FOUND/);
  } finally {
    f.close();
  }
});
Deno.test("failed outbox transaction rolls back version/quota and safely retries staged chunks", () => {
  const f = fixture();
  try {
    const u = f.d.startUpload(a, "a", key(), {
      name: "file",
      expectedRevision: 0,
      size: 3,
      sha256: digest("abc"),
    });
    f.d.chunk(a, "a", u.id, 0, new TextEncoder().encode("abc"));
    f.d.db.exec(
      "CREATE TRIGGER fail_event BEFORE INSERT ON changes BEGIN SELECT RAISE(ABORT,'FAULT'); END;",
    );
    throws(() => f.d.complete(a, "a", key(), u.id), /FAULT/);
    deepStrictEqual(f.d.list(a, "a").length, 0);
    deepStrictEqual(f.d.one("SELECT count(*) n FROM versions")!.n, 0);
    deepStrictEqual(
      f.d.one("SELECT reserved_bytes FROM workspaces WHERE id=?", "a")!
        .reserved_bytes,
      3,
    );
    f.d.db.exec("DROP TRIGGER fail_event");
    deepStrictEqual(f.d.complete(a, "a", key(), u.id).state, "COMMITTED");
  } finally {
    f.close();
  }
});
Deno.test("expired upload releases reservation once and cannot commit later", () => {
  const f = fixture();
  try {
    const u = f.d.startUpload(a, "a", key(), {
      name: "file",
      expectedRevision: 0,
      size: 3,
      sha256: digest("abc"),
    });
    f.d.chunk(a, "a", u.id, 0, new TextEncoder().encode("abc"));
    f.d.run("UPDATE uploads SET expires_at=0 WHERE id=?", u.id);
    deepStrictEqual(f.d.expireUploads(a, "a").expired, 1);
    deepStrictEqual(f.d.expireUploads(a, "a").expired, 0);
    throws(() => f.d.complete(a, "a", key(), u.id), /UPLOAD_CLOSED/);
  } finally {
    f.close();
  }
});
