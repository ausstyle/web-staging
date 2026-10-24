# Sandy agenda production reconciliation preflight

- Project: `zmqlyygzqoidkcwdysok`
- Function: `sandy-agenda`
- Live Supabase version observed: **43**
- Repository snapshot corresponds to an earlier deployment and is not certified as current.
- Production entrypoint: **98,273 characters**, **728 lines** (source API representation).
- Repository entrypoint: **90,938 characters**, **649 lines**.
- Different lines (distinct-line approximation): **70 newly present**, **3 absent**. This is not a semantic diff.
- Simple private-key / credential signature checks: **no matches detected**. This does **not** guarantee safe publication.

## Decision

**BLOCKED: explicit source-publication approval and independent security review required.**

The full production source was retrieved for analysis but intentionally NOT committed to this branch, included in an issue comment, or published in an artifact. Do not merge this documentation PR as proof of source parity. Do not deploy repository code to production.

## Reconciliation procedure

1. Independently review deployed source version 43 and all changed code for hard-coded identifiers, credentials, customer data, access controls and behavior changes.
2. Once production-derived source publication is explicitly approved, create a draft source-reconciliation PR containing only approved source files, with a bounded diff and no production deployment.
3. Validate code and tests, compare the reviewed PR's hashes against a fresh protected audit, and preserve any unrelated GitHub changes.
4. Re-run Architect on issue #1 only after new verified evidence exists. Engineer remains blocked unless the Architect says `DECISION: READY`.

Evidence: [GitHub source audit #5](https://github.com/ausstyle/web-staging/actions/runs/39042927265).
