# Runtime capability evidence freshness — 24 October 2026

Bounded SANDY-ENG-0001 / 0003 truthfulness repair. Source acceptance is separate from deployment and customer acceptance.

Installed Runtime39 operational module SHA `120e5b831f970beefe5cd1ad24da741e6516f5c04d881af6e93fbb7a1e35fbcc` treats malformed/future verification timestamps as fresh, and module/master registry errors as successful empty lists. Both new integration tests fail against that original source. The corrected handler returns unverified for missing, invalid, future or >=24-hour evidence and returns capability_catalog_unavailable if any required catalogue errors or returns a non-array. Genuine empty catalogues remain valid. One observed clock is used for every module in a response.

Six isolated SQL integration tests pass through existing authentication, task binding and operational inspection. Coverage includes exact freshness boundaries, twelve error/malformed response cases across all four registries, genuine emptiness and existing tenant/channel count checks. Sixteen Python release/workflow tests pass. Independent review found no source blocker. Fault cases are isolated fixtures, not production fault injection.

Manifest pins all 32 Runtime39 modules and raw bundle `b1ddb8b3813d3ee9401c6394697aea8ced40e481e3e05745786cd7c4a041f36e`; only runtime_operational.ts changes. Runtime records SHA remains `11d12b4ed55f646d776b9c32aa1226dc4285c53b3e9c0dcc080791a85a634440`; denied PR301 remains separate and stopped. No schema, identity, grant or provider exposure changes.

Protected release selection `capability-truth` deploys only this Runtime slice and runs one new ordinary customer web capability inspection, comparing returned counts against independently read database aggregates before/after the turn, requiring actual scoped tool/model receipts and source readback. It skips the completed channel-count, memory and mutation suites. The existing cleanup retires only new synthetic web fixtures, bans their Auth identities and preserves immutable audit references. It does not mutate the capability catalogue. The current read-only observation is 111 modules, all beyond the freshness window; actual acceptance must read current values, never hard-code this observation.

Rollback uses the release's captured private preimage with compatible source checks; no old acceptance suite replay or evidence deletion. Deployment and normal-web acceptance are pending at source publication, and no full Runtime completion is claimed.
