# SANDY-ENG-0011 — Passive & Active Browser Learning and Verified Skill Execution

Version: 1.0 · 21 October 2026  
Status: DRAFT — engineering design, not deployed software  
Priority: P1, with independent design/fixture work allowed while P0 runs  
Owner: Sandy Learning & Skills Engineering / Codex  
Master Scope: v1.1 §§1–7, 10–15, 17–19, 22 (AC-02–06, AC-08, AC-10–12)  
API Scope: use existing canonical requirement families and handlers before creating new ones  
Architecture: [shared contracts](../architecture-contracts.md) SC-01–SC-08  
Dependencies: [0002 computer/autonomy](SANDY-ENG-0002-always-on-autonomy-dots-parity.md), [0003 orchestrator](SANDY-ENG-0003-unified-executive-orchestrator.md), [0004 durable Missions](SANDY-ENG-0004-durable-missions-truth-engine.md), [0005 API/MCP](SANDY-ENG-0005-api-mcp-engineering-delivery.md), [0006 memory](SANDY-ENG-0006-memory-world-model.md), [0009 portal](SANDY-ENG-0009-customer-experience-portal.md), [0010 tenant readiness](SANDY-ENG-0010-commercial-infrastructure-readiness.md)

## 1. Product design and outcome

**Sandy Learn** allows Sandy to acquire useful website skills without customers having to program a macro or manually name every workflow. Customers may opt into automatic learning on individual websites, explicitly demonstrate a task to Sandy, and later ask Sandy to carry out a learned, verified skill in her own tenant-isolated VM browser. Sandy should then improve the skill from verified executions and customer corrections.

Illustrative user journey: customer uses Drivalia to extend an existing car rental. Sandy observes that the customer opened reservations, identified a booking, changed the return date, reviewed the extra fee, confirmed, and checked the updated booking. Sandy recognizes a repeatable goal and typed variables (account, booking, return date, maximum additional charge), creating a **candidate** rather than a falsely confirmed automation. Later, “Extend my current booking until Friday if the extra cost is no more than €150” triggers a permission-bound run. Sandy binds the real account and booking, validates current fee/terms, requests handoff if necessary, submits once, independently reads back the updated reservation, and returns a provider-grounded receipt. No confirmed provider change means no “completed” claim.

### Product tenets

- **Automatic within permission:** Passive recording is enabled once by affirmative, site-specific consent; after that it needs no Record click on each visit. Never treat extension installation or login as permission to monitor all browsing.
- **Intent over coordinates:** Learn semantic targets, branching decisions, variables, preconditions and successful postconditions; do not store blind X/Y mouse macros or raw keystroke streams.
- **One skill system:** Passive, Active and Execution Learning feed the same immutable, versioned Skill Library. No parallel planner, mission queue, memory store, browser fleet or provider-execution gateway.
- **Observe != permission to act:** Learning consent never authorizes purchases, contracts, messages or changes. Skill execution needs a separate, current delegated action grant.
- **Truthful completion:** Clicking Submit, an HTTP 200 or the model's assertion does not establish provider-side success. Reconcile and verify the actual changed resource.
- **Least data:** Redact before local persistence, upload or model access. Do not record continuous video, full-page contents, passwords, OTPs, card details, cookies or session tokens.

### Modes

| Mode | Activation | Behavior | Output | Authority |
| --- | --- | --- | --- | --- |
| Passive Learning | Ongoing customer opt-in per authorized domain | Observe semantic click/navigation/form actions and relevant outcomes unobtrusively | Redacted episodes, patterns, candidate skills | Capture only |
| Active Learning | “Teach Sandy” button or authenticated teaching command | Focused demonstration with optional goal, annotations and variable identification | Annotated candidate and validation plan | Capture only |
| Execution Learning | A Sandy-run skill completes/fails, or user supplies a correction | Compare observations to expected results, propose improvements | Testable new skill version | Cannot widen previous grant |
| Skill Execution | User request, approved Mission or separately approved schedule | Use sandbox VM/browser with preconditions, policy, checkpoints and verification | Durable job, verified result and artifact/receipt | Scoped standing grant or requested approval |

