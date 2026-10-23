# Sandy marketing — hosting pilot packaging

SANDY-ENG-0005/0010; continues PR #194, hosting contract #203 and DNS issue #226. Source-only until protected release and independent acceptance. Reuse hosting change `20a92691-558e-4939-8b61-6d777375c765`; do not register a duplicate.

## Exact intended target

Project `elaborate-haven-511518-a5`, hosting region **europe-west8**. Reconcile existing service `sandy-marketing` and artifact repository `sandy-web` before reuse or creation. These names come from the existing package; their existence is unverified. Preserve Sandy internal Supabase `zmqlyygzqoidkcwdysok`. This static page needs no customer SQL database or object bucket; provision those only for an actual workload requirement and approved budget.

Build only `sandy/index.html` and nginx configuration. The page is unchanged. `/app` and `/app/*` temporarily redirect to the existing HTTPS GitHub Pages portal at `https://ausstyle.github.io/web-staging/sandy/app/`, preserving path/query. No portal or Controller files enter this image. GitHub Pages metadata confirms main/root publication; live portal/session acceptance remains required.

## Build and provenance

The Dockerfile pins the existing nginx 1.27 Alpine linux/amd64 manifest; the Cloud Build builder is pinned too. Pins were read from provider registries on 23 October 2026. Pinning establishes repeatable inputs, not a vulnerability/security approval. Scan the built image before release and update pins through review when necessary.

Use `sandy/` as build context. Set `_SOURCE_SHA` to the full lowercase 40-character commit checked out by the protected release. Missing or malformed values fail before building. The release must bind uploaded source to that exact commit: a caller-supplied label alone is not provenance. `requestedVerifyOption: VERIFIED` requests build provenance. Output repository/region is fixed. Cloud Build publishes the declared image; no second explicit push is needed.

Record build ID, source commit, builder/base digests, provenance and output **image digest**. The source-SHA tag is a lookup label, not an immutable deployment reference. Deploy only the returned `europe-west8-docker.pkg.dev/.../sandy-marketing@sha256:...` reference after source/provenance verification and security scan. Do not submit a paid build or create resources without the approved budget envelope.

Local smoke test (no provider changes):

```sh
python -m unittest discover -s scripts/sandy -p test_hosting_packaging.py
docker build --platform linux/amd64 -t sandy-hosting-local sandy
docker run --rm -p 127.0.0.1:8080:8080 sandy-hosting-local
# In another terminal:
python scripts/sandy/check_hosting_preview.py http://127.0.0.1:8080
```

## Protected release prerequisites

Use existing Sandy API admission, tenant identity, durable receipts and protected release. This package adds no provider executor or standalone production deploy command. The inspected shared provider scope is europe-west1; its owner must add an exact independently authorized europe-west8 binding with compatibility tests. Never replace its global region or broaden grants merely to run this pilot.

Before provisioning: verify tenant/account, existing resources, provider permissions, service identity and quantified cost ceiling. Logical account creation is separate from paid resources. Test same-key account creation and changed-input conflicts through the implemented hosting API; the contract alone cannot create an account.

Deploy a no-production-traffic canary through the protected process. Capture previous revision/traffic, exact resource diff and image digest. Verify health, content hash, sign-in redirects, security headers, absence of private routes, tenant isolation, idempotency and provider readback. Public invocation or load-balancer identity changes require separately authorized security configuration, not an automatic public-invoker grant.

## Domain and rollback gates

Issue #226 requires tenant/domain authorization and exact DNS diff review. Obtain authoritative RRsets and delegation first; preserve MX, SPF, DKIM, DMARC, autodiscover, verification TXT and NS/DS. Use external HTTPS Application Load Balancer, serverless NEG and **Certificate Manager**; Compute SSL certificate catalogue entries do not establish that integration. Verify DNS authorization, active certificate/SAN, routing and independent public HTTPS before proposing live traffic changes. Test A/CNAME/TXT/MX and DNSSEC where applicable on approved records. Registrar commerce/renewals are out of P0 scope.

Keep the existing site and portal serving. Rollback restores recorded previous revision/traffic and reviewed DNS preimage only after checking for intervening changes. Preserve databases, storage, backups and unrelated records. Do not delete resources to roll back code. A preview pass is not customer hosting/DNS acceptance; source, deployed revision and real receipts remain separate.
