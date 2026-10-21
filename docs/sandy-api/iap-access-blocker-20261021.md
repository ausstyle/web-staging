# Existing VM access blocker — 21 October 2026

The IAP relay returned4033 (`NOT_AUTHORIZED`) before either guest login. Required tunnel permission is `iap.tunnelInstances.accessViaIAP`. The exact missing binding/condition cannot be determined: the current service account receivesHTTP403 from both IAP policy reads and permission inspection. There are no configured separate Google Cloud admin identities in this Codex environment.

Principal: `sandy-computer@elaborate-haven-511518-a5.iam.gserviceaccount.com`  
Project: `elaborate-haven-511518-a5` (`1030223524306`)  
Zone: `europe-west1-b`; observed numeric zone ID `2101`.

| VM | Immutable instance ID | IAP port | IAP policy resource |
|---|---|---:|---|
| sandy-video | `6831598645020395570` | 22 | `projects/1030223524306/iap_tunnel/zones/europe-west1-b/instances/6831598645020395570` |
| sandy-windows | `8120150462304566315` | 5986 | `projects/1030223524306/iap_tunnel/zones/europe-west1-b/instances/8120150462304566315` |

The WebSocket endpoint is `wss://tunnel.cloudproxy.app/v4/connect`, with the fixed project, zone, VM name, nic0 and port above. No session SID was issued by the denied attempt. OS Login permission is confirmed on Linux. Compute instance policy-writing permission does not authorize an IAP policy change.

The smallest candidate repair is to add `roles/iap.tunnelResourceAccessor` for this service-account member on each individual IAP VM resource, constrained by `destination.port == 22` or `destination.port == 5986`. An existing authorized IAP policy operator must first inspect the current policy and conditions. Preserve version3 policies, unrelated members, conditions and etags; do not blind-replace a policy or grant Sandy IAP policy administration. If an existing restriction is the cause, it requires the applicable operator decision. No IAM change was applied because the IAP policies are unreadable with the available identity.

Windows is RUNNING. Its guest reports show agent `connected` at `2026-10-19T23:43:45Z` and setup `installed` at `2026-10-19T23:46:12.1698889Z`. Its metadata bootstrap registers an interactive-logon agent and lacks a PowerShell command branch. This does not establish whether the current disk file was later updated or why its process stopped. No reboot, forced login, password reset or security change was made. WinRM reachability/authentication cannot be tested past the IAP denial.

Backend66 is ACTIVE from `1999fe2`, with all16 uploaded sources accounted for. Intermediate64/65 are also source-attested. Sandy API31 and MCP14 remain in place; no new operation was added. Native execution activation, approved host/certificate enrollment and scoped test authorization remain separate application prerequisites. Linux/Windows/graphical acceptance stays0/3.

A separate real, authenticated MCP→Sandy API→Supabase log query passed: HTTP200, provider200, executed=true, one expected fixture marker, admission `5eaba260-b43f-402c-b40a-565a5bbf5d04`. The dedicated renewable workload identity was used; no personal Controller token was reused. This is a scoped engineering regression, not whole-family certification.

The broader programme continues with source delivery, durable jobs/recovery and domain/provider activation using existing adapters. The IAP blocker does not block those components. See the [full family matrix](requirement-coverage-161.md), [status](implementation-status.md), [actual diagnosis and proposed repair](iap-access-blocker-20261021.json) and [MCP receipt](engineering-logs-mcp-regression-20261021.json).
