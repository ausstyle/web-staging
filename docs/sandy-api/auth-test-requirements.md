# Authentication requirements for Sandy integration tests

**23 October 2026:** administrator acceptance uses separately verified genuine
Owner delegation and the existing renewable non-Owner workload identity. Personal
Owner-password/JWT custody is prohibited. See the [Owner authorization and
workload acceptance runbook](owner-acceptance-authentication.md). Installation does
not establish a grant or prove administrator/IAP execution.

Current checkpoint: 21 October 2026 UTC. The permanent dedicated engineering identity
uses source `97bd825` (latest observed metadata runtime **13**), normal Supabase Auth verification and renewable short-lived
user sessions. Its bootstrap credential stays in Vault; it has **zero Controller
memberships**. The personal Controller token is not used for successful tests.
The existing six-operation fixture delegation remains unchanged. A separate,
revocable owner-approved VM read scope permits ten fixed-target reads, including
canonical `gcp.compute.instances.get` for `sandy-video` through the shared provider
engine. Another VM, project override and command input are refused before admission.

Broader owner-only acceptance needs a genuinely approved, target-specific workload
delegation or a current normal owner session. Existing fixture or VM authority
does not grant other provider operations. Do not fabricate an owner approval,
assign the workload global Controller ownership, or send a service-role key as a
customer session. Additional workload-scope implementation and owner consent are
separate from token renewal, which is operational. See the actual positive and
revocation evidence in `canonical-vm-read-MCP-evidence-20261021.json` and
`canonical-vm-read-denial-evidence-20261021.json`.

Current normal-Auth acceptance also passed bounded REST/MCP log execution and real GitHub/test-migration writes without a personal Controller token. See `REST-log-MCP-evidence-20261022.json` and `engineering-write-MCP-evidence-20261022.json`. Two fresh normal customer fixtures verified scoped reads and denials; see `customer-service-MCP-evidence-20261022.json`.

The following sections preserve the original 20 October source review. Statements
about unavailable Auth egress or an absent renewable identity are historical;
they do not describe the current deployed runtime.

## Controller tests

The Controller uses normal Supabase user authentication. The application in
`sandy/app/index.html` requests an email link with
`signInWithOtp({ options: { shouldCreateUser: false } })` and refreshes an
existing session through the Auth client. The production Auth configuration has
email authentication enabled, email confirmation required and a 3,600-second
access-token lifetime. No noninternal trigger is installed on `auth.users`.

After Auth verifies the user's access token, `sandy-operation-api` independently
requires an enabled `public.sandy_controller_admins` membership for Controller
operations. Owner operations additionally require the owner role. Management API
access provides neither a Controller session nor this application membership.
There is no supported Management API endpoint that turns its management token
into a customer or Controller user token.

The remaining credential for existing-owner integration tests is an unexpired
access token from the normal login or refresh flow of an already enabled owner.
Store it securely as `SANDY_CONTROLLER_ACCESS_TOKEN`; never put it in a report or
chat. Initiating the email-link flow sends an email and therefore requires the
user's explicit instruction. Do not generate a sign-in link for an existing user
administratively, forge a JWT, reset an existing password, add owner membership
to a test user, or use a service-role key as a user bearer token.

## Existing Google Cloud machine identity

Cloud Run deployment does not inherently require a human Controller session.
The existing `_shared/sandy_machine_identity.ts` implements a separate dedicated
machine flow: it resolves only `sandy-gcp-machine@sandy-ai.internal`, requires its
unique Auth identity and `app_metadata.sandy_gcp_machine === true`, verifies the
issued machine session through Auth, exchanges it with Google STS using the
configured workload-identity audience, and requests a short-lived IAM Credentials
token for the configured Sandy service account. Its requested access-token
lifetime is 1,800 seconds. This dedicated machine flow must not be reused to mint
an existing human owner's session or to grant customer access.

The execution machine currently cannot reach the project Auth hostname because
the managed network proxy rejects that destination. No independent local Google
ADC credential is configured. Those machine-identity/egress and provider-IAM
requirements are separate from the missing human Controller test session. A
SQL relay, Edge relay, IP override or alternative proxy is not an authorized
replacement for the published runtime network configuration.

## Independent tenant tests

A separate, dedicated synthetic identity can exercise tenant authorization
without an existing owner's session. The supported sequence, once the project
hostname is reachable, is:

1. Use Supabase Auth's server-side admin `createUser` operation for a fresh,
   clearly synthetic identity with a random password and `email_confirm: true`.
   This must be a new test identity, never an existing customer's identity.
   Keep the password and administrative credential in memory and send no mail.
2. Obtain its user session through the normal password grant
   (`/auth/v1/token?grant_type=password`). Use the returned user access token in
   Sandy requests. A successful grant, rather than possession of a project key,
   establishes the authenticated test user.
