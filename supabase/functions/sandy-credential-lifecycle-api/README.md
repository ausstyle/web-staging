Credential custody uses the existing Supabase Vault extension and the shared
Sandy execution policy. It does not create Auth users, customer sessions,
service accounts, IAM roles or provider plans. Every contract starts unexposed
and unverified. There are no enabled credential targets in the migration.

The canonical gateway must authenticate a normal enabled Controller owner, load
the selected target from `sandy_credential_targets`, and compute
`credentialExecutionScope(target)` before admission. The same helper runs again
inside the handler. The target configuration and scope hashes bind the existing
Supabase project, GitHub repository, GCP project, credential target UUID and
immutable server resource configuration. API keys cannot execute these
operations. The handler consumes the same single-use grant protocol as the other
Sandy provider handlers.

A target has one of four provider kinds: `supabase_edge_secret`,
`github_actions_secret`, `gcp_secret`, or `gcp_service_account_key`. Resource
bindings name a fixed provider secret, or the existing `sandy-computer` service
account. GCP secret names accept only the configured project's ID or numeric
identity. Additional organization, billing, host, service account, token,
audience or URL overrides are absent.

The execution sequence is explicit:

1. Configure and verify a dedicated existing target and consumer probe. Adoption
   can copy an already authorized Vault source into version custody; Secret
   Manager access can import a provider value into encrypted custody. Both
   return opaque version IDs.
2. `supabase.vault.secrets.create_version` stores proposed material encrypted in
   Vault. Its request body is transient; the shared admission and audit store
   its digest. The response does not contain material. Deletion only removes
   unused staged custody versions.
3. A provider rotation claims an immutable preimage, checks the current provider
   state, performs the fixed provider mutation, stores the resulting material in
   encrypted Vault, and returns an acceptance receipt. It retains the prior
   credential and does not activate or revoke it.
4. `system.credentials.provider.verify` performs an actual provider or consumer
   observation and records a separate successful read admission. Secret Manager
   checks CRC32C, the exact version, the material digest and `latest`. A service
   account key signs a short-lived JWT for Google's fixed token endpoint and
   reads the fixed project using the resulting provider token. Edge and GitHub
   secrets use a bound HMAC consumer probe because their APIs hide values.
5. `system.credentials.provider.activate` repeats the current observation and
   changes the custody pointer using a database compare-and-swap. SQL checks the
   exact canonical verification result against the shared admission digest and a
   five-minute freshness limit. Every provider write still finishes as
   `accepted`; this module does not mark a shared mutation job succeeded from
   HTTP acceptance.
6. Rollback requires another approved operation, the captured prior version and
   an unchanged active preimage. GCP keys reactivate the retained working
   material; secret stores write the retained value as a new version and require
   verification and activation again. Revocation is separate and refuses the
   active credential. GCP key disable must also refuse a fresh token exchange.
   Previously issued OAuth access tokens can remain valid until expiry. Secret
   Manager disable must also refuse version access. Deleting a current
   GitHub/Edge secret is not treated as revoking its prior underlying
   credential.
7. `system.credentials.provider.reconcile` uses a separately approved admission
   to inspect an ambiguous attempt. An already staged version is preserved. Lost
   staging of an encrypted source can be recovered after provider observation.
   Key cleanup additionally requires SQL proof that the original source created
   a distinct new key. Adopted and rollback keys are re-observed and staged,
   never disabled. The workflow dispatch has its own database claim; an
   ambiguous dispatch is observed through workflow metadata instead of repeated.

The GitHub fixture workflow only reads `SANDY_ROTATION_TEST_SECRET`, runs on
explicit `workflow_dispatch`, and returns a domain-separated HMAC as job
metadata. It requires neither checkout nor third-party actions. The handler
requires the configured workflow ID, repository, reference, exact run commit,
rotation UUID, successful job, fixed secret-name marker and expected HMAC. A
production secret needs its own reviewed fixed consumer probe; the fixture
cannot verify another secret by changing a request parameter. The Edge probe
requires the internal service identity and a server-only
UUID-to-environment-name allowlist, which is empty by default. It refuses
platform Auth keys and never accepts a caller-selected environment name.

Provider APIs do not offer an atomic transaction with Vault. Mutation inputs
therefore require explicit acknowledgement that provider compare-and-swap is
unavailable. A lost response records `unknown`, blocks blind replay and requires
reconciliation. Source errors never automatically disable a key. A separate
approved reconciliation can atomically claim cleanup of a known newly created,
uncustodied key. That committed claim blocks late staging, activation and
adoption through another target before a single disable dispatch. After an
ambiguous dispatch, later reconciliation can only observe whether that exact key
is disabled; it cannot repeat the write. Unknown creation without a known key
identity requires provider investigation. Adopted and rollback preimages are
never cleanup candidates. Provider key IDs remain safe metadata, while private
keys and tokens remain internal.

Activation changes the encrypted custody pointer. Existing Sandy provider
clients continue to use their established WIF or environment credential
configuration; the module does not silently switch them to service-account key
authentication. A consumer using the custody pointer requires its own explicit,
fixed-target resolver integration. Hidden provider secret stores apply their new
value when the provider accepts the update, so their consumer readback precedes
custody activation.

`scripts/sandy/build_credential_contracts.ts` deterministically regenerates the
small gateway manifest and the migration's disabled registry contracts. It
performs no network or database calls. The gateway and runtime share the exact
target scope implementation and contract hashes.

Current verification is source and isolated-fixture validation: typed contracts,
local cryptographic/provider fixtures, and a Management API transaction ending
in `ROLLBACK` that checks ACLs, default denial and the installed Vault
encryption signature with a disposable noncredential string. No real credential
rotation, workflow dispatch, owner-session integration or positive production
activation is claimed. The separate dependencies are normal Controller
authorization, an approved verified provider fixture/probe, actual provider IAM
and runtime egress; none is inferred missing from an unattempted call.
