# Sandy AI Master Software Scope v1.0 — full extracted text

> Text extraction of the owner's original 17-page DOCX (19 October 2026). This preserves the source wording for search and engineering reference but not exact Word layout. The signed original DOCX remains the archival source; do not infer figures or tables not retained in extracted text.

<PARSED TEXT FOR PAGE: 1 / 17>
SANDY AI / MASTER SOFTWARE SCOPE


SANDY AI
Master Software Requirements & Engineering Scope

Version: 1.0 — Proposed design baseline

Date: 19 October 2026

Status: Draft for architecture and product-owner approval

Purpose: Specify the mission, behaviour, architecture, technical contracts, implementation and measurable
acceptance criteria for Sandy AI, building on its existing systems without disrupting live customer operations.

     Important distinction: This is a target-state software specification, not a claim that all named capabilities
     are deployed, accessible, connected, or production-tested. Existing implementation descriptions are based
     on previously reported Sandy project work and must be reconciled against live Supabase, GitHub, running
     services and end-to-end tests before work is accepted. The two source blueprints are proposed reference
     architectures, not descriptions of OpenAI's proprietary ChatGPT implementation.


1. Executive mission and business objective
1.1 The mission
Sandy is an independent, trustworthy and increasingly autonomous AI chief of staff for an individual's
personal life and business affairs. Sandy understands the people, organisations, obligations, plans, decisions,
information and systems that matter to each client; communicates naturally through the client's preferred
channels; identifies what needs doing; carries work through to a verified outcome; follows up persistently; and
learns from authorised experience without losing control, privacy or accountability.

Customer promise: “Sandy. Tell her what you need. She takes care of the rest.” A related operational description is
“Your life and business, taken care of.” Marketing claims must never exceed tested capability.

Sandy is not merely an email responder, chat UI, search interface, workflow trigger, or thin wrapper around
OpenAI. Her competitive value is sustained knowledge and trustworthy execution across a client's world,
independent of any individual model, channel or software provider.


1.2 The core operating contract
For every actionable request Sandy must: Understand → Contextualise → Plan → Authorise →
Delegate/Execute → Verify → Communicate → Remember → Follow through → Improve. These stages may be
abbreviated for simple requests, but no stage may be falsely represented as complete. One accountable
orchestrator retains ownership even when specialist models, agents, tools or humans perform steps.

For each mission Sandy stores its objective, owner, intended outcome, constraints, source evidence, tasks
and dependencies, delegated permissions, budgets, approval requirements, progress, blockers, verification
rules, deadlines and commitment to follow up. The customer must be able to ask “What is happening?”, “What
did you do?”, “Why?”, “What is blocked?”, and “What remains?” and receive an evidence-backed answer.


1.3 Business outcomes
1.    Time returned: measurable reduction in routine customer administration and repeated explanation.
                                                                             Proposed baseline | 19 Oct 2026         •   1
<PARSED TEXT FOR PAGE: 2 / 17>
SANDY AI / MASTER SOFTWARE SCOPE

2.   Outcome completion: work is carried through, not abandoned after a plausible acknowledgement.
3.   Continuity: Sandy knows applicable history and commitments across sessions and channels, within consent
     and permissions.
4.   Proactivity: Sandy spots upcoming deadlines, unanswered correspondence, dependencies, opportunities and
     emerging problems.
5.   Trust: no fabricated research, file, delivery, calendar entry, deployment or completed action; status is
     independently supported.
6.   Scalability: serve individuals and businesses with tenant isolation, measured costs, subscriptions and
     graduated autonomy.
7.   Learning: systematically identify failures, test improvements and safely deploy beneficial changes with
     rollback.


1.4 Non-goals and boundaries
    Do not train or host a proprietary frontier foundation model as a prerequisite. Sandy uses supported external
     OpenAI models through APIs and may add other providers behind a controlled adapter.
    Do not claim to copy OpenAI's internal ChatGPT software, prompting, private hardware or hidden model
     reasoning.
    Do not let model language, retrieved emails or web pages confer authorisation or establish real-world
     success.
    Do not replace live V1 capabilities or migrate customer data destructively for an architectural refresh.
    Do not permit autonomous code changes, financial transfers, security-sensitive operations or irreversible
     actions without applicable governance gates.


2. Who Sandy serves and how she behaves
2.1 Users and roles
Individuals, family/household collaborators, executives, professionals, SME business owners, administrators,
delegates, external collaborators, support operators, engineering operators and developer/integration partners. A
principal may have separate personal, organisation and company contexts; visibility, authority and information
use are distinct dimensions.


2.2 Character and interaction principles
Sandy should sound like a competent, discreet, resourceful human executive assistant: natural, warm, concise,
accurate and proactive without being intrusive. She should adapt tone by channel and customer preference;
avoid repeating known questions; ask only for genuinely missing information; surface uncertainty and next steps;
respond promptly with meaningful progress during long work; and never say “done” before verification.
Delegation should be transparent rather than making the customer coordinate hidden subagents.


2.3 Unified omnichannel interface
The same identity, conversations, memory, mission state, permissions and underlying tool capability should be
available from web chat, Microsoft 365 email, Gmail where connected, WhatsApp, browser voice, telephony/SIP
and later Sandy-branded video. A customer switching from WhatsApp to voice and then portal must not have to


                                                                            Proposed baseline | 19 Oct 2026      •   2
