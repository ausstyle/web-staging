This handler implements the managed guest capabilities in requirements 35–44. The canonical operation IDs and exact specification-family mapping are in `contracts.json`. `gcp.vm.ssh.exec` and `gcp.vm.winrm.exec` return explicit unsupported-transport errors: an OSConfig policy or a managed-agent task is not represented as an SSH/WinRM connection.

The reviewed catalog contains existing Windows instance 8120150462304566315 and video instance 6831598645020395570 in project `elaborate-haven-511518-a5`, zone `europe-west1-b`, with the dedicated `sandy-vm-runtime` service account. Catalog entries begin disabled. Existing desktop automation is preserved. Historical Windows GUI agent heartbeats do not prove this managed worker is installed.

The API gateway must authenticate the actual Controller user, require an enabled owner, and obtain an exact shared execution admission. Requests to this internal function carry the service identity plus server-derived actor/request/grant fields. Customer sessions, administrative project credentials and API-key principals are never interchangeable. Delegated keys and non-null tenants are refused. Mutation and sensitive-read contracts stay unexposed/unverified until a real approved test can establish evidence.

For a guest operation with `arguments.vm_name`, the canonical gateway uses `guestExecutionScope(vm_name)` and the contract hash from `guestOperations`. The safe `gcp.vm.tasks.get` receipt uses scope `{provider:"gcp_guest",project_id:"elaborate-haven-511518-a5",receipt_actor_id:<verified actor UUID>}`. Both identifiers are fixed server values, never caller-selected hosts or SSH credentials. All Compute methods use the immutable numeric instance ID; the pinned discovery parameter pattern in `compute_instance_binding.json` explicitly permits this form. The handler consumes the grant once. Queue acceptance returns `accepted:true,executed:false`; receipt queries never redispatch.

Guest v2 resolves the current GCP credential consumer only after consuming the exact owner admission. The resolver rechecks the current owner, registry and provider scope; an active-key refusal cannot fall back to the existing WIF identity. Queue/status operations and the VM worker's separate metadata identity do not acquire this Compute credential. Apply credential-consumer migration `20261021006100` before deploying this cutover. Configuring the Ed25519 signer alone does not enroll a VM, dispatch a task or run startup code.

Required deployment configuration:

- Preserve Edge `verify_jwt=true`, `SUPABASE_URL`, the service-role binding and public `SUPABASE_ANON_KEY`.
- Securely configure `SANDY_GUEST_ED25519_PRIVATE_KEY_PKCS8_B64`, `SANDY_GUEST_ED25519_PUBLIC_KEY_SPKI_B64`, and `SANDY_GUEST_SIGNING_KEY_ID`. The private value is an Ed25519 PKCS8 DER key encoded as base64. The public value is its SPKI DER counterpart. The function checks the pair before claiming a task. Never store the private value in the repository, VM metadata, logs or chat.
- The installer rejects untrusted existing path ownership, writable ACLs/modes and reparse points/symlinks, then establishes private System/Administrator or root permissions. Actual Windows installer execution remains untested until an approved VM fixture is available. The worker needs Node 22 or later, a writable persistent private journal and a managed file directory. Linux uses systemd and the configured apt/dnf/service/firewall tools; Windows uses the existing Node installation, Task Scheduler and typed PowerShell service/firewall commands. Winget must already be installed/configured if selected; this API does not accept provider or package terms automatically.
- Google identity verification requires the official Google JWKS endpoint. VM transport retains the public anon JWT in `Authorization` and sends a Google-signed full metadata identity token in `x-sandy-vm-identity`. Audience is the exact function URL; project, zone, instance ID, verified service-account email, current generation, signing public-key hash and worker digest must match the enrollment. This is VM authentication, not a Controller session.
- A normal authenticated owner must approve and verify the exact enrollment/install contract using the existing engineering/deployment approval path. There is no alternative enrollment bypass. Install/update code reads the actual Compute instance and stages a checksum-pinned startup program only if the approved metadata fingerprint matches. It refuses to overwrite an unrelated existing startup script. HTTP acceptance does not prove metadata staging: an operation error is rejected, and the exact metadata payload must be read back before `metadata_staged:true`. Staging does not prove installation; startup execution and a fresh authenticated worker heartbeat remain required. No VM staging, installation, package operation, firewall change or reboot was performed while implementing these files.

The worker accepts signed tasks for files, named packages, services, owned firewall rules and delayed reboot. Files stay inside the private managed file root; traversal and symlinks are refused, with a 64 KiB limit and SHA-256 readback. Package changes require inventory readback before completion. Service changes require the observed target state. Firewall removal only affects a persisted rule owned by this worker. A scheduled reboot remains accepted until the same authenticated VM reports a different boot identity. This is trusted VM evidence, not measured-boot software attestation or an independent provider guarantee.

An execution-start CAS and a persistent intent journal precede all guest effects. Expired claims/running leases become unknown and are never requeued. Lost completion replies retry only the durable receipt. Accepted/unknown outcomes require reconciliation. Revocation cancels queued work and blocks future starts; it cannot undo an OS operation that already started. Shared mutation admissions remain accepted pending the independent readback policy, even when the guest receipt records a trusted VM result. Audit events contain digests and IDs only. Final reboot-readback receipts identify their digest serialization as `pg_jsonb_v1`; worker results use `canonical_json_v1`.

Validation commands:

```sh
deno test supabase/functions/sandy-guest-operation-api/index_test.ts
node --test supabase/functions/sandy-guest-operation-api/worker_test.mjs
python3 supabase/functions/sandy-guest-operation-api/generate_contracts.py
```

`test_database.sql` is a complete rollback component suite. Apply the new migration and the test together inside one enclosing rollback transaction for predeployment validation. Its owner/membership/enrollment/receipt fixtures are synthetic. It creates no Auth user/session, contacts no VM and makes no claim that the positive real mutation approval or actual provider path was tested. Keep those distinctions in registry evidence. Regenerate the manifest, bundled worker and SQL registry fragment after changing worker source; its SHA is part of every contract.


Managed-worker update handoff (22 October 2026): the installer stops the existing
marker-verified Linux unit before replacing code/configuration, then enables and
starts it. Windows first verifies the existing scheduled task's exact executable,
arguments and SYSTEM identity, requests stop and waits up to 30 seconds before
replacement/re-registration. An unrelated task/unit or unconfirmed stop fails
closed. The durable journal is retained; interrupted jobs are reconciled rather
than replayed. This prevents an old enrollment remaining in a running process
while a new configuration is staged. The isolated shell fixture covers successful
update, failed stop and preservation of an unrelated service. Windows generated
script contracts are checked, but actual Windows task execution and fresh VM
heartbeats remain unverified until legitimate enrollment/connectivity is available.
