import { deepStrictEqual, ok, throws } from "node:assert/strict";
import { CloudDomain } from "./domain.ts";
import { PageCursor } from "./page_cursor.ts";
const schema = Deno.readTextFileSync(new URL("./schema.sql", import.meta.url));
const actor = { id: "alice", tenantId: "tenant-a" };
function fixture(count = 6) {
  const root = Deno.makeTempDirSync({ dir: "/tmp", prefix: "cloud-page-" });
  const d = new CloudDomain(root, schema);
  d.seedWorkspace("a", "tenant-a", "A", [["alice", "owner"], [
    "reader",
    "reader",
  ]]);
  d.seedWorkspace("b", "tenant-b", "B", [["bob", "owner"]]);
  d.transaction(() => {
    const insert = d.db.prepare(
      "INSERT INTO nodes(id,workspace_id,name,name_key,kind) VALUES(?,'a',?,?,'directory')",
    );
    for (let n = 0; n < count; n++) {
      const name = String(n).padStart(6, "0");
      insert.run("node-" + name, name, name);
    }
  });
  return {
    d,
    root,
    close() {
      d.close();
      Deno.removeSync(root, { recursive: true });
    },
  };
}
Deno.test("signed cursor rejects tamper, context substitution, expiry and key change", () => {
  const key = new Uint8Array(32).fill(1), codec = new PageCursor(key);
  const p = {
    snapshot: crypto.randomUUID(),
    after: 50,
    context: "admitted-context",
    expiresAt: 1000,
  };
  const token = codec.sign(p);
  deepStrictEqual(codec.verify(token, p.context, 999).after, 50);
  for (
    const t of [
      token + "x",
      token.replace(/^./, token[0] === "a" ? "b" : "a"),
      "x".repeat(3000),
    ]
  ) {
    throws(() => codec.verify(t, p.context, 999), /CURSOR_INVALID/);
  }
  throws(() => codec.verify(token, "other", 999), /CURSOR_INVALID/);
  throws(() => codec.verify(token, p.context, 1000), /CURSOR_INVALID/);
  throws(
    () =>
      new PageCursor(new Uint8Array(32).fill(2)).verify(token, p.context, 999),
    /CURSOR_INVALID/,
  );
});
Deno.test("snapshot pages preserve order and complete membership through rename, insert and trash", () => {
  const f = fixture();
  try {
    const first = f.d.listPage(actor, "a", { limit: 2 });
    const token = first.nextCursor!;
    f.d.changeNode(actor, "a", crypto.randomUUID(), "node-000002", 1, {
      name: "zzz",
    });
    f.d.changeNode(actor, "a", crypto.randomUUID(), "node-000004", 1, {
      trashed: true,
    });
    f.d.folder(actor, "a", crypto.randomUUID(), "aaa");
    const second = f.d.listPage(actor, "a", { limit: 2, cursor: token });
    deepStrictEqual(
      f.d.listPage(actor, "a", { limit: 2, cursor: token }),
      second,
    );
    const third = f.d.listPage(actor, "a", {
      limit: 2,
      cursor: second.nextCursor!,
    });
    deepStrictEqual(
      [...first.items, ...second.items, ...third.items].map((n) => n.name),
      ["000000", "000001", "000002", "000003", "000004", "000005"],
    );
    deepStrictEqual(third.nextCursor, null);
    const fresh = f.d.listPage(actor, "a", { limit: 20 });
    ok(fresh.items.some((n) => n.name === "zzz"));
    ok(!fresh.items.some((n) => n.name === "000004"));
  } finally {
    f.close();
  }
});
Deno.test("current membership, tenant, epoch, query and page size bind every page", () => {
  const f = fixture();
  try {
    const token = f.d.listPage(actor, "a", { limit: 2 }).nextCursor!;
    for (
      const changed of [{ limit: 3 }, { limit: 2, trash: true }, {
        limit: 2,
        parentId: "node-000000",
      }]
    ) {
      throws(
        () => f.d.listPage(actor, "a", { ...changed, cursor: token }),
        /CURSOR_INVALID/,
      );
    }
    throws(
      () =>
        f.d.listPage({ id: "reader", tenantId: "tenant-a" }, "a", {
          limit: 2,
          cursor: token,
        }),
      /CURSOR_INVALID/,
    );
    throws(
      () =>
        f.d.listPage({ id: "bob", tenantId: "tenant-b" }, "a", {
          limit: 2,
          cursor: token,
        }),
      /NOT_FOUND/,
    );
    f.d.run("UPDATE workspaces SET policy_epoch=2 WHERE id='a'");
    throws(
      () => f.d.listPage(actor, "a", { limit: 2, cursor: token }),
      /CURSOR_INVALID/,
    );
    f.d.run("UPDATE memberships SET revoked=1 WHERE actor_id='alice'");
    throws(
      () => f.d.listPage(actor, "a", { limit: 2, cursor: token }),
      /NOT_FOUND/,
    );
  } finally {
    f.close();
  }
});
Deno.test("listing cache is bounded, expires, and is additively created without touching files", () => {
  const f = fixture();
  try {
    for (let n = 0; n < 4; n++) f.d.listPage(actor, "a", { limit: 2 });
    throws(() => f.d.listPage(actor, "a", { limit: 2 }), /LIST_SNAPSHOT_LIMIT/);
    f.d.run("UPDATE list_snapshots SET expires_at=0");
    f.d.listPage(actor, "a", { limit: 2 });
    deepStrictEqual(f.d.one("SELECT count(*) n FROM list_snapshot_rows")!.n, 6);
    deepStrictEqual(f.d.one("SELECT count(*) n FROM nodes")!.n, 6);
    const token = f.d.listPage(actor, "a", { limit: 2 }).nextCursor!;
    f.d.close();
    const restarted = new CloudDomain(f.root, schema);
    try {
      throws(
        () => restarted.listPage(actor, "a", { limit: 2, cursor: token }),
        /CURSOR_INVALID/,
      );
    } finally {
      restarted.close();
    }
  } finally {
    Deno.removeSync(f.root, { recursive: true });
  }
});
Deno.test("100000-node enumeration uses bounded indexed pages with no duplicate or missing rows", () => {
  const f = fixture(100000);
  try {
    let cursor: string | undefined, seen = 0;
    const start = performance.now();
    do {
      const page = f.d.listPage(actor, "a", { limit: 500, cursor });
      deepStrictEqual(page.total, 100000);
      ok(page.items.length <= 500);
      for (const row of page.items) {
        deepStrictEqual(row.id, "node-" + String(seen++).padStart(6, "0"));
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    deepStrictEqual(seen, 100000);
    const plan = f.d.all(
      "EXPLAIN QUERY PLAN SELECT position,node_json FROM list_snapshot_rows WHERE snapshot_id=? AND position>? ORDER BY position LIMIT ?",
      "fixture",
      500,
      500,
    );
    ok(
      plan.some((r) =>
        r.detail.includes("SEARCH") && r.detail.includes("position>?")
      ),
    );
    console.log(
      JSON.stringify({
        syntheticNodes: seen,
        pageSize: 500,
        elapsedMs: Math.round(performance.now() - start),
        providerAcceptance: false,
      }),
    );
  } finally {
    f.close();
  }
});
