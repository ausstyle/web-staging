/** Durable fixture implementation of the Cloud domain contract. Not a production
 * identity/provider adapter. Bytes live in a separate immutable object directory.
 */
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { portablePath, validateManifest } from "./restore.ts";
export class CloudError extends Error {
  constructor(readonly code: string, readonly status = 400) {
    super(code);
  }
}
export const digest = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
type Row = Record<string, any>;
export interface Actor {
  id: string;
  tenantId: string;
}
export interface UploadRequest {
  parentId?: string;
  nodeId?: string;
  name: string;
  expectedRevision: number;
  size: number;
  sha256: string;
}
const fail = (code: string, status = 400): never => {
  throw new CloudError(code, status);
};
function nameKey(name: string) {
  if (typeof name !== "string" || name.includes("/")) fail("INVALID_NAME");
  try {
    return portablePath(name);
  } catch {
    return fail("INVALID_NAME");
  }
}
function canonical(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((k) =>
      JSON.stringify(k) + ":" + canonical(value[k])
    ).join(",") + "}";
  }
  return JSON.stringify(value);
}
export class CloudDomain {
  readonly db: DatabaseSync;
  constructor(readonly root: string, schema: string) {
    Deno.mkdirSync(root, { recursive: true, mode: 0o700 });
    Deno.mkdirSync(root + "/objects", { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(root + "/metadata.sqlite");
    this.db.exec(schema);
    // Additive local fixture upgrade: preserve every prior upload/object/receipt.
    // Never use a fixture reset as application rollback.
    if (
      !this.db.prepare("PRAGMA table_info(uploads)").all().some((c) =>
        c.name === "purpose"
      )
    ) {
      this.db.exec(
        "ALTER TABLE uploads ADD COLUMN purpose TEXT NOT NULL DEFAULT 'DRIVE' CHECK(purpose IN ('DRIVE','BACKUP'))",
      );
    }
    this.db.exec("PRAGMA user_version=2");
  }
  close() {
    this.db.close();
  }
  one(sql: string, ...args: any[]): Row | undefined {
    const row = this.db.prepare(sql).get(...args);
    return row ? { ...row } : undefined;
  }
  all(sql: string, ...args: any[]): Row[] {
    return this.db.prepare(sql).all(...args).map((row) => ({ ...row }));
  }
  run(sql: string, ...args: any[]) {
    return this.db.prepare(sql).run(...args);
  }
  transaction<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = action();
      this.db.exec("COMMIT");
      return value;
    } catch (e) {
      this.db.exec("ROLLBACK");
      if (e instanceof CloudError) throw e;
      if (String(e).includes("UNIQUE constraint")) fail("CONFLICT", 409);
      throw e;
    }
  }
  /** Local fixture setup ONLY. Production grants belong to existing identity service. */
  seedWorkspace(
    id: string,
    tenant: string,
    name: string,
    members: Array<[string, string]>,
    quota = 64 * 1024 * 1024,
  ) {
    this.transaction(() => {
      this.run(
        "INSERT OR IGNORE INTO workspaces(id,tenant_id,name,quota_bytes) VALUES(?,?,?,?)",
        id,
        tenant,
        name,
        quota,
      );
      for (const [actor, role] of members) {
        this.run(
          "INSERT OR IGNORE INTO memberships VALUES(?,?,?,0)",
          id,
          actor,
          role,
        );
      }
    });
  }
  authorize(actor: Actor, workspace: string, write = false) {
    const row = this.one(
      "SELECT w.*,m.role FROM workspaces w JOIN memberships m ON m.workspace_id=w.id WHERE w.id=? AND w.tenant_id=? AND m.actor_id=? AND m.revoked=0",
      workspace,
      actor.tenantId,
      actor.id,
    );
    if (!row) fail("NOT_FOUND", 404);
    if (write && row!.role === "reader") fail("FORBIDDEN", 403);
    return row!;
  }
  workspaces(actor: Actor) {
    return this.all(
      "SELECT w.id,w.name,w.sequence,w.policy_epoch,w.used_bytes,w.quota_bytes FROM workspaces w JOIN memberships m ON m.workspace_id=w.id WHERE w.tenant_id=? AND m.actor_id=? AND m.revoked=0",
      actor.tenantId,
      actor.id,
    );
  }
  node(workspace: string, id: string, includeTrash = false): Row {
    const row = this.one(
      "SELECT * FROM nodes WHERE workspace_id=? AND id=?",
      workspace,
      id,
    );
    if (!row || (!includeTrash && row.trashed)) fail("NOT_FOUND", 404);
    return row!;
  }
  parent(workspace: string, id: string | null) {
    if (!id) return;
    let row = this.node(workspace, id);
    if (row.kind !== "directory") fail("INVALID_PARENT");
    const seen = new Set<string>();
    while (row) {
      if (seen.has(row.id) || seen.size >= 64) fail("INVALID_PARENT");
      seen.add(row.id);
      if (!row.parent_id) break;
      row = this.node(workspace, row.parent_id);
    }
  }
  accessibleNode(workspace: string, id: string): Row {
    const n = this.node(workspace, id);
    this.parent(workspace, n.parent_id);
    return n;
  }
  event(actor: Actor, workspace: string, type: string, payload: any) {
    this.run("UPDATE workspaces SET sequence=sequence+1 WHERE id=?", workspace);
    const seq =
      this.one("SELECT sequence FROM workspaces WHERE id=?", workspace)!
        .sequence;
    this.run(
      "INSERT INTO changes VALUES(?,?,?,?,?)",
      workspace,
      seq,
      actor.id,
      type,
      JSON.stringify(payload),
    );
    return seq;
  }
  mutate<T>(
    actor: Actor,
    w: string,
    key: string,
    input: any,
    action: () => T,
  ): T {
    if (typeof key !== "string" || key.length < 8 || key.length > 200) {
      fail("INVALID_IDEMPOTENCY_KEY");
    }
    const hash = digest(canonical(input));
    return this.transaction(() => {
      this.authorize(actor, w, true);
      const prior = this.one(
        "SELECT * FROM receipts WHERE workspace_id=? AND actor_id=? AND idempotency_key=?",
        w,
        actor.id,
        key,
      );
      if (prior) {
        if (prior.input_hash !== hash) fail("IDEMPOTENCY_CONFLICT", 409);
        return JSON.parse(prior.result_json);
      }
      const result = action();
      this.run(
        "INSERT INTO receipts VALUES(?,?,?,?,?)",
        w,
        actor.id,
        key,
        hash,
        JSON.stringify(result),
      );
      return result;
    });
  }
  list(actor: Actor, w: string, parentId: string | null = null, trash = false) {
    this.authorize(actor, w);
    if (!trash) this.parent(w, parentId);
    return this.all(
      "SELECT * FROM nodes WHERE workspace_id=? AND parent_id IS ? AND trashed=? ORDER BY kind,name_key,id",
      w,
      parentId,
      trash ? 1 : 0,
    );
  }
  folder(
    actor: Actor,
    w: string,
    key: string,
    name: string,
    parentId: string | null = null,
  ) {
    const normalized = nameKey(name);
    return this.mutate(actor, w, key, { op: "folder", name, parentId }, () => {
      this.parent(w, parentId);
      const id = randomUUID();
      this.run(
        "INSERT INTO nodes(id,workspace_id,parent_id,name,name_key,kind) VALUES(?,?,?,?,?,'directory')",
        id,
        w,
        parentId,
        name,
        normalized,
      );
      this.event(actor, w, "node.created", { id });
      return this.node(w, id);
    });
  }
  changeNode(
    actor: Actor,
    w: string,
    key: string,
    id: string,
    revision: number,
    patch: { name?: string; parentId?: string | null; trashed?: boolean },
  ) {
    return this.mutate(
      actor,
      w,
      key,
      { op: "change", id, revision, patch },
      () => {
        const n = this.node(w, id, true);
        if (n.revision !== revision) fail("STALE_REVISION", 409);
        const name = patch.name ?? n.name,
          normalized = nameKey(name),
          parent = patch.parentId === undefined ? n.parent_id : patch.parentId;
        this.parent(w, parent);
        let cursor = parent;
        const seen = new Set<string>();
        while (cursor) {
          if (cursor === id || seen.has(cursor) || seen.size >= 64) {
            fail(
              "FOLDER_CYCLE",
            );
          }
          seen.add(cursor);
          cursor = this.node(w, cursor).parent_id;
        }
        const trashed = patch.trashed === undefined
          ? n.trashed
          : (patch.trashed ? 1 : 0);
        this.run(
          "UPDATE nodes SET name=?,name_key=?,parent_id=?,trashed=?,revision=revision+1 WHERE id=? AND workspace_id=?",
          name,
          normalized,
          parent,
          trashed,
          id,
          w,
        );
        this.event(actor, w, "node.changed", { id });
        return this.node(w, id, true);
      },
    );
  }
  startUpload(
    actor: Actor,
    w: string,
    key: string,
    input: UploadRequest,
    backup = false,
  ) {
    if (backup && input.nodeId) fail("INVALID_BACKUP_UPLOAD");
    nameKey(input.name);
    if (
      !Number.isSafeInteger(input.size) || input.size < 0 ||
      input.size > 64 * 1024 * 1024 || typeof input.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(input.sha256) ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0
    ) fail("INVALID_UPLOAD");
    return this.mutate(
      actor,
      w,
      key,
      { op: "start_upload", ...input, backup },
      () => {
        this.parent(w, input.parentId ?? null);
        if (input.nodeId) {
          const n = this.accessibleNode(w, input.nodeId);
          if (n.kind !== "file" || n.revision !== input.expectedRevision) {
            fail("STALE_REVISION", 409);
          }
        } else if (input.expectedRevision !== 0) fail("STALE_REVISION", 409);
        const ws = this.authorize(actor, w, true);
        if (ws.used_bytes + ws.reserved_bytes + input.size > ws.quota_bytes) {
          fail("QUOTA_EXCEEDED", 409);
        }
        const id = randomUUID();
        this.run(
          "INSERT INTO uploads(id,workspace_id,actor_id,node_id,parent_id,name,expected_revision,size,sha256,state,expires_at,purpose) VALUES(?,?,?,?,?,?,?,?,?,'UPLOADING',?,?)",
          id,
          w,
          actor.id,
          input.nodeId ?? null,
          input.parentId ?? null,
          input.name,
          input.expectedRevision,
          input.size,
          input.sha256,
          Date.now() + 3600000,
          backup ? "BACKUP" : "DRIVE",
        );
        this.run(
          "UPDATE workspaces SET reserved_bytes=reserved_bytes+? WHERE id=?",
          input.size,
          w,
        );
        return { id, offset: 0, state: "UPLOADING" };
      },
    );
  }
  upload(actor: Actor, w: string, id: string) {
    this.authorize(actor, w, true);
    const u = this.one(
      "SELECT * FROM uploads WHERE id=? AND workspace_id=? AND actor_id=?",
      id,
      w,
      actor.id,
    );
    if (!u) fail("NOT_FOUND", 404);
    return u!;
  }
  chunk(
    actor: Actor,
    w: string,
    id: string,
    offset: number,
    bytes: Uint8Array,
  ) {
    const u = this.upload(actor, w, id);
    if (u.state !== "UPLOADING" || u.expires_at <= Date.now()) {
      fail("UPLOAD_CLOSED", 409);
    }
    if (
      !Number.isSafeInteger(offset) || offset < 0 || bytes.length < 1 ||
      bytes.length > 1024 * 1024 || offset + bytes.length > u.size
    ) fail("INVALID_CHUNK");
    const sha = digest(bytes),
      prior = this.one(
        "SELECT * FROM chunks WHERE upload_id=? AND offset=?",
        id,
        offset,
      );
    if (prior) {
      if (prior.sha256 !== sha || prior.size !== bytes.length) {
        fail("CHUNK_CONFLICT", 409);
      }
      return { offset: u.received };
    }
    if (u.received !== offset) fail("OFFSET_CONFLICT", 409);
    const path = this.root + "/objects/" + id + "-" + offset;
    const temporary = this.root + "/objects/" + randomUUID() + ".partial";
    Deno.writeFileSync(temporary, bytes, { createNew: true, mode: 0o600 });
    const f = Deno.openSync(temporary, { write: true });
    try {
      f.syncSync();
    } finally {
      f.close();
    }
    try {
      Deno.linkSync(temporary, path);
    } catch (e) {
      if (!(e instanceof Deno.errors.AlreadyExists)) throw e;
      if (digest(Deno.readFileSync(path)) !== sha) fail("CHUNK_CONFLICT", 409);
    } finally {
      Deno.removeSync(temporary);
    }
    // Only a fully synced immutable chunk is linked. A crash before the SQL
    // offset commit leaves an orphan reconciled by an identical retry.
    const dir = Deno.openSync(this.root + "/objects", { read: true });
    try {
      dir.syncSync();
    } finally {
      dir.close();
    }
    return this.transaction(() => {
      const current = this.upload(actor, w, id);
      if (
        current.received !== offset || current.state !== "UPLOADING" ||
        current.expires_at <= Date.now()
      ) fail("OFFSET_CONFLICT", 409);
      this.run(
        "INSERT INTO chunks VALUES(?,?,?,?)",
        id,
        offset,
        bytes.length,
        sha,
      );
      this.run(
        "UPDATE uploads SET received=received+? WHERE id=?",
        bytes.length,
        id,
      );
      return { offset: offset + bytes.length };
    });
  }
  objectBytes(key: string): Uint8Array {
    if (!/^[0-9a-f-]{36}$/.test(key)) fail("INVALID_OBJECT");
    const chunks = this.all(
      "SELECT * FROM chunks WHERE upload_id=? ORDER BY offset",
      key,
    );
    const size = chunks.reduce((sum, c) => sum + c.size, 0);
    if (size > 64 * 1024 * 1024) fail("INVALID_OBJECT");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      if (c.offset !== offset) fail("TRANSFER_INCOMPLETE", 409);
      const b = Deno.readFileSync(
        this.root + "/objects/" + key + "-" + c.offset,
      );
      if (b.length !== c.size || digest(b) !== c.sha256) {
        fail("CHECKSUM_MISMATCH", 409);
      }
      bytes.set(b, offset);
      offset += b.length;
    }
    return bytes;
  }
  complete(actor: Actor, w: string, key: string, id: string) {
    const u = this.upload(actor, w, id);
    if (u.purpose !== "DRIVE") fail("INVALID_UPLOAD_PURPOSE");
    if (u.state === "COMMITTED") {
      const v = this.one(
        "SELECT * FROM versions WHERE id=? AND workspace_id=?",
        u.version_id,
        w,
      );
      return { state: "COMMITTED", version: v };
    }
    if (u.received !== u.size) fail("TRANSFER_INCOMPLETE", 409);
    const bytes = this.objectBytes(id);
    if (bytes.length !== u.size || digest(bytes) !== u.sha256) {
      fail("CHECKSUM_MISMATCH", 409);
    }
    // Fixture data only; NOT a malware scanner. Production scan proof is an
    // explicit dependency and this implementation must never serve real users.
    return this.mutate(actor, w, key, { op: "complete", id }, () => {
      const current = this.upload(actor, w, id);
      if (current.state !== "UPLOADING" || current.expires_at <= Date.now()) {
        fail("UPLOAD_CLOSED", 409);
      }
      let nodeId = u.node_id;
      if (nodeId) {
        const n = this.accessibleNode(w, nodeId);
        if (n.revision !== u.expected_revision) fail("STALE_REVISION", 409);
      } else {
        this.parent(w, u.parent_id);
        nodeId = randomUUID();
        this.run(
          "INSERT INTO nodes(id,workspace_id,parent_id,name,name_key,kind,revision) VALUES(?,?,?,?,?,'file',0)",
          nodeId,
          w,
          u.parent_id,
          u.name,
          nameKey(u.name),
        );
      }
      const versionId = randomUUID();
      this.run(
        "INSERT INTO versions VALUES(?,?,?,?,?,?,?,?)",
        versionId,
        w,
        nodeId,
        id,
        u.size,
        u.sha256,
        "1",
        Date.now(),
      );
      this.run(
        "UPDATE nodes SET current_version_id=?,revision=revision+1 WHERE id=?",
        versionId,
        nodeId,
      );
      this.run(
        "UPDATE uploads SET state='COMMITTED',version_id=? WHERE id=?",
        versionId,
        id,
      );
      this.run(
        "UPDATE workspaces SET reserved_bytes=reserved_bytes-?,used_bytes=used_bytes+? WHERE id=?",
        u.size,
        u.size,
        w,
      );
      this.run("INSERT INTO usage_events VALUES(?,?,?)", versionId, w, u.size);
      this.event(actor, w, "version.committed", { nodeId, versionId });
      return {
        state: "COMMITTED",
        version: this.one("SELECT * FROM versions WHERE id=?", versionId),
      };
    });
  }
  history(actor: Actor, w: string, nodeId: string) {
    this.authorize(actor, w);
    this.accessibleNode(w, nodeId);
    return this.all(
      "SELECT * FROM versions WHERE workspace_id=? AND node_id=? ORDER BY created_at,id",
      w,
      nodeId,
    );
  }
  download(actor: Actor, w: string, versionId: string) {
    this.authorize(actor, w);
    const v = this.one(
      "SELECT * FROM versions WHERE workspace_id=? AND id=?",
      w,
      versionId,
    );
    if (!v) fail("NOT_FOUND", 404);
    this.accessibleNode(w, v!.node_id);
    const bytes = this.objectBytes(v!.object_key);
    if (bytes.length !== v!.size || digest(bytes) !== v!.sha256) {
      fail("CHECKSUM_MISMATCH", 409);
    }
    return { version: v!, bytes };
  }
  changes(actor: Actor, w: string, after: number, epoch: number) {
    const ws = this.authorize(actor, w);
    if (
      epoch !== ws.policy_epoch || !Number.isSafeInteger(after) || after < 0 ||
      after > ws.sequence
    ) fail("CURSOR_RESET_REQUIRED", 409);
    const events = this.all(
      "SELECT sequence,event_type,payload_json FROM changes WHERE workspace_id=? AND sequence>? ORDER BY sequence LIMIT 100",
      w,
      after,
    );
    return {
      events,
      next: events.at(-1)?.sequence ?? after,
      epoch: ws.policy_epoch,
      hasMore: (events.at(-1)?.sequence ?? after) < ws.sequence,
    };
  }
  snapshot(actor: Actor, w: string, key: string) {
    return this.mutate(actor, w, key, { op: "snapshot" }, () => {
      const files = this.all(
        "SELECT * FROM nodes WHERE workspace_id=? AND trashed=0 ORDER BY id",
        w,
      ).filter((n) => {
        try {
          this.parent(w, n.parent_id);
          return true;
        } catch {
          return false;
        }
      });
      const entries: Row[] = files.map((n) => ({
        ...n,
        version: n.current_version_id
          ? this.one(
            "SELECT * FROM versions WHERE id=? AND workspace_id=?",
            n.current_version_id,
            w,
          )
          : null,
      }));
      for (const n of entries) {
        if (
          n.kind === "file" &&
          (!n.version ||
            digest(this.objectBytes(n.version.object_key)) !== n.version.sha256)
        ) fail("CHECKSUM_MISMATCH", 409);
      }
      const manifest = canonical(entries), id = randomUUID(), now = Date.now();
      this.run(
        "INSERT INTO snapshots VALUES(?,?,?,?,?,?)",
        id,
        w,
        now,
        manifest,
        digest(manifest),
        now + 30 * 86400000,
      );
      this.event(actor, w, "snapshot.recorded", { id });
      return {
        id,
        state: "LOCAL_SNAPSHOT_RECORDED",
        files: entries.filter((n) => n.kind === "file").length,
      };
    });
  }
  snapshots(actor: Actor, w: string) {
    this.authorize(actor, w);
    return this.all(
      "SELECT id,created_at,manifest_sha256,retention_until FROM snapshots WHERE workspace_id=? ORDER BY created_at DESC",
      w,
    );
  }
  restore(actor: Actor, w: string, key: string, id: string, name: string) {
    return this.mutate(actor, w, key, { op: "restore", id, name }, () => {
      const s = this.one(
        "SELECT * FROM snapshots WHERE id=? AND workspace_id=?",
        id,
        w,
      );
      if (!s) fail("NOT_FOUND", 404);
      if (digest(s!.manifest_json) !== s!.manifest_sha256) {
        fail("CHECKSUM_MISMATCH", 409);
      }
      const entries: Row[] = JSON.parse(s!.manifest_json),
        folder = randomUUID();
      this.run(
        "INSERT INTO nodes(id,workspace_id,name,name_key,kind) VALUES(?,?,?,?,'directory')",
        folder,
        w,
        name,
        nameKey(name),
      );
      const ids = new Map(entries.map((n) => [n.id, randomUUID()]));
      let remaining = [...entries];
      const done = new Set<string>();
      while (remaining.length) {
        const ready = remaining.filter((n) =>
          !n.parent_id || done.has(n.parent_id)
        );
        if (!ready.length) fail("INVALID_MANIFEST");
        for (const n of ready) {
          const newId = ids.get(n.id)!;
          this.run(
            "INSERT INTO nodes(id,workspace_id,parent_id,name,name_key,kind) VALUES(?,?,?,?,?,?)",
            newId,
            w,
            n.parent_id ? ids.get(n.parent_id) : folder,
            n.name,
            n.name_key,
            n.kind,
          );
          if (n.version) {
            const v = n.version, bytes = this.objectBytes(v.object_key);
            if (bytes.length !== v.size || digest(bytes) !== v.sha256) {
              fail("CHECKSUM_MISMATCH", 409);
            }
            const vid = randomUUID();
            this.run(
              "INSERT INTO versions VALUES(?,?,?,?,?,?,?,?)",
              vid,
              w,
              newId,
              v.object_key,
              v.size,
              v.sha256,
              v.generation,
              Date.now(),
            );
            this.run(
              "UPDATE nodes SET current_version_id=? WHERE id=?",
              vid,
              newId,
            );
          }
          done.add(n.id);
        }
        remaining = remaining.filter((n) => !done.has(n.id));
      }
      this.event(actor, w, "snapshot.restored", { id, folder });
      return { state: "LOCAL_RESTORE_RECORDED", folder };
    });
  }
  expireUploads(actor: Actor, w: string) {
    return this.transaction(() => {
      this.authorize(actor, w, true);
      const pending = this.all(
        "SELECT id,size FROM uploads WHERE workspace_id=? AND actor_id=? AND state='UPLOADING' AND expires_at<=?",
        w,
        actor.id,
        Date.now(),
      );
      for (const u of pending) {
        this.run("UPDATE uploads SET state='EXPIRED' WHERE id=?", u.id);
        this.run(
          "UPDATE workspaces SET reserved_bytes=reserved_bytes-? WHERE id=?",
          u.size,
          w,
        );
      }
      return { expired: pending.length };
    });
  }
  registerDevice(actor: Actor, w: string, key: string, name: string) {
    if (typeof name !== "string" || name.length < 1 || name.length > 100) {
      fail("INVALID_DEVICE");
    }
    return this.mutate(actor, w, key, { op: "register_device", name }, () => {
      const id = randomUUID();
      this.run("INSERT INTO devices VALUES(?,?,?,?,0)", id, w, actor.id, name);
      this.event(actor, w, "device.registered", { id });
      return { id };
    });
  }
  assertDevice(actor: Actor, w: string, id: string) {
    this.authorize(actor, w, true);
    if (
      !this.one(
        "SELECT id FROM devices WHERE id=? AND workspace_id=? AND actor_id=? AND revoked=0",
        id,
        w,
        actor.id,
      )
    ) fail("DEVICE_REVOKED", 403);
  }
  revokeDevice(actor: Actor, w: string, key: string, id: string) {
    return this.mutate(actor, w, key, { op: "revoke_device", id }, () => {
      this.assertDevice(actor, w, id);
      this.run("UPDATE devices SET revoked=1 WHERE id=?", id);
      this.event(actor, w, "device.revoked", { id });
      return { revoked: true };
    });
  }
  createShare(
    actor: Actor,
    w: string,
    key: string,
    version: string,
    recipient: string,
    expiresAt: number,
  ) {
    let token: string | null = null;
    const result = this.mutate(actor, w, key, {
      op: "share",
      version,
      recipient,
      expiresAt,
    }, () => {
      const ws = this.authorize(actor, w, true);
      this.download(actor, w, version);
      if (
        !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() ||
        expiresAt > Date.now() + 86400000
      ) fail("INVALID_EXPIRY");
      if (
        !this.one(
          "SELECT actor_id FROM memberships WHERE workspace_id=? AND actor_id=? AND revoked=0",
          w,
          recipient,
        )
      ) fail("RECIPIENT_NOT_AUTHORIZED", 403);
      const id = randomUUID();
      token = randomUUID() + randomUUID();
      this.run(
        "INSERT INTO shares VALUES(?,?,?,?,?,?,?,0)",
        id,
        w,
        version,
        recipient,
        digest(token),
        expiresAt,
        ws.policy_epoch,
      );
      this.event(actor, w, "share.created", { id, version, recipient });
      return { id, expiresAt };
    });
    return { ...result, token };
  }
  sharedDownload(actor: Actor, w: string, token: string) {
    const ws = this.authorize(actor, w);
    const share = this.one(
      "SELECT * FROM shares WHERE token_hash=? AND workspace_id=? AND recipient_actor_id=? AND revoked=0",
      digest(token),
      w,
      actor.id,
    );
    if (
      !share || share.expires_at <= Date.now() ||
      share.policy_epoch !== ws.policy_epoch
    ) fail("NOT_FOUND", 404);
    const result = this.download(actor, w, share!.version_id);
    this.transaction(() => {
      this.authorize(actor, w);
      this.event(actor, w, "share.downloaded", { id: share!.id });
    });
    return result;
  }
  revokeShare(actor: Actor, w: string, key: string, id: string) {
    return this.mutate(actor, w, key, { op: "revoke_share", id }, () => {
      if (
        !this.one("SELECT id FROM shares WHERE id=? AND workspace_id=?", id, w)
      ) fail("NOT_FOUND", 404);
      this.run("UPDATE shares SET revoked=1 WHERE id=?", id);
      this.event(actor, w, "share.revoked", { id });
      return { revoked: true };
    });
  }

  snapshotManifest(actor: Actor, w: string, id: string) {
    this.authorize(actor, w);
    const s = this.one(
      "SELECT * FROM snapshots WHERE id=? AND workspace_id=?",
      id,
      w,
    );
    if (!s) fail("NOT_FOUND", 404);
    if (digest(s!.manifest_json) !== s!.manifest_sha256) {
      fail("CHECKSUM_MISMATCH", 409);
    }
    const rows: Row[] = JSON.parse(s!.manifest_json),
      byId = new Map(rows.map((n) => [n.id, n]));
    const path = (n: Row): string => {
      const parts = [n.name], seen = new Set([n.id]);
      while (n.parent_id) {
        n = byId.get(n.parent_id)!;
        if (!n || seen.has(n.id) || seen.size >= 64) fail("INVALID_MANIFEST");
        seen.add(n.id);
        parts.unshift(n.name);
      }
      return parts.join("/");
    };
    return {
      id,
      tenantId: actor.tenantId,
      workspaceId: w,
      entries: rows.map((n) => ({
        path: path(n),
        kind: n.kind,
        ...(n.version
          ? {
            versionId: n.version.id,
            ref: {
              tenantId: actor.tenantId,
              workspaceId: w,
              bucket: "local-fixture",
              key: n.version.object_key,
              generation: n.version.generation,
              size: n.version.size,
              sha256: n.version.sha256,
            },
          }
          : {}),
      })),
    };
  }
  snapshotDownload(actor: Actor, w: string, id: string, version: string) {
    const manifest = this.snapshotManifest(actor, w, id);
    if (!manifest.entries.some((n) => n.versionId === version)) {
      fail("NOT_FOUND", 404);
    }
    const v = this.one(
      "SELECT * FROM versions WHERE workspace_id=? AND id=?",
      w,
      version,
    );
    if (!v) fail("NOT_FOUND", 404);
    const bytes = this.objectBytes(v!.object_key);
    if (bytes.length !== v!.size || digest(bytes) !== v!.sha256) {
      fail("CHECKSUM_MISMATCH", 409);
    }
    return { version: v!, bytes };
  }
  setDocumentConsent(actor: Actor, w: string, key: string, enabled: boolean) {
    if (typeof enabled !== "boolean") fail("INVALID_ARGUMENT");
    return this.mutate(
      actor,
      w,
      key,
      { op: "document_consent", enabled },
      () => {
        if (this.authorize(actor, w, true).role !== "owner") {
          fail(
            "FORBIDDEN",
            403,
          );
        }
        this.run(
          "INSERT INTO document_consent VALUES(?,?) ON CONFLICT(workspace_id) DO UPDATE SET enabled=excluded.enabled",
          w,
          enabled ? 1 : 0,
        );
        if (!enabled) {
          this.run(
            "DELETE FROM document_index WHERE workspace_id=?",
            w,
          );
        }
        this.event(actor, w, "document.consent", { enabled });
        return { enabled };
      },
    );
  }
  indexText(actor: Actor, w: string, key: string, version: string) {
    return this.mutate(actor, w, key, { op: "index_text", version }, () => {
      const ws = this.authorize(actor, w, true);
      if (
        !this.one(
          "SELECT workspace_id FROM document_consent WHERE workspace_id=? AND enabled=1",
          w,
        )
      ) fail("CONSENT_REQUIRED", 403);
      const { version: v, bytes } = this.download(actor, w, version),
        n = this.node(w, v.node_id);
      if (!/\.txt$/i.test(n.name) || bytes.length > 1024 * 1024) {
        fail("UNSUPPORTED_DOCUMENT");
      }
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return fail("UNSUPPORTED_DOCUMENT");
      }
      if (text.includes("\u0000")) fail("UNSUPPORTED_DOCUMENT");
      // Deterministic labels only, not AI inference. Document text never executes
      // tools or changes authority, even when it contains instructions/prompts.
      const classification = /\binvoice\b/i.test(text)
        ? "possible-invoice"
        : "plain-text";
      this.run(
        "INSERT INTO document_index VALUES(?,?,?,?,?) ON CONFLICT(version_id) DO UPDATE SET text_content=excluded.text_content,classification=excluded.classification,indexed_epoch=excluded.indexed_epoch",
        version,
        w,
        text,
        classification,
        ws.policy_epoch,
      );
      this.event(actor, w, "document.indexed", { version });
      return {
        versionId: version,
        classification,
        method: "deterministic-text-only",
      };
    });
  }
  search(actor: Actor, w: string, query: string) {
    const ws = this.authorize(actor, w);
    if (
      typeof query !== "string" || query.trim().length < 1 || query.length > 200
    ) fail("INVALID_QUERY");
    const term = query.toLocaleLowerCase(),
      consent = !!this.one(
        "SELECT workspace_id FROM document_consent WHERE workspace_id=? AND enabled=1",
        w,
      );
    const candidates = this.all(
      "SELECT n.*,v.sha256,i.text_content,i.classification,i.indexed_epoch FROM nodes n LEFT JOIN versions v ON v.id=n.current_version_id LEFT JOIN document_index i ON i.version_id=v.id WHERE n.workspace_id=? AND n.trashed=0",
      w,
    );
    const results = [];
    for (const n of candidates) {
      try {
        this.accessibleNode(w, n.id);
      } catch {
        continue;
      }
      const text = consent && n.indexed_epoch === ws.policy_epoch
        ? n.text_content || ""
        : "";
      const offset = text.toLocaleLowerCase().indexOf(term);
      if (n.name.toLocaleLowerCase().includes(term) || offset >= 0) {
        results.push({
          nodeId: n.id,
          name: n.name,
          versionId: n.current_version_id,
          sha256: n.sha256,
          excerpt: offset >= 0
            ? text.slice(Math.max(0, offset - 40), offset + 160)
            : null,
          classification: text ? n.classification : null,
          method: "lexical",
          untrustedDocument: true,
        });
      }
      if (results.length === 100) break;
    }
    return results;
  }
  completeBackup(actor: Actor, w: string, key: string, id: string) {
    const u = this.upload(actor, w, id);
    if (u.purpose !== "BACKUP") fail("INVALID_UPLOAD_PURPOSE");
    if (u.state === "COMMITTED") {
      return {
        state: "COMMITTED",
        object: this.one(
          "SELECT * FROM backup_objects WHERE upload_id=? AND workspace_id=?",
          id,
          w,
        ),
      };
    }
    const bytes = this.objectBytes(id);
    if (
      u.received !== u.size || bytes.length !== u.size ||
      digest(bytes) !== u.sha256
    ) fail("CHECKSUM_MISMATCH", 409);
    return this.mutate(actor, w, key, { op: "backup_complete", id }, () => {
      const current = this.upload(actor, w, id);
      if (current.state !== "UPLOADING" || current.expires_at <= Date.now()) {
        fail("UPLOAD_CLOSED", 409);
      }
      const objectId = randomUUID();
      this.run(
        "INSERT INTO backup_objects VALUES(?,?,?,?,?)",
        objectId,
        w,
        id,
        u.size,
        u.sha256,
      );
      this.run(
        "UPDATE uploads SET state='COMMITTED',version_id=? WHERE id=?",
        objectId,
        id,
      );
      this.run(
        "UPDATE workspaces SET reserved_bytes=reserved_bytes-?,used_bytes=used_bytes+? WHERE id=?",
        u.size,
        u.size,
        w,
      );
      this.run("INSERT INTO usage_events VALUES(?,?,?)", objectId, w, u.size);
      this.event(actor, w, "backup.object.committed", { objectId });
      return {
        state: "COMMITTED",
        object: this.one("SELECT * FROM backup_objects WHERE id=?", objectId),
      };
    });
  }
  sealBackup(
    actor: Actor,
    w: string,
    key: string,
    device: string,
    entries: Array<{ path: string; kind: string; objectId?: string }>,
  ) {
    return this.mutate(
      actor,
      w,
      key,
      { op: "backup_seal", device, entries },
      () => {
        this.assertDevice(actor, w, device);
        if (!Array.isArray(entries) || entries.length > 100000) {
          fail(
            "INVALID_MANIFEST",
          );
        }
        const id = randomUUID(),
          mapped = entries.map((e) => {
            if (e.kind === "directory") {
              return { path: e.path, kind: "directory" };
            }
            if (e.kind !== "file") {
              fail("INVALID_MANIFEST");
            }
            const object = this.one(
              "SELECT * FROM backup_objects WHERE id=? AND workspace_id=?",
              e.objectId,
              w,
            );
            if (!object) fail("NOT_FOUND", 404);
            const bytes = this.objectBytes(object!.upload_id);
            if (
              bytes.length !== object!.size || digest(bytes) !== object!.sha256
            ) fail("CHECKSUM_MISMATCH", 409);
            return {
              path: e.path,
              kind: "file",
              versionId: object!.id,
              ref: {
                tenantId: actor.tenantId,
                workspaceId: w,
                bucket: "local-fixture",
                key: object!.upload_id,
                generation: "1",
                size: object!.size,
                sha256: object!.sha256,
              },
            };
          });
        const manifest = {
          id,
          tenantId: actor.tenantId,
          workspaceId: w,
          entries: mapped,
        };
        validateManifest(manifest as any, {
          tenantId: actor.tenantId,
          workspaceId: w,
          allowedBuckets: new Set(["local-fixture"]),
          maxBytes: 64 * 1024 * 1024,
          signal: new AbortController().signal,
        });
        const raw = canonical(manifest), now = Date.now();
        this.run(
          "INSERT INTO backup_snapshots VALUES(?,?,?,?,?,?,?)",
          id,
          w,
          device,
          raw,
          digest(raw),
          now,
          now + 30 * 86400000,
        );
        this.event(actor, w, "backup.snapshot.recorded", { id, device });
        return { id, state: "LOCAL_BACKUP_RECORDED" };
      },
    );
  }
  backupManifest(actor: Actor, w: string, id: string) {
    this.authorize(actor, w);
    const s = this.one(
      "SELECT * FROM backup_snapshots WHERE id=? AND workspace_id=?",
      id,
      w,
    );
    if (!s) fail("NOT_FOUND", 404);
    if (digest(s!.manifest_json) !== s!.manifest_sha256) {
      fail("CHECKSUM_MISMATCH", 409);
    }
    return JSON.parse(s!.manifest_json);
  }
  backupDownload(actor: Actor, w: string, snapshot: string, objectId: string) {
    const manifest = this.backupManifest(actor, w, snapshot);
    if (!manifest.entries.some((e: any) => e.versionId === objectId)) {
      fail("NOT_FOUND", 404);
    }
    const o = this.one(
      "SELECT * FROM backup_objects WHERE id=? AND workspace_id=?",
      objectId,
      w,
    );
    if (!o) fail("NOT_FOUND", 404);
    const bytes = this.objectBytes(o!.upload_id);
    if (bytes.length !== o!.size || digest(bytes) !== o!.sha256) {
      fail("CHECKSUM_MISMATCH", 409);
    }
    return { version: o!, bytes };
  }
}
