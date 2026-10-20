# Sandy API scope — 161 requirements

Source: original *Sandy API Function Inventory* and *Sandy Autonomous Control API Specification*, v1.0 (20 October 2026).
Each numbered entry is a **requirement or function family**, not necessarily one callable endpoint. Implement provider-supported operations with specific typed contracts. Confirm the full PDF context before interpreting wildcard families. The runtime registry is `public.sandy_operation_registry` in Supabase `zmqlyygzqoidkcwdysok`.

## Mandatory universal API and MCP architecture

**Normative requirement, applies to all 161 scope items and every expanded sub-operation.** Every action Sandy supports—customer-facing, internal, administrative, engineering, infrastructure or third-party integration—MUST have a uniquely named, versioned Sandy API operation with a documented input/output contract and an actual server-side implementation. Wildcard function families MUST be expanded into discrete callable operations. This requirement also applies to future Sandy functionality.

**Execution path:** ChatGPT / other MCP clients → Sandy MCP → Sandy API gateway → authorized Sandy API handler → Supabase, GitHub, Google Cloud, Microsoft Graph, Composio or other provider. Sandy MCP MUST be an adapter for discovery, schema translation, authentication context and invocation of Sandy API; it MUST NOT independently implement provider operations or use a parallel privileged deployment path. Internal Sandy applications and agents MUST use the same Sandy API contracts for supported operations (shared libraries may call the gateway or the same centrally governed application service, without duplicating business rules).

**Canonical catalogue:** `public.sandy_operation_registry` in Supabase project `zmqlyygzqoidkcwdysok` is the authoritative runtime source for operation identifiers, schemas, handler mapping, permission requirements, dependencies, implementation status, deployment version, test evidence and MCP exposure. Sandy API serves catalogue/discovery endpoints from this registry; Sandy MCP must dynamically discover or synchronize from those API endpoints with version/change detection, rather than maintain a divergent hard-coded allowlist. Registry entries alone do not establish executability: only an installed, permitted, healthy handler may execute, and only tests with evidence can mark an operation verified.

**Universal operational contracts:** For each operation provide identity/tenant scope, required authorization, provider prerequisite, typed schema, synchronous or durable asynchronous execution, idempotency, structured errors, progress/result, audit trail, cancellation/retry/rollback where meaningful, rate/cost controls, and test cases. Provider-specific restrictions and approvals still apply. Unauthorized, unsupported or unverified mutations MUST fail closed rather than acknowledge success.

**Platform-wide acceptance gates:**
1. Each of the 161 scope entries maps to one or more concrete Sandy API operation IDs; every constituent provider action in a wildcard family is accounted for.
2. Sandy MCP offers corresponding callable tools whose execution traverses Sandy API, with no independent provider-execution implementation.
3. All customer applications, Controller, agents, Examiner and engineering services discover and use the same operation contracts, with migration/compatibility tests for any legacy direct calls.
4. A real provider-side readback or functional test demonstrates outcome; changes are version-controlled, deployed and recorded in the canonical registry.
5. No missing, placeholder or registry-only operation is counted as implemented or verified.

## Core orchestration (1–11)
1. GET /v1/capabilities — executable operations, scopes and verification.
2. GET /v1/capabilities/{operation} — schema, handler and required grants.
3. POST /v1/operations/{operation}:execute — synchronous/asynchronous execution.
4. GET /v1/jobs/{jobId} — status, provider request IDs and result.
5. GET /v1/jobs/{jobId}/events — structured progress events.
6. POST /v1/jobs/{jobId}:cancel — cancel eligible job.
7. POST /v1/jobs/{jobId}:retry — retry idempotent failed steps.
8. POST /v1/jobs/{jobId}:rollback — verified compensation.
9. GET /v1/audit?resource=... — tamper-evident audit.
10. POST /v1/plans:validate — dry-run, permissions, cost and blast radius.
11. POST /v1/plans:execute — multi-service dependency graph.

## Google Cloud organization (12–25)
12. gcp.organizations.list/get
13. gcp.folders.list/create/move/delete
14. gcp.projects.list/get/create/update/move/delete/undelete
15. gcp.services.list/enable/disable
16. gcp.quotas.get/request
17. gcp.iam.policy.get/set
18. gcp.iam.roles.list/create/update/delete
19. gcp.serviceAccounts.list/create/update/delete
20. gcp.serviceAccounts.keys.rotate
21. gcp.workloadIdentity.configure
22. gcp.osLogin.grant/revoke
23. gcp.billing.accounts.list
24. gcp.billing.projects.link/unlink
25. gcp.budgets.manage

## Google Cloud VM operations (26–46)
26. gcp.compute.instances.list/get/create/delete
27. gcp.compute.instances.start/stop/reset/suspend/resume
28. gcp.compute.instances.resize/setMachineType/setLabels/setTags/setMetadata
29. gcp.compute.instances.attachDisk/detachDisk
30. gcp.disks.create/resize/delete
31. gcp.compute.images.create/list/delete
32. gcp.snapshots.create/list/restore/delete
33. gcp.compute.instances.serialOutput
34. gcp.compute.operations.get/wait
35. gcp.vm.access.bootstrap/rotate/revoke
36. gcp.vm.ssh.exec
37. gcp.vm.winrm.exec
38. gcp.vm.files.upload/download
39. gcp.vm.packages.install/update/remove
40. gcp.vm.services.start/stop/restart/status
41. gcp.vm.reboot
42. gcp.vm.firewallGuest.manage
43. gcp.vm.agent.install/update/status
44. gcp.vm.bootstrap.getLogs
45. gcp.compute.instanceGroups.*
46. gcp.compute.templates.*

