# Runtime custody dependency and independent task-count repair

Scope: existing SANDY-ENG-0001/0003/0004/0005; no new architecture, identity, deployment or grant. PR297 remains isolated and pending its exact approval.

## API custody binding assessment

Reviewed API's handoff at `21ccd8f96364b23c7c6b19ff180737361bc1c8cc` and candidate `ArtifactCustodyOwner` at PR287 `3b6671c652ea1703901c4a2a0ce0f789f5a6436d`, alongside Cloud's production integration handoff. Live read-only catalogue inspection found:

- `sandy_api_execution_admissions` supplies actor/tenant, input/contract/scope digests and lifecycle fields. It does not supply a proven portal-customer mapping or repository-artifact claim.
- `sandy_universal_files` supplies owner_customer_id, size/hash, storage bucket/path and metadata. No immutable-generation/scanner/claim/seal columns establish the required owner contract.
- `sandy_engineering_artifacts` stores change configuration/provenance, not a trusted scanner receipt or generation-bound byte custody.
- `sandy_provider_supplement_opaque` and `sandy_provider_artifact_deliver` are an existing, different boundary: owner-only captured provider downloads, maximum1MiB, with exact source-operation allowlists. The SQL consumes the stored download and returns base64. It has no trusted malware-scanner identity/version receipt or repository-staging seal contract. It must not be broadened to impersonate PR287's owner.
- No production scanner-receipt table or matching binary claim/seal RPC was found in the inspected public/private catalogue. Cloud's `sandy_cloud.scan_receipts` is candidate source, not an installed production dependency.

Binding implementation is paused on concrete missing interfaces: trusted scanner identity/receipt with immutable-generation validation; canonical admission-to-artifact/customer relation; an existing transaction-capable connection and shared revision-lock protocol used by BOTH revocation writers and sealing; durable single-use claim/seal/reconciliation ownership. Supplying only a Boolean scanner callback or metadata JSON would fabricate authority. Do not create a parallel store/worker. API/Cloud must identify these canonical interfaces or jointly approve their extension design before a production owner can be implemented. No binary activation or access expansion occurred.

## Existing proposal source review

Read the original clock, task-count and cross-channel proposals after event233 resumed them. Their hypotheses describe older V2 behavior; they are not instructions to introduce duplicate tools, keyword routing or paid reinvestigation. Current Runtime38 already includes server clock grounding, canonical customer-scoped tasks and Executive handling of incomplete Responses. Examiner23 already projects aggregate deadline evidence. Historical event211 at Runtime37/Examiner22 is not evidence that these later source fixes are absent. None of the three complete handoffs is newly accepted here.

A separate concrete defect remains in Runtime38's exact live `runtime_records.ts`: missing exact count is converted to zero (`exactCount ?? 0`), and separate list/count reads can return a short list with a contradictory total. This is a source-proven failure mode, not a claim that it caused the historical QA failure.

The bounded repair refuses absent/invalid count evidence and detectable list/count drift before loading related records. It retains the existing successful output schema, genuine empty accounts, same-title distinct tasks and capped150-row pages with larger totals. It does not claim a transactionally atomic snapshot: same-size concurrent changes remain possible. No new operation, query privilege or storage owner is introduced.

Validation: four new tests exercise missing counts, read drift, genuine zero/consistent lists, and capped pages; eight existing deadline tests pass. Customer filters remain asserted on both task queries. No model call, live mutation or deployment was performed. Deployment must source-pin the shared module's actual consumers, preserve existing release owners and obtain current protected review/acceptance; no pending PR297 pins were modified.
