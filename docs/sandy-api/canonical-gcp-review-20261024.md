# Google Cloud canonical review

SANDY-ENG-0005;41 remaining Google Cloud families reviewed against original PDF4.1–4.3, current typed provider descriptors, guest contracts and private credential-lifecycle implementations. The JSON companion records required canonical identities, source descriptor fields, supporting candidates and unresolved capability obligations. It does not claim operation-level functional verification, activation or family acceptance.

The review retains bound/capture/media contracts as distinct safety boundaries, not name variants to strip. Global/regional/zonal resources, IAM parents and long-running operations remain separate. Supporting legacy video and google_cloud diagnostic helpers do not multiply the required provider lifecycle. Wildcard families retain their concrete subresources; generic CRUD is not substituted for runtime effects.

## Findings affecting implementation

- `gcp.projects.list` invokes project GET and projects the one configured project as an array. Real parent-scoped list is `gcp.projects.list_filtered`; its stricter existing authority remains unchanged.
- Standard snapshot restore uses `gcp.disks.create` with `sourceSnapshot`, followed by disk integrity and isolated guest readback. No fictitious snapshots.restore endpoint is introduced.
- OS Login key/profile management is not IAM grant/revoke. Target-specific IAP policy and actual host access remain separate Runtime/API integration obligations.
- Key/secret rotation requires the private credential lifecycle, verification/reconciliation and old-version retirement. Listing metadata does not prove consumer rotation.
- The current candidates contain log metrics/sinks/log-name listing but no canonical `gcp.logging.query` entry-query handler. That original scope operation remains visibly missing.
- Monitoring metric descriptors are not time-series query/write. Actual series and metric/notification behavior remain explicit gaps.
- Guest reboot/firewall/agent/bootstrap families41–44 remain Runtime-owned execution dependencies. This review does not change worker source, host enrollment, IAM or installation authority.

Official semantic checks: [snapshot restore](https://docs.cloud.google.com/compute/docs/disks/restore-snapshot), [service-account rotation](https://docs.cloud.google.com/iam/docs/key-rotation), [OS Login setup](https://docs.cloud.google.com/compute/docs/oslogin/set-up-oslogin), and [Workload Identity Federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation). Exact REST method/path/provider IDs remain pinned in source descriptors, including the reviewed Resource Manager discovery source.

No provider execution, paid resource, new credential, grant, exposure or deployment occurred. Prior IAM/Private Google Access/DNS refusals are preserved. Future target decisions must name the exact resource, allowed effects, expiry and rollback; this review does not request broad authority. Family acceptance remains blocked by the recorded capability obligations and the existing independent-evidence gates.