<PARSED TEXT FOR PAGE: 3 / 17>
SANDY AI / MASTER SOFTWARE SCOPE

start over. Channel-specific formatting is permitted, but channels must not have unrelated reasoning engines or
conflicting state.


3. Existing Sandy footprint and migration
constraints
3.1 Known project anchors to inspect, not assume healthy
   Primary Supabase project: zmqlyygzqoidkcwdysok (PostgreSQL, edge functions, storage, state and related
    services).
   Email: Microsoft Graph / Microsoft 365, primary Sandy sender ai@email.com.au; Gmail test identity
    sandyemail.ai@gmail.com.
   Web/client portal: a Sandy application with Agenda, Tasks, Calendar, Memory Centre, Missions, Connections
    and Controller; a previously discussed staging path is ausstyle.github.io/web-staging/sandy/app/.
   Messaging: WhatsApp Business webhook and related message state in Supabase.
   Voice: browser voice and a separate SIP/voice VM or gateway; verify current hosting, routing and actual tool
    access before modifications.
   Cloud / code: GitHub delivery, Google Cloud compute including a Windows VM and related Linux/voice
    infrastructure; confirm exact resources, access paths and deployment owners.
   Existing engineering components referenced in prior work: Agent Runtime, Meta-Intelligence, World
    Model initiatives, Examiner, Evolution, Engineering Control API, MCP/Sandy API, Composio connectors,
    memory indexing, code/deployment workflows.

These are reported implementation elements, not verified production acceptance evidence. Version
numbers, route names and deployment states must be discovered at commencement rather than inferred from
previous descriptions.


3.2 Non-disruption mandate
Upgrade in place. Preserve all existing accounts, user/customer IDs, sessions where technically possible,
messages, file references, tasks, missions, approvals, contact links, OAuth associations, connectors and audit
history. All migrations follow expand/migrate/contract; use feature flags, shadow paths, canaries, rollback and
reconciled state. Keep existing V1 routing active until a defined new runtime passes production acceptance gates.


3.3 Required initial discovery deliverables
Produce a signed as-built inventory: services, URLs, cloud resources, function handlers, environments, queue
schedules, database schemas, RLS, secrets ownership (not values), API contracts, model calls, current memory
pipeline, channel handlers, voice topology, connector scopes, CI/CD workflows, feature flags, known incidents and
test results. For each feature label Implemented / Connected / Exercised / Verified in production / Blocked /
Proposed. Do not equate a GitHub commit, SQL object, deployment event or model assertion with verified
functioning behaviour.




                                                                             Proposed baseline | 19 Oct 2026     •   3
<PARSED TEXT FOR PAGE: 4 / 17>
SANDY AI / MASTER SOFTWARE SCOPE


4. Target system architecture
4.1 Reference logical architecture
  CLIENTS: Web • Email • WhatsApp • Voice/PSTN • Video • Developer API
            │ verified identity, consent, channel adapters
       API Gateway / OAuth / Rate Limits / Policy
            │
       UNIFIED SANDY EXECUTIVE ORCHESTRATOR
      Understand → Plan → Execute → Verify → Follow up
      │         │     │       │
   World Model Context         Tool Broker Truth/Receipt Engine
   & Identity & Memory        & Permissions + Commitments
      │         │     │       │
      └─────────┴──────────┴───────────┘
            │       Durable Runs / Missions / Events
       Supabase PostgreSQL + Storage + Search
            │
     Model Gateway: OpenAI Responses / Realtime
            │
   Connected apps • Microsoft Graph • Google • MCP • SIP
   Browser/Code Sandbox • Calendar • Tasks • Documents
            │
      Examiner → Evolution → Engineering Control
          Regression → Staging → Canary → Rollback



4.2 Responsibility boundaries
Executive Orchestrator: sole accountable run/mission owner, request semantics, planning, dependency graph,
budget, approvals, continuation and final user communication.

World Model: authoritative linked people, organisations, projects, locations, assets, relationships, obligations,
timelines, connected services, accessible capabilities and entity identities.

Context & Memory Intelligence: select source-grounded conversational, semantic, episodic, temporal and
connected-app knowledge at the right time.

Model Gateway/Meta-Intelligence: select eligible providers/models/reasoning effort and tool candidates; record
choice and cost. Meta-Intelligence advises rather than creating a second competing execution authority.

Tool Broker: independently enforces actor, tenant, scope, target, business policy, approvals, version,
idempotency and verification.

Truth Engine: validates retrieved evidence and external side-effect receipts; guards final claims; reconciles
uncertain outcomes.

Commitment Engine: tracks obligations, promises, deadlines, follow-ups and pending replies even if a
conversation ends.

Examiner: detects and reproduces deficiencies via evaluations and actual-state checks.

Evolution: proposes and implements allowed improvements under tests, change control and rollback—not direct
unreviewed production self-modification.

Engineering Control: authoritative path and change register for approved modifications to code, infrastructure
and database objects, with immutable evidence.



                                                                                Proposed baseline | 19 Oct 2026   •   4
<PARSED TEXT FOR PAGE: 5 / 17>
SANDY AI / MASTER SOFTWARE SCOPE

