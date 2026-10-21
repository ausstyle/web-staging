# SANDY-ENG-0006 — Memory, Context Intelligence and World Model

Version: 1.0 · 21 October 2026  
Status: DRAFT — target engineering design  
Priority: P1 overall; correct current-turn context, correction and authorization are P0 dependencies  
Owner: Sandy Knowledge Engineering / Codex  
Master: §§2.3, 4.2, 5.3–5.4, 6, 11–14, 17–19; AC-05, AC-07, AC-09–10  
API requirements: 145–147, 151–152, 156, 159–160  
Shared contracts: SC-01, SC-02, SC-06, SC-07 in [architecture-contracts.md](../architecture-contracts.md)

## 1. Outcome and ownership

Sandy should remember relevant facts, decisions and commitments, know which person/company/source they belong to, distinguish current facts from historical assertions, and stop repeating corrected or unauthorized information. Cross-channel continuity must respect verified identity and consent. The World Model connects entities and relationships; Context Intelligence assembles a task-specific evidence bundle. Neither becomes an alternative conversation orchestrator or authorization authority.

This scope owns knowledge ingestion, provenance, entity resolution, retrieval, correction, suppression and forgetting. 0003 decides what context a turn needs; 0004 owns action/mission truth; 0005 authorizes source access; 0009 renders My World and Memory Centre; 0010 owns tenancy/retention obligations and deletion orchestration. A received message is not automatically a durable personal fact.

## 2. Existing-state investigation

Live metadata confirmed memory archive/audit/settings/subjects/rejected-facts relations, voice memory fact/review records and runtime identity metadata. Inspect the current embeddings, search indexes, entity keys, consent checks, connected-source handles, identity collisions and all channel writers before proposing schema changes. Determine where the same fact is duplicated and which representation owns corrections. Do not assume these existing tables already form a coherent World Model.

Build a failing retrieval/correction cohort: exact names and IDs, time-sensitive facts, conflicting source revisions, company-private records, stale summaries, shared email addresses, revoked sources and voice-to-chat recall. Use consented/redacted fixtures; never add real private customer facts to the public repository.

## 3. Architecture

`authorized source event → validated source/revision → eligible memory candidate → entity resolution → conflict/consent review → versioned assertion/relationship → lexical + semantic index`

`turn objective + actor → ACL filter → exact/entity/temporal search → ranked hybrid retrieval → source expansion → context bundle with omissions and provenance`

Keep PostgreSQL as the initial entity/relationship store, with typed relationships, normalized identifiers, validity intervals and permission metadata. Use existing full-text/vector infrastructure. Add a graph database only after a measured query/workload case and migration ADR; a visually rich graph does not require another database. Object storage holds original authorized files/transcripts with restricted references.

### Logical records

Source: provider/account/resource/revision, observed/event time, MIME/page/cell/section handles, content hash, retention and permission reference. Entity: tenant, type, stable ID, display names, verified identifiers, merge history. Assertion: subject, predicate, value/object entity, validity interval, observation time, confidence, provenance, status and visibility. Relationship: typed entities plus the same provenance/temporal/ACL fields. Correction: supersedes/rejects reference, source, reason, actor and invalidation revision. Derived embedding/summary: source revision, model/index version and deletion/suppression generation.

Names are conceptual: map to existing tables and preserve identifiers before adding or renaming anything. Contact identity, account authentication and knowledge relationships must remain distinct. A person appearing in an email is not proof that the sender controls that identity.

## 4. Functional requirements

| ID | Requirement |
| --- | --- |
| MEM-01 | Store source-backed assertions and typed relationships, not free-floating summaries |
| MEM-02 | Distinguish working context, conversation history, durable memory and live external records |
| MEM-03 | Apply actor/tenant/company/source consent before search and before returning excerpts |
| MEM-04 | Resolve exact identifiers and entities before approximate semantic matches |
| MEM-05 | Track event time, observation time and validity; preserve temporal questions |
| MEM-06 | Detect contradictions, duplicates, uncertain matches and source supersession |
| MEM-07 | Apply corrections immediately across active retrieval paths |
| MEM-08 | Link channels only through verified identity/consent |
| MEM-09 | Explain provenance, confidence, omissions and freshness |
| MEM-10 | Propagate suppression/deletion through caches, vectors, summaries and derived artifacts |
| MEM-11 | Ask useful discovery questions only for material missing facts |
| MEM-12 | Provide bounded, relevant context with measurable retrieval quality and cost |

## 5. Ingestion, correction and retrieval workflows

**Ingestion:** store the original authorized source revision; extract candidate facts with exact source locations; screen sensitivity, usefulness and consent; resolve entities using verified identifiers; retain uncertain links as candidates. Never infer highly sensitive attributes merely to enrich the graph. Provider content is untrusted data and cannot change prompts, grants or engineering policy. Duplicate input events map to the same source revision/candidate identity.

**Conflict:** preserve competing evidence with event/validity times rather than overwrite by ingestion timestamp. Explicit customer corrections govern active personal-memory assertions within their authority; they do not rewrite an external provider's historical record. Mark superseded candidates and retain lawful minimum provenance. For consequential ambiguity ask a focused question or consult a current authoritative source. Confidence does not grant access or establish truth by itself.

**Retrieval:** first validate actor and permitted source scopes. Search exact IDs, addresses, dates and document titles where provided; then entity edges, lexical terms and semantic vectors. Rank by task relevance, source authority, temporal applicability, explicit correction status and freshness within a token budget. Expand the primary source when a summary alone cannot support the claim. Report partial connector failure, stale evidence and unsearched sources. Do not claim absence from a timed-out search or claim availability merely from an OAuth connection row.

