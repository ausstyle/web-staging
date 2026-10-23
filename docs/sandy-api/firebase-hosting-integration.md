# Firebase Hosting API — Sandy engineering integration

**Status: source adapter added, NOT wired/deployed/verified.**
Target Google Cloud project: `elaborate-haven-511518-a5`.
Public website source: `sandy/index.html`, with hosting PR #191.

## New operation contracts
- `firebase.hosting.sites.list` (read)
- `firebase.hosting.sites.create` (write; explicit Sandy-approved change + idempotency key)
- `firebase.hosting.versions.list` (read)
- `firebase.hosting.channels.list` (read)
- `firebase.hosting.domains.list` (read)

Source adapter: `supabase/functions/_shared/firebase-hosting-provider.ts`.
**Not registered as live operations yet.** No API/MCP exposure until a deployed handler wraps it with existing operation-registry dispatch, tenant/owner authorization, target checks, structured receipts, replay protection and provider audit logging.

## Implementation still required
1. Inspect and reconcile deployed `sandy-deployment-api`, Sandy gateway, and registry before changing their routes.
2. Add a real workload-identity token broker with `firebasehosting.sites.*` scopes/roles scoped to the selected project. No downloaded key and no privileged token in frontend.
3. Extend the adapter for custom-domain create/get and release deployment upload lifecycle (populate files, finalize version, create release), with response-level verification; support the documented hosting API's upload host and hash manifest.
4. Add server-side typed operations to the canonical `sandy_operation_registry` and MCP discovery **only after** handler installation and policy approval, with verification flags initially false.
5. Validate permissions, DNS TXT/A/CNAME instructions, HTTPS issuance, domain routing and live asset checksum. Report pending states rather than success.
6. Maintain existing approval/deployment guards and rollback release history. Never bypass the existing Google Cloud outbound identity connection limitations.

## Required acceptance
- Deny unauthenticated/non-owner calls, unapproved writes, cross-project IDs, malformed site IDs and duplicate write requests.
- Verify `sites.list` against the real project using authorised Google identity.
- Test a disposable site create, inspect Google receipt, then delete only under separately approved cleanup; leave existing site untouched.
- Deploy only marketing build; confirm customer portal and API are not exposed through Firebase.
- Verify both HTTPS hostnames with actual DNS and certificate status, and a no-change rollback path.

The source module here is a bounded building block, **not an assertion that the Google API connection works or that Firebase Hosting has been deployed.**