4.3 Technical implementation preference
Preserve the existing Supabase/PostgreSQL and deployed application footprint. Prefer a modular runtime with
bounded, independently scalable workers, not premature microservices. Use type-safe APIs, versioned
contracts, durable database-backed state, transactional outbox, leases, task queues, encrypted object storage,
lexical/vector retrieval, OpenTelemetry and secure secret management. Apply Redis/managed queue/Temporal
only when load and workflow complexity justify them; do not add duplicate queues or databases without an ADR.
Frontend may use existing stack; new services should favour a consistent TypeScript/Node.js API layer and Python
for file, numerical and sandbox work where justified.


5. Sandy reasoning and model orchestration
5.1 Every request follows a structured turn lifecycle
8.   Ingest channel event; authenticate or link identity; deduplicate and persist raw event with provider
     identifiers.
9.   Resolve actor, tenant, connected account, locale, IANA timezone and target entities from verified evidence.
10. Classify objective, consequence/risk, required freshness, expected deliverable and mission continuity.
11. Retrieve appropriate working context and available tools with ACL/consent gates; preserve cited source
     manifest.
12. Choose model profile by task complexity, modality, time, cost, tool compatibility, risk and measured
     evaluation results.
13. Stream meaningful progress where possible; call model; preserve structured provider response/tool call IDs
     and reasoning-continuation requirements.
14. Validate every requested tool call deterministically; execute with state ledger, approvals and verification
     receipts.
15. Re-enter the model with verified tool results as needed; loop within bounded budget and no-progress
     detection.
16. Verify final claims, persist completed or partial status, create commitments and notify through the right
     channel.
17. Add eligible memory candidates and evaluation traces; never silently discard an incomplete obligation.


5.2 Model profiles and routing
Maintain fast, balanced, deep, highest-assurance, realtime, embedding and image profiles. Actual OpenAI API
model IDs and feature compatibility must be obtained from current catalogue and tested; consumer product
names are not a guaranteed API contract. Use deterministic triggers for specialist modalities and high-impact
workflows; a lightweight classifier/heuristic for complexity; escalation after low-confidence or failed attempts;
and authenticated user settings where offered. Record selected model, effort, reason, fallback, version, cost,
latency and observed quality. Never downgrade consequential work solely to save cost.


5.3 Context engineering and continuity
The model must distinguish (1) the current turn and current task state, (2) durable conversation history, (3)
evidence-linked longer-term memory, and (4) independent external authoritative records. Context planner ranks
by authorisation, explicit relevance, entity, recency, source authority, verified confidence and
contradicted/superseded status. Use hybrid SQL/full-text/vector retrieval; exact identifiers, dates and addresses

                                                                           Proposed baseline | 19 Oct 2026        •   5
<PARSED TEXT FOR PAGE: 6 / 17>
SANDY AI / MASTER SOFTWARE SCOPE

require exact search before semantic approximation. Preserve source handles for later expansion.
Summarisation checkpoints must retain decisions, entity IDs, unresolved questions, approvals, actual completed
actions and source pointers; never turn a request into a completion claim.


5.4 Referent and intent resolution
Follow-ups such as “move it an hour,” “email him,” “do the same for the other company” or “complete the
deployment” must inherit all unspecified relevant constraints, with explicit disambiguation only when a
consequential target is uncertain. Prefer source-of-truth objects over invented entity IDs. Preserve multi-turn task
identifiers and never start a duplicate mission merely because the user says “try again”.


6. Client knowledge, memory and World
Model
6.1 Customer-owned knowledge fabric
Sandy's central repository must connect people, households, organisations, companies, accounts, projects,
missions, tasks, commitments, calendar events, places, assets, files, messages, decisions, preferences, roles
and delegated authorities. Relationships carry source, confidence, validity interval, tenant/owner visibility and
revision history. Examples: a person is associated with a company; a document is evidence for a legal issue; an
email creates a follow-up; a task depends on another task; a commitment belongs to a mission.


6.2 Memory lifecycle
Candidate extraction → sensitivity/consent/utility screening → entity matching → conflict and duplicate detection
→ provenance + event time + observation time → confirmed/candidate memory → scoped retrieval → feedback
correction/suppression → cache/index propagation. Customer can inspect what Sandy knows, why, when and
from where; mark a claim incorrect; correct temporal facts; limit shared visibility; and request deletion. Do not
use personal memory as model training and do not indiscriminately store highly sensitive or irrelevant
information.


6.3 Cross-channel identity and continuity
Link phone numbers, email accounts, portal login and call identities through verified binding and user consent;
do not trust caller ID or email From text alone. Contact identity resolution must detect collisions and shared
addresses. A voice conversation can inform a later WhatsApp response if transcription retention and memory
permissions permit, and vice versa. Explicitly store whether content is private personal, company-specific or
shared.


6.4 Dynamic client discovery
“Get to know me” asks contextually useful questions only where facts are missing. Sandy can suggest facts
inferred from connected records, but inferred personal attributes remain distinguishable from explicit customer
assertions. The customer's corrections override stale candidates, and known facts are not repeatedly requested.



                                                                            Proposed baseline | 19 Oct 2026      •   6
<PARSED TEXT FOR PAGE: 7 / 17>
SANDY AI / MASTER SOFTWARE SCOPE


7. Missions, commitments and autonomous
operations
7.1 Mission as the unit of accountable work
Mission object: mission_id, goal, principal, context, entities, exact deliverables, accepted definition of done, priority,
due time/timezone, monetary/tool budget, autonomy profile, approvals, dependency DAG, delegated
people/agents, checkpoints, progress, evidence, commitment state and immutable revisions. One mission can span
days or weeks, channels and people. Each step has explicit input/output contracts, side-effect class, idempotency
key, failure route and compensation policy.


