# SANDY-ENG-0014 — My Voices: Consent-based Personal Voice Cloning

Version 1.0 · 24 October 2026 · Status: IMPLEMENTING — not end-to-end verified.
Priority P2 · Portal owned by 0009; media adapter by 0008; API/release boundary by 0005.
Parent: [Master Software Scope](../master-scope-v1.md) and [Architecture contracts](../architecture-contracts.md).

## Goal and limitations

A signed-in customer can record their own voice, speak an exact provider consent phrase, supply a separate matching reference sample, submit both to OpenAI, preview the accepted custom voice, select the saved voice, and revoke/delete it. Third-party uploads are prohibited; a separately verified speaker-shared voice capability is a future scope. Personalisation changes the vocal sound, never Sandy's identity, policy, memory permissions or intelligence.

## As-built 24 October 2026

- Database: production migration 20261024030000_sandy_my_voices_v1.sql applied in Supabase zmqlyygzqoidkcwdysok. Tenant-owned rows are accessed only through service-role backend, with no raw audio stored in Sandy's tables. Selected voice uniqueness and idempotent request identifiers are enforced in the database. Audit events record lifecycle outcomes.
- Backend: sandy-my-voices Edge Function v2 ACTIVE, verify_jwt=true. Authenticated user resolved against existing non-revoked sandy_memory_portal_accounts membership; never trusts a customer identifier from the browser. Consent and sample sent to OpenAI only for a specifically requested action. Unknown create outcomes block new creations pending reconciliation. Revocation first removes selection, provider deletion errors remain pending; a provider HTTP 404 is not proof of deletion.
- UI: sandy/voices/index.html, with two-step mic recording, explicit self-consent, voice names, list, previews, select, standard Coral fallback and revoke. Linked from sandy/app/index.html sidebar and services card. Frontend remains feature-branch source pending verified GitHub Pages publishing.

Existing sandy-voice-call remains ACTIVE v40 and unchanged. Its deployed source cannot be recovered via current connected Edge Function inspection and is not in the matching repository path. A bounded Sandy Rooms frontend change now resolves a selected voice for the signed-in host before the session update, falling back to Coral for missing access/errors. This code has not yet been published or tested in a real call; the direct browser voice-call service remains unchanged.

## Required integration before live calling

1. Recover and parity-check the exact live sandy-voice-call source and Sandy Rooms session setup, preserving transcription, memory, tools, authentication and existing failure handling.
2. On new Realtime session creation only, resolve the authenticated tenant's ready, selected, non-revoked, provider-accepted profile and supply the provider voice object at session setup. Use the existing Coral voice if no eligible profile; never allow arbitrary client-provided voice IDs.
3. Close/restart active sessions when a change requires a new voice; propagate revocations to ongoing sessions.
4. Route exported voice operations through canonical Sandy API and operation policy; do not make the new Edge function an alternate privileged provider gateway.
5. Check OpenAI project custom-voice eligibility and organisation quota, and conduct an explicitly authorised end-to-end test with the speaker's own sample and deletion/readback.

## Acceptance gates and status

| ID | Requirement | Status |
| --- | --- | --- |
| MV-01 | SQL applied and tenant-sensitive records locked down | Migration confirmed; privileges review pending |
| MV-02 | Anonymous, mismatched tenant and revoked portal membership rejected | Implemented; live negative tests pending |
| MV-03 | Separate microphone consent and sample, self-consent required | Implemented; browser test pending |
| MV-04 | Real OpenAI provider consent/creation accepted | Not tested; provider entitlement and user sample unknown |
| MV-05 | Correct voice preview audible | Implemented; untested with a custom voice |
| MV-06 | Selected voice actually spoken in new Sandy calls | Rooms session selection coded, not published or audibly tested; direct browser call adapter not integrated |
| MV-07 | Revocation immediate; provider deletion separately evidenced | Implemented; deletion tests pending |
| MV-08 | Duplicate creates and uncertain outcomes contained | Guarded; stress test pending |
| MV-09 | Existing Coral default and existing calls preserved | Additive backend only; regression test pending |
| MV-10 | Customer browser/mobile acceptance and published page | Frontend coded; publish/acceptance pending |

## Consent and rollback

The speaker must use the official spoken English OpenAI consent phrase. Browser recordings are transmitted only for the user's enrollment request; Sandy does not persist audio from this workflow. OpenAI's own storage and retention terms govern the provider copy. No voice is attributed to a different person, and there is no anonymous enrollment.

Roll back frontend navigation and disable the new Edge Function if required. Keep provider IDs, pending deletion records, and audit history for reconciliation; never silently drop database tables with external voices outstanding. Code deployed and an API status response are insufficient evidence of successful real-world speech synthesis or deletion.
