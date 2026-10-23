# Sandy universal Google Cloud wrapper — implementation contract

**Status:** reusable API engine in source. Not merged, deployed, wired to the canonical API/MCP handler, or tested against Google's live IAM identity.

## Architecture
`ChatGPT → Sandy MCP → sandy-operation-api → existing authenticated provider executor → google-cloud-universal.ts → Google Cloud`.

Expose stable *generic* tool contracts, not thousands of new MCP tools:

- `gcp.apis.list` — discover supported Google API versions.
- `gcp.methods.search` — search methods inside one API version.
- `gcp.methods.describe` — fetch its authoritative method shape.
- `gcp.execute` — invoke a precisely selected method, with full existing Sandy admission/approval checks.
- `gcp.operations.status` — read provider long-running operation status using its discovered GET method.

Google API discovery is a metadata source, **not an authority grant**. Some Google APIs require special support for media, upload protocols or custom API contracts that this initial JSON REST implementation does not yet provide.

## Nonnegotiable caller integration
1. Authenticate the real Sandy owner/tenant. Check declared resource scope *including request JSON bodies* and deny cross-project, destructive, IAM-sensitive or billing-sensitive calls unless authorised under the currently approved policy.
2. Obtain a renewable **short-lived** Google bearer token through the existing vetted WIF broker (choose `sandy-cloud-administrator` for approved administration; do not globally replace unrelated `sandy-computer` identities).
3. Validate every parameter and request body against the resolved Google Discovery schema, including required path parameters, query parameters, types and references. Current engine performs only partial validation, and is **not safe to expose for general mutations** until full validation is added.
4. Cache/verify published specifications; cap request/response sizes and execution time; never allow arbitrary user-supplied hosts, protocols or redirect following.
5. Use Sandy's durable idempotency, approval, retry, reconciliation, provider audit receipts, long-running-operation polling and IAM policy requirements.
6. Add canonical registry operations only when integrated and deployed with passing provider tests; never mark unverified operations as verified.
7. Repair the Sandy AI Operations V2 MCP `-32603` connection issue and verify `operations_list` from ChatGPT. This remains a separate transport blocker.
8. Add contract tests for URI-template parameters, discovery schema validation, API errors, permission failure, and provider long-running status. Tests in `google-cloud-universal.test.ts` are local fixture tests only.

## Execution prerequisites
- Google Cloud project: `elaborate-haven-511518-a5`.
- Supabase project: `zmqlyygzqoidkcwdysok`.
- Existing service account: `sandy-cloud-administrator@elaborate-haven-511518-a5.iam.gserviceaccount.com`.
- Avoid JSON service-account keys. Verify WIF pool/provider binding, STS exchange, impersonation and refresh.
- Confirm successful Google reads and reversible write via the **actual** canonical API/MCP, not only direct HTTP or local mock tests.

## Rollout safety
Deploy read-only discovery and describe first; then owner-authenticated reads; then controlled mutations. Keep existing Google provider operations until the replacement is verified and reversible. No website or DNS changes are part of this wrapper commit.
