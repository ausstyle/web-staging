# SC-0012 isolated provider pilot proposal — approval required, not executed

Proposed on 24 October 2026. This is an exact bounded proposal for review, not an
approval record. No resources, accounts, grants or billing changes have been made.
The existing GCS draft PR177 remains owned separately; its four shared buckets
and two identities are not modified or silently adopted here.

## Requested resource and cost envelope

- Project: `elaborate-haven-511518-a5` (observed registered Sandy project).
- Proposed region: `europe-west1`, inferred from the registered compute zone and
  PR177, **not a verified customer residency decision**. Synthetic fixtures only.
- Three new private, flat-namespace STANDARD buckets:
  `elaborate-haven-511518-a5-sc0012-stage`,
  `elaborate-haven-511518-a5-sc0012-drive`,
  `elaborate-haven-511518-a5-sc0012-vault`.
- Public access prevention enforced; uniform bucket access; no public principal;
  no customer files or default-backend cutover. Generation-conditioned creates;
  no overwrite/delete privilege for workload identities. No irreversible bucket
  retention lock. Proposed vault retention: seven days, unlocked, synthetic pilot
  only; ordinary Drive identity receives no vault permissions. This is not a
  production retention policy or legal-compliance approval.
- 30-day pilot; **USD 10 total incremental GCS spend ceiling**, excluding tax and
  currency conversion. Aggregate physical bytes including history/soft-deleted
  bytes <=10 GiB; external readback <=20 GiB; <=10,000 Class A and <=100,000 Class B
  operations. Pause admissions at USD 8 estimated usage; reconcile provider bill
  before resuming. Budget alerts are not a hard provider spending cap.
- Planning rates (conservative assumptions, verify exact regional/account SKU
  before applying): USD 0.03/GiB-month storage, 0.005/1,000 Class A,
  0.0004/1,000 Class B and 0.19/GiB external egress. Estimate:
  `10×0.03 + 10×0.005 + 100×0.0004 + 20×0.19 = USD 4.19`, leaving USD 5.81
  contingency. No Cloud SQL, VM, Cloud Run, KMS, paid scanner/model, domain or
  subscription commitment is included. Existing compute use needs an explicit
  verified capacity/ownership check, not an assumption of free capacity.

Google's [current pricing](https://cloud.google.com/storage/pricing) lists
single-region Standard operation rates of USD 0.005/1,000 Class A and
0.0004/1,000 Class B. Internet egress varies by destination; the proposal uses
Australia's first-tier USD 0.19/GiB. The storage page's regional selector was not
independently resolved to the billing account SKU; USD 0.03 is a planning
allowance, not a quoted Belgium price. Retained and soft-deleted bytes also count.

## Exact proposed access expansion

Create keyless service accounts below in that project. No keys, project-level
storage role, token-creator grant, IAM-admin role, service-account impersonation
or federation binding is included in this request.

| Service account | Bucket | Proposed roles |
|---|---|---|
| `sc0012-transfer@elaborate-haven-511518-a5.iam.gserviceaccount.com` | stage | `roles/storage.objectCreator`, `roles/storage.objectViewer` |
| same transfer account | drive | `roles/storage.objectViewer` |
| `sc0012-scanner@elaborate-haven-511518-a5.iam.gserviceaccount.com` | stage | `roles/storage.objectViewer` |
| same scanner account | drive | `roles/storage.objectCreator`, `roles/storage.objectViewer` |
| `sc0012-backup@elaborate-haven-511518-a5.iam.gserviceaccount.com` | drive | `roles/storage.objectViewer` |
| same backup account | vault | `roles/storage.objectCreator`, `roles/storage.objectViewer` |

ObjectViewer includes bucket-scoped object listing. These service identities can
read all synthetic objects in their allowed pilot buckets; tenant-level filtering
must be enforced by the admitted service and verified in the pilot. No existing
identity gains access from the proposal. Separate scanner process and protected
backup path are prerequisites; local fixture parsing is not a malware scanner.

A second exact binding request is still required after the release owner supplies
the existing authorized workload principal. Do not guess a Cloud Run principal,
reuse a personal token, add service-account keys, create a second provider gateway
or broaden shared access to make this pilot run. Approving this document alone
would not authorize that missing binding or production deployment.

## Pre-apply and rollback gates

Authorized read-only inventory must first establish name availability, current
bucket ownership, existing identities, billing/currency, region and organization
policy. `gcp.storage.buckets.list` is presently unavailable through Sandy's
allowlisted path; this proposal does not authorize bypassing that denial.
Prepare an exact IaC plan with those observations and recheck the USD ceiling.
Apply only through the existing protected release path and component owner.

Rollback means freeze admissions and preserve staged/committed/vault data and
receipts. No bucket destruction, legal retention lock, live DNS change, user-file
migration, shared runtime/provider release or backend-default switch is approved
by this proposal. At pilot expiry stop new transfers; any cleanup or continued
retention cost needs an explicit reconciled follow-up rather than silent deletion.

**Decision requested:** approve or revise the project/region, three bucket names,
30-day USD 10 storage-only ceiling, synthetic-data limits and the exact account/
bucket role matrix above. Binding and release approvals remain separate until
actual workload identity and protected release ownership are verified.
