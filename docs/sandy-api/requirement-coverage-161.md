# Sandy 161-family production coverage

Generated from production metadata and recorded execution evidence. Flags and active functions do not prove execution. Shared-adapter coverage is reused; expanded rows are not separate implementation projects.

**0/161 families fully accepted**; **11 families have partial required-operation MCP evidence**. **33 distinct operations** have documented positive MCP evidence. All remaining families require constituent acceptance; unknowns are not labelled external blockers.

| Family | Requirement | Required/candidate operations | API/AI flags | Actual required MCP success | State |
|---:|---|---:|---:|---:|---|
| 1 | GET /v1/capabilities — executable operations, scopes and verification. | 3 | 3/1 | 0 | not_yet_accepted |
| 2 | GET /v1/capabilities/{operation} — schema, handler and required grants. | 2 | 2/1 | 0 | not_yet_accepted |
| 3 | POST /v1/operations/{operation}:execute — synchronous/asynchronous execution. | 4 | 0/0 | 0 | not_yet_accepted |
| 4 | GET /v1/jobs/{jobId} — status, provider request IDs and result. | 6 | 5/3 | 0 | not_yet_accepted |
| 5 | GET /v1/jobs/{jobId}/events — structured progress events. | 2 | 2/1 | 0 | not_yet_accepted |
| 6 | POST /v1/jobs/{jobId}:cancel — cancel eligible job. | 2 | 0/0 | 0 | not_yet_accepted |
| 7 | POST /v1/jobs/{jobId}:retry — retry idempotent failed steps. | 2 | 0/0 | 0 | not_yet_accepted |
| 8 | POST /v1/jobs/{jobId}:rollback — verified compensation. | 9 | 8/8 | 0 | not_yet_accepted |
| 9 | GET /v1/audit?resource=... — tamper-evident audit. | 4 | 3/2 | 0 | not_yet_accepted |
| 10 | POST /v1/plans:validate — dry-run, permissions, cost and blast radius. | 3 | 3/3 | 0 | not_yet_accepted |
| 11 | POST /v1/plans:execute — multi-service dependency graph. | 4 | 1/1 | 0 | not_yet_accepted |
| 12 | gcp.organizations.list/get | 3 | 0/0 | 0 | not_yet_accepted |
| 13 | gcp.folders.list/create/move/delete | 8 | 0/0 | 0 | not_yet_accepted |
| 14 | gcp.projects.list/get/create/update/move/delete/undelete | 9 | 2/2 | 0 | not_yet_accepted |
| 15 | gcp.services.list/enable/disable | 7 | 2/2 | 0 | not_yet_accepted |
| 16 | gcp.quotas.get/request | 6 | 4/4 | 0 | not_yet_accepted |
| 17 | gcp.iam.policy.get/set | 15 | 4/4 | 0 | not_yet_accepted |
| 18 | gcp.iam.roles.list/create/update/delete | 6 | 2/2 | 0 | not_yet_accepted |
| 19 | gcp.serviceAccounts.list/create/update/delete | 14 | 4/4 | 0 | not_yet_accepted |
| 20 | gcp.serviceAccounts.keys.rotate | 7 | 2/2 | 0 | not_yet_accepted |
| 21 | gcp.workloadIdentity.configure | 46 | 6/6 | 0 | not_yet_accepted |
| 22 | gcp.osLogin.grant/revoke | 7 | 0/0 | 0 | not_yet_accepted |
| 23 | gcp.billing.accounts.list | 11 | 2/2 | 0 | not_yet_accepted |
| 24 | gcp.billing.projects.link/unlink | 3 | 1/1 | 0 | not_yet_accepted |
| 25 | gcp.budgets.manage | 5 | 0/0 | 0 | not_yet_accepted |
| 26 | gcp.compute.instances.list/get/create/delete | 4 | 2/2 | 0 | not_yet_accepted |
| 27 | gcp.compute.instances.start/stop/reset/suspend/resume | 5 | 0/0 | 0 | not_yet_accepted |
| 28 | gcp.compute.instances.resize/setMachineType/setLabels/setTags/setMetadata | 4 | 0/0 | 0 | not_yet_accepted |
| 29 | gcp.compute.instances.attachDisk/detachDisk | 2 | 0/0 | 0 | not_yet_accepted |
| 30 | gcp.disks.create/resize/delete | 3 | 0/0 | 0 | not_yet_accepted |
| 31 | gcp.compute.images.create/list/delete | 22 | 2/2 | 0 | not_yet_accepted |
| 32 | gcp.snapshots.create/list/restore/delete | 53 | 2/2 | 0 | not_yet_accepted |
| 33 | gcp.compute.instances.serialOutput | 1 | 0/0 | 0 | not_yet_accepted |
| 34 | gcp.compute.operations.get/wait | 22 | 7/7 | 0 | not_yet_accepted |
| 35 | gcp.vm.access.bootstrap/rotate/revoke | 5 | 1/1 | 0 | not_yet_accepted |
| 36 | gcp.vm.ssh.exec | 1 | 0/0 | 0 | not_yet_accepted |
| 37 | gcp.vm.winrm.exec | 1 | 0/0 | 0 | not_yet_accepted |
| 38 | gcp.vm.files.upload/download | 2 | 0/0 | 0 | not_yet_accepted |
| 39 | gcp.vm.packages.install/update/remove | 3 | 0/0 | 0 | not_yet_accepted |
| 40 | gcp.vm.services.start/stop/restart/status | 6 | 1/1 | 0 | not_yet_accepted |
| 41 | gcp.vm.reboot | 1 | 0/0 | 0 | not_yet_accepted |
| 42 | gcp.vm.firewallGuest.manage | 1 | 0/0 | 0 | not_yet_accepted |
| 43 | gcp.vm.agent.install/update/status | 5 | 0/0 | 0 | not_yet_accepted |
| 44 | gcp.vm.bootstrap.getLogs | 2 | 1/1 | 0 | not_yet_accepted |
| 45 | gcp.compute.instanceGroups.* | 87 | 2/2 | 0 | not_yet_accepted |
| 46 | gcp.compute.templates.* | 12 | 2/2 | 0 | not_yet_accepted |
| 47 | gcp.vpc.networks.* | 24 | 2/2 | 0 | not_yet_accepted |
| 48 | gcp.vpc.subnets.* | 12 | 2/2 | 0 | not_yet_accepted |
| 49 | gcp.vpc.routes.* | 5 | 2/2 | 0 | not_yet_accepted |
| 50 | gcp.firewalls.* | 7 | 2/2 | 0 | not_yet_accepted |
| 51 | gcp.networkPolicies.* | 86 | 2/2 | 0 | not_yet_accepted |
| 52 | gcp.nat.* | 22 | 2/2 | 0 | not_yet_accepted |
| 53 | gcp.vpn.* | 26 | 4/4 | 0 | not_yet_accepted |
| 54 | gcp.addresses.* | 15 | 4/4 | 0 | not_yet_accepted |
| 55 | gcp.dns.zones.* | 30 | 2/2 | 0 | not_yet_accepted |
| 56 | gcp.dns.records.* | 14 | 2/2 | 0 | not_yet_accepted |
| 57 | gcp.loadBalancers.* | 186 | 4/4 | 0 | not_yet_accepted |
| 58 | gcp.certificates.* | 22 | 2/2 | 0 | not_yet_accepted |
| 59 | gcp.healthChecks.* | 65 | 2/2 | 0 | not_yet_accepted |
| 60 | gcp.cloudRun.services.* | 16 | 4/4 | 0 | not_yet_accepted |
| 61 | gcp.cloudRun.jobs.* | 16 | 2/2 | 0 | not_yet_accepted |
| 62 | gcp.gke.* | 36 | 9/9 | 0 | not_yet_accepted |
| 63 | gcp.artifacts.repositories.* | 62 | 2/2 | 0 | not_yet_accepted |
| 64 | gcp.storage.buckets.* | 17 | 0/0 | 0 | not_yet_accepted |
| 65 | gcp.storage.objects.* | 30 | 0/0 | 0 | not_yet_accepted |
| 66 | gcp.secrets.createVersion/access/rotate/revoke | 17 | 4/4 | 0 | not_yet_accepted |
| 67 | gcp.logging.query/sinks.manage | 39 | 12/12 | 0 | not_yet_accepted |
| 68 | gcp.monitoring.metrics/alerts.* | 36 | 16/16 | 0 | not_yet_accepted |
| 69 | gcp.scheduler.jobs.* | 8 | 2/2 | 0 | not_yet_accepted |
| 70 | gcp.pubsub.topics/subscriptions.* | 46 | 4/4 | 0 | not_yet_accepted |
| 71 | gcp.tasks.queues.* | 19 | 2/2 | 0 | not_yet_accepted |
| 72 | gcp.security.findings.list | 26 | 11/11 | 0 | not_yet_accepted |
| 73 | gcp.kms.keys.* | 54 | 4/4 | 0 | not_yet_accepted |
| 74 | gcp.backups.* | 53 | 13/13 | 0 | not_yet_accepted |
| 75 | supabase.orgs.list | 1 | 1/1 | 0 | not_yet_accepted |
| 76 | supabase.projects.list/get/create/update/pause/restore/delete | 10 | 5/4 | 0 | not_yet_accepted |
| 77 | supabase.project.config.get/set | 12 | 4/4 | 0 | not_yet_accepted |
| 78 | supabase.network.* | 8 | 3/3 | 0 | not_yet_accepted |
| 79 | supabase.domains.* | 6 | 2/2 | 0 | not_yet_accepted |
| 80 | supabase.branches.create/list/get/merge/delete | 12 | 2/2 | 0 | not_yet_accepted |
| 81 | supabase.db.diff | 1 | 0/0 | 0 | not_yet_accepted |
| 82 | supabase.db.migrations.plan/apply/list/repair/verify | 12 | 2/2 | 1 | partial_MCP_evidence |
| 83 | supabase.functions.list/get/deploy/delete/invoke/logs | 13 | 5/3 | 1 | partial_MCP_evidence |
| 84 | supabase.functions.secrets.list/set/delete/rotate | 4 | 2/2 | 1 | partial_MCP_evidence |
| 85 | supabase.project.logs.query | 1 | 1/1 | 1 | partial_MCP_evidence |
| 86 | supabase.project.health | 2 | 2/1 | 0 | not_yet_accepted |
| 87 | supabase.backups.list/restore | 6 | 2/2 | 0 | not_yet_accepted |
| 88 | supabase.sql.query | 1 | 0/0 | 0 | not_yet_accepted |
| 89 | supabase.sql.execute | 2 | 0/0 | 0 | not_yet_accepted |
| 90 | supabase.sql.transaction | 1 | 0/0 | 0 | not_yet_accepted |
| 91 | supabase.schema.tables/views/materializedViews.* | 16 | 4/4 | 0 | not_yet_accepted |
| 92 | supabase.schema.functions/procedures/triggers.* | 13 | 2/2 | 0 | not_yet_accepted |
| 93 | supabase.schema.indexes/constraints/types/extensions.* | 16 | 4/4 | 0 | not_yet_accepted |
| 94 | supabase.database.roles/grants/defaultPrivileges.* | 10 | 3/3 | 0 | not_yet_accepted |
| 95 | supabase.database.rls.policies.* | 6 | 1/1 | 0 | not_yet_accepted |
| 96 | supabase.database.replication.* | 4 | 0/0 | 0 | not_yet_accepted |
| 97 | supabase.data.insert/upsert/update/delete/bulkImport/bulkExport | 6 | 0/0 | 0 | not_yet_accepted |
| 98 | supabase.database.inspect/explain/analyze/vacuum/reindex | 9 | 3/3 | 0 | not_yet_accepted |
| 99 | supabase.database.connections/pooler/slowQueries/locks | 9 | 4/4 | 0 | not_yet_accepted |
| 100 | supabase.database.backup/snapshot/restore/verify | 2 | 1/1 | 0 | not_yet_accepted |
| 101 | supabase.database.cron/jobs.* | 4 | 1/1 | 0 | not_yet_accepted |
| 102 | supabase.database.webhooks.* | 2 | 0/0 | 0 | not_yet_accepted |
| 103 | supabase.auth.users.list/get/create/update/disable/delete | 6 | 0/0 | 0 | not_yet_accepted |
| 104 | supabase.auth.providers/config/hooks/sessions/mfa.* | 19 | 0/0 | 0 | not_yet_accepted |
| 105 | supabase.storage.buckets.* | 7 | 1/1 | 0 | not_yet_accepted |
| 106 | supabase.storage.objects.* | 9 | 0/0 | 0 | not_yet_accepted |
| 107 | supabase.storage.policies.* | 4 | 0/0 | 0 | not_yet_accepted |
| 108 | supabase.realtime.channels/permissions/publications.* | 10 | 0/0 | 0 | not_yet_accepted |
| 109 | supabase.vault.secrets.* | 12 | 0/0 | 0 | not_yet_accepted |
| 110 | supabase.logs.query | 1 | 1/1 | 1 | partial_MCP_evidence |
| 111 | supabase.tenant.export/erase/restore | 34 | 0/0 | 0 | not_yet_accepted |
| 112 | supabase.compliance.audit | 10 | 0/0 | 0 | not_yet_accepted |
| 113 | github.apps.installations.list/verify | 3 | 3/3 | 0 | not_yet_accepted |
| 114 | github.repos.list/get/create/update/archive/delete | 6 | 3/3 | 0 | not_yet_accepted |
| 115 | github.refs.list/create/update/delete | 5 | 2/2 | 0 | not_yet_accepted |
| 116 | github.branches.list/protect | 36 | 2/2 | 0 | not_yet_accepted |
| 117 | github.files.get/create/update/delete | 9 | 2/2 | 1 | partial_MCP_evidence |
| 118 | github.git.blobs/trees/commits.* | 7 | 3/3 | 1 | partial_MCP_evidence |
| 119 | github.pullRequests.list/create/update/review/merge/close | 35 | 3/3 | 0 | not_yet_accepted |
| 120 | github.issues.* | 63 | 2/2 | 0 | not_yet_accepted |
| 121 | github.labels.* | 5 | 2/2 | 0 | not_yet_accepted |
| 122 | github.milestones.* | 6 | 2/2 | 0 | not_yet_accepted |
| 123 | github.discussions.* | 16 | 1/1 | 0 | not_yet_accepted |
| 124 | github.tags.* | 3 | 1/1 | 0 | not_yet_accepted |
| 125 | github.releases.create/publish/delete | 16 | 2/2 | 0 | not_yet_accepted |
| 126 | github.packages.* | 8 | 4/4 | 0 | not_yet_accepted |
| 127 | github.actions.workflows.list/dispatch/enable/disable | 7 | 2/2 | 0 | not_yet_accepted |
| 128 | github.actions.runs.get/cancel/rerun | 27 | 2/2 | 0 | not_yet_accepted |
| 129 | github.actions.artifacts.list/download/delete | 5 | 2/2 | 0 | not_yet_accepted |
| 130 | github.checks.* | 12 | 2/2 | 0 | not_yet_accepted |
| 131 | github.statuses.* | 3 | 2/2 | 0 | not_yet_accepted |
| 132 | github.deployments.create/status | 7 | 2/2 | 0 | not_yet_accepted |
| 133 | github.environments.list/update | 14 | 2/2 | 0 | not_yet_accepted |
| 134 | github.repoSecrets.set/remove | 6 | 2/2 | 0 | not_yet_accepted |
| 135 | github.variables.set/remove | 10 | 0/0 | 0 | not_yet_accepted |
| 136 | github.environmentSecrets.* | 5 | 3/3 | 0 | not_yet_accepted |
| 137 | github.webhooks.list/create/update/delete/deliveries/redeliver | 12 | 2/2 | 0 | not_yet_accepted |
| 138 | github.collaborators/teams/permissions.* | 9 | 2/2 | 0 | not_yet_accepted |
| 139 | github.rulesets.* | 10 | 2/2 | 0 | not_yet_accepted |
| 140 | github.audit.list | 1 | 0/0 | 0 | not_yet_accepted |
| 141 | github.security.alerts/list | 18 | 1/1 | 0 | not_yet_accepted |
| 142 | github.codeScanning.* | 22 | 1/1 | 0 | not_yet_accepted |
| 143 | sandy.tenancy_and_subscription.* | 41 | 16/16 | 12 | partial_MCP_evidence |
| 144 | sandy.authentication_and_security.* | 32 | 4/4 | 0 | not_yet_accepted |
| 145 | sandy.connections_composio.* | 21 | 9/9 | 0 | not_yet_accepted |
| 146 | sandy.email_and_microsoft_graph.* | 41 | 0/0 | 0 | not_yet_accepted |
| 147 | sandy.google_gmail.* | 4 | 2/2 | 0 | not_yet_accepted |
| 148 | sandy.calendar_and_scheduling.* | 22 | 10/10 | 0 | not_yet_accepted |
| 149 | sandy.whatsapp.* | 19 | 0/0 | 0 | not_yet_accepted |
| 150 | sandy.voice_sip_and_video.* | 6 | 2/2 | 0 | not_yet_accepted |
| 151 | sandy.web_chat_and_conversations.* | 15 | 7/7 | 0 | not_yet_accepted |
| 152 | sandy.memory_and_social_graph.* | 35 | 11/11 | 0 | not_yet_accepted |
| 153 | sandy.agenda_tasks_and_projects.* | 82 | 23/23 | 0 | not_yet_accepted |
| 154 | sandy.missions_and_autonomous_work.* | 19 | 4/4 | 0 | not_yet_accepted |
| 155 | sandy.controller_and_qa.* | 94 | 58/53 | 5 | partial_MCP_evidence |
| 156 | sandy.files_and_documents.* | 45 | 17/17 | 0 | not_yet_accepted |
| 157 | sandy.notifications_and_alerts.* | 20 | 0/0 | 0 | not_yet_accepted |
| 158 | sandy.payments_and_commerce.* | 51 | 0/0 | 0 | not_yet_accepted |
| 159 | sandy.customer_lifecycle_and_support.* | 37 | 16/16 | 15 | partial_MCP_evidence |
| 160 | sandy.search_agents_tools_and_ai.* | 41 | 9/9 | 0 | not_yet_accepted |
| 161 | sandy.product_configuration.* | 45 | 12/12 | 12 | partial_MCP_evidence |

Explicit-family optional candidates and the four legacy software/video-specific names are not new required implementation tasks. Wildcard expansion still needs semantic review; no unreviewed operation is declared globally out of scope.

Operation-level schemas, permissions, risk classification, receipts and grants remain authoritative in the existing registry and typed source contracts. The JSON companion retains per-operation metadata, evidence references, missing IDs, shared adapter grouping and every family's remaining capability.