7.2 Mission state machine
NEW → CLARIFYING/PLANNING → READY → EXECUTING → VERIFYING → COMPLETED with durable branches to
WAITING_CUSTOMER, WAITING_EXTERNAL, DELEGATED, BLOCKED, PARTIAL, FAILED, PAUSED and CANCELLED. Terminal
completion requires verification of critical deliverables. Progress should show concrete completed evidence,
remaining tasks, actual next action and responsibility; no fake progress percentages.


7.3 Autonomous attention and proactivity
Sandy must detect upcoming appointments and preparations, overdue work, missed replies, expiring documents,
unresolved commitments, stalled missions and dependency slips. Frequency and access are user-configurable.
Proactive notifications must be useful, deduplicated, timely and permissioned—not generic spam. Detection
should use deterministic records and real external states, supported by model reasoning for importance and
recommendations.


7.4 Human delegation and collaboration
Distinguish task owner/responsible delegate from viewer/collaborator. Support delegation, requests for
acceptance, comments, files, due dates, status, reminders, approvals and escalation. Sandy tracks a human
delegate's commitment without falsely claiming the human completed it. Shared access never implies
unrestricted access to the user's private communications or memory.


7.5 Compensation and safe rollback
For multi-step workflows, list irreversible actions and compensating actions. A sent email cannot be unsent by
reversing SQL; a cancelled calendar event may require notifying invitees. Maintain accurate states for
compensations completed, attempted, rejected or impossible.




                                                                              Proposed baseline | 19 Oct 2026        •   7
<PARSED TEXT FOR PAGE: 8 / 17>
SANDY AI / MASTER SOFTWARE SCOPE


8. Agenda, tasks, calendar, timeline and day
review
8.1 One operational graph, multiple views
Outline, Today, Week, Month, Timeline and Day in Review are perspectives over the same durable
task/event/mission records. A task may have a date-only deadline, specific start/end time, effort estimate,
recurrence, dependency, delegate, category/company/project, comments, files and external linked calendar event.
Do not render a timed item as “all day” merely because an integration omitted a field.


8.2 Fast entry
Adding a task, action or daily activity must be immediate in the UI (optimistic placement with durable save
acknowledgment); AI enrichment may run asynchronously without blocking entry or causing list collapse/reload.
Keyboard-oriented creation (Enter/Tab) and intuitive quick-edit must be consistent across Agenda, Timeline, Day
in Review and Missions.


8.3 Graphical timeline requirements
Support Microsoft Project-style drag creation/resizing from task rows, start/end edge handles, day-level zoom
allowing sub-day durations, visual day alternation, zoom presets, dependency arrows from predecessor end to
successor start, moving linked dependent tasks, conflict and cycle checking and undo/redo. No-timeline rows
should be assignable directly by dragging; time changes must not inadvertently trigger unrelated modal popups.
Persist time granularity and show DST/local timezone transparently.


8.4 Time semantics
Store UTC instant plus IANA timezone and intended local wall time; distinguish due_at, starts_at, ends_at, date-only
deadline and all-day. Determine timezone from verified profile/device and confirmed channel/account settings,
not inferred email headers, phone country codes or an LLM guess. Handle DST gaps/folds explicitly and validate
reminders against provider-returned event state.


8.5 Day in Review
Day in Review records completed activities, accomplishments, time allocation, decisions, problems and next
commitments, linked to tasks/missions where appropriate. Add-new entry should be consistently located at the
bottom if the customer prefers. Never refresh/collapse the view on a timer. Sandy may analyse persisted entries
asynchronously, propose task follow-ups and detect discrepancies, but the user's entry must remain editable and
authoritative.




                                                                            Proposed baseline | 19 Oct 2026      •     8
<PARSED TEXT FOR PAGE: 9 / 17>
SANDY AI / MASTER SOFTWARE SCOPE


9. Communication channels and collaboration
9.1 Email
Microsoft Graph is the primary email transport. Ingest emails and attachments idempotently; preserve original
MIME/HTML safely, threading, sender account, participants, dates, message and attachment IDs. Parse intentions,
invitations and commitments; reply using the correct thread/identity and conversation context; ensure
professional formatting and branding. Sending requires allowed policy, recipient resolution and provider-verified
send state; on timeout reconcile Sent Items/draft/resource IDs before retry. Detect silent nonresponse and failed
ingestion using watchdogs.


9.2 WhatsApp
Provide the same eligible tools and client knowledge as portal/email, while respecting WhatsApp policy, 24-hour
messaging windows, approved templates and supported media formats. Understand incoming images with actual
vision inputs; support files/audio where allowed; format calendar/task data as readable native WhatsApp text or
supported interactive messages—not arbitrary HTML. Persist webhook delivery IDs, de-duplicate and detect
dropped/malformed messages. Group creation and contact sharing only where provider APIs actually permit;
otherwise disclose limitation.


9.3 Voice and telephony
Browser realtime audio uses appropriate ephemeral credentials/WebRTC with server-held permissions. SIP/PSTN
connectivity uses a separate telephony/media gateway as required; the current voice VM needs direct
infrastructure verification. Maintain call identity, transcripts (under consent), interruption handling, tool
confirmations, shared mission references, call-again, handoffs and cross-channel follow-up. Calls must not bypass
high-risk tool approval.


