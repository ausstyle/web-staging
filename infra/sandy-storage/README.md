# Sandy Google Cloud Storage — opt-in infrastructure

This module provisions private regional GCS buckets and two least-privilege service accounts. It **does not** redirect production file operations, enable an unscanned upload path, grant service-account impersonation, deploy a scanning worker, or migrate existing files.

## Deployment prerequisites
1. Confirm the Sandy-owned Google Cloud project and regional data-residency requirements. Do not infer them from a Cloud Shell default.
2. Run `terraform init` and `terraform plan -var project_id=PROJECT -var region=europe-west1` in an approved CI identity with GCP provisioning permissions.
3. Review cost, IAM and the plan, then apply through the production deployment gate.
4. Bind Sandy's actual Cloud Run runtime identity to impersonate `file_service_identity` through IAM Credentials / workload identity without exporting private keys. Grant only the exact identity.
5. Deploy a tenant-authorized server-side file service and asynchronous quarantine scanning pipeline; do not issue GCS signed URLs to a client before authenticated tenant/file ACL checks. Quarantined content must not be indexed, downloaded or supplied to models until scanning passes.
6. Verify cross-tenant denial, malware test file rejection, upload checksum/content-length, signed URL expiry, object deletion/recovery, retention compliance, audit logs and quota enforcement. Set the `gcs_primary` database backend to verified only with evidence.
7. Migrate selected workload with dual-read validation, checksummed copy and reversible feature flag. Only then switch the default.

### Rollback
Turn off GCS writes at the file-service feature gate, retain dual reads, and route new writes back to existing private Supabase buckets. Reconcile in-flight uploads before stopping GCS reads. Never run `terraform destroy` as application rollback. All buckets have `force_destroy=false`.

### Known gaps
This Terraform alone does not deliver the full file API, virus scanning, keyless workload binding, monitoring or tested live GCS service. Their verification is a mandatory production gate. Existing Supabase buckets and original documents remain in place.
