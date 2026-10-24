import { deepStrictEqual, rejects } from "node:assert/strict";
import {
  type CloudTransferIntent,
  lockedTransferScope,
  type PrivateCustodyRow,
} from "./postgres/transfer_custody.ts";
import { cloudTransport } from "../sandy-api/cloud/transport.ts";
import { reconcileResumable } from "./gcs_protocol.ts";
const context = {
  actorId: "actor",
  apiTenantId: "tenant",
  sessionId: "session",
  deviceId: "device",
  companyId: null,
  admissionId: "admission",
};
const intent: CloudTransferIntent = {
  intentId: "intent",
  actorId: "actor",
  tenantId: "tenant",
  workspaceId: "workspace",
  admissionId: "admission",
  bucket: "synthetic-bucket",
  key: "private/file",
  objectPrefix: "private/",
  size: 10,
  sha256: "a".repeat(64),
  expiresAt: Date.now() + 60000,
};
const base: PrivateCustodyRow = {
  rowId: "row",
  ...intent,
  sessionId: "session",
  deviceId: "device",
  revoked: false,
  offset: 0,
  state: "READY",
};
const tx = { query: async () => ({ rows: [] }) };
const session =
  "https://storage.googleapis.com/upload/storage/v1/b/synthetic-bucket/o?uploadType=resumable&upload_id=private-id";
Deno.test("Runtime custody must match current actor/session/device and exact server intent", async () => {
  for (
    const patch of [
      { intentId: "foreign" },
      { actorId: "foreign" },
      { tenantId: "foreign" },
      { workspaceId: "foreign" },
      { admissionId: "foreign" },
      { sessionId: "foreign" },
      { deviceId: "foreign" },
      { bucket: "foreign" },
      { key: "private/foreign" },
      { sha256: "b".repeat(64) },
      { size: 11 },
      { expiresAt: 0 },
      { revoked: true },
      { offset: 11 },
    ]
  ) {
    await rejects(
      lockedTransferScope(tx, context, intent, {
        lock: async (supplied) => {
          deepStrictEqual(supplied, tx);
          return { ...base, ...patch };
        },
      }, "start"),
      /CLOUD_CUSTODY_DENIED/,
    );
  }
  const scope = await lockedTransferScope(tx, context, intent, {
    lock: async () => ({ ...base }),
  }, "start");
  deepStrictEqual(scope.intentId, intent.intentId);
  deepStrictEqual(Object.isFrozen(scope), true);
});
Deno.test("unknown session outcome permits status only, never blind chunk retry", async () => {
  const row: PrivateCustodyRow = {
    ...base,
    sessionUrl: session,
    state: "UNKNOWN_OUTCOME",
  };
  await rejects(
    lockedTransferScope(
      tx,
      context,
      intent,
      { lock: async () => row },
      "chunk",
    ),
    /CLOUD_CUSTODY_DENIED/,
  );
  const scope = await lockedTransferScope(tx, context, intent, {
    lock: async () => row,
  }, "status");
  let calls = 0;
  const transport = cloudTransport(scope, {
    execute: async (request) => {
      calls++;
      deepStrictEqual(
        request.operation,
        "gcp.storage.objects.upload.resumable.status",
      );
      return new Response(null, {
        status: 308,
        headers: { range: "bytes=0-4" },
      });
    },
  });
  // The real API transport is exercised, not a second provider route.
  const result = await reconcileResumable(
    {
      binding: scope,
      sessionUrl: session,
      offset: scope.offset,
      state: "RECONCILE_REQUIRED",
    },
    {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      allowedBuckets: new Set([scope.bucket]),
      maxBytes: 100,
      signal: AbortSignal.timeout(1000),
    },
    transport,
  );
  deepStrictEqual(result.offset, 5);
  deepStrictEqual(calls, 1);
});
Deno.test("custody rejects foreign session endpoints and incomplete generation read", async () => {
  for (
    const sessionUrl of [
      "https://example.com/secret",
      session + "&extra=1",
      session.replace("synthetic-bucket", "foreign"),
    ]
  ) {
    await rejects(
      lockedTransferScope(tx, context, intent, {
        lock: async () => ({ ...base, sessionUrl }),
      }, "status"),
      /CLOUD_CUSTODY_DENIED/,
    );
  }
  await rejects(
    lockedTransferScope(tx, context, intent, {
      lock: async () => ({
        ...base,
        state: "COMPLETE",
        offset: 9,
        generation: "1",
      }),
    }, "read"),
    /CLOUD_CUSTODY_DENIED/,
  );
  const scope = await lockedTransferScope(tx, context, intent, {
    lock: async () => ({
      ...base,
      state: "COMPLETE",
      offset: 10,
      generation: "101",
    }),
  }, "read");
  deepStrictEqual(scope.generation, "101");
});
