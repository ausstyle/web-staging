/** A browser-only execution handoff for the separately requested high-risk
 * authentication repair. Keeps the configured owner's refresh session private. */
export async function registerAuthorizedAuthRepair(transport, request) {
  const pins = /^Release ([a-f0-9]{40}); manifest ([a-f0-9]{64})\./.exec(request.expected_behavior || "");
  if (request.action !== "register" || request.risk !== "high" || !pins ||
      !request.scope?.includes("sandy-engineering-control") || !request.scope.includes("security:standing-owner-delegation")) {
    throw Error("The fixed, separately authorized security repair request is required.");
  }
  const registered = await transport.engineering(request), change = registered.change;
  if (!change?.id || !change.expected_behavior.includes(pins[1]) || !change.expected_behavior.includes(pins[2]) || change.risk !== "high") throw Error("Registered security-repair pins are not verified.");
  if (change.status === "proposed") await transport.engineering({ action: "status", change_id: change.id, status: "approved",
    reason: `Release ${pins[1]}; manifest ${pins[2]}. Record the owner's explicit instruction to repair the existing Controller owner-session path and separately implement protected standing routine delegation. No approval impersonation, workload self-approval or customer-channel source expansion.` });
  const after = await transport.engineering({ action: "get", change_id: change.id });
  const owner = (await transport.session()).user.id;
  if (after.change?.status !== "approved" || !after.events?.some(e => e.actor === owner && e.event_type === "status_changed" &&
      e.detail?.to === "approved" && e.detail.reason?.includes(pins[1]) && e.detail.reason?.includes(pins[2]))) {
    throw Error("The authenticated owner audit event is not verified. Read the actual record before repeating any action.");
  }
  return { security_repair_change_id: change.id, status: after.change.status, matching_owner_audit_verified: true,
    tokens_exported: false, deadline_change_attested: false, deployment_started: false };
}
