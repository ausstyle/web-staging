import test from 'node:test';
import assert from 'node:assert/strict';
import { planDnsChange, planDnsRollback, dnsSnapshotDigest } from './dns_plan.mjs';
const rr = (name, type, rrdatas, ttl = 300) => ({ name, type, rrdatas, ttl });
const a = rr('www.sandy.chat.', 'A', ['192.0.2.10']);
const b = rr('www.sandy.chat.', 'A', ['192.0.2.11']);
const mx = rr('sandy.chat.', 'MX', ['10 mail.sandy.chat.']);
const txt = rr('sandy.chat.', 'TXT', ['"v=spf1 -all"']);
function input(current = [a, mx, txt], changes = [{ before: a, after: b }]) {
  return { project: 'elaborate-haven-511518-a5', tenant_id: '11111111-1111-4111-8111-111111111111',
    managed_zone: 'sandy-chat', dns_name: 'sandy.chat.', snapshot_complete: true,
    current, expected_snapshot_sha256: dnsSnapshotDigest(current, 'sandy.chat.'), changes };
}
test('exact A diff preserves all unrelated MX/TXT and never authorizes execution', () => {
  const p = planDnsChange(input());
  assert.deepEqual(p.additions, [b]); assert.deepEqual(p.deletions, [a]);
  assert.equal(p.executable, false); assert.equal(p.requires_authorization_and_diff_review, true);
  assert.equal(p.after_sha256, dnsSnapshotDigest([b, mx, txt], 'sandy.chat.'));
});
test('canonical snapshot and diff stable under record order', () => {
  assert.deepEqual(planDnsChange(input()), planDnsChange(input([txt, a, mx])));
});
test('diff binds tenant and exact target', () => {
  const i = input(); const p = planDnsChange(i);
  i.tenant_id = '22222222-2222-4222-8222-222222222222';
  assert.notEqual(planDnsChange(i).diff_sha256, p.diff_sha256);
  i.project = 'other'; assert.throws(() => planDnsChange(i), /invalid_target/);
});
test('partial or stale snapshot refused', () => {
  assert.throws(() => planDnsChange({ ...input(), snapshot_complete: false }), /complete_snapshot/);
  assert.throws(() => planDnsChange({ ...input(), expected_snapshot_sha256: '0'.repeat(64) }), /stale_snapshot/);
});
test('duplicate edits and existing-record conflicts refused', () => {
  const i = input(); i.changes.push(i.changes[0]);
  assert.throws(() => planDnsChange(i), /duplicate_change/);
  assert.throws(() => planDnsChange(input(undefined, [{ before: null, after: b }])), /preimage_conflict/);
  assert.throws(() => planDnsChange(input(undefined, [{ before: { ...a, ttl: 60 }, after: b }])), /preimage_conflict/);
});
test('existing email records cannot be replaced or deleted', () => {
  for (const r of [mx, txt]) assert.throws(() => planDnsChange(input(undefined, [{ before: r, after: null }])), /email_record_protected/);
});
test('MX address and SPF a dependencies protected', () => {
  const mail = rr('mail.sandy.chat.', 'A', ['192.0.2.20']);
  assert.throws(() => planDnsChange(input([mx, mail], [{ before: mail, after: { ...mail, ttl: 60 } }])), /email_record_protected/);
  const spf = rr('www.sandy.chat.', 'TXT', ['"v=spf1 a -all"']);
  assert.throws(() => planDnsChange(input([a, spf])), /email_record_protected/);
});
test('new A AAAA CNAME TXT MX test RRsets supported without live writes', () => {
  const records = [rr('a.sandy.chat.', 'A', ['192.0.2.1']), rr('v6.sandy.chat.', 'AAAA', ['2001:db8::1']),
    rr('alias.sandy.chat.', 'CNAME', ['www.sandy.chat.']), rr('_test.sandy.chat.', 'TXT', ['"test"']),
    rr('test.sandy.chat.', 'MX', ['10 mail.sandy.chat.'])];
  const i = input([a], records.map(after => ({ before: null, after })));
  assert.equal(planDnsChange(i).additions.length, 5);
  const rollback = planDnsRollback(i, [a, ...records]);
  assert.equal(rollback.deletions.length, 5); assert.equal(rollback.executable, false);
});
test('CNAME coexistence apex and cycles refused', () => {
  assert.throws(() => planDnsChange(input([a], [{ before: null, after: rr(a.name, 'CNAME', ['else.sandy.chat.']) }])), /cname_conflict/);
  assert.throws(() => planDnsChange(input([], [{ before: null, after: rr('sandy.chat.', 'CNAME', ['else.sandy.chat.']) }])), /invalid_cname/);
  const rows = [rr('one.sandy.chat.', 'CNAME', ['two.sandy.chat.']), rr('two.sandy.chat.', 'CNAME', ['one.sandy.chat.'])];
  assert.throws(() => planDnsChange(input([], rows.map(after => ({ before: null, after })))), /cname_cycle/);
});
test('zone escape, malformed IP, MX and TXT fail closed', () => {
  for (const r of [rr('not-sandy.chat.', 'A', ['192.0.2.1']), rr('x.sandy.chat.', 'A', ['999.1.1.1']),
    rr('x.sandy.chat.', 'MX', ['65536 mail.sandy.chat.']), rr('x.sandy.chat.', 'TXT', ['unquoted']),
    rr('x.sandy.chat.', 'TXT', ['"' + 'x'.repeat(256) + '"'])]) {
    assert.throws(() => planDnsChange(input([], [{ before: null, after: r }])));
  }
});
test('NS DNSSEC and routing-policy edits require separate reviewed workflows', () => {
  assert.throws(() => planDnsChange(input([], [{ before: null, after: rr('sandy.chat.', 'NS', ['ns.example.com.']) }])), /separate_workflow/);
  assert.throws(() => planDnsChange(input([], [{ before: null, after: { ...a, routingPolicy: {} } }])), /standard_rrset/);
});
test('rollback refuses any intervening change and binds the forward diff', () => {
  const i = input(); const p = planDnsChange(i); const rollback = planDnsRollback(i, [b, mx, txt]);
  assert.equal(rollback.forward_diff_sha256, p.diff_sha256);
  assert.deepEqual(rollback.additions, [a]); assert.deepEqual(rollback.deletions, [b]);
  assert.throws(() => planDnsRollback(i, [b, mx, txt, rr('new.sandy.chat.', 'A', ['192.0.2.2'])]), /rollback_preimage_conflict/);
});
