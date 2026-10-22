# Sandy 161-family production coverage

Generated from production metadata and recorded execution evidence. Flags and active functions do not prove execution. Shared-adapter coverage is reused; expanded rows are not separate implementation projects.

**0/161 families fully accepted**; **37 families have partial required-operation MCP evidence**. **83 distinct operations** have documented positive MCP evidence. All remaining families require constituent acceptance; unknowns are not labelled external blockers.

**33 explicit families have reviewed code awaiting real family acceptance**; **128 need software, integration or constituent reconciliation**. **7 have documented external dependencies**, including **6 with permission denials**. External dependencies overlap the implementation counts; they do not certify completion or explain every missing function.

The code review is limited to the existing authorized provider targets. It does not certify additional projects, tenants, organizations or newly purchased services. A missing review is classified as work remaining, not proof that every constituent lacks code. Wildcard families stay incomplete until their required business constituents are reconciled and accepted.

Only explicit reviewed mappings are definitive required sets. Unreviewed wildcard/provider expansion remains a candidate set; its size is not a count of required development tasks. The JSON marks this distinction per family.

| Family | Requirement | Reviewed required / candidates | API/AI flags | Actual required/candidate MCP success | Implementation assessment | External dependencies |
|---:|---|---:|---:|---:|---|---|
| 1 | GET /v1/capabilities — executable operations, scopes and verification. | 3 | 3/1 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 2 | GET /v1/capabilities/{operation} — schema, handler and required grants. | 2 | 2/1 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 3 | POST /v1/operations/{operation}:execute — synchronous/asynchronous execution. | 4 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 4 | GET /v1/jobs/{jobId} — status, provider request IDs and result. | 6 | 6/4 | 2 | implementation_or_constituent_reconciliation_required | none established |
| 5 | GET /v1/jobs/{jobId}/events — structured progress events. | 2 | 2/1 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 6 | POST /v1/jobs/{jobId}:cancel — cancel eligible job. | 2 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 7 | POST /v1/jobs/{jobId}:retry — retry idempotent failed steps. | 2 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 8 | POST /v1/jobs/{jobId}:rollback — verified compensation. | 9 | 9/9 | 3 | implementation_or_constituent_reconciliation_required | none established |
| 9 | GET /v1/audit?resource=... — tamper-evident audit. | 4 | 3/2 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 10 | POST /v1/plans:validate — dry-run, permissions, cost and blast radius. | 3 | 3/3 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 11 | POST /v1/plans:execute — multi-service dependency graph. | 4 | 1/1 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 12 | gcp.organizations.list/get | 2 | 0/0 | 0 | implemented_awaiting_real_family_acceptance | none established |
| 13 | gcp.folders.list/create/move/delete | 4 | 0/0 | 0 | implemented_awaiting_real_family_acceptance | none established |
| 14 | gcp.projects.list/get/create/update/move/delete/undelete | 9 | 2/2 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 15 | gcp.services.list/enable/disable | 3 | 1/1 | 0 | implemented_awaiting_real_family_acceptance | none established |
| 16 | gcp.quotas.get/request | 6 | 4/4 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 17 | gcp.iam.policy.get/set | 15 | 4/4 | 0 | implementation_or_constituent_reconciliation_required | iap_policy_authority |
| 18 | gcp.iam.roles.list/create/update/delete | 4 | 1/1 | 0 | implemented_awaiting_real_family_acceptance | none established |
| 19 | gcp.serviceAccounts.list/create/update/delete | 4 | 1/1 | 0 | implemented_awaiting_real_family_acceptance | none established |
| 20 | gcp.serviceAccounts.keys.rotate | 7 | 2/2 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 21 | gcp.workloadIdentity.configure | 46 | 6/6 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 22 | gcp.osLogin.grant/revoke | 7 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 23 | gcp.billing.accounts.list | 1 | 0/0 | 0 | implemented_awaiting_real_family_acceptance | none established |
| 24 | gcp.billing.projects.link/unlink | 2 | 0/0 | 0 | implemented_awaiting_real_family_acceptance | none established |
| 25 | gcp.budgets.manage | 5 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 26 | gcp.compute.instances.list/get/create/delete | 4 | 2/2 | 1 | implemented_awaiting_real_family_acceptance | none established |
| 27 | gcp.compute.instances.start/stop/reset/suspend/resume | 5 | 0/0 | 0 | implemented_awaiting_real_family_acceptance | none established |
| 28 | gcp.compute.instances.resize/setMachineType/setLabels/setTags/setMetadata | 4 | 0/0 | 0 | implemented_awaiting_real_family_acceptance | none established |
| 29 | gcp.compute.instances.attachDisk/detachDisk | 2 | 0/0 | 0 | implemented_awaiting_real_family_acceptance | none established |
| 30 | gcp.disks.create/resize/delete | 3 | 0/0 | 0 | implemented_awaiting_real_family_acceptance | none established |
| 31 | gcp.compute.images.create/list/delete | 3 | 1/1 | 0 | implemented_awaiting_real_family_acceptance | none established |
| 32 | gcp.snapshots.create/list/restore/delete | 53 | 2/2 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 33 | gcp.compute.instances.serialOutput | 1 | 0/0 | 0 | implemented_awaiting_real_family_acceptance | none established |
| 34 | gcp.compute.operations.get/wait | 6 | 4/4 | 0 | implemented_awaiting_real_family_acceptance | none established |
| 35 | gcp.vm.access.bootstrap/rotate/revoke | 5 | 1/1 | 0 | implementation_or_constituent_reconciliation_required | iap_policy_authority |
| 36 | gcp.vm.ssh.exec | 1 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | iap_policy_authority |
| 37 | gcp.vm.winrm.exec | 1 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | iap_policy_authority |
| 38 | gcp.vm.files.upload/download | 2 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 39 | gcp.vm.packages.install/update/remove | 3 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 40 | gcp.vm.services.start/stop/restart/status | 6 | 1/1 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 41 | gcp.vm.reboot | 1 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 42 | gcp.vm.firewallGuest.manage | 1 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 43 | gcp.vm.agent.install/update/status | 5 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 44 | gcp.vm.bootstrap.getLogs | 2 | 1/1 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 45 | gcp.compute.instanceGroups.* | 87 | 2/2 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 46 | gcp.compute.templates.* | 12 | 2/2 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 47 | gcp.vpc.networks.* | 24 | 2/2 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 48 | gcp.vpc.subnets.* | 12 | 2/2 | 0 | implementation_or_constituent_reconciliation_required | subnet_private_google_access |
| 49 | gcp.vpc.routes.* | 5 | 2/2 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 50 | gcp.firewalls.* | 7 | 2/2 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 51 | gcp.networkPolicies.* | 86 | 2/2 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 52 | gcp.nat.* | 22 | 2/2 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 53 | gcp.vpn.* | 26 | 4/4 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 54 | gcp.addresses.* | 15 | 4/4 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 55 | gcp.dns.zones.* | 30 | 2/2 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 56 | gcp.dns.records.* | 14 | 2/2 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 57 | gcp.loadBalancers.* | 186 | 4/4 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 58 | gcp.certificates.* | 22 | 2/2 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 59 | gcp.healthChecks.* | 65 | 2/2 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 60 | gcp.cloudRun.services.* | 16 | 4/4 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 61 | gcp.cloudRun.jobs.* | 16 | 2/2 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 62 | gcp.gke.* | 36 | 9/9 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 63 | gcp.artifacts.repositories.* | 62 | 2/2 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 64 | gcp.storage.buckets.* | 17 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 65 | gcp.storage.objects.* | 30 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 66 | gcp.secrets.createVersion/access/rotate/revoke | 17 | 4/4 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 67 | gcp.logging.query/sinks.manage | 39 | 12/12 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 68 | gcp.monitoring.metrics/alerts.* | 36 | 16/16 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 69 | gcp.scheduler.jobs.* | 8 | 2/2 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 70 | gcp.pubsub.topics/subscriptions.* | 46 | 4/4 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 71 | gcp.tasks.queues.* | 19 | 2/2 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 72 | gcp.security.findings.list | 1 | 1/1 | 0 | implemented_awaiting_real_family_acceptance | none established |
| 73 | gcp.kms.keys.* | 54 | 4/4 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 74 | gcp.backups.* | 53 | 13/13 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 75 | supabase.orgs.list | 1 | 1/1 | 0 | implemented_awaiting_real_family_acceptance | none established |
| 76 | supabase.projects.list/get/create/update/pause/restore/delete | 7 | 1/1 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 77 | supabase.project.config.get/set | 12 | 4/4 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 78 | supabase.network.* | 8 | 3/3 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 79 | supabase.domains.* | 5 | 1/1 | 0 | implemented_awaiting_real_family_acceptance | custom_domain_entitlement |
| 80 | supabase.branches.create/list/get/merge/delete | 12 | 2/2 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 81 | supabase.db.diff | 1 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 82 | supabase.db.migrations.plan/apply/list/repair/verify | 5 | 2/2 | 1 | implementation_or_constituent_reconciliation_required | none established |
| 83 | supabase.functions.list/get/deploy/delete/invoke/logs | 6 | 4/2 | 2 | implementation_or_constituent_reconciliation_required | none established |
| 84 | supabase.functions.secrets.list/set/delete/rotate | 4 | 2/2 | 1 | implemented_awaiting_real_family_acceptance | none established |
| 85 | supabase.project.logs.query | 1 | 1/1 | 1 | implemented_awaiting_real_family_acceptance | none established |
| 86 | supabase.project.health | 1 | 1/1 | 0 | implemented_awaiting_real_family_acceptance | none established |
| 87 | supabase.backups.list/restore | 6 | 2/2 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 88 | supabase.sql.query | 1 | 0/0 | 0 | implemented_awaiting_real_family_acceptance | none established |
| 89 | supabase.sql.execute | 1 | 0/0 | 0 | implemented_awaiting_real_family_acceptance | none established |
| 90 | supabase.sql.transaction | 1 | 0/0 | 0 | implemented_awaiting_real_family_acceptance | none established |
| 91 | supabase.schema.tables/views/materializedViews.* | 16 | 4/4 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 92 | supabase.schema.functions/procedures/triggers.* | 13 | 2/2 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 93 | supabase.schema.indexes/constraints/types/extensions.* | 16 | 4/4 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 94 | supabase.database.roles/grants/defaultPrivileges.* | 10 | 3/3 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 95 | supabase.database.rls.policies.* | 6 | 1/1 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 96 | supabase.database.replication.* | 4 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 97 | supabase.data.insert/upsert/update/delete/bulkImport/bulkExport | 6 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 98 | supabase.database.inspect/explain/analyze/vacuum/reindex | 9 | 3/3 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 99 | supabase.database.connections/pooler/slowQueries/locks | 9 | 4/4 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 100 | supabase.database.backup/snapshot/restore/verify | 2 | 1/1 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 101 | supabase.database.cron/jobs.* | 4 | 1/1 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 102 | supabase.database.webhooks.* | 2 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 103 | supabase.auth.users.list/get/create/update/disable/delete | 6 | 0/0 | 0 | implemented_awaiting_real_family_acceptance | none established |
| 104 | supabase.auth.providers/config/hooks/sessions/mfa.* | 19 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 105 | supabase.storage.buckets.* | 7 | 1/1 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 106 | supabase.storage.objects.* | 9 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 107 | supabase.storage.policies.* | 4 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 108 | supabase.realtime.channels/permissions/publications.* | 10 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 109 | supabase.vault.secrets.* | 12 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 110 | supabase.logs.query | 1 | 1/1 | 1 | implemented_awaiting_real_family_acceptance | none established |
| 111 | supabase.tenant.export/erase/restore | 34 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 112 | supabase.compliance.audit | 10 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 113 | github.apps.installations.list/verify | 2 | 2/2 | 0 | implemented_awaiting_real_family_acceptance | none established |
| 114 | github.repos.list/get/create/update/archive/delete | 6 | 3/3 | 1 | implementation_or_constituent_reconciliation_required | none established |
| 115 | github.refs.list/create/update/delete | 4 | 4/4 | 3 | implemented_awaiting_real_family_acceptance | none established |
| 116 | github.branches.list/protect | 2 | 1/1 | 1 | implemented_awaiting_real_family_acceptance | none established |
| 117 | github.files.get/create/update/delete | 9 | 5/5 | 4 | implementation_or_constituent_reconciliation_required | none established |
| 118 | github.git.blobs/trees/commits.* | 7 | 6/6 | 4 | implementation_or_constituent_reconciliation_required | none established |
| 119 | github.pullRequests.list/create/update/review/merge/close | 5 | 2/2 | 1 | implemented_awaiting_real_family_acceptance | none established |
| 120 | github.issues.* | 63 | 2/2 | 1 | implementation_or_constituent_reconciliation_required | none established |
| 121 | github.labels.* | 5 | 2/2 | 1 | implementation_or_constituent_reconciliation_required | none established |
| 122 | github.milestones.* | 6 | 2/2 | 1 | implementation_or_constituent_reconciliation_required | none established |
| 123 | github.discussions.* | 16 | 1/1 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 124 | github.tags.* | 3 | 1/1 | 1 | implementation_or_constituent_reconciliation_required | none established |
| 125 | github.releases.create/publish/delete | 3 | 0/0 | 0 | implemented_awaiting_real_family_acceptance | none established |
| 126 | github.packages.* | 8 | 4/4 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 127 | github.actions.workflows.list/dispatch/enable/disable | 4 | 1/1 | 1 | implemented_awaiting_real_family_acceptance | none established |
| 128 | github.actions.runs.get/cancel/rerun | 3 | 1/1 | 0 | implemented_awaiting_real_family_acceptance | none established |
| 129 | github.actions.artifacts.list/download/delete | 4 | 1/1 | 1 | implementation_or_constituent_reconciliation_required | none established |
| 130 | github.checks.* | 12 | 2/2 | 1 | implementation_or_constituent_reconciliation_required | none established |
| 131 | github.statuses.* | 3 | 2/2 | 1 | implementation_or_constituent_reconciliation_required | none established |
| 132 | github.deployments.create/status | 7 | 2/2 | 1 | implementation_or_constituent_reconciliation_required | none established |
| 133 | github.environments.list/update | 14 | 2/2 | 1 | implementation_or_constituent_reconciliation_required | none established |
| 134 | github.repoSecrets.set/remove | 6 | 2/2 | 0 | implementation_or_constituent_reconciliation_required | github_actions_secret_metadata_scope |
| 135 | github.variables.set/remove | 10 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 136 | github.environmentSecrets.* | 5 | 3/3 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 137 | github.webhooks.list/create/update/delete/deliveries/redeliver | 12 | 2/2 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 138 | github.collaborators/teams/permissions.* | 9 | 2/2 | 1 | implementation_or_constituent_reconciliation_required | none established |
| 139 | github.rulesets.* | 10 | 2/2 | 1 | implementation_or_constituent_reconciliation_required | none established |
| 140 | github.audit.list | 1 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 141 | github.security.alerts/list | 18 | 1/1 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 142 | github.codeScanning.* | 22 | 1/1 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 143 | sandy.tenancy_and_subscription.* | 41 | 16/16 | 14 | implementation_or_constituent_reconciliation_required | none established |
| 144 | sandy.authentication_and_security.* | 32 | 4/4 | 2 | implementation_or_constituent_reconciliation_required | none established |
| 145 | sandy.connections_composio.* | 21 | 9/9 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 146 | sandy.email_and_microsoft_graph.* | 41 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 147 | sandy.google_gmail.* | 4 | 2/2 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 148 | sandy.calendar_and_scheduling.* | 22 | 10/10 | 4 | implementation_or_constituent_reconciliation_required | none established |
| 149 | sandy.whatsapp.* | 19 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 150 | sandy.voice_sip_and_video.* | 6 | 2/2 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 151 | sandy.web_chat_and_conversations.* | 15 | 7/7 | 2 | implementation_or_constituent_reconciliation_required | none established |
| 152 | sandy.memory_and_social_graph.* | 35 | 11/11 | 1 | implementation_or_constituent_reconciliation_required | none established |
| 153 | sandy.agenda_tasks_and_projects.* | 82 | 23/23 | 9 | implementation_or_constituent_reconciliation_required | none established |
| 154 | sandy.missions_and_autonomous_work.* | 19 | 4/4 | 2 | implementation_or_constituent_reconciliation_required | none established |
| 155 | sandy.controller_and_qa.* | 94 | 58/53 | 5 | implementation_or_constituent_reconciliation_required | none established |
| 156 | sandy.files_and_documents.* | 45 | 17/17 | 6 | implementation_or_constituent_reconciliation_required | none established |
| 157 | sandy.notifications_and_alerts.* | 20 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 158 | sandy.payments_and_commerce.* | 51 | 0/0 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 159 | sandy.customer_lifecycle_and_support.* | 37 | 16/16 | 15 | implementation_or_constituent_reconciliation_required | none established |
| 160 | sandy.search_agents_tools_and_ai.* | 41 | 9/9 | 0 | implementation_or_constituent_reconciliation_required | none established |
| 161 | sandy.product_configuration.* | 45 | 12/12 | 12 | implementation_or_constituent_reconciliation_required | none established |

Explicit-family optional candidates and the four legacy software/video-specific names are not new required implementation tasks. Wildcard expansion still needs semantic review; no unreviewed operation is declared globally out of scope.

Operation-level schemas, permissions, risk classification, receipts and grants remain authoritative in the existing registry and typed source contracts. The [current JSON index](requirement-coverage-current.json) and its three hashed parts retain all 161 current family states, production handler versions, actual scoped discovery, tested operations and blockers. The older requirement-coverage-161.json remains a historical constituent-mapping archive; its version/flag totals are historical.

Known missing contracts within the original scope (reported without adding registry rows):

- `supabase.projects.list`: No registry operation or installed gateway handler; existing project-specific GET does not implement listing.
- `supabase.projects.create`: No registry operation or installed gateway handler; existing project management does not implement new-project provisioning.
- `supabase.functions.invoke`: No registry operation or installed gateway handler for general authorized Edge Function invocation; direct fixture HTTP readback does not satisfy MCP invocation.
