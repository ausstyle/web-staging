# Owner-approved workload acceptance

SANDY-ENG-0001/0005, 23 October 2026. Supersedes PR214's password handoff.
No personal password, human refresh token or Owner JWT is stored in GitHub.
The password-collection helper and its workflow binding have been removed.

## Two separate identities

The existing `sandy-engineering-test@sandy-ai.internal` identity obtains normal
short-lived Auth sessions through the existing private issuer. It remains a
non-Owner with zero Controller memberships. No new user or issuer is introduced.

Administrator-read permission is a separate optional policy on the existing
`sandy_engineering_control_grants` record. The release creates **no active grant**
and preserves canary delegation v6. Current v6 provider metadata access is not
treated as administrator impersonation authority.

Only a normally authenticated, currently enabled Owner can call
`sandy_engineering_set_admin_read_delegation`. PostgREST verifies that Owner's
real user JWT, and the database checks `auth.uid()`, role and live Auth session.
The service role cannot execute this setter or insert/update the policy column.
The workload cannot establish or expand its own grant. The Owner audit event is
append-only, and a trigger prevents service/workload forgery of this receipt.
An existing database account/role establishes identity and eligibility; it does
not itself establish a currently authenticated Owner session.

## One-time establishment through normal sign-in

After the forward release and normal Pages publication are verified, open:

**https://ausstyle.github.io/web-staging/sandy/app/engineering-delegation.html**

An existing normal Sandy session is reused on that origin. Otherwise enter your
existing Sandy Owner email and use **Email me a sign-in link**; open the link on
the same device. No new account is created. Review the fixed scope and expiry,
then select **Establish or renew read delegation**. The browser passes its normal
user token directly to the Owner-only authorization RPC; it is not exported to
GitHub, the engineering workload, chat or browser developer tools.

The scope is fixed: administrator impersonation for read-only verification of the
existing Sandy Cloud Run identity, `sandy-video`, `sandy-windows` and both IAP
tunnel policies in `elaborate-haven-511518-a5`. It permits no IAM writes, agent
enrolment, infrastructure creation or traffic changes. Limits are zero declared
cost units and two requests/minute. Expiry is mandatory and at most 30 days,
bounded by the parent grant. The page defaults to seven days. Renewal or scope
expansion is an Owner operation; routine execution within the active grant does
not need another Owner login. Revision checks prevent stale updates.

Use **Revoke read delegation** to invalidate it. Revocation leaves canary v6 and
other permissions untouched. Parent identity/control-grant revocation, Owner role
removal, session retirement or credential-epoch rotation also blocks execution.

## Workload execution and evidence

Sandy MCP continues to invoke `engineering.preflight` with exactly
`{"connection":"sandy-gcp-admin"}`. No new operation or generic URL executor is
added. Discovery includes this operation only when the distinct grant resolves.
Gateway and Control retain the actual workload bearer token. Admission and the
Google-signed runtime callback independently recheck the workload session, epoch,
grant revision, current Owner authority, expiry, target boundary and zero budget.
One-use admission prevents replay. The same existing runtime worker supplies
short-lived impersonation and five fixed provider reads; no new Cloud Run
candidate is needed.

Acceptance reads the protected Owner authorization event independently, then
issues a **workload** session, verifies zero Controller memberships, verifies that
the workload cannot call the Owner setter, executes normal MCP discovery/call,
checks administrator token expiry and both actual IAP receipts, and retires its
workload session. Owner authorization evidence and workload execution evidence
are separate fields. An absent Owner authorization yields a precise policy
blocker; it never becomes a fake Owner session or an implicit approval.

GitHub environment reviews have been removed by the owner. Releases still use
main-only workflows, CI, full module digests, fixed targets, serialized leases,
source-preservation artifacts and independent installed-source readback. This
does not bypass Controller policy.

## Release and recovery

`sandy-admin-delegation-release.yml` applies only new migration `20261023170000`
and four explicitly reviewed modules across Control/API. It does not rerun the
installed migrations, change worker binding, IAM, grants, enrolment or traffic.
`sandy-gcp-admin-acceptance.yml` is acceptance-only and contains no installer.
The original Owner-only API and one-use admission RPCs remain available.

Before changes, original bundles, metadata and the complete manifest are saved
in the release artifact's `source-preservation` directory. Recovery must first
compare live source with that manifest, restore only the captured Control/API
modules with original JWT settings, and verify all original module digests.
Retain the additive policy schema/audit protections on source rollback; never
erase authorization history or replay migrations. Rollback artifacts and a
validated recovery path are not a claim that a production rollback was exercised.

If PR214's obsolete `SANDY_OWNER_ACCEPTANCE_CREDENTIAL` was ever configured,
delete it in GitHub Settings → Environments → sandy-production → Environment
secrets. The new workflow never reads it. Normal account recovery applies if an
Owner password was disclosed; this release does not reset that password.
