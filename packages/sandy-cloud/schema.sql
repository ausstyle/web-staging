-- Executable local reference schema. Not a Supabase/Cloud SQL migration.
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS workspaces (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL,
 sequence INTEGER NOT NULL DEFAULT 0, policy_epoch INTEGER NOT NULL DEFAULT 1,
 quota_bytes INTEGER NOT NULL CHECK(quota_bytes>=0), used_bytes INTEGER NOT NULL DEFAULT 0,
 reserved_bytes INTEGER NOT NULL DEFAULT 0,
 CHECK(used_bytes>=0 AND reserved_bytes>=0 AND used_bytes+reserved_bytes<=quota_bytes)
);
CREATE TABLE IF NOT EXISTS memberships (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id), actor_id TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('reader','writer','owner')), revoked INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(workspace_id,actor_id)
);
CREATE TABLE IF NOT EXISTS nodes (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), parent_id TEXT,
 name TEXT NOT NULL, name_key TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('file','directory')),
 revision INTEGER NOT NULL DEFAULT 1, trashed INTEGER NOT NULL DEFAULT 0, current_version_id TEXT,
 UNIQUE(id,workspace_id), FOREIGN KEY(parent_id,workspace_id) REFERENCES nodes(id,workspace_id),
 FOREIGN KEY(current_version_id,workspace_id) REFERENCES versions(id,workspace_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS live_sibling ON nodes(workspace_id,COALESCE(parent_id,''),name_key) WHERE trashed=0;
CREATE TABLE IF NOT EXISTS versions (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), node_id TEXT NOT NULL,
 object_key TEXT NOT NULL, size INTEGER NOT NULL CHECK(size>=0), sha256 TEXT NOT NULL,
 generation TEXT NOT NULL, created_at INTEGER NOT NULL,
 FOREIGN KEY(node_id,workspace_id) REFERENCES nodes(id,workspace_id), UNIQUE(id,workspace_id)
);
CREATE TRIGGER IF NOT EXISTS immutable_version_update BEFORE UPDATE ON versions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_VERSION'); END;
CREATE TRIGGER IF NOT EXISTS immutable_version_delete BEFORE DELETE ON versions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_VERSION'); END;
CREATE TABLE IF NOT EXISTS uploads (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), actor_id TEXT NOT NULL,
 node_id TEXT, parent_id TEXT, name TEXT NOT NULL, expected_revision INTEGER NOT NULL,
 size INTEGER NOT NULL CHECK(size>=0), sha256 TEXT NOT NULL, received INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL CHECK(state IN ('UPLOADING','COMMITTED','EXPIRED')),
 expires_at INTEGER NOT NULL, version_id TEXT, purpose TEXT NOT NULL DEFAULT 'DRIVE' CHECK(purpose IN ('DRIVE','BACKUP')), UNIQUE(id,workspace_id)
);
CREATE TABLE IF NOT EXISTS chunks (
 upload_id TEXT NOT NULL REFERENCES uploads(id), offset INTEGER NOT NULL, size INTEGER NOT NULL,
 sha256 TEXT NOT NULL, PRIMARY KEY(upload_id,offset)
);
CREATE TABLE IF NOT EXISTS receipts (
 workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
 input_hash TEXT NOT NULL, result_json TEXT NOT NULL,
 PRIMARY KEY(workspace_id,actor_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS changes (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id), sequence INTEGER NOT NULL,
 actor_id TEXT NOT NULL, event_type TEXT NOT NULL, payload_json TEXT NOT NULL,
 PRIMARY KEY(workspace_id,sequence)
);
CREATE TABLE IF NOT EXISTS usage_events (
 event_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), bytes INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshots (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), created_at INTEGER NOT NULL,
 manifest_json TEXT NOT NULL, manifest_sha256 TEXT NOT NULL, retention_until INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS immutable_snapshot_update BEFORE UPDATE ON snapshots BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SNAPSHOT'); END;
CREATE TRIGGER IF NOT EXISTS immutable_snapshot_delete BEFORE DELETE ON snapshots BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SNAPSHOT'); END;
CREATE TABLE IF NOT EXISTS shares (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), version_id TEXT NOT NULL,
 recipient_actor_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL,
 policy_epoch INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0,
 FOREIGN KEY(version_id,workspace_id) REFERENCES versions(id,workspace_id)
);
CREATE TABLE IF NOT EXISTS devices (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), actor_id TEXT NOT NULL,
 name TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS document_consent (
 workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id), enabled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS document_index (
 version_id TEXT PRIMARY KEY REFERENCES versions(id), workspace_id TEXT NOT NULL,
 text_content TEXT NOT NULL, classification TEXT NOT NULL, indexed_epoch INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS backup_objects (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), upload_id TEXT NOT NULL UNIQUE,
 size INTEGER NOT NULL, sha256 TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS immutable_backup_object_update BEFORE UPDATE ON backup_objects BEGIN SELECT RAISE(ABORT,'IMMUTABLE_BACKUP_OBJECT'); END;
CREATE TRIGGER IF NOT EXISTS immutable_backup_object_delete BEFORE DELETE ON backup_objects BEGIN SELECT RAISE(ABORT,'IMMUTABLE_BACKUP_OBJECT'); END;
CREATE TABLE IF NOT EXISTS backup_snapshots (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), device_id TEXT NOT NULL REFERENCES devices(id),
 manifest_json TEXT NOT NULL, manifest_sha256 TEXT NOT NULL, created_at INTEGER NOT NULL, retention_until INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS immutable_backup_snapshot_update BEFORE UPDATE ON backup_snapshots BEGIN SELECT RAISE(ABORT,'IMMUTABLE_BACKUP_SNAPSHOT'); END;
CREATE TRIGGER IF NOT EXISTS immutable_backup_snapshot_delete BEFORE DELETE ON backup_snapshots BEGIN SELECT RAISE(ABORT,'IMMUTABLE_BACKUP_SNAPSHOT'); END;
-- Short-lived server-side listing snapshots, not backup snapshots. No bytes.
CREATE INDEX IF NOT EXISTS paged_siblings ON nodes(workspace_id,parent_id,trashed,kind,name_key,id);
CREATE TABLE IF NOT EXISTS list_snapshots (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 actor_id TEXT NOT NULL, context_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
 sequence INTEGER NOT NULL, total INTEGER NOT NULL CHECK(total BETWEEN 0 AND 100000)
);
CREATE INDEX IF NOT EXISTS list_snapshot_expiry ON list_snapshots(expires_at);
CREATE TABLE IF NOT EXISTS list_snapshot_rows (
 snapshot_id TEXT NOT NULL REFERENCES list_snapshots(id) ON DELETE CASCADE,
 position INTEGER NOT NULL, node_json TEXT NOT NULL,
 PRIMARY KEY(snapshot_id,position)
);