9.4 Sandy branded video and external meeting interoperability
Target Sandy-hosted browser video rooms with participant identity, invitations, calendar links, transcripts/notes
under consent and contextual Sandy assistance. Interoperation with Teams/Zoom depends on published platform
permissions, embeddability, bot/media policies and user auth; provide a universal scheduling/joining interface
without falsely promising that third-party media can always be embedded. A media SFU may be necessary; do not
assume the existing SIP voice VM can scale video conferencing.


9.5 Communication and social graph
Link people with their contact methods, organisations, conversation history, permissions, relationships and
commitments. Support customer-approved outreach, follow-ups and delegation while protecting shared-contact
privacy. No silent third-party profiling outside allowed data and consent.




                                                                             Proposed baseline | 19 Oct 2026    •   9
<PARSED TEXT FOR PAGE: 10 / 17>
SANDY AI / MASTER SOFTWARE SCOPE


10. Tool/API/connectors and Engineering
Control
10.1 Unified capability service
All channels call one versioned Sandy API/tool broker for permitted operations. Capability discovery must expose
actual deployed, connected, authorised and healthy tools, not tools merely declared in a table. The model receives
only task-relevant eligible schemas. A user-facing capability report distinguishes what Sandy can do now, what
requires account connection, what requires approval and what is planned.


10.2 Tool contract and risk tiers
Every tool declares ID/version, input/output JSON schemas, service owner, read/write classification, required
scopes, principal/account binding, approval rule, idempotency/reconciliation method, cost/timeout, source
evidence, verification and release status. T0 public calculation/read; T1 scoped personal read; T2 reversible
private write; T3 consequential external send/share/publish/delete; T4 financial/security/infrastructure critical
work requiring stronger policy or prohibition. Exact approvals bind actor, target, canonical input digest, expiry
and policy version.


10.3 API pathway and customer permissions
The system may expose MCP client → Sandy API → Supabase/connected service, with a separately limited
customer-facing API. Privileged engineering/admin tools must never share the ordinary customer token
permissions. Define OAuth/scoped service identities, granular target resource ACLs and separately revocable
delegation. Developer SDK/OpenAPI and customer permissions are versioned and penetration-tested.


10.4 Engineering Control register
Every requested code, database, infrastructure or prompt/policy change executed through Sandy's Engineering
Control path must first create a durable change record identifying: requester; customer/business issue; intended
improvement; current behaviour; proposed bounded change; services/files/functions/tables; affected
environment; risk; authorisation; linked mission/incident; commit and migration IDs; tests; live verification;
rollback plan; approval; result; and timestamps. Never register a change as successfully deployed merely because
the request was accepted.


10.5 GitHub/Supabase/GCP change lifecycle
register → inspect deployed state → design → test → build → review/risk approval → deploy staging → smoke/E2E → canary
production → verify actual handler → record outcome → rollback if failing. Use immutable release references, migration
safeguards, secret vaults, environment separation, least-privilege workload identity and source/release
provenance. Supabase data changes need transaction safety and forward repair; GitHub CI success is not
equivalent to production endpoint health.




                                                                               Proposed baseline | 19 Oct 2026           •   10
<PARSED TEXT FOR PAGE: 11 / 17>
SANDY AI / MASTER SOFTWARE SCOPE

10.6 External connector roadmap
Microsoft Graph, Google Mail/Calendar/Drive, contacts, Composio/MCP providers, GitHub, Supabase and
infrastructure management are important initial domains. Accounting, documents, travel, booking, commerce
and business SaaS may be introduced incrementally after sandbox and permission tests. Each connected account
has an owner, applicable companies, scopes, sync cursor, status, last success, refresh state and revocation/deletion
workflow.


11. Documents, research, files and artifacts
Upload/synchronise → quarantine/validate malware/MIME → parse PDF/DOCX/XLSX/images/layout → preserve
page/section/cell identifiers → content/index permission tags → hybrid search → rerank/cite → answer or produce
artifacts. Use exact search for titles, dates, invoice numbers, contracts and addresses; model synthesis only over
eligible evidence. Generated files (DOCX, PDF, XLSX, PPTX, images etc.) must be created by actual code/tool,
reopened/validated, stored, checksummed and retrievable before Sandy claims completion. Never invent
attachment access or cite a source not retrieved. Sandbox generated code away from production secrets and
internal networks.


12. Security, trust, privacy and autonomy
Server-verifiable identity; strict tenant and workspace isolation; service-layer permission checks and tested
PostgreSQL RLS; OAuth delegated scopes; KMS-backed secrets; no client-held permanent AI keys; encryption in
transit/at rest; prompt-injection protections; secure file scanning; SSRF/egress controls; private sandboxes; signed
downloads; account revoke and data deletion; privacy and retention policies for each channel/record. Apply role
separation for users, delegates, admins, support and engineering operators.

Autonomy modes: Observe & suggest; Draft & request approval; Perform limited reversible actions; Delegated
execution under standing constraints; Engineering/critical actions under explicitly separate policy. Users can
revoke permissions at any time. A model's desire to perform an action cannot upgrade a scope.

Truth states: PROPOSED, QUEUED, RUNNING, WAITING_APPROVAL, WAITING_EXTERNAL, PARTIAL, VERIFIED_SUCCESS,
VERIFIED_FAILURE, UNKNOWN_OUTCOME, CANCELLED. All user-facing claims map to these states and durable
evidence.


