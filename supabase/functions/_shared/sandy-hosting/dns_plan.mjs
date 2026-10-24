/** Offline standard-RRset planner for #203/#226. Never authorizes or executes DNS.
 * Gateway must supply a complete authoritative snapshot and independently verify
 * tenant/domain authority, reviewed digest, cost policy and current preimage.
 */
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

const project = 'elaborate-haven-511518-a5';
const editable = new Set(['A', 'AAAA', 'CNAME', 'TXT', 'MX']);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = code => { throw new Error(code); };
const key = r => `${r.name}/${r.type}`;
const order = (a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function name(value) {
  if (typeof value !== 'string' || value.length > 254 || !value.endsWith('.') || value !== value.toLowerCase()) fail('canonical_fqdn_required');
  const labels = value.slice(0, -1).split('.');
  if (labels.length < 2 || labels.some((s, i) => !(i === 0 && s === '*') && !/^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/.test(s))) fail('invalid_dns_name');
  return value;
}

function record(raw, zone, mutation = false) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => !['name', 'type', 'ttl', 'rrdatas'].includes(k))) fail('standard_rrset_required');
  const owner = name(raw.name);
  if (owner !== zone && !owner.endsWith('.' + zone)) fail('record_outside_zone');
  if (!/^[A-Z][A-Z0-9]{0,15}$/.test(raw.type) || !Number.isInteger(raw.ttl) || raw.ttl < 1 || raw.ttl > 2147483647) fail('invalid_type_or_ttl');
  if (!Array.isArray(raw.rrdatas) || !raw.rrdatas.length || raw.rrdatas.length > 100 || raw.rrdatas.some(s => typeof s !== 'string' || !s.length || s.length > 4096 || /[\r\n\0]/.test(s)) || new Set(raw.rrdatas).size !== raw.rrdatas.length) fail('invalid_rrdata');
  if (mutation) {
    if (!editable.has(raw.type)) fail('record_type_requires_separate_workflow');
    for (const value of raw.rrdatas) {
      if (raw.type === 'A' && isIP(value) !== 4 || raw.type === 'AAAA' && isIP(value) !== 6) fail('invalid_ip');
      if (raw.type === 'CNAME') {
        name(value);
        if (value.includes('_') || value.includes('*') || value === owner || owner === zone || raw.rrdatas.length !== 1) fail('invalid_cname');
      }
      if (raw.type === 'MX') {
        const match = /^(0|[1-9][0-9]{0,4}) ([^ ]+)$/.exec(value);
        if (!match || Number(match[1]) > 65535) fail('invalid_mx');
        if (match[2] === '.') { if (value !== '0 .' || raw.rrdatas.length !== 1) fail('invalid_null_mx'); }
        else { name(match[2]); if (/[_*]/.test(match[2])) fail('invalid_mx'); }
      }
      // Bounded ASCII master-file form. Unsupported escapes/Unicode fail closed.
      if (raw.type === 'TXT' && !/^"(?:[\x20-\x21\x23-\x5b\x5d-\x7e]|\\["\\])*"(?: "(?:[\x20-\x21\x23-\x5b\x5d-\x7e]|\\["\\])*")*$/.test(value)) fail('unsupported_txt_encoding');
      if (raw.type === 'TXT' && [...value.matchAll(/"((?:[^"\\]|\\.)*)"/g)].some(m => Buffer.byteLength(m[1].replace(/\\(.)/g, '$1')) > 255)) fail('txt_chunk_too_long');
    }
  }
  return { name: owner, type: raw.type, ttl: raw.ttl, rrdatas: [...raw.rrdatas].sort() };
}

function snapshot(records, zone) {
  if (!Array.isArray(records) || records.length > 5000) fail('snapshot_limit');
  let bytes = 0;
  const rows = records.map(r => {
    const parsed = record(r, zone);
    bytes += Buffer.byteLength(JSON.stringify(parsed));
    if (bytes > 8_388_608) fail('snapshot_byte_limit');
    return parsed;
  }).sort(order);
  if (new Set(rows.map(key)).size !== rows.length) fail('duplicate_rrset');
  return rows;
}
const protectedEmail = r => ['MX', 'TXT', 'SRV'].includes(r.type) || /(^|\.)(_domainkey|_dmarc|autodiscover)(\.|$)/.test(r.name);

