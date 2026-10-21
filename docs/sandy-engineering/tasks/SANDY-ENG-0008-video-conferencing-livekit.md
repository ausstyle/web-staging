# SANDY-ENG-0008 — Video Conferencing and LiveKit Delivery

Version: 1.0 · 21 October 2026  
Status: DRAFT — target design; no assertion that a meeting server is operational  
Priority: P2  
Owner: Sandy Realtime/Media Engineering / Codex  
Master: §§3, 9.3–9.5, 10, 12–15, 17–20; AC-03, AC-07, AC-10, AC-12  
API requirements: 26–74 as needed for hosting, 150, 156–157; release requirements in 0005  
Contracts: SC-01, SC-04, SC-05, SC-07; [shared architecture](../architecture-contracts.md)

## 1. Customer outcome and boundaries

An authorized customer creates a Sandy-branded meeting, invites permitted participants, joins in a supported browser and successfully exchanges audio/video. Sandy can provide consented assistance, notes and later task/context continuity. Operators can deploy, diagnose, restart safely and recover the media service through Sandy API. Completion requires real media exchange, not just a running VM, an open TCP port or a successful join-token response.

Do not assume Zoom or Teams media can be embedded or that a bot may join without supported provider permissions. Initial delivery is native Sandy browser rooms with supported external calendar/join links. Existing telephony/SIP routing stays intact; reuse of a voice VM requires measured capacity and explicit architecture approval, not convenience. General remote-command infrastructure belongs to 0005; browser/computer autonomy belongs to 0002.

## 2. Current-state investigation

The project has registered cloud targets and guest enrollment/job/receipt relations. Earlier work referred to `sandy-video`, but this specification does not certify its current existence, network access, guest enrollment or LiveKit health. Inspect the actual GCP project/zone/instance, service account, OS, disks, firewall, egress, DNS/TLS, agent heartbeat and billing allocation. Compare deployed management handlers to Git source and establish whether a real installation path exists.

Map current video/voice UI, APIs, credentials references, room/provider records and policies. Preserve existing working calls. Do not create another VM, change public exposure, enable paid services or reuse production customer rooms solely because a script assumes a blank environment.

## 3. Architecture

**Control plane:** Sandy API authorizes meeting creation, participant admission, room-scoped credentials, consent, calendar integration and lifecycle. Supabase owns durable meeting metadata, permissions, recording references and receipts. No media packets traverse the ordinary Edge Function API gateway.

**Media plane:** a pinned LiveKit SFU deployment on the verified GCP media host, with HTTPS/WebSocket signaling, reachable ICE/media transport and tested TURN fallback. Media and browser client communicate directly according to the chosen secure network topology. Dedicated recording/transcription workers scale separately and receive only permitted room/media access.

**Operations plane:** 0005 engineering release and guest-execution contracts install versioned artifacts, configure secret references, run health probes and retrieve bounded logs. 0004 schedules reconciliation and captures receipts. 0009 owns room/calendar UI; 0007 owns event writes and invitation semantics; 0006 owns source-backed memory candidates from consented transcripts.

## 4. Server bootstrap and installation sequence

1. Resolve the named server from authoritative target records; read real instance/service-account/network state. Obtain normal delegated engineering authority and a recovery snapshot/artifact where applicable.
2. Prove authorized remote execution with a harmless command, exact guest identity, exit code and bounded output. For agent-based access, verify enrollment generation, signed identity, fresh heartbeat and replay protection. For supported SSH/OS Login/IAP, keep host verification and short-lived identity; do not open unrestricted public administration ports.
3. Assess egress, public/private addressing and media reachability. An outbound NAT path does not by itself provide inbound media connectivity. Choose and document a provider-supported topology with restricted management access and the required client media paths.
4. Build a pinned LiveKit/configuration deployment artifact with checksums, secrets by reference, service supervision and persistent config. Validate syntax and ports before installation. No remote unpinned script piping or secrets in VM metadata/logs.
5. Configure approved DNS, valid certificates, signaling routing and only the selected media/TURN ports. Do not enable every optional SIP/media port by default.
6. Start under the existing supervisor/container approach, read back binary/image/config digests, confirm readiness and test authenticated room creation.
7. Run two real clients on distinct network paths, including a restrictive TCP/TURN case, and verify bidirectional audio/video statistics and user-visible playback.
8. Record source, deployed artifact, instance identity, network configuration, meeting test receipts, cost estimate and recovery steps. Enable customer exposure only after acceptance.

## 5. Meeting, identity and consent design

Meeting states: DRAFT, SCHEDULED, OPEN, LIVE, ENDED, CANCELLED, with separately represented DEGRADED/FAILED operational health. Repeated create requests use the same idempotent meeting identity. A scheduled meeting can exist before a media room becomes active; an empty room does not prove readiness.

Participants have role, tenant/guest binding, invite ID, consent state, permissions and admission status. Guest invitation capabilities are unguessable, time-limited and narrowly scoped; storing their digest rather than a reusable raw secret is preferred. Public join URLs must not include permanent API keys or customer session tokens. Token issuance checks room membership, role, permitted publish/subscribe/record operations and current revocation. Owner/admin access never silently joins a private room.

Revoking an invite blocks future token issuance; remove active participants using supported APIs and enforce rejoin restrictions. A token TTL alone is not immediate revocation. Do not trust a browser-supplied room name or participant identity without server binding.

Recording/transcription is off by default unless customer policy and informed participant consent permit it. Display recording status and capture consent revisions; stop downstream processing when consent is withdrawn according to policy. Distinguish transport encryption from end-to-end encryption. If Sandy or a recording component receives an E2EE key, it is an authorized participant in the trust boundary; do not claim the server/AI cannot access content while also promising server-side transcription. Verify the chosen SDK/egress combination and document unsupported combinations explicitly.