**Correction:** in one transaction store the correction, supersede/suppress the active assertion, increment the relevant memory visibility revision and emit invalidation work. Retrieval checks the current revision/suppression state immediately, so stale vector indexes cannot leak the rejected fact while async reindexing runs. Update related conversation summaries as derived projections, not authoritative rewrites.

**Forgetting/revocation:** disable source visibility before asynchronous purge; cancel pending extraction jobs; invalidate retrieval caches; remove vectors and derived summaries; delete eligible original artifacts under retention policy; record a minimal non-sensitive deletion marker. Restoration workflows must reapply deletion/revocation markers before restored data can be served. Legal holds and policy conflicts are explicit, audited exceptions, not silent retention.

## 6. API and data contracts

Map candidates to existing canonical operation names. SC-01 and SC-06 are mandatory; no endpoint returns an unrestricted graph or arbitrary customer export.

| Candidate contract | Required inputs | Outputs |
| --- | --- | --- |
| `context.retrieve` | objective, entity refs, freshness, token budget, source scopes | evidence bundle, omissions, source refs |
| `memory.assertions.list/get` | subject/filter or assertion ID | permissioned active/historical assertions |
| `memory.candidates.review` | candidate ID, expected revision, decision | confirmed/rejected state and source |
| `memory.assertions.correct` | assertion ID, correction, expected revision | supersession and invalidation receipt |
| `memory.assertions.suppress` | assertion/source ID, reason | immediate active suppression receipt |
| `memory.sources.get` | source/revision and location | authorized excerpt or signed artifact reference |
| `world.entities.resolve` | verified identifiers/context | matched/candidate/ambiguous result, never invented ID |
| `world.relationships.list` | scoped entity/time | evidence-linked relationships |
| `memory.preferences.update` | consent/retention/retrieval settings | policy revision and propagation status |
| `memory.export/erase` | approved scoped lifecycle request | durable job via 0010 with itemized completion |

Entity merge/unmerge is privileged, reversible through provenance and concurrency-checked. Account/channel link changes require explicit verified binding, not fuzzy matching. Exact retrieval fields and foreign keys must be indexed within tenant boundaries.

## 7. Privacy, model context and observability

Separate personal, household and company visibility. Do not treat a company role as permission to inspect every personal message. Recheck source ACLs at read, cache reuse and artifact delivery. Store only a privacy-safe context manifest/decision reason for diagnostics; do not persist hidden model reasoning or tokens. Use least-data retrieval, redaction and configurable retention. Never send revoked or foreign-tenant content to a model and then rely on response filtering.

Measure exact-match recall, relevant-source ranking, grounding accuracy, contradiction resolution, stale-memory leakage, correction-to-active-read latency, index lag, memory growth and retrieval cost. Proposed gates: a committed correction is absent from the next authorized active retrieval; derived indexes converge within a configured 60-second pilot target, while correctness is maintained by read-time filtering. Measure latency on an explicit fixture corpus; do not promise arbitrary scale.

## 8. Acceptance tests

MEM-T01: exact invoice/date/contact ID retrieval despite a semantically similar distractor. MEM-T02: two customers with same names cannot cross-retrieve. MEM-T03: personal versus company visibility and role change. MEM-T04: historical question uses the correct validity interval. MEM-T05: user correction suppresses stale vector and cached results immediately. MEM-T06: conflicting authoritative sources are disclosed, not averaged into an invented fact. MEM-T07: voice transcript consent and later WhatsApp question share permitted context. MEM-T08: spoofed sender/shared address cannot link an account. MEM-T09: duplicate ingest and entity merge/unmerge preserve provenance. MEM-T10: revoke/delete while extraction is running, then restore backup in an isolated exercise without resurrecting suppressed content. MEM-T11: prompt injection embedded in a document cannot change policy/tool authority. MEM-T12: connector timeout creates explicit omissions, not false absence.

Tie to SAT-03, SAT-08, SAT-09, SAT-13, SAT-17 and SAT-19. Use at least 100 source-grounded retrieval cases across exact, semantic, temporal and correction classes, with explicit relevance labels. Meet Master pilot grounding thresholds and all critical isolation/correction gates. Include real consented connected-source canaries; mocked embeddings alone do not prove retrieval behavior.

## 9. Delivery, dependencies and migration

MEM-M1 (P0 slice): map existing sources; fix ACLs, exact retrieval, source manifests and corrections used by 0001/0003. MEM-M2: temporal claims/entity model with safe backfill and dual-read comparison. MEM-M3: hybrid retrieval, relationship expansion and cross-channel verified linking. MEM-M4: My World/Memory Centre API projections, preference controls and lifecycle purge validation. MEM-M5: quality and capacity tuning.

0003 can consume existing memory through SC-06 while this work advances; no circular requirement to finish the entire World Model first. 0002 proactive work consumes the same context interface and cannot build a shadow memory store. 0009 owns editing/display workflows, not memory semantics.

## 10. Rollout and completion

Capture index/schema/source mapping and current retrieval baseline. Backfill with bounded batches and checkpoints, compare results under shadow reads, then canary a consented cohort. Preserve the prior retrieval route for rollback, but never restore revoked/suppressed facts to active service. A failed new index falls back to permission-filtered exact/lexical retrieval with a disclosed limitation.

Handover includes source ownership and ACL map, schema migration proofs, retrieval and temporal benchmarks, correction/deletion propagation evidence, cross-channel tests, live release/source parity and rollback demonstration. Current state remains unverified until these gates pass; a larger knowledge graph is not itself a quality improvement.