**Skill states:** DISCOVERED → CANDIDATE → NEEDS_REVIEW → READY_TO_TEST → VERIFIED → PAUSED / NEEDS_REVERIFICATION / DEPRECATED. States may be skipped only by documented equivalent evidence. A single demonstration can yield a candidate, but not automatic authority. Running a candidate against a synthetic fixture is not live provider verification.

### User experience

**Chrome Companion (Manifest V3).** Visible status OFF / LEARNING / TEACHING / PAUSED / ERROR; current site permission; Enable learning for this site; Teach Sandy; Pause; Exclude this page; View captured steps; Open Sandy Skills. No learning in incognito. Support accessible keyboard controls, clear mode indicator and immediate stop. Default OFF until informed affirmative opt-in and browser permission. Sensitive sites (banking, healthcare, government IDs, password managers, webmail/chat) are excluded by default; exceptions require a separately reviewed policy and granular user consent. Site/site-path exclusion and global kill switch always available.

**Sandy portal → Skills.** Discovered and verified tabs, grouped by website, tenant/company and owner; semantic process preview; observations used; typed variables; site/account scope; current status; consent; last validated website version; run history; human-readable receipts; error/reverification state. Actions: teach/reteach, annotate/correct, approve within user's authority, pause, execute with preview, schedule as a Mission only by explicit instruction, export redacted skill definition, delete source observations and skill history. Controller sees bounded operational diagnostics, not everyone's browsing.

**Omnichannel.** Verified skill can be invoked from web chat, WhatsApp, email, voice or a Mission, all routed through the same actor/account/grant/policy and task ledger. An incoming email sender address or phone number does not itself confer action authority.

**Proactivity.** Sandy may recommend automating a frequent invoice-download task but may not silently schedule it, create a third-party account, or run writes from observation alone.

## 2. Existing production state and non-goals

Existing Sandy documentation governs one orchestrator, durable Missions, one authorization/provider boundary and isolated computers. This document does **not** claim a working extension, skill compiler or replay system already exists. Before coding, inventory actual GitHub files and deployed Supabase project zmqlyygzqoidkcwdysok for existing web/VM automation, computer worker images, Sand​y API/MCP operation registry, grant and account binding, Missions/steps/leases/receipts, knowledge entities, frontend and audit/retention. Capture source SHA, serving release, schema migration, owning module and source-linked evidence. Map existing similar “skills/workflows” before proposing new data entities. Preserve production state and completed tests.

Non-goals: train a foundation model, continuously capture whole-screen video, export local session cookies to Sandy VM, capture passwords/keylogging, bypass MFA/CAPTCHA/bot restrictions, guarantee automation of every website, expose another privileged MCP provider path, allow model-generated arbitrary scripts/shell/HTTP/SQL, or redesign current core architecture.

## 3. Architecture and ownership

    Chrome MV3 content script (consented origin)
      → local event sanitization and session/episode boundary
      → authenticated Sandy API ingestion [0005; consent and tenant checks]
      → observation store and episode clustering [0011]
      → candidate detector → semantic inference / parameterization [0011]
      → strict declarative Skill IR compiler + validators [0011]
      → Skill Registry + rehearsal/verification/versioning [0011]
      → eligible skill discovery and request interpretation [0003/0005]
      → durable Mission, step leases, checkpoints [0004]
      → admitted authorized operation [0005]
      → isolated browser/computer worker with own credential binding [0002]
      → independent provider readback and receipt [0004]
      → response/portal [0003/0009], permitted knowledge pointers [0006]
      → correction/change proposal [0011], never automatic privilege expansion

