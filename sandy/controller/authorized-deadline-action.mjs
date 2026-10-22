export const authorizedDeadline = Object.freeze({
  change: "07894248-0808-4ae0-a271-2fb850ec054d",
  source: "3734254e872fcb2f0b5270aac43f8540b40726a2",
  manifest: "1cd49be83211912bae2fce62bf0f0415a486e5f904a48acc65f4c852b2986017",
});

/** Execute an already authorized action in the real owner's browser. No token
 * leaves the normal Controller destination or appears in the returned result. */
export async function recordAuthorizedDeadline(transport) {
  const p = authorizedDeadline;
  const read = () => transport.engineering({ action: "get", change_id: p.change });
  const before = await read();
  if (before.change?.id !== p.change || before.change.risk !== "normal" ||
      !before.change.expected_behavior?.includes(p.source) || !before.change.expected_behavior?.includes(p.manifest) ||
      !Array.isArray(before.change.scope) || before.change.scope.length !== 2 ||
      !before.change.scope.includes("sandy-agent-runtime-v4") ||
      !before.change.scope.includes("github:ausstyle/web-staging:engineering/sandy-unified-intelligence-20261021")) {
    throw Error("The recorded change differs from the owner's exact authorized release.");
  }
  const owner = (await transport.session()).user.id;
  const ownerEvent = e => e.actor === owner && e.detail?.to === "approved" && e.detail.reason?.includes(p.source) &&
    e.detail.reason?.includes(p.manifest) && (e.event_type === "status_changed" ||
      (e.event_type === "owner_release_attested" && e.detail.owner_session_authenticated === true));
  if (before.change.status === "proposed" || (before.change.status === "approved" && !before.events?.some(ownerEvent))) {
    await transport.engineering({ action: "status", change_id: p.change, status: "approved",
      reason: `Release ${p.source}; manifest ${p.manifest}. Record the owner's existing explicit authorization for the bounded V4 deadline correction. Preserve the existing pilot, Gmail confirmation, customer data and memory ingestion. Require guarded source/version deployment and actual overdue-task verification.` });
  } else if (!["approved", "implementing"].includes(before.change.status)) {
    throw Error("Change is not awaiting approval or ready for the authorized release.");
  }
  const after = await read();
  const audited = after.events?.some(ownerEvent);
  if (!["approved", "implementing"].includes(after.change?.status) || !audited) {
    throw Error("A matching owner audit event is not verified. Do not repeat the action; have the runner read the actual database state.");
  }
  return { change_id: p.change, status: after.change.status, matching_owner_audit_verified: true,
    tokens_exported: false, deployment_started: false };
}