export function planDnsChange(input) {
  if (!input || input.project !== project || typeof input.tenant_id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.tenant_id) || !/^[a-z][a-z0-9-]{0,62}$/.test(input.managed_zone)) fail('invalid_target');
  const zone = name(input.dns_name);
  if (zone.includes('*') || zone.includes('_')) fail('invalid_zone_name');
  if (input.snapshot_complete !== true) fail('complete_snapshot_required');
  const before = snapshot(input.current, zone);
  if (digest(before) !== input.expected_snapshot_sha256) fail('stale_snapshot');
  if (!Array.isArray(input.changes) || !input.changes.length || input.changes.length > 100) fail('change_limit');
  const protectedNames = new Set();
  for (const row of before) {
    if (['MX', 'SRV'].includes(row.type)) {
      for (const data of row.rrdatas) protectedNames.add(data.split(' ').at(-1).toLowerCase());
    }
    if (row.type === 'TXT') {
      for (const data of row.rrdatas) {
        const spf = data.replace(/" "/g, '').replace(/^"|"$/g, '');
        if (!spf.startsWith('v=spf1 ')) continue;
        for (const term of spf.split(/ +/)) {
          const match = /^[+?~-]?a(?::([^/]+))?(?:\/.*)?$/.exec(term);
          if (match) protectedNames.add(match[1] ? match[1].toLowerCase().replace(/\.$/, '') + '.' : row.name);
        }
      }
    }
  }
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const row of before) if (row.type === 'CNAME' && protectedNames.has(row.name)) {
      for (const value of row.rrdatas) if (!protectedNames.has(value.toLowerCase())) {
        protectedNames.add(value.toLowerCase()); expanded = true;
      }
    }
  }
  const after = new Map(before.map(r => [key(r), r]));
  const seen = new Set(); const additions = []; const deletions = [];
  for (const change of input.changes) {
    if (!change || !Object.hasOwn(change, 'before') || !Object.hasOwn(change, 'after') || Object.keys(change).some(k => !['before', 'after'].includes(k))) fail('exact_change_required');
    const old = change.before === null ? null : record(change.before, zone, true);
    const next = change.after === null ? null : record(change.after, zone, true);
    if (!old && !next || old && next && key(old) !== key(next)) fail('invalid_replacement');
    const k = key(old || next);
    if (seen.has(k)) fail('duplicate_change');
    seen.add(k);
    if (!equal(after.get(k) ?? null, old)) fail('preimage_conflict');
    if (equal(old, next)) fail('no_effect');
    if (old && (protectedEmail(old) || protectedNames.has(old.name))) fail('existing_email_record_protected');
    if (old) { deletions.push(old); after.delete(k); }
    if (next) { additions.push(next); after.set(k, next); }
  }
  const result = snapshot([...after.values()], zone);
  for (const row of result) {
    if (row.type === 'CNAME' && result.some(other => other.name === row.name && other.type !== 'CNAME')) fail('cname_conflict');
    if (row.type === 'CNAME') {
      const visited = new Set([row.name]); let target = row.rrdatas[0].toLowerCase();
      while (after.has(`${target}/CNAME`)) {
        if (visited.has(target)) fail('cname_cycle');
        visited.add(target); target = after.get(`${target}/CNAME`).rrdatas[0].toLowerCase();
      }
    }
  }
  additions.sort(order);
  deletions.sort(order);
  const plan = { project, tenant_id: input.tenant_id, managed_zone: input.managed_zone, dns_name: zone,
    before_sha256: digest(before), after_sha256: digest(result), additions, deletions };
  return { ...plan, diff_sha256: digest(plan), executable: false, requires_authorization_and_diff_review: true };
}

export function dnsSnapshotDigest(records, dnsName) {
  return digest(snapshot(records, name(dnsName)));
}

export function planDnsRollback(originalInput, current) {
  const forward = planDnsChange(originalInput);
  // Recompute from original reviewed inputs, never trust a supplied inverse/plan.
  if (dnsSnapshotDigest(current, originalInput.dns_name) !== forward.after_sha256) fail('rollback_preimage_conflict');
  const inverse = { project: forward.project, tenant_id: forward.tenant_id, managed_zone: forward.managed_zone,
    dns_name: forward.dns_name, before_sha256: forward.after_sha256, after_sha256: forward.before_sha256,
    additions: forward.deletions, deletions: forward.additions, forward_diff_sha256: forward.diff_sha256 };
  return { ...inverse, diff_sha256: digest(inverse), executable: false, requires_authorization_and_diff_review: true };
}