**0011 owns** observation clients and ingestion semantics, redaction schema, episode segmentation, intent clustering, candidate discovery, typed Skill Intermediate Representation (IR), compiler, semantic locator strategy, skill definitions/revisions and deterministic rehearsal tests.  
**0002 owns** browser and VM execution, worker image/lifecycle, browser profiles, egress and artifact handling; 0011 never provisions a competing fleet.  
**0003 owns** dialogue, tool/skill selection, goal resolution and outcomes through every channel.  
**0004 owns** durable mission/step state, watchdogs, idempotency, uncertain outcomes, external-effect receipts and compensation.  
**0005 owns** Sandy API admission/authorization, delegation, operation manifests, connected accounts, credential broker and MCP adapter. Chrome/portal/runtime use Sandy API; external MCP calls it too.  
**0006 owns** ACL/provenance-filtered World Model pointers, not browser skill execution state.  
**0009 owns** portal UX, onboarding, consent, skill review, preview/approval and operator dashboard.  
**0010 owns** tenant onboarding, entitlements, storage/data lifecycle, budgets and commercial policy.

Implementation preference: modular shared TypeScript contracts, reuse existing Supabase/worker infrastructure, bounded Edge ingress and durable leased workers for compilation/replay. A skill definition is a declarative data contract, **never raw executable JavaScript returned by an LLM**.

## 4. Recorder and learning pipeline

### MV3 extension and permission model

Use on-demand optional host permissions and consented content scripts; request the narrowest site origins, not blanket all-sites access. A persistent MV3 service worker must **not** be assumed: design for service-worker suspension, tab closure, SPA route updates, network loss, offline batches and reconnect deduplication. Instrument allowed DOM interactions using accessible labels, roles, element semantics and navigation transitions, including consent-permitted frames. Do not pretend cross-origin/protected/closed-shadow regions are observable when they are not. Target locators should prioritize role + accessible name, stable labels/test IDs, then scoped CSS as fallback with uniqueness checks; raw mouse coordinates are diagnostics only. Observe postconditions rather than treat a click as success.

Event envelope concept:

    {
      "event_id": "uuid", "schema_version": 1,
      "device_ref": "opaque", "grant_ref": "opaque",
      "session_ref": "opaque", "episode_ref": "opaque",
      "origin": "https://example.test",
      "route_template": "/reservations/:id",
      "frame_ref": "opaque", "action": "click|select|navigate|submit|result",
      "target": {"role": "button", "label_signature": "Manage booking"},
      "variable_hint": {"field": "return_date", "type": "date"},
      "timestamp": "ISO8601", "sequence": 123, "redaction_version": 1
    }

This is illustrative, not authority to ingest arbitrary page data. Form values are redacted by default; safe necessary values, where expressly enabled, are typed and purpose-limited. Never transmit credentials, authentication state, OTPs, CVV, passwords, free-text personal messages, entire page DOM, clipboard, request bodies or browser storage. Conservative classifiers and sensitive-field allow/deny rules operate **before any disk, network, telemetry or model call**. Ambiguity fails closed; no false promise of universal detection. Passive screenshot/video recording OFF; separate explicitly approved, redacted, short-lived diagnostic captures only where justified. Limit volume, size, frequency and retention.

Consent/grant must be validated on the server for each batch against authoritative user/site/device/tenant membership and revocation epoch; Chrome host permission alone is insufficient. An enabled site can be temporarily paused, path excluded and deleted. Consent to learn is not a site-login credential or consent for subsequent execution.

### Episode and task discovery

Deterministic local/server segmentation uses permitted-site navigation, inactivity, form-submit milestones, tab/frame correlation and observable outcome markers; never link unrelated accounts simply because a domain matches. Deduplicate source events and distinguish unfinished processes. Cluster candidate episodes by semantic action graph and goal, not exact coordinates or URLs. Repeated patterns increase confidence, but do not merge genuinely different booking/return-location workflows just because they share screens.

A stronger reasoning model identifies purpose, parameters, branches and risk-critical actions on sanitized candidates; simpler detection/dedup is deterministic or economical. Model output is untrusted and validated against typed schemas. Ask the customer only when material ambiguity remains, including the meaning of a condition, risk limit or success state. Preserve original sanitized episodes and attribution so customer corrections can be traced.