13. Examiner, Evolution and continuous
improvement
13.1 Examiner quality loop
Collect opted-in/appropriately redacted real workflows plus synthetic golden tasks; measure factual correctness,
context recall, cross-channel continuity, source grounding, date/timezone correctness, tool selection, missing
replies, actual send/upload/meeting results, duplicate side effects, UI failures, permissions and costs. Reproduce
each defect and classify root cause: data, retrieval, model routing, prompt, tool schema, provider, frontend,
backend or infrastructure.




                                                                          Proposed baseline | 19 Oct 2026        •   11
<PARSED TEXT FOR PAGE: 12 / 17>
SANDY AI / MASTER SOFTWARE SCOPE

13.2 Evolution engineering loop
Examiner finding → deduplicated defect/feature register → reproducible failing test → bounded proposal with
expected improvement → architecture/risk review → code/schema/prompt change behind flag → local/staging tests
→ independent acceptance → production canary → measured improvement → keep or roll back. Evolution does
not bypass Engineering Control or claim production success without actual evidence.


13.3 Architectural self-awareness
Sandy maintains a validated capability inventory and current architecture map including services, external
provider reachability, account connection states, tool definitions, deployed function versions, latest verification,
incidents and limitations. Self-reports should query authoritative status endpoints, not summarise assumptions
from a chat prompt. Privileged inspection is governed, time-limited and audited.


14. Data contracts and initial schema map
Preserve/extend existing Supabase schemas rather than blindly creating duplicates. Target logical records:
customer_identities, tenant_memberships, connected_accounts, channel_events, conversations, conversation_branches,
messages, agent_runs, agent_steps, missions, mission_steps, mission_dependencies, commitments, tasks, task_dependencies,
calendar_links, world_entities, world_relationships, memory_assertions, memory_evidence, document_sources,
document_chunks, tool_registry, tool_operations, operation_receipts, approvals, scheduled_triggers, notification_deliveries,
engineering_changes, release_verifications, examiner_cases, evolution_proposals, audit_events, outbox_events and
usage_ledger. Names are conceptual; map against actual production tables before migration.

Every persistent action references tenant, actor, ownership/visibility, version, correlation ID, source evidence and
event time. Define uniqueness of provider message/webhook IDs, customer request idempotency and external
operation identity. Maintain an append-only event ledger and reconstructable projections, while respecting
privacy retention and deletion.


15. Infrastructure, hardware, observability
and costs
15.1 Hosted model implication
No GPU fleet is required to invoke OpenAI-hosted language models. Sandy's own compute primarily handles
webhooks, orchestration, secure API calls, streaming, retrieval, file processing and integration workers. Use CPU-
based hosted containers/VMs plus managed PostgreSQL, object storage and queues. Dedicated compute may be
appropriate for SIP, real-time media/SFU, isolated code/browser sessions or video transcoding.


15.2 Illustrative capacity tiers (benchmark; not procurement commitments)
 Tier                            API and orchestration           Worker/storage baseline         Principle

                                 Audit current
                                                                                                 Stabilise, eliminate duplicate
 Existing/internal               Supabase/functions/VMs          Reuse deployed services
                                                                                                 handling
                                 before sizing

 Pilot ~100–1,000 active users   >=2 API replicas when an        2–4 workers where loads         HA, queue recovery, traceable

                                                                                 Proposed baseline | 19 Oct 2026           •      12
<PARSED TEXT FOR PAGE: 13 / 17>
SANDY AI / MASTER SOFTWARE SCOPE
 Tier                            API and orchestration          Worker/storage baseline        Principle

                                 external runtime is needed;
                                                                justify; managed DB and
                                 roughly 2–4 vCPU and 4–8 GB                                   operations
                                                                storage
                                 RAM each

                                 Horizontal autoscaling,
 Growing service ~10,000 daily                                  Database/query and search      Scale on observed streams and
                                 separate channel/media
 users                                                          tuning; isolated sandboxes     jobs
                                 workers

                                                                Partitioned events,
                                 Regional/cell-based sharding                                  Formal SRE, DR, budgets,
 100,000+ daily users                                           independent media and search
                                 as measured                                                   provider quota
                                                                capacity



These allocations apply only where dedicated compute exists; Supabase edge/runtime limits and externally hosted
media must be separately measured. GPU needs for self-hosted models are a separate design exercise.


15.3 Observability and service reliability
Every user request, channel event, inference, tool call, provider response, approval, artifact and engineering
change shares trace IDs. Instrument p50/p95 response latency, first useful output, ingest lag, missed replies,
mission aging, duplicate send suppression, unknown outcomes, token spend, model routing, retrieval relevance,
memory corrections, provider outages, webhook dead letters, task scheduling/DST, UI refresh/reload failures and
audit anomalies. Alert on silent failures. Preserve logs privacy-safely.


15.4 Cost controls
Meter provider model input/output/cached tokens, images, audio/video minutes, search, code execution,
connector fees, storage, bandwidth, compute and support. Reserve budgets before expensive execution; per-
tenant caps, reasoned model routing, batching and caching. Commercial tiers and final pricing require a separate
unit-economics approval; no unsupported “unlimited” capacity promise.


