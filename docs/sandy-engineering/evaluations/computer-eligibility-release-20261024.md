# Computer eligibility release

This release applies PR #221's reviewed session predicate to the exact deployed computer worker v58 (source SHA256 `07c52143be403fed7073a6bd05362a2f47cdbbe704498bdd87862c624782628d`). The full original module is preserved as a source fixture; the installer patches only dispatch and error handling and verifies every uploaded module.

Before each original Daytona/OpenAI provider call, the worker rereads the actual task and session. Expired or unbounded sessions, terminal states, cancellation, reclaimed attempts, expired leases, lost approval, changed sandbox identity and human takeover fail closed. A failed or uncertain provider attempt is not automatically requeued. Existing Windows worker tick behavior and the remaining provider implementation are preserved.

The protected `sandy-computer-eligibility-release.yml` workflow validates source and fixtures, obtains a component lease, captures rollback preimages, uploads the exact candidate, independently compares installed module digests and checks negative ingress without a worker token or queue dispatch. It performs no session updates, provider execution, IAM changes, grant establishment, agent enrolment, Cloud Run deployment or traffic promotion.

The reviewed Python IAP expiry helper and proposal are packaged as a source-pinned release artifact. This does not install an IAM write path in Cloud Run, record an independent grant or apply an IAM change. That path remains separately protected work.

Tests cover the actual transformed worker, including no provider call for an expired session and no mouse action or automatic retry after takeover during a model response. These are regression fixtures, not real graphical acceptance. All existing sessions without expiry remain ineligible rather than being silently amended.
