# sandy.chat hosting

Hosting choice: Firebase Hosting (Google Cloud ecosystem) for the public marketing site.
This intentionally deploys only `sandy/index.html`; it **does not** publish
`sandy/app/`, controller tools, configuration files, or backend code.

## One-time activation

1. In the Google Cloud organization, select the intended billing-enabled Google Cloud
   project and add Firebase to it (or create a dedicated Firebase project for Sandy's website).
   Record its actual project ID; do not assume it is the same as Supabase.
2. Enable Firebase Hosting through the Firebase console.
3. With an authorized Firebase CLI login, at repository root:
   `cd sandy && SANDY_FIREBASE_PROJECT=<ACTUAL_GOOGLE_PROJECT_ID> bash deploy-marketing.sh`.
4. In Firebase console > Hosting > Add custom domain, add `sandy.chat`
   and `www.sandy.chat`. Enter *exactly the DNS verification, A/AAAA, or CNAME*
   records Firebase supplies at the domain registrar. Avoid guessing IPs.
5. Wait for Firebase to show certificates as active. Verify both hostnames over
   HTTPS and configure the desired apex/WWW redirect.
6. Set up a CI deployment using Workload Identity Federation or an approved
   restricted service identity after the existing deployment review gate is resolved.
   Do not commit credentials or bypass the deployment gate.

The authenticated portal (`app.sandy.chat`) and future Cloud Run API
(`api.sandy.chat`) are intentionally out of scope. No existing endpoints
or DNS records should be changed until their cutovers are verified.

## Rollback

Firebase console > Hosting > Release history > Roll back to a known good release,
or redeploy the prior Git commit. Keep the existing GitHub Pages site available
until DNS, TLS and route verification complete.
