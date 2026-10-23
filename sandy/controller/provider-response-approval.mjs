// One pending exception; approval uses only the existing signed-in Owner session.
// This page never creates a grant, executes a release or exports authentication.
export const RELEASE = Object.freeze({
  change: 'fbcdd7f6-a29f-4063-9d1f-04c5608a9ceb',
  source: '53556941f600c7ec625067a74d37bbcffa8bd400',
  manifest: 'b72099a290d0e69ec09aba33fc1f8ab2159de6985e9ae292c6626a1c9e42dc40',
  request: '0b293dcb87f09590427052fd24a0757cea633949431321005bfae2047bbf4873',
  target: 'sandy-provider-operation-api',
});
const fields = ['title', 'problem', 'expected_behavior', 'change_purpose', 'feature_improvement',
  'scope', 'risk', 'idempotency_key', 'acceptance_criteria', 'regression_rules'];
const canonical = value => JSON.stringify(value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(v => JSON.parse(canonical(v)))
    : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])) : value);
export async function verifyReleaseChange(change) {
  if (change?.id !== RELEASE.change || fields.some(k => change[k] === undefined)) throw Error('The registered release request is unavailable.');
  const raw = canonical(Object.fromEntries(fields.map(k => [k, change[k]])));
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)))].map(x => x.toString(16).padStart(2, '0')).join('');
  if (digest !== RELEASE.request) throw Error('The registered request differs from the pinned release. Approval is disabled.');
  return change;
}
function hasOwnerAudit(current, owner) {
  return current.change.status === 'approved' && current.events?.some(e =>
    e.change_id === RELEASE.change && e.actor === owner &&
    ['status_changed', 'owner_release_attested'].includes(e.event_type) && e.detail?.to === 'approved' &&
    e.detail.reason?.includes(RELEASE.source) && e.detail.reason?.includes(RELEASE.manifest));
}
export function createReleaseApproval(transport) {
  let reviewedOwner, busy = false, dispatched = false;
  async function inspect() {
    const owner = (await transport.session()).user?.id;
    if (!owner) throw Error('Use your normal signed-in Controller Owner account.');
    const current = await transport.engineering({ action: 'get', change_id: RELEASE.change });
    await verifyReleaseChange(current.change);
    reviewedOwner ??= owner;
    if (reviewedOwner !== owner) throw Error('Controller account changed. Reload the page.');
    return { ...current, matching_owner_audit_verified: hasOwnerAudit(current, owner) };
  }
  async function approve() {
    if (busy) throw Error('The Owner action is already running.');
    busy = true;
    try {
      let current = await inspect();
      if (current.matching_owner_audit_verified) return { change_id: RELEASE.change, status: 'approved', matching_owner_audit_verified: true, deployment_started: false, reused: true };
      if (current.change.status !== 'proposed') throw Error('A matching Owner audit is not verified. Refresh recorded state.');
      if (dispatched) throw Error('The prior approval outcome is uncertain. Refresh recorded state; do not repeat the action.');
      // Recheck the real account immediately before a mutation; never adopt a new one.
      if ((await transport.session()).user?.id !== reviewedOwner) throw Error('Controller account changed. Reload the page.');
      dispatched = true;
      await transport.engineering({ action: 'status', change_id: RELEASE.change, status: 'approved',
        reason: `Release ${RELEASE.target}; source ${RELEASE.source}; manifest ${RELEASE.manifest}. Approve this bounded source-preserving upgrade and its captured-source rollback only. Do not change standing authority.` });
      current = await inspect();
      if (!current.matching_owner_audit_verified) throw Error('The Owner audit is not verified. Refresh recorded state; do not repeat the action.');
      return { change_id: RELEASE.change, status: 'approved', matching_owner_audit_verified: true, deployment_started: false, reused: false };
    } finally { busy = false; }
  }
  return { inspect, approve, canDispatch: () => !dispatched && !busy };
}
const approvalActions = new WeakMap();
export function releaseApprovalFor(transport) {
  if (!approvalActions.has(transport)) approvalActions.set(transport, createReleaseApproval(transport));
  return approvalActions.get(transport);
}
export function showProviderResponseApproval(host, transport) {
  const el = (tag, text) => { const e = document.createElement(tag); e.textContent = text; return e; };
  const box = el('section', ''); box.className = 'panel'; box.id = 'pr222-release';
  const status = el('p', 'Reading the registered release request…'); status.setAttribute('role', 'status');
  const details = el('pre', ''); details.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere';
  const approve = el('button', 'Approve PR #222 release'); approve.className = 'btn primary'; approve.disabled = true;
  const refresh = el('button', 'Refresh recorded approval'); refresh.className = 'btn';
  box.append(el('h2', 'PR #222 · one-off production release'),
    el('p', 'Approve the registered provider response correction and its bounded rollback using your existing Owner session. Approval is recorded separately from deployment; standing permissions remain unchanged.'), details, status, approve, refresh); host.append(box);
  const action = releaseApprovalFor(transport);
  const read = async () => {
    approve.disabled = true;
    try {
      const current = await action.inspect();
      details.textContent = `Change: ${RELEASE.change}\nFunction: ${RELEASE.target}\nSource: ${RELEASE.source}\nManifest: ${RELEASE.manifest}\n\n${current.change.expected_behavior}\n\nAcceptance:\n${current.change.acceptance_criteria.join('\n')}`;
      status.textContent = current.matching_owner_audit_verified
        ? `Approved: ${RELEASE.change}. Matching Owner audit verified. Deployment has not been started by this page.`
        : `Recorded status: ${current.change.status}. ${action.canDispatch() ? 'Review the exact request above, then select Approve PR #222 release.' : 'Refresh to reconcile the prior action; no automatic retry.'}`;
      approve.disabled = current.change.status !== 'proposed' || !action.canDispatch();
    } catch (e) { status.textContent = e.message; }
  };
  refresh.onclick = read;
  approve.onclick = async () => {
    approve.disabled = refresh.disabled = true;
    status.textContent = 'Recording authenticated Owner approval…';
    try { await action.approve(); await read(); }
    catch (e) { status.textContent = e.message; }
    finally { refresh.disabled = false; }
  };
  read();
}