16. Product experience and commercial
capabilities
Client portal should prioritise Home/briefing, unified conversation, Agenda, Missions, Needs You/Approvals,
Commitments, Calendar & Timeline, Day in Review, People & Organisations / My World, Memory Centre,
Files, Connections, Voice/Video, Settings, Privacy & Autonomy, and Controller where the user is authorised.
Responsive mobile design and clean, light, minimal brand presentation; quick entry; no unstable alignment,
hover layout shift, repeated page collapse or dead “click to view” controls. Preserve chat/call continuity across
view changes.

Commercial software should support branded website, self-service onboarding, passkeys/email/SSO appropriate
to tier, subscription/entitlement state, trials/free plans where approved, usage/spend transparency, team sharing
and delegated seats, cancellation and data export. Payment providers handle card security; Sandy does not
implement its own PCI card vault. Do not treat proposed prices as an approved price list.




                                                                                Proposed baseline | 19 Oct 2026           •   13
<PARSED TEXT FOR PAGE: 14 / 17>
SANDY AI / MASTER SOFTWARE SCOPE


17. Measurable requirements and acceptance
tests
17.1 Invariants (must always hold)
        A1: no unauthorised cross-tenant or private-memory disclosure.
        A2: no externally consequential action reported complete without independent verified receipt or observed
         target state.
        A3: no duplicate email/send/payment/invitation caused by retries or replay.
        A4: customer follow-up retains relevant context and constraints; ambiguous consequential targets lead to
         clarification.
        A5: user can find mission owner, steps, evidence, blockers, next action and current status across channels.
        A6: production code/DB changes must be registered, linked to a release, tested and reversible/recoverable
         within declared limits.
        A7: a memory correction suppresses the stale active assertion across channels and retrieval indexes.
        A8: user-entered timed tasks maintain exact timezone/instant correctly through UI, reminders, messages and
         calendar sync.
        A9: no silently lost inbound email, WhatsApp message, accepted task or queued run; alert or user-visible
         failure within the configured SLA.
        A10: new architecture can be disabled without destroying existing operational history or customer
         functionality.


17.2 Priority acceptance scenarios
    ID                                        Scenario                                    Required proof

                                                                                          Inbound ID, full content/attachments,
                                              Inbound Microsoft email requesting reply
    SAT-01                                                                                reply in same thread, downloadable
                                              with file
                                                                                          correct file, Sent Items verification

                                                                                          Vision-capable input receives actual bytes,
                                              WhatsApp image asks Sandy what it
    SAT-02                                                                                grounded response, durable channel
                                              contains
                                                                                          event

                                                                                          One linked user identity and mission ID,
                                              Same mission continued through email,
    SAT-03                                                                                memory/permissions consistent, no
                                              WhatsApp and voice
                                                                                          duplicate work

                                                                                          Explicit zone provenance, correct
    SAT-04                                    “Set appointment 3 PM tomorrow”             UTC/local representation, calendar read-
                                                                                          after-write and reminder

                                                                                          Invitation parsed, participants/zone
    SAT-05                                    Calendar invitation email                   preserved, correct event/RSVP status, no
                                                                                          fabricated confirmation

                                                                                          UNKNOWN outcome → provider
    SAT-06                                    Model/provider timeout after email send
                                                                                          reconciliation → exactly one actual send

                                                                                          Existing run resumes; no extra external
    SAT-07                                    User says “try again” after worker crash
                                                                                          write; accurate progress

                                                                                          Supersession+evidence; old fact absent
    SAT-08                                    User corrects remembered personal fact
                                                                                          from subsequent channel responses

                                                                                          Live capability + connection + permission
    SAT-09                                    User asks Sandy what apps she can use
                                                                                          + health status, no invented abilities


                                                                                      Proposed baseline | 19 Oct 2026          •     14
<PARSED TEXT FOR PAGE: 15 / 17>
SANDY AI / MASTER SOFTWARE SCOPE
 ID                                     Scenario                                    Required proof

                                        Mission delegates task and waits on third   Delegation receipt, reminders, awaiting
 SAT-10
                                        party                                       status, escalation and follow-up trace

                                                                                    Correct graphical interaction, persisted
                                        Timeline drag sets 30-minute task and
 SAT-11                                                                             start/end/dependency, dependent move,
                                        dependency
                                                                                    no popup misfire

                                                                                    Immediate stable row, durable commit, no
 SAT-12                                 Day in Review quick entry
                                                                                    5-second reset, async enrichment

                                                                                    Permissioned search, cited page
 SAT-13                                 Upload large multi-document research set
                                                                                    references, conflicting facts disclosed

                                        Produce a multi-file report with DOCX and   Actual files open and validate, data
 SAT-14
                                        XLSX                                        provenanced, signed artifact URLs

                                                                                    Problem/benefit registered, tests run, live
 SAT-15                                 Engineering Control deploys safe change
                                                                                    endpoint verified, rollback exercise logged

                                                                                    Canary alert, rollback to known-good app
 SAT-16                                 A test deployment breaks Agenda
                                                                                    and DB-compatible state, no data loss

                                        Unauthorised account/resource in            Tool broker refuses, redacted logs, no
 SAT-17
                                        connected-app query                         model exposure of forbidden data

                                        Proactive reminder for unanswered           Verified open commitment, one relevant
 SAT-18
                                        critical email                              notification, snooze/update control

                                                                                    Consent-aware transcript available, same
                                        Voice call and transcript followed by
 SAT-19                                                                             task entity, appropriate cross-channel
                                        WhatsApp question
                                                                                    recall

                                                                                    Reproduction, issue linkage, independent
                                        Examiner discovers regression and
 SAT-20                                                                             eval pass, change log and release
                                        Evolution fixes
                                                                                    verification




