# Sandy Antigravity Linux worker — controlled bootstrap

**State on 24 October 2026: SOURCE ONLY. Not installed, authenticated, connected or deployed.**

## Scope

Install the Google Antigravity CLI as an additional coding-provider adapter under Sandy's existing engineering controller, not as a second queue, unauthorized shell API or independent deployment system.

**Target (from the live Sandy cloud-target registry):**
- Instance: sandy-deploy
- Google Cloud project: elaborate-haven-511518-a5
- Zone: europe-west1-b
- Purpose: dedicated deployment worker
- Source: ausstyle/web-staging
- Control plane: Supabase zmqlyygzqoidkcwdysok

Existing production Linux VM sandy-linux, video and SIP infrastructure must remain untouched. On 24 October, live operation registry marked both cloud.vm.exec and gcp.vm.ssh.exec unverified/not exposed; legacy Sandy VM operations returned internal errors. An older install_worker job for sandy-deploy was pending_approval. This is **not** authorisation to execute commands or reuse that unrelated job.

## Approved deployment path

1. Register a bounded new engineering change through Sandy's existing engineering-control API and obtain genuine owner or valid standing-grant approval. Do not update approval state directly via SQL.
2. Read actual Google Cloud instance metadata, boot image, current CLI/process/service state, IAM and existing engineering worker through the approved VM access handler. Capture rollback evidence first. A registry target row is not an actual VM status check.
3. Supply the VM-authenticated, non-root sandbox identity. Never give Antigravity Google Cloud Owner/Editor credentials or production secrets.
4. Download the installer from Google's official URL, inspect it, calculate the SHA-256, and record approval of that exact digest as part of the protected change. The bootstrap script rejects an absent or changed checksum.
5. Bind the following target assertions **only after verifying the real VM identity independently**:

   - SANDY_TARGET_INSTANCE=sandy-deploy
   - SANDY_TARGET_PROJECT=elaborate-haven-511518-a5
   - SANDY_TARGET_ZONE=europe-west1-b

   These environment variables are assertions and do not themselves prove VM identity. The existing provider executor must enforce resource identity and actor permission.

6. Run: bash scripts/sandy/antigravity/bootstrap.sh --preflight
7. In the authorised change window, set ANTIGRAVITY_INSTALLER_SHA256 to the independently approved lowercase 64-character SHA-256 and run: bash scripts/sandy/antigravity/bootstrap.sh --install
8. Run: bash scripts/sandy/antigravity/verify.sh. Record the exact agy version and installed binary location. This proves binary presence only.
9. Authenticate via approved Gemini Enterprise / ADC or a Gemini API key in a managed secret facility. For Gemini API-key mode, Google's CLI guide requires modelProvider=gemini in the user's ~/.gemini/antigravity-cli/settings.json. No credentials in GitHub, shell history, the prompts, output logs or the customer's repository.
10. Only after credentials and permissions have been verified, test agy headless mode from a **sanitised disposable checkout** using the documented -p and --output-format flags. Headless mode can write workspace files without prompts: inspect git diff and ensure no external effects. Do not use --dangerously-skip-permissions.
11. Wire the worker into existing Engineering Control, Sandy API, Mission/Truth and lease/outbox contracts with bounded delegated authority. Do not directly insert deployment jobs, flip registry flags, or bypass protected releases.

## Proposed adapter operations — NOT YET IMPLEMENTED

- engineering.antigravity.task.create: authenticated queue request, repository allowlist, base-commit pin, bounded prompt/model budget/time, idempotency and policy snapshot. Acknowledgement means admitted, not successful.
- engineering.antigravity.task.status: durable state, agent version, tests, worktree changes, GitHub PR and independently verified receipts.
- engineering.antigravity.task.cancel: signal and confirm cancellation of a running worker; cancellation never implies rollback of completed external effects.

Reuse existing Sandy engineering ownership and operation boundaries; verify deployed backend source before introducing any new API operation. Existing GitHub checks and owner-approved production releases remain authoritative.

## Acceptance criteria

- Source branch and pull request reviewed.
- Current VM and IAM state independently verified through approved provider reads.
- Separate bounded change approved with durable audit.
- Exact installer digest recorded and checked; non-root CLI and version readback verified on sandy-deploy.
- Authenticated, restricted disposable agent worktree with no production credentials.
- Live minimal task completes; negative permission, cancellation, replay, lost-ack and recovery tests verified.
- GitHub PR and protected release verified separately; no deployment claims from queue acknowledgements.
- Rollback and uninstall plan tested without affecting pre-existing VM services.

Current evidence: **no VM command has been executed and no Antigravity task has run**.

Official sources:
- https://www.antigravity.google/docs/cli/install/
- https://www.antigravity.google/docs/cli/headless/
- Sandy: docs/sandy-engineering/architecture-contracts.md
