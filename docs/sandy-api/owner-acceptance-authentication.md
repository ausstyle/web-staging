# Renewable Owner authentication for administrator acceptance

SANDY-ENG-0001/0005 implementation, 23 October 2026. This changes acceptance
tooling, not the deployed Owner-only API, grants or provider IAM.

## Supported mechanism and custody

The existing enabled Owner account has a password configured. Project Auth
supports email/password login; its access-token lifetime is 3,600 seconds. The
read-only configuration inspection found no verified MFA factor on that account.
These observations establish availability, **not successful Owner sign-in**.

The protected, main-only `sandy-gcp-admin-acceptance.yml` obtains a new normal
Supabase Auth session with the **existing Owner email and password** for each
run. It does not reuse `SANDY_CONTROLLER_ACCESS_TOKEN`. This is not a narrowly
scoped provider credential: an Owner password is sensitive Owner authority.
Custody is limited to the existing protected `sandy-production` environment and
reviewed acceptance code. Do not put the credential in the engineering runtime,
ordinary repository secrets, source, chat, artifacts, browser developer tools or
command arguments. The workflow has no environment-secret write permission and
cannot establish or extend its own credential-use window.

The Owner-operated helper verifies normal sign-in and the pinned existing Owner
identity, signs out its bootstrap session, and independently checks that its
refresh token is rejected. It then passes a bounded-use credential directly to
`gh secret set` over stdin. GitHub encrypts that environment secret. No JWT or
refresh token is saved; no password reset, new identity, role assignment or
workload delegation occurs. The helper refuses to run in GitHub Actions or the
Management-credential-bearing engineering environment.

The default use window is 24 hours, with an explicit maximum of seven days.
Fresh sessions renew automatically within that window, including when a token
nears expiry during acceptance. An expired window fails before provider reads.
Renewing the window requires the Owner's helper again; the workload cannot renew
its own authority. The password's actual validity is controlled by normal Auth;
the window is an acceptance client restriction, not a server-side scoped-password
feature. Do not mistake secret deletion for revoking a copied Owner password.

## One-time Owner sign-in and secure handoff

On **your own computer**, with Python 3 and GitHub CLI installed:

1. Sign in to GitHub through its supported browser/device flow:
   `gh auth login --web --hostname github.com`. Use your repository administrator
   account with permission to manage `sandy-production` secrets. Do not give this
   permission to Sandy's engineering workload.
2. In your `ausstyle/web-staging` checkout, update to the reviewed merged `main`.
3. Run:

   ```sh
   python3 scripts/sandy/configure_owner_acceptance.py --hours 24
   ```

4. Enter your **existing Sandy Owner email and password** at the local prompts.
   Password input is hidden. This authenticates against the project's normal
   `/auth/v1/token?grant_type=password` endpoint. No browser developer tools,
   JWT extraction, credential file or chat handoff is involved.
5. After the command reports that the protected binding was saved, tell the
   engineering task only: **“Owner acceptance binding is available.”**

The exact destination is GitHub repository **ausstyle/web-staging → Settings →
Environments → sandy-production → Environment secrets →
SANDY_OWNER_ACCEPTANCE_CREDENTIAL**. The helper creates its structured value;
do not manually assemble it or paste a JWT there. Existing GitHub environment
protection remains in force. This authentication does not approve a deployment.

If you do not know the existing password, stop rather than resetting it for this
test. The existing web sign-in is
`https://ausstyle.github.io/web-staging/sandy/app/` and supports email links and
passkeys. That web session is not automatically transferred into GitHub. Under
the current no-deployment restriction, there is no already-installed secure
browser-session broker that can create separate renewable, retired-per-run
Owner sessions. A browser sign-in alone is therefore not claimed to activate
this workflow. If MFA is enabled, this implementation fails closed rather than
weakening or disabling MFA.

## Verification, retirement and audit

Before MCP access, acceptance independently verifies `/auth/v1/user`, the pinned
Owner identity, confirmed email, absence of workload metadata and current enabled
Owner membership. A read-only Management query verifies membership and MFA state;
the Management credential is never a user bearer token. The deployed API repeats
normal Owner authorization. Fresh access tokens remain in memory, are masked in
GitHub and are never artifact fields.

On success **or failure**, `finally` signs out only the session created by that
run with `scope=local`, then independently checks `auth.sessions` through a fixed
read-only Management query. Retirement failure makes acceptance fail. Logout
revokes the refresh session; existing access JWTs may remain valid until expiry.
Abrupt runner termination can prevent cleanup; a cancelled or missing receipt is
an unknown cleanup outcome, never proof of retirement. The normal one-hour JWT
expiry still applies; this tooling does not alter project-wide Auth settings.

The safe artifact records source commit, GitHub run/attempt, login status, Auth
verification, current membership, expiry, retirement status/readback, exact
administrator token expiry, runtime identity and five fixed provider receipts.
GitHub retains the credential configuration/protection audit. Normal Auth retains
authentication audit and the deployed one-use admission ledger retains execution
receipts. No new parallel audit service or database migration is introduced.

## Acceptance, rotation and revocation

Once the Owner binding exists, run exactly one **Accept installed Sandy
administrator connection** workflow (`sandy-gcp-admin-acceptance.yml`) on `main`.
It reconciles installed source and unchanged traffic, performs authenticated MCP
discovery/call, verifies short-lived runtime-to-administrator impersonation and
both fixed VM IAP policy reads, and checks retirement. It contains no installer,
function deployment, migration replay, IAM/grant write, enrolment or promotion.

Rotate the binding by running the helper again with the current normal password
and a new bounded window. If the account password changes through its normal
security flow, the old binding fails closed; this tooling does not change it.
To revoke future acceptance sign-ins:

```sh
python3 scripts/sandy/configure_owner_acceptance.py --revoke
```

That deletes only this environment binding. Existing job sessions still require
their normal cleanup/expiry. For suspected password compromise, use the normal
account recovery/security process to rotate the password and revoke sessions;
removing the GitHub binding alone is insufficient. Disabling Owner membership,
disabling the workflow or expiration also blocks new acceptance execution.

Recovery is to restore a legitimate binding through the Owner-operated helper;
there is no service-role, generated-login-link, role-grant or expired-JWT fallback.
Production traffic stays unchanged until all independently required gates pass.