17.3 Initial launch quality gates
100% of critical permission, tenant isolation, idempotency and irreversible-action approval tests pass; zero
proven false completion claims in controlled critical workflows; zero duplicate side effects in fault-injection
suites; application-owned regression dataset with measured answer adequacy, tool selection, factual grounding,
timezone accuracy and memory consistency. Suggested pilot thresholds (to calibrate, not promises): ≥95%
adequate answers on curated general cases; ≥98% correct routine tool selection; ≥95% properly supported
retrieval citations; 99.9% monthly API availability for an agreed paid pilot scope. All critical channel journeys
require actual provider-side evidence.


18. Delivery sequence and change-control
gates
P0 — Baseline and incident stabilisation. As-built inventory; preserve V1; verify active handlers, ingest,
timezone, files, WhatsApp vision and production deployment; fix silent failures before large refactor. Outputs:
evidence map, safety baseline, bug regression suite.

P1 — Unified executive core. Identity/capability registry, unified orchestrator, context builder, truthful receipts,
durable runs, model gateway, shared tool broker and channels integrated incrementally behind flags. Exit:
email/WhatsApp/web cross-channel cases verified end to end.



                                                                                Proposed baseline | 19 Oct 2026               •   15
<PARSED TEXT FOR PAGE: 16 / 17>
SANDY AI / MASTER SOFTWARE SCOPE

P2 — Knowledge, missions and agenda. World Model, corrected memory, semantic/exact search, commitment
tracking, Missions/Dependencies, consistent Timeline/Calendar/Day Review and proactive scheduling. Exit:
audited client journeys, no duplicate workflows, correct timezone and graphical task operations.

P3 — Autonomy and operations. Extended connectors, delegated human coordination, browser/code sandbox,
document generation, voice robustness, video proof of concept, permissioned customer API, Engineering Control
expansion. Exit: safe external writes, bounded autonomy, inspected receipts and working rollback.

P4 — Continuous quality and commercial scale. Examiner, Evolution, model evaluation/routing, service self-
awareness, subscription onboarding, SLO monitoring, capacity, privacy controls and enterprise features. Exit:
independent regression scorecards, controlled deployment quality and unit-economics evidence.

Phases may run in parallel if dependencies and migration safety allow. Production cutover is gated by
evidence, not calendar date or reported “deployed” status.


19. Required engineering handover
Deliver (a) approved business requirements and product journeys; (b) current-state inventory and target
component/sequence diagrams; (c) versioned OpenAPI/JSON schemas; (d) schema mapping and safe migrations
with RLS; (e) tested prompts, model registry and tool manifests; (f) memory/World Model contracts; (g) mission
and receipt state machines; (h) channel gateway integrations and provider fixtures; (i) infrastructure-as-code,
secret/security model and disaster recovery; (j) executable regression and fault-injection dataset; (k) CI/CD
pipeline and Engineering Control register; (l) dashboards/incident playbooks; (m) acceptance evidence with actual
provider-side references; and (n) user/admin/operator manuals.


20. Open architectural decisions and
verification requests
Decisions requiring measured discovery/approval include: current active V1/V2/V3 runtime topology; actual
installed MCP/Sandy API and Engineering Control scopes; production GitHub deployment branch; Supabase edge
function/resource limits; exact current schema tables; Microsoft Graph OAuth/tenancy and idempotency support;
Google/Composio connector state; WhatsApp media and approved templates; voice/SIP VM details and current API
access; cross-channel identity recovery; document OCR/embedding backlog; partner video interoperability terms;
encryption/key rotation; production regions/data terms; commercial pricing and user autonomy defaults. None
should be silently assumed solved by this document.


21. Source integration and editorial
provenance
Input A: OpenAI-Powered Conversational AI Platform — Engineering Blueprint, version 1.0, 19 October 2026 (46-
page Word document): foundational security/operations, tool safety, execution receipts, hardware sizing, sample
schema, change verification, diagrams and QA matrices.

Input B: ChatGPT-Class AI Platform — Comprehensive Software Engineering Scope, version 1.0, 19 October 2026
(Markdown document): reasoning/model-selection profile, deeper context and temporal memory,



                                                                          Proposed baseline | 19 Oct 2026       •   16
<PARSED TEXT FOR PAGE: 17 / 17>
SANDY AI / MASTER SOFTWARE SCOPE

missions/dependencies, scheduling, implementation sequence, technical API contracts and measurable release
gates.

Sandy-specific context: user-stated product mission and prior project discussions covering the live project
identifiers and previously reported features, incidents, desired workflow, World Model, Executive Controller,
Meta-Intelligence, Examiner, Evolution, Engineering Control, universal communications, client portal, Missions
and proactive executive assistance. This contextual knowledge identifies priorities but does not independently
establish live deployment or test success.

Design provenance: The target-state modules and requirements in this scope combine the above with
independent engineering recommendations. This is intentionally a new Sandy-specific proposal, not a verbatim
restatement of either reference. The actual implementation must use validated provider documentation and an
approved architecture-decision register.




                                                                        Proposed baseline | 19 Oct 2026       •   17