Compiler stages: intake → segmentation → pattern clustering → inference → typed variable extraction → bounded declarative IR → static/risk/selector validator → fixture rehearsal → active-account risk-dependent confirmation → versioned promotion. Promote only on explicit acceptance evidence. Site change, loss of account scope, changed payment/terms/confirmation screen or uniqueness failure demotes affected skill to NEEDS_REVERIFICATION. No silent promotion because “the model is confident.”

### Declarative Skill IR

Minimum immutable versioned schema:

    skill_id, version, tenant_id, owner_actor_id, company_scope?,
    title, objective, permitted_origins, account_binding_policy,
    typed_inputs_schema, preconditions, semantic_step_graph,
    branches, max_steps, max_duration, permitted_effects,
    risk_tier, spending_and_target_constraints,
    verification_postconditions, reconciliation_policy,
    consent_provenance, source_episode_refs, runner_min_version,
    compiler_version, checksum, tests, status, valid_until?

Allowed step types: navigate, locate, read, select, fill (typed safe value), click, bounded-wait, branch, bounded-loop, handoff, verify. Each step has a unique ID, input binding, semantic locator set, precondition, timeout, retry safety classification, expected observed effect and evidence rule. No unbounded loops, arbitrary origin expansion, model-supplied shell, in-page eval or bypass of operation policy. Version/hash code and Skill IR against expected runtime compatibility. A skill's editable policy cannot grant broader execution rights.

**Self-healing:** first analyze read-only DOM/role changes; test alternatives and unique target selection; propose a version update with diff and test evidence. If a change affects money, destination, consent, user identity, booking choice or provider terms, do not attempt a speculative write. Successful real runs produce improvement candidates; promotion requires checks and risk-tier review, preserving the previous verified version for rollback.

## 5. Browser authentication, execution and receipts

User's interactive Chrome and Sandy's VM are different contexts. **Never copy cookies, localStorage, bearer tokens or passwords from the user's browser into the VM.** Use an authorized, tenant/account-bound, isolated VM browser profile and centrally governed credential/session broker. Support login/MFA handoff through authenticated UI. Challenge or CAPTCHA cannot be bypassed. Sessions expire/revoke; profiles are encrypted and isolated and worker jobs have egress/resource/time restrictions.

Prefer supported provider API first when it can meet the same customer objective, with the same receipts. Browser automation is the fallback when permitted by provider terms and policy. Page contents are untrusted instructions. Redirects to new origins, unexpected identity, new terms, pricing or ambiguous booking require revalidation.

Execution sequence:
1. Resolve customer + tenant/company + account + exact target + skill version + variables and constraints using SC-01/SC-06.
2. Admit eligible skill and Mission via Sandy API. Bind standing delegation to action class, target, max cost, destination, expiry and revocation; compute stable intent/idempotency digest.
3. Start isolated 0002 worker under 0004 lease, restore separate authorized VM session or return WAITING_CUSTOMER for secure login/MFA.
4. Read current website state; assert correct account/booking, date/timezone, preconditions, quote/terms and limits.
5. For consequential uncovered writes, present preview/approval. Approval must be bound to exact target and constraints and rechecked at final dispatch.
6. Execute bounded steps, checkpoint each recoverable stage; serialize conflicting writes. On timeout after uncertain submit set UNKNOWN_OUTCOME rather than blindly retry.
7. Independently read back provider state or confirmation reference; issue SC-05 receipt with evidence/ref/time and actual values. Distinguish VERIFIED_SUCCESS, PARTIAL, WAITING_CUSTOMER, BLOCKED_EXTERNAL, FAILED and UNKNOWN_OUTCOME.
8. Publish human-readable result with real evidence; append learning signal without altering validated skill automatically.

## 6. API contracts and storage

