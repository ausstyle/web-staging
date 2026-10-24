# Supabase canonical review

SANDY-ENG-0005;25 remaining Supabase families reviewed against original PDF5.1–5.3 and existing management, database, service, tenant and credential source. The JSON companion retains registered metadata-read contracts omitted by the source-contract-only inventory, including branch/backup lists, schema object lists, connections/locks and cron jobs. Omitting these reads would understate the family lifecycle.

This is canonical mapping and capability review, not operation implementation certification. Typed SQL support does not establish arbitrary schema/database administration, service SDK support does not establish all tenant/product behavior, and a protected export manifest is not a full content backup.

Concrete retained gaps include logical replication/CDC beyond publication DDL; real backup artifact/restore verification beyond restore points; webhook lifecycle/delivery beyond enable/list; session/token revocation and functional MFA/provider/hooks; signed/large/resumable object transfer; actual Realtime broadcast/reconnect behavior; and Runtime identity/file-writer/custody bindings for protected restore. These requirements remain machine-readable acceptance blockers.

Tenant lifecycle111 shares Runtime/Cloud integration dependencies already recorded in PR270/287 and the Runtime handoff. This review does not duplicate their gateway, database worker, identity mapping or custody store. Existing consent, legal hold, retention, RLS and object ownership remain authoritative. No live SQL, provider call, credential, grant/exposure change, destructive test or deployment occurs.

Tests verify descriptor identity, retention of shared reads/publications and the exact97-family review partition across this and prior batches. All reviewed families retain independent lifecycle/isolation/recovery/evidence obligations; none is accepted by this source review.