3. Map only this identity's email to its dedicated synthetic customer through
   enabled `sandy_agenda_access`. The gateway and existing tenant handler both
   use this directory and ignore caller-supplied tenant identity. Give the test
   identity no Controller membership or external integrations.
4. Test positive reads, missing-resource responses and cross-tenant denial with
   two isolated synthetic customers. Revoke/sign out the sessions and delete the
   test users and fixture rows afterward, checking that cleanup completed.

The project service-role key may be used internally for this supported test-user
provisioning operation. It must never be sent to Sandy API as a successful
customer session. `scripts/sandy/verify_deployed_api.py` includes a separate
negative check that the gateway rejects a service key as a user identity.

## Fixture side effects

Production inserts have triggers, so default customer/task inserts are unsafe
for passive read tests. The read-only trigger and constraint inspection found:

- `email_customers.google_drive_folder_status` permits `excluded`. Use that
  explicit value for a synthetic customer. The default `pending` value enqueues
  Drive provisioning when no folder ID is present.
- Customer insertion creates memory settings with learning and proactive work
  disabled. The settings trigger seeds life spaces only when learning is enabled
  and consent exists. Do not enable either setting for a fixture.
- Task insertion with `source_kind` equal to `manual`, `web`, `web_instant` or
  `agenda` enqueues analysis and can dispatch a real worker HTTP request. Use an
  explicit synthetic source such as `integration_test`; the current schema has
  no source-kind CHECK allowlist. Recheck this invariant before insertion.
- Use `metadata = {}`, `status = 'todo'`, null parent/company/category,
  null waiting/review/scheduling fields, and no dependencies. These choices avoid
  mission work, reply reminders, dependency-unblocked work and life contexts.
  Task audit and a local temporal fact are still written. No noninternal trigger
  was found on those derived tables during this review.
- Delete tasks before customers, and verify removal of the created audit,
  temporal, memory and access-directory rows. Temporal facts use textual entity
  IDs and must be checked explicitly; customer deletion alone is not sufficient
  evidence of cleanup. Never disable production triggers to seed fixtures.

These are preconditions for a dedicated fixture runner, not evidence that a
tenant test passed. Reinspect trigger definitions, constraints and cleanup
dependencies immediately before any future production fixture run. The current
project-host proxy denial prevents Auth and deployed Sandy requests; it does not
prevent independent engineering, migrations or Management API tests.

## Memory Portal authorization and passive reads

Memory Portal authorization is independent of Agenda and Controller access.
The deployed `sandy-memory-centre` verifies a confirmed Auth user, an unrevoked
`sandy_memory_portal_accounts` row for that user's `auth_user_id`, and equality
between the user's lowercased email and that customer's primary
`email_customer_addresses.normalized_email`. Every resource query is scoped to
the resulting customer. The canonical gateway retains all three checks and
forwards the actual user JWT so the backend repeats its own authorization.
Neither Controller membership nor `sandy_agenda_access` grants memory access.

The nine registry entries labelled as memory reads have different effects:

| Operation | Reviewed backend behavior | Canonical forwarding |
| --- | --- | --- |
| `memory.overview` | Tenant snapshot queries | Installed |
| `memory.tree` | Tenant subject and fact-link queries | Installed |
| `memory.evidence` | One active tenant archive source by UUID | Installed |
| `memory.life_brief` | Fixed STABLE, security-invoker SQL summary, consent-aware | Installed |
| `memory.life_spaces` | Tenant life spaces/document suggestions and public area catalogue | Installed |
| `memory.ask` | Can create a task from a natural-language instruction; otherwise invokes embedding and response models and writes audit | Omitted pending a correctly classified, bounded contract |
| `memory.biography` | Invokes response models and writes audit | Omitted pending explicit model consent/cost bounds |
| `memory.search` | Invokes an embedding model and writes audit | Omitted pending explicit model consent/cost bounds |
| `memory.life_search` | Invokes an embedding model | Omitted pending explicit model consent/cost bounds |

The five passive operations use fixed query actions and a JSON body of `{}`,
except `memory.evidence`, which accepts exactly `{ "id": "<uuid>" }`. No tenant,
action, settings or confirmation field may be forwarded from callers. Their
version 1.0.0 registry contracts are in migration
`20261020220000_sandy_passive_memory_read_contracts.sql`; exposure flags and
existing verification evidence are preserved. Installed source dispatch and
unit tests do not establish deployed, authenticated integration verification.
The shared backend may record an error if a read fails; none of the successful
five paths invokes a provider model or changes customer data.

API and AI exposure flags are independent. An installed contract with
`api_exposed = true` and `ai_exposed = false` remains available through the
authenticated API, subject to its normal role, tenant and verification gates.
MCP discovery omits it and direct MCP execution is denied by the API channel
check. No exposure or verification flag is changed by this separation.
