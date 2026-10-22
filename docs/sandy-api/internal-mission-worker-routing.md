# Internal mission work-product routing

The `sandy-mission-executor` source candidate invokes the private versioned
application operation `agent.missions.work_product.prepare@1.0.0`. It has not
been committed or deployed. The public agent API catalogue stays at eight
operations. The new contract is sensitive, mutates draft/review records and
consumes model resources; API/UI/AI/verified exposure remains false.

Read-only production inspection found ACTIVE version 8, `verify_jwt=false`,
with exact entrypoint SHA-256
`6f6b7ce3d1bca03d9637c46a3535c4f288efef4c3a5532cc8a6ef5a6de3b0dc4`
and bundle SHA-256
`96a54a96e48e97dc903f91767d1d8de7f7199ba72dd6c6aed245d9f21c95f8c0`.
This matches archived version 7. The release must recheck the source hash;
secret-only metadata refreshes can change numeric versions.

The adapter retains the existing `x-email-ai-renewal-key` / `EMAIL_AI_RENEWAL_KEY`
authentication, configuration requirements, two-job batch and actual queued
execute-run selection. The dedicated process-local worker proof and stored
run/customer/mission capability cannot authorize a customer, Controller or
runtime operation, and cannot be recreated from JSON. The caller cannot choose
a job, customer, milestone, model or executor through the request body.

The central database application service preserves the original provisional or
approved-plan gate, 100-child view, Sandy-owned unapproved internal milestone
selection and same-plan completed prerequisites. It additionally verifies that
the referenced plan run actually belongs to the same stored mission/customer;
a metadata UUID alone is not sufficient authority. A run with no eligible or
ready step completes with the same waiting reason and no model request.

The fixed shared Responses transport retains the exact original instructions,
`gpt-4.1-mini`, 1,600-token limit, 80-second timeout, input ordering, previous-draft
bound and omitted plan-summary behavior. It adds no broker token or external
tool. Fenced JSON parsing and original title/content/type normalization remain.
The shared transport change adds only the existing worker's 80-second profile;
previous runtime and diagnosis profile behavior is unchanged.

Migration `10060` gives each run a durable one-use claim before model work.
Started/unknown receipts also block another run ID from repeating the same
unresolved milestone. Known completed drafts can still support explicitly
reopened revisions. Context hashes bind actual mission, milestone, prerequisite
and prior-draft observations. Completion locks the parent mission, all same-parent child rows in UUID order,
the selected milestone, the actual plan and all matching prior-draft rows before
revalidating that context. Immediate parent/product foreign keys prevent new
committed child/product phantoms; locking archived and beyond-100 child rows
prevents edits from entering the unchanged 100-child/prerequisite view. Locking
all prior drafts prevents a timestamp edit from changing the latest-draft
predicate during completion. Cancellation or changed customer context cannot
be overwritten by stale model output. The source lock protocol was independently
reviewed; the component run does not claim a live multi-session race test.

Successful completion atomically inserts the pending-review work product,
updates its milestone, creates the client-owned review task, preserves the
provisional/approved mission state, records the run result and original event,
and finishes the receipt. A failed or lost final result cannot duplicate a
paid request, product or review task. An unknown paid result requires
reconciliation. No research, file inspection, external communication, payment,
customer action or independent provider verification is claimed by a model
response or stored draft.

Existing production task ownership, review, temporal, audit and task-analysis
triggers remain enabled. Creating the client review task retains its original
analysis enqueue behavior. The actual inspected pg_net 0.20.4 `http_post`
implementation inserts an ordinary MVCC `net.http_request_queue` row and wakes
the separate background worker; it does not issue HTTP synchronously. Uncommitted
rows remain invisible to that separate transaction and are removed on rollback.
No trigger was disabled or replaced for tests.

Validation passed 44 composed Deno tests, including nine new mission-handler
cases and existing runtime, v4, Gmail/application and diagnosis regressions.
The new entrypoint type-checks. Migration `10060`, SHA-256
`48927c393ab5c91623f3a3d84e17507dec1694e4859781caf0459e78b2b5c9c7`,
passed 28 actual PostgreSQL checks in a full rollback. Fixtures use the
supported `integration_test` provenance for setup; the original review-task
trigger added one uncommitted HTTP outbox row. A narrow postrollback read
confirmed zero fixture customers, zero such queue rows, absence of the new
receipt table and all original task triggers enabled. The first SQL fixture had
an ambiguous local variable; correcting that fixture did not change the initial
migration. A later source review added the cross-run unresolved-milestone guard and peer
review added locks on plan/prerequisite/prior-product facts through completion.
These changes were tested against the final migration hash above.

These checks performed no real model/provider/customer execution. Local mocked
model envelopes and SQL fixture response IDs are explicitly component evidence,
not independent provider proof. Parent release controls permanent migration,
commit, deployment and exact source readback. Other workers and UI clients
remain separate routing work; universal production Sandy MCP routing is not
established by this source extraction.
