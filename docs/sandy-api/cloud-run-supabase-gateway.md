# Sandy Cloud Run deployment via Supabase API

Target: `elaborate-haven-511518-a5`, `europe-west1`, service `sandy-marketing`.

This change adds a **source-only** provider adapter. It deliberately does not claim live authorization, credential availability, deployment, or website launch.

Implementation: `supabase/functions/_shared/cloud-run-provider.ts`.

## Integration into existing Sandy API
- Reconcile the deployed `sandy-deployment-api` v46, API/MCP, `sandy_deployment_jobs`, and worker source before adding an execution path.
- Reuse the existing owner authorization, approval, job idempotency, audit and provider result receipt. Do not create a separate bypass endpoint.
- Obtain a short-lived OAuth2 access token from the existing `sandy-gcp-admin` workload-identity broker; never save a service-account JSON key or return a token.
- Add `cloud_run.service.get` (read) and `cloud_run.service.deploy_image` (mutation requiring approved job) only after the real backend handler is installed. Preserve registry state as unverified until Google API receipt and service health check.
- Provision Artifact Registry `sandy-web` and Cloud Build with least privilege; build PR #194's container and resolve immutable image digest before requesting Cloud Run deployment.
- A first Cloud Run service may require CREATE rather than PATCH, plus separate public invoker IAM authorization. This initial adapter only PATCHes an **existing** target to prevent accidental service creation.
- Confirm deployment operation status, actual revision, traffic routing, `/healthz` HTTP 200, and the website content. Then configure certificate and DNS via managed load balancer and cut over only after verification.
- Do not automatically redirect `sandy.chat` until HTTPS is confirmed.

## Blockers as observed
- Sandy Operations integration returned an internal error.
- No executable Google workload identity was exposed to this chat.
- This source commit does not change that and should not be treated as a successful deployment.

## Tests required before production
Unauthorized caller; wrong project/region/service; no token; unapproved write; malformed digest; replay; Google 403; Google 429; Google 5xx; reconcile asynchronous Cloud Run operation; rollback to prior verified revision.
