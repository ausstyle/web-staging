# Sandy subscription-first Codex pilot

Status: **pilot scaffold only — not deployed or accepted**. Parent mission: SANDY-ENG-0001. This work does not supersede or merge PR #158.

## Required operator setup
1. Provision an isolated, disposable checkout on the approved Sandy engineering VM/worker. Do not run in a live application checkout.
2. Install a pinned official Codex CLI. Authenticate interactively through the supported ChatGPT sign-in flow as the owner; never export or send authentication tokens in GitHub, logs, chat or Supabase.
3. Independently verify the login uses ChatGPT plan authentication, **not an API key**, and check account eligibility and terms for unattended use. A successful `codex login status` is not sufficient evidence of subscription charging.
4. Run `python3 scripts/sandy/codex_subscription_worker.py --repo /isolated/checkout --prompt-file /isolated/task.txt --receipt /isolated/receipt.json` for preflight.
5. Only after the owner verifies the subscription path and sandbox restrictions, run once with `--execute`. Verify account Usage and separate OpenAI API billing; do not infer coverage from an exit code.

## Execution boundaries
- No paid API fallback, imported API keys, prompt shell interpolation, deployment credentials, or bypass of protected approvals.
- Pilot worker does not automatically restart, accept web commands, push, merge or deploy. The output receipt is **not** independent verification of code correctness.
- Set a bounded wall-clock time, one worker, no parallelism. Protect checkout, filesystem and network with platform isolation outside of this script.
- Access tokens and auth files must remain outside the checkout and outside receipts. The worker's stdout/stderr tails may include sensitive output; keep receipts private and apply redaction before ingestion.
- Stop and report any evidence of API charges, 401/403/429, unknown authentication mode, or unverified completion.

## Acceptance before supervisor integration
- [ ] Official subscription authentication independently verified, account consent recorded
- [ ] No separately billed API request in controlled test
- [ ] Worker runs one real change in isolated checkout; git diff and independent tests confirm it
- [ ] Timeout, process crash, interrupted turn and CLI logout show honest failed/incomplete receipts
- [ ] No deployment, credential leakage, duplicate job or unauthorised file access
- [ ] Owner approved continuous execution scope; concurrency, expiry, and spending controls enforced
- [ ] Engineering runtime persists jobs and idempotency keys, recovers after restart and only dispatches next task after independent verification

## Potential future integration
The official *Sign in with ChatGPT* open-source sharing pathway supports authorised OAuth with the scope `chatgpt.tokens.use.direct`, and documents a Codex app-server integration. Eligibility and permitted usage must be verified before selecting that route. Source: https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server

The subscription-first worker is strictly a proof of execution transport, not a replacement for the persistent engineering supervisor or the SANDY-ENG-0001 four-channel acceptance gates.
