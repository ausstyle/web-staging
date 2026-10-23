import assert from "node:assert/strict";
import { createOwnerAcceptanceAuth, freshSessionClaims, ownerAcceptanceId, ownerAuthBase, parseOwnerCredential } from "./owner_acceptance_auth.ts";
const initial = Date.parse("2026-10-23T12:00:00Z");
const sessionId = "11111111-2222-4333-8444-555555555555";
const credential = (changes = {}) => JSON.stringify({ version: 1, project: "zmqlyygzqoidkcwdysok",
  purpose: "sandy-gcp-admin-read-acceptance", email: "owner@example.invalid", password: "fixture-password",
  issued_at: new Date(initial - 60000).toISOString(), expires_at: new Date(initial + 86400000).toISOString(), ...changes });
const token = (now: number, changes = {}) => [btoa('{}'), btoa(JSON.stringify({ sub: ownerAcceptanceId, role: "authenticated",
  aud: "authenticated", iss: ownerAuthBase + "/auth/v1", session_id: sessionId, exp: Math.floor(now / 1000) + 3600, ...changes })), "fixture"].join('.');
function fixture(change: { signIn?: number; auth?: number; user?: any; owner?: number; mfa?: number; retire?: number; remaining?: number } = {}) {
  let time = initial, logins = 0, retirements = 0;
  const report: Record<string, any> = {}, requests: { url: string; body: any }[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = String(input), body = init?.body ? JSON.parse(String(init.body)) : undefined;
    assert.equal(init?.redirect, 'error');
    requests.push({ url, body });
    if (url.endsWith('/token?grant_type=password')) {
      logins++;
      assert.deepEqual(body, { email: "owner@example.invalid", password: "fixture-password" });
      if (change.signIn) return Response.json({ code: "invalid_credentials", message: "do not leak fixture-password" }, { status: change.signIn });
      return Response.json({ access_token: token(time), refresh_token: "fixture-refresh", token_type: "bearer" });
    }
    if (url.endsWith('/user')) return Response.json(change.user ?? { id: ownerAcceptanceId, email: "owner@example.invalid", email_confirmed_at: "confirmed", app_metadata: {} }, { status: change.auth ?? 200 });
    if (url.endsWith('/logout?scope=local')) { retirements++; return new Response(null, { status: change.retire ?? 204 }); }
    if (url === 'https://api.supabase.com/v1/projects/zmqlyygzqoidkcwdysok/database/query') {
      assert.equal(body.read_only, true);
      assert.match(body.query, /^SELECT /);
      return Response.json(body.query.includes('FROM auth.sessions') ? [{ remaining: change.remaining ?? 0 }] : [{ enabled_owner: change.owner ?? 1, verified_mfa: change.mfa ?? 0 }]);
    }
    throw Error('unexpected_endpoint');
  };
  const auth = createOwnerAcceptanceAuth({ credential: credential(), anon: 'fixture-anon', management: 'fixture-management', request, now: () => time, report });
  return { auth, report, requests, advance: (n: number) => { time += n; }, counts: () => ({ logins, retirements }) };
}
Deno.test('fresh normal Owner login validates Auth and current membership; retires only its session with independent readback', async () => {
  const f = fixture();
  const result = await f.auth.get(); assert.equal(typeof result, 'string');
  assert.equal(await f.auth.get(), result); assert.equal(f.counts().logins, 1);
  assert.equal(f.report.normal_Auth_user_verified, true);
  await f.auth.retire();
  assert.deepEqual(f.counts(), { logins: 1, retirements: 1 });
  assert.equal(f.report.normal_Auth_session_retired, true);
  assert.equal(f.report.Owner_session_retirement_independently_verified, true);
  assert.equal(f.report.access_JWT_immediate_revocation_claimed, false);
  assert.equal(f.report.refresh_token_persisted, false);
  assert.doesNotMatch(JSON.stringify(f.report), /fixture-password|fixture-refresh|fixture-management|access_token"/);
});
Deno.test('near expiry retires old session then obtains a fresh normal session, without refreshing or replaying credentials', async () => {
  const f = fixture(); await f.auth.get(); f.advance(3500000); await f.auth.get();
  assert.deepEqual(f.counts(), { logins: 2, retirements: 1 });
  assert.equal(f.report.normal_Auth_session_retired, false);
  assert.equal(f.requests.some(r => r.url.includes('grant_type=refresh_token')), false);
  await f.auth.retire(); assert.equal(f.counts().retirements, 2);
});
Deno.test('invalid, expired, future, wrong purpose and excessive credential windows fail before any network call', () => {
  for (const value of ['null', '{}', 'not-json', credential({ expires_at: new Date(initial).toISOString() }),
    credential({ issued_at: new Date(initial + 120000).toISOString() }), credential({ expires_at: new Date(initial + 8 * 86400000).toISOString() }),
    credential({ purpose: 'expand-IAM' }), credential({ project: 'another' }), credential({ extra: true })]) {
    assert.throws(() => parseOwnerCredential(value, initial), /owner_credential/);
  }
});
Deno.test('expired or wrong subject JWT cannot establish authentication from claims', () => {
  for (const changes of [{ sub: 'another-user' }, { role: 'service_role' }, { exp: initial / 1000 - 1 },
    { iss: 'https://another.invalid' }, { exp: initial / 1000 + 86400 }, { session_id: "'; DROP TABLE auth.users; --" }]) {
    assert.throws(() => freshSessionClaims(token(initial, changes), initial), /owner_session_claims_invalid/);
  }
});
Deno.test('wrong password is a redacted terminal failure, never a retry or privilege fallback', async () => {
  const f = fixture({ signIn: 400 });
  await assert.rejects(f.auth.get(), /owner_normal_sign_in_failed/);
  await f.auth.retire(); assert.deepEqual(f.counts(), { logins: 1, retirements: 0 });
  assert.equal(f.report.Owner_sign_in_error, 'invalid_credentials');
  assert.doesNotMatch(JSON.stringify(f.report), /fixture-password/);
});
Deno.test('revoked Owner membership, wrong identity, workload identity and MFA fail closed and retire issued session', async () => {
  for (const change of [{ owner: 0 }, { mfa: 1 }, { auth: 401 },
    { user: { id: 'another', email: 'owner@example.invalid', email_confirmed_at: 'confirmed' } },
    { user: { id: ownerAcceptanceId, email: 'owner@example.invalid', email_confirmed_at: 'confirmed', app_metadata: { sandy_engineering_test: true } } }]) {
    const f = fixture(change); await assert.rejects(f.auth.get()); await f.auth.retire();
    assert.equal(f.counts().retirements, 1);
    assert.notEqual(f.report.current_Owner_membership_verified, true);
  }
});
Deno.test('logout failure or nonempty session readback cannot claim session retirement', async () => {
  for (const change of [{ retire: 500 }, { remaining: 1 }]) {
    const f = fixture(change); await f.auth.get(); await assert.rejects(f.auth.retire(), /retirement/);
    assert.notEqual(f.report.normal_Auth_session_retired, true);
  }
});
Deno.test('credential expiry overrides a cached session and never authorizes another call', async () => {
  const f = fixture(); await f.auth.get(); f.advance(86400001);
  await assert.rejects(f.auth.get(), /owner_credential_expired/); await f.auth.retire();
  assert.equal(f.counts().logins, 1); assert.equal(f.counts().retirements, 1);
});