## Google Cloud platform (47–74)
47. gcp.vpc.networks.*
48. gcp.vpc.subnets.*
49. gcp.vpc.routes.*
50. gcp.firewalls.*
51. gcp.networkPolicies.*
52. gcp.nat.*
53. gcp.vpn.*
54. gcp.addresses.*
55. gcp.dns.zones.*
56. gcp.dns.records.*
57. gcp.loadBalancers.*
58. gcp.certificates.*
59. gcp.healthChecks.*
60. gcp.cloudRun.services.*
61. gcp.cloudRun.jobs.*
62. gcp.gke.*
63. gcp.artifacts.repositories.*
64. gcp.storage.buckets.*
65. gcp.storage.objects.*
66. gcp.secrets.createVersion/access/rotate/revoke
67. gcp.logging.query/sinks.manage
68. gcp.monitoring.metrics/alerts.*
69. gcp.scheduler.jobs.*
70. gcp.pubsub.topics/subscriptions.*
71. gcp.tasks.queues.*
72. gcp.security.findings.list
73. gcp.kms.keys.*
74. gcp.backups.*

## Supabase project (75–87)
75. supabase.orgs.list
76. supabase.projects.list/get/create/update/pause/restore/delete
77. supabase.project.config.get/set
78. supabase.network.*
79. supabase.domains.*
80. supabase.branches.create/list/get/merge/delete
81. supabase.db.diff
82. supabase.db.migrations.plan/apply/list/repair/verify
83. supabase.functions.list/get/deploy/delete/invoke/logs
84. supabase.functions.secrets.list/set/delete/rotate
85. supabase.project.logs.query
86. supabase.project.health
87. supabase.backups.list/restore

## Supabase PostgreSQL (88–102)
88. supabase.sql.query
89. supabase.sql.execute
90. supabase.sql.transaction
91. supabase.schema.tables/views/materializedViews.*
92. supabase.schema.functions/procedures/triggers.*
93. supabase.schema.indexes/constraints/types/extensions.*
94. supabase.database.roles/grants/defaultPrivileges.*
95. supabase.database.rls.policies.*
96. supabase.database.replication.*
97. supabase.data.insert/upsert/update/delete/bulkImport/bulkExport
98. supabase.database.inspect/explain/analyze/vacuum/reindex
99. supabase.database.connections/pooler/slowQueries/locks
100. supabase.database.backup/snapshot/restore/verify
101. supabase.database.cron/jobs.*
102. supabase.database.webhooks.*

## Supabase services (103–112)
103. supabase.auth.users.list/get/create/update/disable/delete
104. supabase.auth.providers/config/hooks/sessions/mfa.*
105. supabase.storage.buckets.*
106. supabase.storage.objects.*
107. supabase.storage.policies.*
108. supabase.realtime.channels/permissions/publications.*
109. supabase.vault.secrets.*
110. supabase.logs.query
111. supabase.tenant.export/erase/restore
112. supabase.compliance.audit

## GitHub repositories (113–126)
113. github.apps.installations.list/verify
114. github.repos.list/get/create/update/archive/delete
115. github.refs.list/create/update/delete
116. github.branches.list/protect
117. github.files.get/create/update/delete
118. github.git.blobs/trees/commits.*
119. github.pullRequests.list/create/update/review/merge/close
120. github.issues.*
121. github.labels.*
122. github.milestones.*
123. github.discussions.*
124. github.tags.*
125. github.releases.create/publish/delete
126. github.packages.*

## GitHub CI/CD and security (127–142)
127. github.actions.workflows.list/dispatch/enable/disable
128. github.actions.runs.get/cancel/rerun
129. github.actions.artifacts.list/download/delete
130. github.checks.*
131. github.statuses.*
132. github.deployments.create/status
133. github.environments.list/update
134. github.repoSecrets.set/remove
135. github.variables.set/remove
136. github.environmentSecrets.*
137. github.webhooks.list/create/update/delete/deliveries/redeliver
138. github.collaborators/teams/permissions.*
139. github.rulesets.*
140. github.audit.list
141. github.security.alerts/list
142. github.codeScanning.*

## Sandy customer-service operation families (143–161)
Each wildcard requires the domain-wide CRUD, execution, integration, verification and lifecycle interfaces described in the original specification.
143. sandy.tenancy_and_subscription.*
144. sandy.authentication_and_security.*
145. sandy.connections_composio.*
146. sandy.email_and_microsoft_graph.*
147. sandy.google_gmail.*
148. sandy.calendar_and_scheduling.*
149. sandy.whatsapp.*
150. sandy.voice_sip_and_video.*
151. sandy.web_chat_and_conversations.*
152. sandy.memory_and_social_graph.*
153. sandy.agenda_tasks_and_projects.*
154. sandy.missions_and_autonomous_work.*
155. sandy.controller_and_qa.*
156. sandy.files_and_documents.*
157. sandy.notifications_and_alerts.*
158. sandy.payments_and_commerce.*
159. sandy.customer_lifecycle_and_support.*
160. sandy.search_agents_tools_and_ai.*
161. sandy.product_configuration.*

## Acceptance
Every requirement must map to named implementation(s), source revision, production deployment evidence, an appropriately scoped authorization model and successful real functional/integration tests. Do not equate an existing registry row with executable capability. Preserve existing working implementations; do not invent test results. Treat provider permissions and tenant isolation as mandatory.
