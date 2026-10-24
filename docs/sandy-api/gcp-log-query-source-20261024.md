# Closed GCP log-query source candidate

SANDY-ENG-0005/family67. The review found no log-entry query operation: existing log-name lists, metrics and sinks do not query entries. This adds `gcp.logging.query` to the existing provider-gap executor. It is a bounded metadata-only engineering-canary query, not full log-content access, general query/export or completed family67 acceptance.

Contract: existing project `elaborate-haven-511518-a5`; exact `sandy-engineering-canary` log or a bounded `-`/`_` suffix; canonical UTC start/end, at most15minutes and within the last7days; limit1–100. The executor builds the filter and fixed project resource. Callers cannot pass arbitrary filters, resource names, credentials, URLs or page tokens. Returned fields are timestamp/severity/resource type only. Payloads, insert IDs, labels, trace/user identifiers and provider continuation tokens are omitted. Empty results with a continuation token remain explicitly truncated; no automatic paging or retry.

The admission scope explicitly declares project-level metadata and the canary namespace; it does not imply a region/zone restriction that Cloud Logging project queries cannot enforce. Exact log/time inputs remain bound by the admission input digest.

The transport exception allows only `logging.googleapis.com/v2/entries:list` POST for this operation; existing Compute transport cannot use it. Logging POST is classified as a read, so transport failure does not create an unknown mutation claim. Existing authorization, exact grant consumption, credential consumer and durable finish path are reused. There is no parallel gateway or credential route.

Source schema: pinned Google Logging discovery at commit795219d564a58d0ff44efde7b6be21544b4ff057, SHA256 `09ffd0099481c15e0e67a3407f57d70dc60b74eda29d6bf66f465e1b0525af1f`, `logging.entries.list`. Semantics checked against [official entries.list](https://docs.cloud.google.com/logging/docs/reference/v2/rest/v2/entries/list). The source descriptor was downloaded and its method/path/hash checked locally.

Migration20261024023000 adds one closed/unverified source-ready row and fails on duplicate, without changing existing rows, grants or ACLs. Reproducible generation preserves all38 prior gateway descriptors. It has not been applied. No function is deployed and no log provider call is made.

Validation: nine new boundary tests within36 passing provider-gap tests;14 isolated PostgreSQL checks for closed flags/approval requirement/no overwrite; existing38 descriptors unchanged. Tests cover foreign target/filter rejection, bounded dates/results, payload suppression, partial pages, duplicate admission, credential/authority refusal, immutable host/method/path and truthful read failure.

## Activation boundary

A future protected release must pin the then-current provider-gap and shared gateway source/preimages, preserve Runtime/IAP changes, hold existing component locks and retain exact rollback bytes. An Owner decision must name the existing canary log ID, exact historical UTC window, permitted metadata projection, bounded expiry and applicable existing credential. Exposure/verification/classification changes require that reviewed path; this source PR neither creates nor approves such a grant. No need to grant log writes, private-log payload access, broader project inventory or new identities. The synthetic log must already exist or its creation must be separately authorized; do not fabricate provider evidence.

Family67 still needs broader explicitly authorized log-content custody/query semantics, sink delivery and lifecycle/negative/recovery acceptance. The canonical review's original missing-handler observation remains historical until an independently verified deployment supersedes it.