All operations route through Sandy API's existing SC-04 admission and result contract, regardless of whether called by portal/Chrome/orchestrator or external Sandy MCP. Map candidate names below to already deployed canonical IDs first. Every write uses actor/tenant/account validation, request/correlation IDs, expected version and scoped idempotency; server never trusts a tenant ID or grant asserted by the extension.

| Candidate family | Behavior |
| --- | --- |
| skills.sites.list / grant / revoke | Consented origin/mode/device scopes, expiry, revocation and server readback |
| skills.observations.ingest | Signed/session-bound redacted sequenced batches; dedupe and reject outside consent |
| skills.learning.start / stop | Explicit teaching session lifecycle and objective/annotations |
| skills.episodes.list / inspect / delete | ACL-filtered sanitized episode metadata and deletion |
| skills.candidates.list / explain / correct | Human-understandable inferred intent and parameter corrections |
| skills.compile / validate / test | Async bounded compiler/rehearsal, results and independent evidence |
| skills.registry.list / versions / activate / pause / delete | Immutable skill revisions, version controls, review and lifecycle |
| skills.execute / runs.get / events / handoff / cancel | Authenticated versioned run, durable state, receipts, stop and MFA handoff |
| skills.improvements.propose / review | Tested corrective revision, no privilege escalation |

Proposed *logical* entities (reconcile with existing physical schema before migrations): site_grant, recorder_device, observation_batch, learning_session, workflow_episode, skill_definition, skill_version, skill_trial, skill_revision_proposal and consent_audit. Link execution only to existing 0004 mission/step/receipt records. Enforce tenant- and company-scoped RLS plus separate server-side checks, actor/revocation foreign keys, origin normalization, immutable version digest, idempotent batches, strong storage encryption, object storage policies, retention, export and erasure. Do not copy raw browsing into the World Model; 0006 receives consented skill capability metadata and source pointers with ACL.

Suggested provisional retention **pending privacy/legal review, not a claim of existing policy**: transient sanitized client buffer ≤24 hours; sanitized raw server event batches ≤7 days; candidate episodes ≤30 days unless explicitly saved as a teaching session; immutable skill IR/versions while enabled and under approved lifecycle; short separately controlled diagnostic screenshot TTL; minimal security audit under an approved purpose-specific retention. Include delete-now, site-history clear, account/tenant offboarding, backups and derived-artifact erasure/review; store no secret session state in observation tables.

## 7. Privacy, autonomy and security invariants

- Initial learning OFF; site opt-in and explicit browser permission; visible indicator and pause/kill controls; per-page exclusion; incognito excluded. Revoke blocks inflight server batches as well as future capture. Ordinary passive site grants do not authorize execution.
- Adhere to current Chrome Web Store user data/limited-use policies and applicable law, including clear disclosure and user-facing purpose. Browsing data and website content are sensitive; restrict collection/transmission to what is necessary for visible learning functionality and never for ad targeting or unrelated profiling.
- No full input logging, uncontrolled screenshots, cross-tenant browser/session sharing or support-agent free access to customer recordings. Protect encryption keys, redaction trace and diagnostic access.
- Website prompt injection stays inert untrusted text; no new operation, origin, grant or data disclosure can be authorized by the DOM or skill compiler.
- Respect site terms, rate limits, access restrictions and anti-bot challenges; BLOCKED_EXTERNAL/manual handoff rather than evasion.
- Enforce explicit bounds on amounts, targets, company, origin, time and risk tier. A model or editable skill cannot grant more authority than the verified actor.
- On ambiguous final action, wrong target, revocation, website drift or unrecognized price/terms, stop safely; do not make speculative financial or contractual submissions.
- Reconcile uncertain side effects before retries, including after worker crashes. A queue acknowledgement is not a verified booking outcome.
- Audit redacted source, consent version, skill version/runner version, policy and receipt. No secrets or sensitive raw website text in prompts, logs, analytics or developer artifacts.

## 8. Delivery plan and dependencies