## 6. Functional requirements and contracts

| ID | Requirement |
| --- | --- |
| VID-01 | Verified target and real remote-execution access |
| VID-02 | Reproducible pinned installation with secrets and recovery artifacts |
| VID-03 | TLS/DNS/media/TURN connectivity validated from client networks |
| VID-04 | Tenant/guest/room-specific authorization and credential issuance |
| VID-05 | Functional audio/video, mute/device controls, reconnect and end-room behavior |
| VID-06 | Calendar/invitation integration through canonical APIs |
| VID-07 | Explicit recording/transcription consent, retention and deletion |
| VID-08 | Verified room lifecycle/webhooks without duplicate or spoofed effects |
| VID-09 | Health monitoring, graceful upgrades, capacity and incident recovery |
| VID-10 | Cross-channel notes/tasks with source and consent provenance |

Target operations, mapped to existing IDs before creation: `video.meetings.create/get/update/cancel`, `video.invites.create/revoke`, `video.join.authorize`, `video.rooms.status/end`, `video.participants.remove`, recording consent/start/stop/status, transcript/artifact get, server health/deploy/rollback/logs. Customer room operations and privileged infrastructure operations use separate scopes. Mutations return durable acceptance or actual verified result with receipts. Join authorization returns short-lived room grants over TLS, never a reusable host secret.

Provider webhooks validate the supported signature/token scheme against raw payload, deduplicate event identity and reconcile current room/recording state. Out-of-order leave/join/end events cannot resurrect an ended meeting or relabel an unfinished recording complete.

## 7. Logical storage and integration

Map existing schema before adding: meeting metadata and calendar link, participant/invite authorization, consent revisions, provider room ID, recording job and artifact manifest, transcript source/location handles, deployment artifact and test receipts. Each record binds tenant, actor and source. Recordings remain in encrypted object storage with signed authorized access, lifecycle policy and deletion propagation, not in public bucket URLs.

Meeting notes become evidence-linked candidates for memory/commitments; they are not automatically confirmed facts. A model may draft actions from a transcript but does not send follow-ups or change calendars without the normal operation policy. Existing event/task IDs remain canonical.

## 8. Performance, monitoring and capacity

Monitor join/auth errors, connection time, packet loss, jitter, reconnects, media byte flow, TURN use, CPU/memory/network pressure, recording failures, certificate expiry and cost. Readiness must distinguish control plane, media plane, TURN and consented recording capabilities. Synthetic probes should include a short media exchange, not only HTTPS health.

Initial acceptance workload: two independent participants with audio/video for 15 minutes; then a documented pilot load of eight participants and two simultaneous rooms if the approved host capacity supports it. Measure before claiming capacity or autoscaling requirements. Proposed healthy-network target: p95 permitted join to media-ready within 10 seconds; provider/network delay is measured separately. No participant-count marketing promise without a load report.

Drain active rooms before upgrades where supported; a rolling control-plane update must not forcibly terminate existing calls unnecessarily. Do not put CPU-intensive transcription/recording on the SFU without profiling. Increase compute or add replicas only through authorized budget and an evidenced capacity decision.

## 9. Verification

VID-T01: real harmless guest command, identity and exit result. VID-T02: repeat installation converges without duplicate services or leaked secrets. VID-T03: valid TLS/DNS and restricted management/firewall checks. VID-T04: two independent browser clients exchange both audio and video; server/client statistics and manual playback evidence agree. VID-T05: TURN fallback on a restrictive network, reconnect after interruption and correct meeting end. VID-T06: unauthorized tenant/guest, expired invitation and revoked participant cannot join/rejoin. VID-T07: recording consent denied, granted and revoked; no unauthorized transcript/artifact exposure. VID-T08: duplicate/spoofed/out-of-order webhooks rejected or reconciled. VID-T09: service restart/upgrade/rollback with an honest impact record and no corruption. VID-T10: calendar link and cross-channel transcript/task retrieval retain permissions and source IDs.

Native meeting acceptance is independent from unsupported third-party media embedding. Recording, AI participation and external meeting interoperability have separate capability flags and test gates. Align with Master SAT-03, SAT-15–17 and SAT-19.

## 10. Milestones, release and rollback

VID-M1: access/network/cost baseline and harmless command. VID-M2: pinned install, TLS and media readiness. VID-M3: authorized rooms/invites and two-client meeting. VID-M4: calendar/notes/consent integration. VID-M5: restrictive-network, load, recovery and operator readiness.

Depend on 0005's verified guest/deployment slice, not every GCP API; on 0004 for lifecycle jobs/receipts; on 0007 only for full calendar integration. Native room tests may proceed before calendar completion. Preserve existing SIP/voice services and do not assume their VM is available for reuse.

Rollback drains or explicitly ends affected test rooms, restores known-good image/config/secret references and checks media again. Restore network changes only from a reviewed diff; avoid closing paths supporting unrelated production services. Recording/data deletion is not reversed merely to restore software. Handover includes instance and source map, port/DNS topology, access/secret ownership, media-test evidence, consent tests, capacity/cost results, incident runbook and rollback receipt.

## 11. Primary technical references

Checked 21 October 2026; generated configuration and actual pinned version determine final settings.

- [LiveKit VM deployment](https://docs.livekit.io/transport/self-hosting/vm/): supported VM deployment patterns and service setup.
- [LiveKit ports/firewall](https://docs.livekit.io/transport/self-hosting/ports-firewall/): signaling is distinct from ICE/TURN connectivity; expose only the chosen topology's ports.
- [LiveKit encryption](https://docs.livekit.io/transport/encryption/) and [E2EE agents](https://docs.livekit.io/transport/encryption/agents/): explicitly define which participants possess keys and can process media.
