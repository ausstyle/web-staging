import { test } from "node:test";
import assert from "node:assert/strict";
import { argumentDigest } from "../../supabase/functions/_shared/sandy_api_protocol.ts";
import {
  accountingPayload,
  accountingScope,
  canonicalBoundary,
  type CanonicalContext,
  type CanonicalOwners,
  type LockedAuthority,
} from "./canonical_boundary.ts";
import {
  Accounting,
  type Database,
  type Request,
  type Sql,
} from "./service.ts";
import { fixture } from "./fixture.ts";

test("canonical admission/company/Files adapter binds exact payload and keeps authority on the ledger transaction", async () => {
  const f = await fixture();
  try {
    const request: Request = {
      operation: "accounting.ledger.journal.post",
      company_id: "synthetic-company",
      contract_version: "1",
      idempotency_key: "canonical-fixture",
      arguments: f.journal(),
    };
    const context: CanonicalContext = {
      actorId: "synthetic-canonical-actor",
      apiTenantId: "synthetic-tenant",
      companyId: "synthetic-company",
      sessionId: "canonical-session",
      channel: "api",
      contractSha256: "a".repeat(64),
      admission: {
        admissionId: "synthetic-admission",
        grantId: "synthetic-consumed-grant",
        requestId: "synthetic-request",
        actorId: "synthetic-canonical-actor",
        tenantId: null,
        operation: request.operation,
        inputSha256: await argumentDigest(accountingPayload(request)),
        contractSha256: "a".repeat(64),
        scopeSha256: await argumentDigest({
          tenant_id: "synthetic-tenant",
          company_id: "synthetic-company",
          channel: "api",
        }),
        expiresAt: "2026-10-25T00:00:00Z",
      },
    };
    let authority: LockedAuthority | null = {
      admission: structuredClone(context.admission),
      actorId: context.actorId,
      apiTenantId: context.apiTenantId,
      companyId: context.companyId,
      sessionId: context.sessionId,
      tenantCompanyLinked: true,
      operationAllowed: true,
      grantConsumed: true,
      revoked: false,
      policyRef: "synthetic-canonical-policy",
      expiresAt: "2026-10-25T00:00:00Z",
    };
    let fileAllowed = true,
      activeTx: Sql | null = null,
      authorityCalls = 0,
      fileCalls = 0;
    const owners: CanonicalOwners = {
      async lockAuthority(tx) {
        assert.equal(tx, activeTx);
        authorityCalls++;
        // Real production locks belong to the canonical owner. This test only
        // establishes adapter composition and exact transaction propagation.
        return structuredClone(authority);
      },
      async lockFile(tx, actor, company, source) {
        assert.equal(tx, activeTx);
        fileCalls++;
        return {
          actorId: actor.actor_id,
          apiTenantId: actor.tenant_id,
          companyId: company,
          source,
          allowed: fileAllowed,
          revoked: !fileAllowed,
          deleted: false,
        };
      },
    };
    const db: Database = {
      query: f.db.query.bind(f.db) as Database["query"],
      transaction: (fn) =>
        f.db.transaction(async (tx) => {
          activeTx = tx as unknown as Sql;
          try {
            return await fn(activeTx);
          } finally {
            activeTx = null;
          }
        }),
    };
    const app = new Accounting(
      db,
      canonicalBoundary(context, owners, f.boundary.now),
    );
    const posted = await app.execute(context.sessionId, request);
    assert.equal(posted.state, "POSTED");
    assert.equal(authorityCalls, 2);
    assert.equal(fileCalls, 1);
    assert.deepEqual(await app.execute(context.sessionId, request), posted);
    await assert.rejects(
      app.execute(context.sessionId, {
        ...request,
        idempotency_key: "changed",
      }),
      /authority_denied/,
    );
    await assert.rejects(
      app.execute(context.sessionId, {
        ...request,
        arguments: f.journal("2.00"),
      }),
      /authority_denied/,
    );
    await assert.rejects(
      app.execute("other-session", request),
      /authority_denied/,
    );
    const valid = structuredClone(authority!);
    for (
      const patch of [
        { revoked: true },
        { grantConsumed: false },
        { tenantCompanyLinked: false },
        { operationAllowed: false },
        { apiTenantId: "other-tenant" },
        { companyId: "other-company" },
        { actorId: "other-actor" },
        { expiresAt: "2026-10-23T00:00:00Z" },
        { admission: { ...valid.admission, inputSha256: "0".repeat(64) } },
        { admission: { ...valid.admission, contractSha256: "0".repeat(64) } },
        {
          admission: {
            ...valid.admission,
            scopeSha256: await argumentDigest(
              accountingScope({ ...context, companyId: "other-company" }),
            ),
          },
        },
      ]
    ) {
      authority = { ...valid, ...patch };
      await assert.rejects(
        app.execute(context.sessionId, request),
        /authority_denied/,
      );
    }
    authority = null;
    await assert.rejects(
      app.execute(context.sessionId, request),
      /authority_denied/,
    );
    authority = valid;
    const sourceRequest: Request = {
      operation: "accounting.reporting.drilldown",
      company_id: context.companyId,
      contract_version: "1",
      arguments: { journal_id: posted.journal_id },
    };
    const readContext = {
      ...context,
      admission: {
        ...context.admission,
        operation: sourceRequest.operation,
        inputSha256: await argumentDigest(accountingPayload(sourceRequest)),
      },
    };
    authority = { ...valid, admission: readContext.admission };
    const readApp = new Accounting(
      db,
      canonicalBoundary(readContext, owners, f.boundary.now),
    );
    assert.equal(
      (await readApp.execute(context.sessionId, sourceRequest)).lines.length,
      2,
    );
    fileAllowed = false;
    await assert.rejects(
      readApp.execute(context.sessionId, sourceRequest),
      /evidence_missing_or_revoked/,
    );
    assert.equal(
      (await f.db.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM accounting.journals",
      )).rows[0].n,
      1,
    );
  } finally {
    await f.db.close();
  }
});