| Milestone | Deliverable | Gate |
| --- | --- | --- |
| LEARN-M0 | Current deployed source/schema inventory, ADR, privacy/permission and risk model | Architecture owner reviews, no duplicate services |
| LEARN-M1 | Chrome MV3 extension with consent/visibility, on-device redaction, server ingestion and pause/revoke | Sensitive/no-consent negative tests |
| LEARN-M2 | Episodes, deduplication, automatic candidate discovery, semantic variables, Skill IR/compiler, portal candidate display | Fixture cohort and validator tests |
| LEARN-M3 | Active teaching/annotations, corrections and rehearsal/skill promotion state | Actual customer control and deterministic tests |
| LEARN-M4 | VM execution adapter using 0002, Missions 0004, API 0005 and independent receipts | Verified permitted provider fixture; no false success |
| LEARN-M5 | Drift/self-repair proposals, version regression, old-version rollback and learning from execution | Site-change and dangerous-action tests |
| LEARN-M6 | Opt-in customer pilot, omnichannel/Missions integration, support/telemetry/entitlements | Full isolation, privacy, rollback and acceptance |

P0 runtime reliability (0001) remains priority. M0/M1 isolated fixture work can proceed in parallel; M4 MUST reuse proven foundation slices from 0002/0004/0005, not require all 161 API families nor create ad hoc infrastructure. Work on isolated branches with contract owners and migration/release locks. No production user data is used as test material without specific informed authorization.

## 9. Acceptance scenarios and evidence

Each acceptance record links exact source commit, deployed extension/API/worker version, fixture/site version, test account, scope/risk, result state, receipt refs, trace/test outputs, date and known limitations. Synthetic DOM tests are not live provider success.

| ID | Test | Required result |
| --- | --- | --- |
| LEARN-T01 | No opt-in, unapproved domain, incognito | Zero capture/transmission |
| LEARN-T02 | Consent per domain + passive repeated actions | Correct domain-only sanitized episodes |
| LEARN-T03 | Pause/revoke while offline batches await retry | Immediate local stop, server rejection after revoke |
| LEARN-T04 | Password/OTP/CVV/token/free-text sensitive field | No secret in disk, logs, API, model or trace |
| LEARN-T05 | MV3 suspension, SPA, multiple tabs/frames | Idempotent ordered events; unsupported frames flagged |
| LEARN-T06 | Repeated rental changes with variable dates | Candidate groups goal; typed variables correct |
| LEARN-T07 | Active teaching and user correction | Corrected version visible, provenance preserved |
| LEARN-T08 | Random browsing/unsubmitted form | No falsely verified skill |
| LEARN-T09 | Malicious Skill IR/unknown step/origin redirect | Validation denies unapproved action |
| LEARN-T10 | Ambiguous selector or redesigned confirmation screen | No wrong-target writes; reverification/handoff |
| LEARN-T11 | VM login/MFA and revoked delegated account | Secure handoff; no cloned Chrome auth |
| LEARN-T12 | Rental change would exceed €150 cap | No submission |
| LEARN-T13 | Within-cap authorized rental change | Independent provider confirmation and receipt |
| LEARN-T14 | Timeout after clicking final confirm | UNKNOWN_OUTCOME; reconcile before any retry |
| LEARN-T15 | Duplicate command/worker concurrency | Single intended effect, no duplicate modification |
| LEARN-T16 | Two tenants/same site and company restrictions | No cross-customer skill, data or browser sharing |
| LEARN-T17 | Webpage prompt injection / download / bad redirect | No exfiltration, escalation or unsafe execution |
| LEARN-T18 | Execution learning proposes new version | Diff, tests, risk review and preserved rollback version |
| LEARN-T19 | Web-chat → WhatsApp/voice invocation | Same permissions, run and truthful result |
| LEARN-T20 | Mission schedule and mid-run revocation | No implied schedule; stop unsent steps; reconcile sent ones |
| LEARN-T21 | Erasure/export/offboarding and audit | Scope-correct deletion/retention evidence |
| LEARN-T22 | VM crash, lost lease or resumed browser | Fenced leases and accurate side-effect reconciliation |
| LEARN-T23 | Disallowed bot automation or CAPTCHA | BLOCKED_EXTERNAL / secure handoff, never bypass |
| LEARN-T24 | Chrome Store privacy/permissions review | Documented disclosure, opt-in, limited use, minimal privileges |

