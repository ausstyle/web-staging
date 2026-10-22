// This client acts only through its existing, signed-in owner's Auth session.
// The server independently enforces the policy; local UI state is not authority.
export function showOwnerReleaseControls(host, transport, workflowDigest) {
  const panel = document.createElement("section"); panel.className = "panel";
  const element = (tag, text) => { const e = document.createElement(tag); e.textContent = text; return e; };
  const status = element("p", "Loading Engineering Control…"); status.setAttribute("role", "status");
  panel.append(element("h2", "Engineering release authorization"), status); host.append(panel);
  const select = document.createElement("select"); select.setAttribute("aria-label", "Proposed engineering change");
  const details = element("pre", ""), record = element("button", "Record owner authorization"); record.className = "btn";
  const refresh = element("button", "Refresh recorded state"); refresh.className = "btn";
  panel.append(select, details, record, refresh);
  const run = async action => { record.disabled = refresh.disabled = true; try { await action(); } catch (e) { status.textContent = e.message; }
    finally { record.disabled = refresh.disabled = false; } };
  async function inspect() {
    if (!select.value) { details.textContent = "No proposed changes."; return; }
    const current = await transport.engineering({ action: "get", change_id: select.value });
    details.textContent = JSON.stringify({ id: current.change.id, status: current.change.status, risk: current.change.risk,
      scope: current.change.scope, expected_behavior: current.change.expected_behavior }, null, 2);
    return current;
  }
  refresh.onclick = () => run(inspect); select.onchange = refresh.onclick;
  record.onclick = () => run(async () => {
    const current = await inspect(); if (!current || current.change.status !== "proposed") throw Error("Read the current recorded state before proceeding.");
    const pins = (current.tests || []).map(t => t.evidence).filter(e => /^[a-f0-9]{40}$/.test(e?.source_commit || "") &&
      /^[a-f0-9]{64}$/.test(e?.manifest_sha256 || "") && current.change.expected_behavior.includes(e.source_commit) &&
      current.change.expected_behavior.includes(e.manifest_sha256));
    const unique = new Map(pins.map(p => [p.source_commit + p.manifest_sha256, p]));
    if (unique.size !== 1) throw Error("One exact tested source and release manifest is required.");
    const pin = [...unique.values()][0], owner = (await transport.session()).user.id;
    await transport.engineering({ action: "status", change_id: current.change.id, status: "approved",
      reason: `Release ${pin.source_commit}; manifest ${pin.manifest_sha256}. Owner records the authorized bounded release through the existing authenticated Controller workflow.` });
    const verified = await transport.engineering({ action: "get", change_id: current.change.id });
    if (verified.change.status !== "approved" || !verified.events?.some(e => e.actor === owner && e.event_type === "status_changed" &&
      e.detail?.to === "approved" && e.detail?.reason?.includes(pin.source_commit) && e.detail?.reason?.includes(pin.manifest_sha256))) {
      throw Error("Approval audit is not verified. Read recorded state; do not repeat the action.");
    }
    status.textContent = "Owner approval and matching audit event are recorded. Deployment and customer acceptance remain separate.";
    await inspect();
  });
  const policyStatus = element("p", "Loading standing routine policy…"); panel.append(element("h3", "Standing routine releases"), policyStatus);
  const baseline = document.createElement("input"); baseline.placeholder = "Reviewed baseline commit (40 characters)"; baseline.setAttribute("aria-label", "Reviewed baseline commit");
  const reviewers = document.createElement("input"); reviewers.placeholder = "Trusted independent GitHub reviewers, separated by commas"; reviewers.setAttribute("aria-label", "Trusted independent GitHub reviewers");
  const enable = element("button", "Authorize routine policy for 30 days"), revoke = element("button", "Revoke routine policy"); enable.className = revoke.className = "btn";
  panel.append(baseline, reviewers, enable, revoke, element("p", "Routine releases require independent review, trusted CI, exact source pins and rollback evidence. Security, credentials, migrations and higher-risk changes require explicit owner action. Automatic processing uses this active Controller owner's renewable browser session."));
  const loadPolicy = async () => { const { policy } = await transport.engineering({ action: "delegation_policy" });
    policyStatus.textContent = policy.standing_authorized_by && policy.enabled && !policy.standing_revoked_at
      ? `Policy revision ${policy.standing_revision}; expires ${policy.standing_expires_at}.` : "Standing routine release policy is inactive.";
  };
  enable.onclick = () => run(async () => { await transport.engineering({ action: "set_delegation_policy", enabled: true, config: {
    targets: ["sandy-agent-runtime-v4", "sandy-workspace", "sandy-email-runtime-canary"], baseline_commit: baseline.value.trim(),
    reviewers: reviewers.value.split(",").map(s => s.trim()).filter(Boolean), workflow_sha256: workflowDigest,
    expires_at: new Date(Date.now() + 30 * 86400000 - 60000).toISOString(),
  } }); await loadPolicy(); });
  revoke.onclick = () => run(async () => { await transport.engineering({ action: "set_delegation_policy", enabled: false }); await loadPolicy(); });
  run(async () => { const { changes } = await transport.engineering({ action: "list" });
    for (const c of changes || []) if (c.status === "proposed") { const o = element("option", `${c.title} · ${c.id}`); o.value = c.id; select.append(o); }
    status.textContent = "Using your existing authenticated Controller owner session."; await inspect(); await loadPolicy();
  });
}

/** Runs only in an active owner Controller, never using the engineering runner.
 * Every decision is rechecked server-side; revocation immediately stops approval.
 */
export async function processRoutineProposals(transport) {
  const { policy } = await transport.engineering({ action: "delegation_policy" });
  if (!policy.enabled || policy.standing_revoked_at || !Number.isFinite(Date.parse(policy.standing_expires_at)) || Date.parse(policy.standing_expires_at) <= Date.now() ||
      policy.standing_authorized_by !== (await transport.session()).user.id) return;
  const { changes } = await transport.engineering({ action: "list" });
  for (const c of (changes || []).filter(c => c.status === "proposed" && ["low", "normal"].includes(c.risk)).slice(0, 5)) {
    try { await transport.engineering({ action: "auto_approve", change_id: c.id }); }
    catch { /* Ineligible, unreviewed, revoked or uncertain: no fallback/retry. */ }
  }
}
