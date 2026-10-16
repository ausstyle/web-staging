# Sandy Controller — QA deployment setup

Project: `zmqlyygzqoidkcwdysok`

The workflow at `.github/workflows/sandy-qa-controlled-deploy.yml` is **not ready for production** until the steps below are completed.

1. In GitHub, open **Settings → Environments** for this repository. Create `sandy-production`. Configure **required reviewers** and, where available, restrict deployments to protected branches.
2. Within `sandy-production`, add environment **secret** `SUPABASE_ACCESS_TOKEN` (a suitable, minimally privileged Supabase personal access token). Never put the token in source files, issue text, chat, or repository variables.
3. Add environment **variables** `SUPABASE_PROJECT_REF=zmqlyygzqoidkcwdysok` and `PRODUCTION_DEPLOYMENT_ENABLED=true` only after configuring reviewer protections.
4. Keep reviewed, deployable source in `supabase/functions/<allowlisted function>/index.ts`; preserve any needed import maps, `deno.json` and companion modules. **Do not automatically copy deployed production code into this public repository without source review and a sensitive-data audit.**
5. Run **Actions → Sandy QA controlled deployment → Run workflow**, select an allowlisted function, and leave `dry_run=true`. Inspect the run result.
6. For a production change, record the QA case, commit hash, review evidence and rollback version; then dispatch `dry_run=false`. An environment reviewer must approve the deployment. Review logs and complete independent functional tests before marking QA passed.

## Safety constraints
- The workflow is fail-closed: without `PRODUCTION_DEPLOYMENT_ENABLED=true`, the correct project reference and a configured token, it cannot deploy.
- The workflow does not bypass platform or tool safety restrictions. A rejected deployment must be escalated/reviewed rather than executed through a less-restricted proxy.
- Never describe a successful CLI deployment as proof the function works. Confirm deployed version and function behavior.
- Restrict deployment sources to reviewed GitHub commits; do not expose dynamic code-execution endpoints to clients.

## Current state
Workflow source is committed; protected environment, reviewer, secret, variables, and reviewed function source remain to be verified. No GitHub Action execution has been observed from this setup.