Proposed pilot thresholds, not measured claims: 100% of critical tenant/secret/consent/duplicate effect/false completion gates (zero accepted failures); ≥20 authorized demonstrations across ≥5 sites with a held-out labelled cohort for segmentation/variable detection; ≥10 verified worker runs, including at least two actual provider-side changes on a designated authorized live/staging account; ≥90% correct segmentation and typed parameter detection on that named held-out set; publish sample size, confidence, failure distribution, performance, browser/provider revisions, token and compute costs. No aggregate score substitutes for independent verification of consequential actions. Re-run only relevant 0001–0010 regressions, not already-proven unaffected tests.

## 10. Deployment, recovery and completion

GitHub is the source of scope truth. For code, first inventory active serving source, baseline and migrations. Use compatible additive schemas, RLS and API contract tests; feature flags separately gate capture, candidate generation and execution per tenant/site; staged canary before production enablement. Chrome extension pilot may be enterprise/unpacked while Store review is pending; commit and package alone do not mean Chrome distribution approval. Record reproducible release artifacts, worker image, model/compilation version, consent version and real browser/provider readback.

Rollback stops admission on server, revokes recorder grants, fences Mission leases, preserves in-flight UNKNOWN_OUTCOME reconciliation and critical audit receipts, restores compatible worker and previous verified skill version and quarantines/deletes improperly retained events. Do not claim previously submitted third-party effects have been undone. Chrome UI disable alone is not a sufficient server-side kill switch.

| Completion item | Current result | Required evidence |
| --- | --- | --- |
| Scope committed / synced to catalogue | Pending actual readback | Git commit + sync run/hash |
| As-built baseline and ADR | Pending | Source/deployment inventory |
| Extension recording and consent | Pending | Staging + privacy negative tests |
| Passive and active learning | Pending | Fixture + authorized user scenario |
| Skill registry/compiler and learning from execution | Pending | Version/test artefacts |
| Isolated VM execution and provider outcome | Pending | Real booking/account confirmation |
| Omnichannel/Missions integration | Pending | Authorized cross-channel run |
| Security, privacy, rollback | Pending | Full critical suite/rollback drill |
| Customer pilot | Pending | Actual cohort/evidence |

## 11. Decisions and risks

Resolved design: opt-in, ongoing **per-authorized-site** Passive Learning; explicit Active Learning; Execution Learning only from corrected/verified runs; one declarative Skill Library; tenant-isolated VM replay, strict API policy and independent receipts. **Unresolved for ADR/privacy owner:** jurisdictional lawful basis and exact retention, sensitive-site exemptions, skill sharing across company scopes, authentication/profile vault and key hierarchy, execution promotion gates by risk, provider-specific bot/terms rules and Store distribution. These do not block safe independent contract/fixture preparation.

Risks: excessive browser data, lost Chrome permissions, wrongly inferred intent, brittle selectors, login divergence between local/VM sessions, anti-bot restrictions, cross-company privilege confusion, unintended expenditure and unverified submissions. Controls above are release gates, not optional future polish.

## 12. Technical references

- Chrome permissions: https://developer.chrome.com/docs/extensions/mv3/declare_permissions
- Chrome Web Store user data policy: https://developer.chrome.com/docs/webstore/user_data
- Chrome Web Store program policies: https://developer.chrome.com/docs/webstore/program-policies/policies
- Playwright authentication and secret-sensitive saved state: https://playwright.dev/docs/auth
- Sandy shared contracts: [architecture-contracts.md](../architecture-contracts.md)
