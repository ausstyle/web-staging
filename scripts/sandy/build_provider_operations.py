"""Compile reviewed provider routes from checksum-pinned official contracts.

This builds executable-handler data, not provider-wide discovery or verification.
Routes outside REVIEWED are deliberately absent. Mutations remain unexposed.
"""
from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
from typing import Any

PROJECT = "zmqlyygzqoidkcwdysok"
REPOSITORY = "ausstyle/web-staging"
GCP_PROJECT = "elaborate-haven-511518-a5"
GCP_ZONE = "europe-west1-b"
GCP_REGION = "europe-west1"


def route(operation, provider, path, method="get", fields=(), *, query=(), requirement=None,
          kind="object", cost=False, sensitive=False, fixed_query=None):
    return dict(operation=operation, provider=provider, path=path, method=method.upper(),
                fields=list(fields), query=list(query), requirement=requirement,
                kind=kind, requires_cost_approval=cost, sensitive=sensitive,
                fixed_query=fixed_query or {})


REVIEWED = []
def sb(operation, suffix, method="get", fields=(), **kwargs):
    REVIEWED.append(route("supabase." + operation, "supabase", "/v1/projects/{ref}" + suffix,
                          method, fields, **kwargs))
def gh(operation, suffix, method="get", fields=(), **kwargs):
    REVIEWED.append(route("github." + operation, "github", "/repos/{owner}/{repo}" + suffix,
                          method, fields, **kwargs))

# Reads use explicit projections; provider response secrets are never copied.
sb("project.config.auth.get", "/config/auth", fields=("jwt_exp", "site_url", "disable_signup", "mailer_autoconfirm", "external_email_enabled", "security_captcha_enabled"), requirement=77)
sb("project.config.postgrest.get", "/postgrest", fields=("db_schema", "max_rows", "db_extra_search_path", "db_pool", "db_pool_acquisition_timeout"), requirement=77)
sb("project.config.realtime.get", "/config/realtime", fields=("private_only", "connection_pool", "max_concurrent_users", "max_events_per_second", "suspend", "presence_enabled"), requirement=77)
sb("project.config.storage.get", "/config/storage", fields=("fileSizeLimit", "migrationVersion"), requirement=77)
sb("database.pooler.config.get", "/config/database/pgbouncer", fields=("default_pool_size", "max_client_conn", "pool_mode", "server_idle_timeout", "server_lifetime", "query_wait_timeout", "reserve_pool_size"), requirement=99)
sb("database.postgres.config.get", "/config/database/postgres", fields=("max_connections", "max_wal_size", "shared_buffers", "statement_timeout", "work_mem", "wal_keep_size", "max_replication_slots"), requirement=99)
sb("database.disk.utilization.get", "/config/disk/util", fields=(), kind="safe_json", requirement=98)
sb("database.readonly.get", "/readonly", fields=("enabled", "override_enabled", "override_active_until"), requirement=98)
sb("network.ssl.get", "/ssl-enforcement", fields=("currentConfig", "appliedSuccessfully"), requirement=78)
sb("backups.schedule.get", "/database/backups/schedule", fields=("schedule_for", "updated_at"), requirement=87)
sb("backups.restore_point.get", "/database/backups/restore-point", fields=(), kind="safe_json", requirement=100)
sb("project.restore.versions.list", "/restore", fields=("available_versions",), requirement=76)
sb("project.upgrade.eligibility.get", "/upgrade/eligibility", fields=(), kind="safe_json", requirement=76)
sb("project.upgrade.status.get", "/upgrade/status", fields=(), kind="safe_json", requirement=76)
sb("storage.buckets.metadata.list", "/storage/buckets", fields=("id", "name", "public", "created_at", "updated_at", "file_size_limit", "allowed_mime_types"), kind="array", requirement=105)
sb("database.openapi.paths.list", "/database/openapi", kind="openapi", requirement=91)
sb("domains.inspect", "/custom-hostname", fields=(), kind="domain", requirement=79)
sb("network.bans.list", "/network-bans/retrieve", "post", fields=(), kind="safe_json", requirement=78)

# Domain operations never buy an add-on. Delete explicitly retains subscription.
for name, suffix in [("create", "/initialize"), ("reverify", "/reverify"), ("activate", "/activate")]:
    sb("domains." + name, "/custom-hostname" + suffix, "post", kind="domain", requirement=79)
sb("domains.delete", "/custom-hostname", "delete", kind="empty", requirement=79,
   fixed_query={"remove_addon": "false"})

# Existing-project writes require immutable one-use execution approval.
for name, path, verb, req in [
    ("projects.update", "", "patch", 76), ("projects.pause", "/pause", "post", 76),
    ("projects.restore", "/restore", "post", 76), ("projects.delete", "", "delete", 76),
    ("project.config.auth.set", "/config/auth", "patch", 77),
    ("project.config.postgrest.set", "/postgrest", "patch", 77),
    ("project.config.realtime.set", "/config/realtime", "patch", 77),
    ("project.config.storage.set", "/config/storage", "patch", 77),
    ("database.postgres.config.set", "/config/database/postgres", "put", 98),
    ("database.pooler.config.set", "/config/database/pooler", "patch", 99),
    ("network.restrictions.set", "/network-restrictions", "patch", 78),
    ("network.restrictions.apply", "/network-restrictions/apply", "post", 78),
    ("network.bans.delete", "/network-bans", "delete", 78),
    ("network.ssl.set", "/ssl-enforcement", "put", 78),
    ("branches.create", "/branches", "post", 80),
    ("db.migrations.apply", "/database/migrations", "post", 82),
    ("db.migrations.repair", "/database/migrations", "put", 82),
    ("db.migrations.rollback", "/database/migrations", "delete", 82),
    ("functions.delete", "/functions/{function_slug}", "delete", 83),
    ("functions.secrets.set", "/secrets", "post", 84),
    ("functions.secrets.delete", "/secrets", "delete", 84),
    ("database.webhooks.enable", "/database/webhooks/enable", "post", 102),
    ("backups.restore", "/database/backups/restore", "post", 87),
    ("backups.restore_pitr", "/database/backups/restore-pitr", "post", 87),
    ("backups.restore_point.create", "/database/backups/restore-point", "post", 100),
    ("backups.schedule.set", "/database/backups/schedule", "patch", 87),
]:
    sb(name, path, verb, kind="mutation_metadata", requirement=req,
       query=("gte",) if name.endswith("rollback") else (), cost=name in {"branches.create", "projects.restore"})

# Repository metadata and lifecycle. File-content/secret-value response surfaces
# are not silently treated as metadata; those need separate sensitive contracts.
gh("repos.get", "", fields=("id", "name", "full_name", "private", "default_branch", "archived", "disabled", "html_url", "visibility"), requirement=114)
gh("branches.list", "/branches", fields=("name", "protected"), kind="array", query=("protected", "per_page", "page"), requirement=116)
gh("branches.get", "/branches/{branch}", fields=("name", "protected"), requirement=116)
gh("refs.list", "/git/matching-refs/{ref}", fields=("ref", "node_id", "url", "object"), kind="array", requirement=115)
gh("refs.get", "/git/ref/{ref}", fields=("ref", "node_id", "url", "object"), requirement=115)
gh("files.metadata.get", "/contents/{path}", fields=("name", "path", "sha", "size", "type", "encoding", "html_url"), query=("ref",), kind="object_or_array", requirement=117)
gh("files.content.get", "/contents/{path}", fields=(), query=("ref",), kind="file_content", requirement=117, sensitive=True)
gh("git.commits.get", "/git/commits/{commit_sha}", fields=("sha", "node_id", "url", "html_url", "message", "tree", "parents"), requirement=118)
gh("git.trees.get", "/git/trees/{tree_sha}", fields=("sha", "url", "tree", "truncated"), query=("recursive",), requirement=118)
gh("pull_requests.list", "/pulls", fields=("id", "number", "state", "title", "html_url", "draft", "created_at", "updated_at", "merged_at"), kind="array", query=("state", "head", "base", "sort", "direction", "per_page", "page"), requirement=119)
gh("pull_requests.get", "/pulls/{pull_number}", fields=("id", "number", "state", "title", "html_url", "draft", "mergeable", "merged", "merged_at", "merge_commit_sha"), requirement=119)
gh("pull_requests.reviews.list", "/pulls/{pull_number}/reviews", fields=("id", "state", "submitted_at", "html_url", "commit_id"), kind="array", query=("per_page", "page"), requirement=119)
gh("issues.list", "/issues", fields=("id", "number", "state", "title", "html_url", "created_at", "updated_at", "closed_at"), kind="array", query=("state", "sort", "direction", "per_page", "page"), requirement=120)
gh("issues.get", "/issues/{issue_number}", fields=("id", "number", "state", "title", "html_url", "created_at", "updated_at", "closed_at"), requirement=120)
gh("labels.list", "/labels", fields=("id", "name", "color", "description"), kind="array", query=("per_page", "page"), requirement=121)
gh("labels.get", "/labels/{name}", fields=("id", "name", "color", "description"), requirement=121)
gh("milestones.list", "/milestones", fields=("id", "number", "state", "title", "description", "due_on", "open_issues", "closed_issues"), kind="array", query=("state", "sort", "direction", "per_page", "page"), requirement=122)
gh("milestones.get", "/milestones/{milestone_number}", fields=("id", "number", "state", "title", "description", "due_on", "open_issues", "closed_issues"), requirement=122)
gh("tags.list", "/tags", fields=("name", "node_id", "commit"), kind="array", query=("per_page", "page"), requirement=124)
gh("releases.list", "/releases", fields=("id", "tag_name", "name", "draft", "prerelease", "published_at", "html_url"), kind="array", query=("per_page", "page"), requirement=125)
gh("releases.get", "/releases/{release_id}", fields=("id", "tag_name", "name", "draft", "prerelease", "published_at", "html_url"), requirement=125)
gh("actions.workflows.list", "/actions/workflows", fields=("total_count", "workflows"), query=("per_page", "page"), requirement=127)
gh("actions.workflows.get", "/actions/workflows/{workflow_id}", fields=("id", "name", "path", "state", "html_url", "created_at", "updated_at"), requirement=127)
gh("actions.runs.list", "/actions/runs", fields=("total_count", "workflow_runs"), query=("branch", "event", "status", "per_page", "page"), requirement=128)
gh("actions.runs.get", "/actions/runs/{run_id}", fields=("id", "name", "head_branch", "head_sha", "run_number", "event", "status", "conclusion", "workflow_id", "html_url", "created_at", "updated_at"), requirement=128)
gh("actions.artifacts.list", "/actions/artifacts", fields=("total_count", "artifacts"), query=("name", "per_page", "page"), requirement=129)
gh("actions.artifacts.get", "/actions/artifacts/{artifact_id}", fields=("id", "name", "size_in_bytes", "expired", "created_at", "expires_at", "workflow_run"), requirement=129)
gh("checks.runs.list", "/commits/{ref}/check-runs", fields=("total_count", "check_runs"), query=("check_name", "status", "filter", "per_page", "page"), requirement=130)
gh("checks.runs.get", "/check-runs/{check_run_id}", fields=("id", "name", "head_sha", "status", "conclusion", "started_at", "completed_at", "html_url"), requirement=130)
gh("statuses.list", "/commits/{ref}/statuses", fields=("id", "state", "context", "description", "created_at", "updated_at"), kind="array", query=("per_page", "page"), requirement=131)
gh("statuses.combined.get", "/commits/{ref}/status", fields=("state", "sha", "total_count", "statuses"), query=("per_page", "page"), requirement=131)
gh("deployments.list", "/deployments", fields=("id", "ref", "sha", "task", "environment", "created_at", "updated_at"), kind="array", query=("sha", "ref", "task", "environment", "per_page", "page"), requirement=132)
gh("deployments.statuses.list", "/deployments/{deployment_id}/statuses", fields=("id", "state", "description", "environment", "created_at", "updated_at"), kind="array", query=("per_page", "page"), requirement=132)
gh("environments.list", "/environments", fields=("total_count", "environments"), query=("per_page", "page"), requirement=133)
gh("environments.get", "/environments/{environment_name}", fields=("id", "name", "created_at", "updated_at", "protection_rules", "deployment_branch_policy"), requirement=133)
gh("repo_secrets.list", "/actions/secrets", fields=("total_count", "secrets"), query=("per_page", "page"), requirement=134)
gh("repo_secrets.public_key.get", "/actions/secrets/public-key", fields=("key_id", "key"), requirement=134)
gh("variables.list", "/actions/variables", fields=("total_count", "variables"), query=("per_page", "page"), requirement=135, sensitive=True)
gh("webhooks.list", "/hooks", fields=("id", "type", "name", "active", "events", "created_at", "updated_at"), kind="array", query=("per_page", "page"), requirement=137)
gh("webhooks.deliveries.list", "/hooks/{hook_id}/deliveries", fields=("id", "guid", "delivered_at", "redelivery", "status", "status_code", "event", "action"), kind="array", query=("per_page", "cursor"), requirement=137)
gh("collaborators.list", "/collaborators", fields=("id", "login", "type", "permissions", "role_name"), kind="array", query=("affiliation", "permission", "per_page", "page"), requirement=138)
gh("collaborators.permission.get", "/collaborators/{username}/permission", fields=("permission", "role_name"), requirement=138)
gh("rulesets.list", "/rulesets", fields=("id", "name", "target", "source_type", "source", "enforcement"), kind="array", query=("per_page", "page", "includes_parents"), requirement=139)
gh("rulesets.get", "/rulesets/{ruleset_id}", fields=("id", "name", "target", "source_type", "source", "enforcement", "conditions", "rules"), query=("includes_parents",), requirement=139)
gh("security.code_scanning.alerts.list", "/code-scanning/alerts", fields=("number", "state", "created_at", "updated_at", "html_url", "rule", "tool"), kind="array", query=("state", "ref", "per_page", "page"), requirement=142)
gh("security.dependabot.alerts.list", "/dependabot/alerts", fields=("number", "state", "created_at", "updated_at", "html_url", "dependency"), kind="array", query=("state", "per_page", "page"), requirement=141)

for name, path, method, req in [
    ("repos.update", "", "patch", 114), ("repos.delete", "", "delete", 114),
    ("refs.create", "/git/refs", "post", 115), ("refs.update", "/git/refs/{ref}", "patch", 115), ("refs.delete", "/git/refs/{ref}", "delete", 115),
    ("branches.protect", "/branches/{branch}/protection", "put", 116), ("branches.unprotect", "/branches/{branch}/protection", "delete", 116),
    ("files.upsert", "/contents/{path}", "put", 117), ("files.delete", "/contents/{path}", "delete", 117),
    ("git.blobs.create", "/git/blobs", "post", 118), ("git.trees.create", "/git/trees", "post", 118), ("git.commits.create", "/git/commits", "post", 118),
    ("pull_requests.create", "/pulls", "post", 119), ("pull_requests.update", "/pulls/{pull_number}", "patch", 119),
    ("pull_requests.review", "/pulls/{pull_number}/reviews", "post", 119), ("pull_requests.merge", "/pulls/{pull_number}/merge", "put", 119),
    ("issues.create", "/issues", "post", 120), ("issues.update", "/issues/{issue_number}", "patch", 120),
    ("labels.create", "/labels", "post", 121), ("labels.update", "/labels/{name}", "patch", 121), ("labels.delete", "/labels/{name}", "delete", 121),
    ("milestones.create", "/milestones", "post", 122), ("milestones.update", "/milestones/{milestone_number}", "patch", 122), ("milestones.delete", "/milestones/{milestone_number}", "delete", 122),
    ("releases.create", "/releases", "post", 125), ("releases.update", "/releases/{release_id}", "patch", 125), ("releases.delete", "/releases/{release_id}", "delete", 125),
    ("actions.workflows.dispatch", "/actions/workflows/{workflow_id}/dispatches", "post", 127),
    ("actions.workflows.enable", "/actions/workflows/{workflow_id}/enable", "put", 127), ("actions.workflows.disable", "/actions/workflows/{workflow_id}/disable", "put", 127),
    ("actions.runs.cancel", "/actions/runs/{run_id}/cancel", "post", 128), ("actions.runs.rerun", "/actions/runs/{run_id}/rerun", "post", 128),
    ("actions.artifacts.delete", "/actions/artifacts/{artifact_id}", "delete", 129),
    ("checks.runs.create", "/check-runs", "post", 130), ("checks.runs.update", "/check-runs/{check_run_id}", "patch", 130),
    ("statuses.create", "/statuses/{sha}", "post", 131), ("deployments.create", "/deployments", "post", 132),
    ("deployments.statuses.create", "/deployments/{deployment_id}/statuses", "post", 132),
    ("environments.update", "/environments/{environment_name}", "put", 133),
    ("repo_secrets.set", "/actions/secrets/{secret_name}", "put", 134), ("repo_secrets.remove", "/actions/secrets/{secret_name}", "delete", 134),
    ("variables.create", "/actions/variables", "post", 135), ("variables.set", "/actions/variables/{name}", "patch", 135), ("variables.remove", "/actions/variables/{name}", "delete", 135),
    ("webhooks.create", "/hooks", "post", 137), ("webhooks.update", "/hooks/{hook_id}", "patch", 137), ("webhooks.delete", "/hooks/{hook_id}", "delete", 137),
    ("webhooks.redeliver", "/hooks/{hook_id}/deliveries/{delivery_id}/attempts", "post", 137),
    ("collaborators.add", "/collaborators/{username}", "put", 138), ("collaborators.remove", "/collaborators/{username}", "delete", 138),
    ("rulesets.create", "/rulesets", "post", 139), ("rulesets.update", "/rulesets/{ruleset_id}", "put", 139), ("rulesets.delete", "/rulesets/{ruleset_id}", "delete", 139),
]:
    gh(name, path, method, kind="mutation_metadata", requirement=req,
       cost=name in {"actions.workflows.dispatch", "actions.runs.rerun", "deployments.create"})

# Additional fixed-repository aliases preserve precise create/update semantics.
gh("repos.list", "", fields=("id", "name", "full_name", "private", "default_branch", "archived", "disabled", "html_url", "visibility"), kind="scoped_list", requirement=114)
gh("repos.archive", "", "patch", kind="mutation_metadata", requirement=114)
REVIEWED[-1].update(fixed_body={"archived": True}, fixed_body_only=True)
for name in ["create", "update"]:
    gh("files." + name, "/contents/{path}", "put", kind="mutation_metadata", requirement=117)
    REVIEWED[-1]["file_write_mode"] = name
for name in ["get", "list", "verify"]:
    gh("apps.installations." + name, "/installation", fields=("id", "app_id", "app_slug", "target_id", "target_type", "repository_selection", "permissions", "events", "suspended_at"), kind="scoped_list" if name == "list" else "object", requirement=113)
    REVIEWED[-1]["credential_kind"] = "github_app_jwt"

# Explicit method sets, not wildcard registration. Every entry is looked up in
# its official Discovery document and fails generation if a method disappears.
GCP_REVIEWED = [
    ("compute", "instances", "compute.instances", 26, ["list", "aggregatedList", "get", "insert", "delete", "start", "stop", "reset", "suspend", "resume", "setMachineType", "setLabels", "setTags", "setMetadata", "attachDisk", "detachDisk"]),
    ("compute", "disks", "disks", 30, ["list", "get", "insert", "resize", "delete"]),
    ("compute", "images", "compute.images", 31, ["list", "get", "insert", "delete"]),
    ("compute", "snapshots", "snapshots", 32, ["list", "get", "insert", "delete"]),
    ("compute", "zoneOperations", "compute.zone_operations", 34, ["get", "wait", "list"]),
    ("compute", "globalOperations", "compute.global_operations", 34, ["get", "wait", "list"]),
    ("compute", "instanceGroups", "compute.instance_groups", 45, ["list", "get", "insert", "delete", "addInstances", "removeInstances", "setNamedPorts"]),
    ("compute", "instanceTemplates", "compute.templates", 46, ["list", "get", "insert", "delete"]),
    ("compute", "networks", "vpc.networks", 47, ["list", "get", "insert", "delete"]),
    ("compute", "subnetworks", "vpc.subnets", 48, ["list", "get", "insert", "delete", "expandIpCidrRange"]),
    ("compute", "routes", "vpc.routes", 49, ["list", "get", "insert", "delete"]),
    ("compute", "firewalls", "firewalls", 50, ["list", "get", "insert", "patch", "delete"]),
    ("compute", "networkFirewallPolicies", "network_policies", 51, ["list", "get", "insert", "patch", "delete", "addRule", "removeRule"]),
    ("compute", "routers", "nat.routers", 52, ["list", "get", "insert", "patch", "delete"]),
    ("compute", "vpnTunnels", "vpn.tunnels", 53, ["list", "get", "insert", "delete"]),
    ("compute", "vpnGateways", "vpn.gateways", 53, ["list", "get", "insert", "delete"]),
    ("compute", "addresses", "addresses.regional", 54, ["list", "get", "insert", "delete"]),
    ("compute", "globalAddresses", "addresses.global", 54, ["list", "get", "insert", "delete"]),
    ("compute", "backendServices", "load_balancers.backends", 57, ["list", "get", "insert", "patch", "delete"]),
    ("compute", "forwardingRules", "load_balancers.forwarding_rules", 57, ["list", "get", "insert", "patch", "delete"]),
    ("compute", "sslCertificates", "certificates", 58, ["list", "get", "insert", "delete"]),
    ("compute", "healthChecks", "health_checks", 59, ["list", "get", "insert", "patch", "delete"]),
    ("cloudresourcemanager", "projects", "projects", 14, ["get", "delete", "undelete", "patch", "getIamPolicy", "setIamPolicy", "testIamPermissions"]),
    ("serviceusage", "services", "services", 15, ["list", "get", "enable", "disable"]),
    ("iam", "projects.roles", "iam.roles", 18, ["list", "get", "create", "patch", "delete", "undelete"]),
    ("iam", "projects.serviceAccounts", "service_accounts", 19, ["list", "get", "create", "patch", "delete", "disable", "enable"]),
    ("iam", "projects.serviceAccounts.keys", "service_accounts.keys", 20, ["list", "get", "delete", "disable", "enable"]),
    ("dns", "managedZones", "dns.zones", 55, ["list", "get", "create", "patch", "delete"]),
    ("dns", "resourceRecordSets", "dns.records", 56, ["list", "get", "create", "patch", "delete"]),
    ("run", "projects.locations.services", "cloud_run.services", 60, ["list", "get", "create", "patch", "delete"]),
    ("run", "projects.locations.jobs", "cloud_run.jobs", 61, ["list", "get", "create", "patch", "delete", "run"]),
    ("artifactregistry", "projects.locations.repositories", "artifacts.repositories", 63, ["list", "get", "create", "patch", "delete"]),
    ("secretmanager", "projects.secrets", "secrets", 66, ["list", "get", "create", "patch", "delete"]),
    ("secretmanager", "projects.secrets.versions", "secrets.versions", 66, ["list", "get", "enable", "disable", "destroy"]),
    ("cloudscheduler", "projects.locations.jobs", "scheduler.jobs", 69, ["list", "get", "create", "patch", "delete", "pause", "resume", "run"]),
    ("pubsub", "projects.topics", "pubsub.topics", 70, ["list", "get", "create", "patch", "delete"]),
    ("pubsub", "projects.subscriptions", "pubsub.subscriptions", 70, ["list", "get", "create", "patch", "delete"]),
    ("cloudtasks", "projects.locations.queues", "tasks.queues", 71, ["list", "get", "create", "patch", "delete", "pause", "resume", "purge"]),
    ("cloudkms", "projects.locations.keyRings", "kms.key_rings", 73, ["list", "get", "create"]),
    ("cloudkms", "projects.locations.keyRings.cryptoKeys", "kms.keys", 73, ["list", "get", "create", "patch", "updatePrimaryVersion"]),
]
GCP_REVIEWED += [
    ("container", "projects.locations.clusters", "kubernetes.clusters", 62, ["list", "get", "create", "delete", "update", "setAddons", "setLocations", "setLogging", "setMonitoring", "setMaintenancePolicy", "setNetworkPolicy", "setResourceLabels", "updateMaster", "startIpRotation", "completeIpRotation", "completeControlPlaneUpgrade", "checkAutopilotCompatibility", "fetchClusterUpgradeInfo"]),
    ("container", "projects.locations.clusters.nodePools", "kubernetes.node_pools", 62, ["list", "get", "create", "delete", "update", "setAutoscaling", "setManagement", "setSize", "rollback", "completeUpgrade", "fetchNodePoolUpgradeInfo"]),
    ("container", "projects.locations.operations", "kubernetes.operations", 62, ["list", "get", "cancel"]),
    ("storage", "buckets", "storage.buckets", 64, ["list", "get", "insert", "patch", "delete", "getIamPolicy", "setIamPolicy", "testIamPermissions", "getStorageLayout"]),
    ("storage", "objects", "storage.objects", 65, ["list", "get", "patch", "delete", "restore"]),
    ("storage", "folders", "storage.folders", 65, ["list", "get", "insert", "delete", "rename"]),
    ("storage", "managedFolders", "storage.managed_folders", 65, ["list", "get", "insert", "delete", "getIamPolicy", "setIamPolicy", "testIamPermissions"]),
    ("storage", "notifications", "storage.notifications", 64, ["list", "get", "insert", "delete"]),
    ("logging", "projects.sinks", "logging.sinks", 67, ["list", "get", "create", "delete", "patch"]),
    ("logging", "projects.exclusions", "logging.exclusions", 67, ["list", "get", "create", "delete", "patch"]),
    ("logging", "projects.metrics", "logging.metrics", 67, ["list", "get", "create", "delete", "update"]),
    ("logging", "projects.locations.buckets", "logging.buckets", 67, ["list", "get", "create", "delete", "patch", "undelete"]),
    ("logging", "projects.locations.buckets.views", "logging.views", 67, ["list", "get", "create", "delete", "patch", "getIamPolicy", "setIamPolicy"]),
    ("logging", "projects.logs", "logging.logs", 67, ["list", "delete"]),
    ("monitoring", "projects.alertPolicies", "monitoring.alert_policies", 68, ["list", "get", "create", "delete", "patch"]),
    ("monitoring", "projects.alerts", "monitoring.alerts", 68, ["list", "get"]),
    ("monitoring", "projects.groups", "monitoring.groups", 68, ["list", "get", "create", "delete", "update"]),
    ("monitoring", "projects.metricDescriptors", "monitoring.metric_descriptors", 68, ["list", "get", "create", "delete"]),
    ("monitoring", "projects.monitoredResourceDescriptors", "monitoring.resource_descriptors", 68, ["list", "get"]),
    ("monitoring", "projects.notificationChannels", "monitoring.notification_channels", 68, ["list", "get", "create", "delete", "patch"]),
    ("monitoring", "projects.snoozes", "monitoring.snoozes", 68, ["list", "get", "create", "patch"]),
    ("monitoring", "projects.uptimeCheckConfigs", "monitoring.uptime_checks", 68, ["list", "get", "create", "delete", "patch"]),
    ("securitycenter", "projects.assets", "security.assets", 72, ["list", "group", "updateSecurityMarks"]),
    ("securitycenter", "projects.sources", "security.sources", 72, ["list"]),
    ("securitycenter", "projects.sources.findings", "security.findings", 72, ["list", "group", "patch", "setMute", "setState", "updateSecurityMarks"]),
    ("securitycenter", "projects.muteConfigs", "security.mute_configs", 72, ["list", "get", "create", "delete", "patch"]),
    ("securitycenter", "projects.notificationConfigs", "security.notification_configs", 72, ["list", "get", "create", "delete", "patch"]),
    ("securitycenter", "projects.bigQueryExports", "security.big_query_exports", 72, ["list", "get", "create", "delete", "patch"]),
    ("backupdr", "projects.locations.backupPlans", "backups.plans", 74, ["list", "get", "create", "delete", "patch"]),
    ("backupdr", "projects.locations.backupPlanAssociations", "backups.associations", 74, ["list", "get", "create", "delete", "patch", "triggerBackup"]),
    ("backupdr", "projects.locations.backupVaults", "backups.vaults", 74, ["list", "get", "create", "delete", "patch", "testIamPermissions"]),
    ("backupdr", "projects.locations.backupVaults.dataSources", "backups.data_sources", 74, ["list", "get"]),
    ("backupdr", "projects.locations.backupVaults.dataSources.backups", "backups.backups", 74, ["list", "get", "delete", "patch", "restore"]),
    ("backupdr", "projects.locations.operations", "backups.operations", 74, ["list", "get", "cancel", "delete"]),
    ("cloudbilling", "projects", "billing.project", 24, ["getBillingInfo", "updateBillingInfo"]),
    ("cloudbilling", "services", "billing.services", 23, ["list"]),
    ("cloudbilling", "services.skus", "billing.skus", 23, ["list"]),
]
GCP_REVIEWED += [
    ("cloudresourcemanager", "organizations", "organizations", 12, ["get"]),
    ("cloudresourcemanager", "folders", "folders", 13, ["list", "get", "create", "patch", "move", "delete", "undelete"]),
    ("cloudresourcemanager", "projects", "projects", 14, ["create", "move"]),
    ("cloudbilling", "billingAccounts", "billing.accounts", 23, ["get"]),
    ("billingbudgets", "billingAccounts.budgets", "budgets", 25, ["list", "get", "create", "patch", "delete"]),
    ("iam", "projects.locations.workloadIdentityPools", "workload_identity.pools", 21, ["list", "get", "create", "patch", "delete", "undelete", "getIamPolicy", "setIamPolicy", "testIamPermissions"]),
    ("iam", "projects.locations.workloadIdentityPools.providers", "workload_identity.providers", 21, ["list", "get", "create", "patch", "delete", "undelete"]),
    ("iam", "projects.serviceAccounts", "service_accounts", 19, ["getIamPolicy", "setIamPolicy", "testIamPermissions"]),
    ("oslogin", "users", "os_login.profiles", 22, ["getLoginProfile", "importSshPublicKey"]),
    ("oslogin", "users.sshPublicKeys", "os_login.public_keys", 22, ["get", "create", "patch", "delete"]),
]
READ_METHODS = {"get", "list", "aggregatedList", "wait", "getIamPolicy", "testIamPermissions", "getStorageLayout", "getBillingInfo", "group", "checkAutopilotCompatibility", "fetchClusterUpgradeInfo", "fetchNodePoolUpgradeInfo", "getLoginProfile"}
GCP_FIELDS = ["name", "id", "kind", "selfLink", "status", "state", "zone", "region", "location", "creationTimestamp", "createTime", "updateTime", "description", "disabled", "enabled", "etag", "version", "labels", "items", "nextPageToken", "unreachables", "done", "error", "warnings", "targetId", "targetLink", "operationType", "startTime", "endTime", "machineType", "bindings", "permissions", "services", "serviceAccounts", "keys", "roles", "repositories", "jobs", "topics", "subscriptions", "queues", "secrets", "versions", "keyRings", "cryptoKeys", "rrsets", "managedZones", "clusters", "nodePools", "operations", "incompatibleWorkloads", "minorTargetVersion", "patchTargetVersion", "sinks", "exclusions", "metrics", "buckets", "views", "logNames", "alertPolicies", "alerts", "groups", "metricDescriptors", "monitoredResourceDescriptors", "notificationChannels", "snoozes", "uptimeCheckConfigs", "listAssetsResults", "listFindingsResults", "groupByResults", "sources", "muteConfigs", "notificationConfigs", "bigQueryExports", "backupPlans", "backupPlanAssociations", "backupVaults", "dataSources", "backups", "billingAccountName", "billingEnabled", "projectId", "skus", "storageClass", "locationType", "projectNumber", "timeCreated", "updated", "size", "contentType", "generation", "metageneration", "crc32c", "md5Hash", "notificationConfig", "topic", "payload_format", "event_types", "custom_attributes", "storageLayout", "hierarchicalNamespace", "uniformBucketLevelAccess", "view", "metricDescriptor", "filter", "destination", "writerIdentity", "entryCount", "byteCount", "displayName", "issues", "summary", "organizations", "folders", "parent", "displayName", "billingAccounts", "open", "currencyCode", "budgets", "amount", "budgetFilter", "thresholdRules", "allUpdatesRule", "costAmount", "units", "nanos", "currencyCode", "workloadIdentityPools", "workloadIdentityPoolProviders", "loginProfile", "posixAccounts", "sshPublicKeys", "disks", "quotaInfos", "quotaPreferences", "quotaId", "metric", "service", "refreshInterval", "metricDisplayName", "quotaDisplayName", "metricUnit", "isPrecise", "isFixed", "isConcurrent", "containerType", "dimensions", "quotaIncreaseEligibility", "isEligible", "ineligibilityReason", "quotaConfig", "preferredValue", "grantedValue", "stateDetail", "reconciling", "fingerprint", "expirationTimeUsec", "username", "uid", "gid", "homeDirectory", "shell", "primary"]


def discovery_document(document, reviewed):
    def convert(value):
        if isinstance(value, list): return [convert(item) for item in value]
        if not isinstance(value, dict): return value
        result = {key: convert(child) for key, child in value.items() if not ((key in {"id", "location"} and isinstance(child, str)) or key == "parameterOrder" or (key == "annotations" and isinstance(child, dict) and "required" in child and "type" not in child))}
        if "$ref" in result: result["$ref"] = "#/components/schemas/" + result["$ref"]
        if result.get("type") == "any": result.pop("type")
        return result
    paths, specs = {}, []
    root = document.get("rootUrl", "")
    if not re.fullmatch(r"https://[a-z0-9-]+\.googleapis\.com/", root):
        raise ValueError("Unexpected Google service host")
    for service, chain, family, requirement, methods in reviewed:
        resource = document
        for member in chain.split("."):
            if member not in resource.get("resources", {}):
                raise ValueError("Reviewed Google resource absent: " + chain)
            resource = resource["resources"][member]
        for method in methods:
            if method not in resource.get("methods", {}):
                raise ValueError("Reviewed Google method absent: " + chain + "." + method)
            operation = resource["methods"][method]
            path = "/" + document.get("servicePath", "") + operation["path"]
            parameters = []
            for name, parameter in operation.get("parameters", {}).items():
                parameters.append({"name": name, "in": parameter["location"], "required": parameter.get("required", False), "schema": convert(parameter)})
            entry = {"operationId": operation["id"], "parameters": parameters, "responses": {"200": {"content": {"application/json": {"schema": convert(operation.get("response", {}))}}}}}
            if operation.get("request"):
                entry["requestBody"] = {"required": True, "content": {"application/json": {"schema": convert(operation["request"])}}}
            paths.setdefault(path, {})[operation["httpMethod"].lower()] = entry
            alias = {"insert": "create", "aggregatedList": "list_aggregated", "getIamPolicy": "iam_policy.get", "setIamPolicy": "iam_policy.set", "testIamPermissions": "iam_permissions.test"}.get(method, re.sub(r"(?<!^)(?=[A-Z])", "_", method).lower())
            kind = "object" if method in READ_METHODS else "mutation_metadata"
            fields = list(GCP_FIELDS)
            spec = route("gcp." + family + "." + alias, "gcp", path, operation["httpMethod"], fields, kind=kind,
                         query=[name for name, parameter in operation.get("parameters", {}).items() if parameter["location"] == "query" and name not in {"project", "projectId", "project_id"}],
                         requirement=({"start":27,"stop":27,"reset":27,"suspend":27,"resume":27,"setMachineType":28,"setLabels":28,"setTags":28,"setMetadata":28,"attachDisk":29,"detachDisk":29}.get(method,requirement) if family=="compute.instances" else 17 if service=="cloudresourcemanager" and method in {"getIamPolicy","setIamPolicy","testIamPermissions"} else requirement), cost=method in {"insert", "create", "run", "resume", "triggerBackup", "restore"} or service=="storage")
            spec["_provider_entry"] = entry
            spec.update(service_host=root[:-1], source_provider="gcp-" + service, semantic_read=method in READ_METHODS, bucket_scope_check=service=="storage" and "bucket" in operation.get("parameters", {}))
            binding = "organization" if chain == "organizations" else "folder" if chain == "folders" or (chain == "projects" and method == "move") else "billing_account" if service == "billingbudgets" or (service == "cloudbilling" and chain == "billingAccounts") else "os_login_user" if service == "oslogin" else None
            if binding:
                spec.update(binding_kind=binding, sensitive=True)
            if service == "cloudbilling" and chain == "projects" and method == "updateBillingInfo":
                spec.update(operation="gcp.billing.projects.link", binding_kind="billing_account", sensitive=True, requires_cost_approval=True, fixed_body={"billingAccountName": "__configured_billing_account__"}, fixed_body_only=True)
                spec["unlink_alias"] = True
            if chain == "folders" and method == "move":
                spec["secondary_binding_kind"] = "destination_folder"
            if chain == "folders" and method in {"create", "move"}:
                spec["fixed_body"] = {"parent" if method == "create" else "destinationParent": "__configured_folder__" if method == "create" else "__configured_destination_folder__"}
            if chain == "projects" and method == "create":
                spec["fixed_body"] = {"projectId": GCP_PROJECT}
            if chain == "projects" and method == "move":
                spec["fixed_body"] = {"destinationParent": "__configured_folder__"}
            if "workloadIdentityPools" in chain:
                spec["fixed_global_location"] = True
            if (chain == "organizations" or (service == "cloudbilling" and chain == "billingAccounts") or (service == "cloudresourcemanager" and chain == "projects")) and method == "get":
                spec["scoped_list_alias"] = "gcp." + family + ".list"

            specs.append(spec)
            if spec.get("unlink_alias"):
                specs.append({**spec, "operation": "gcp.billing.projects.unlink", "fixed_body": {"billingAccountName": ""}})
            if spec.get("scoped_list_alias"):
                specs.append({**spec, "operation": spec["scoped_list_alias"], "kind": "scoped_list"})
    return {"paths": paths, "components": {"schemas": {name: convert(schema) for name, schema in document["schemas"].items()}}}, specs

ANNOTATIONS = {"title", "description", "example", "examples", "deprecated", "readOnly", "writeOnly", "xml", "externalDocs", "discriminator", "default", "enumDescriptions", "enumDeprecated", "repeated"}
FORMATS = {"date", "date-time", "time", "email", "hostname", "ipv4", "ipv6", "uri", "uri-reference", "uuid", "regex"}


class Schemas:
    def __init__(self, document, public_fields=None, strict_metadata=False):
        self.public_fields = public_fields
        self.strict_metadata = strict_metadata
        self.document = document
        self.defs = {}

    def resolve(self, value):
        if not isinstance(value, dict) or "$ref" not in value:
            return value
        ref = value["$ref"]
        if not ref.startswith("#/components/"):
            raise ValueError("Only pinned local OpenAPI references are supported")
        result = self.document
        for key in ref[2:].split("/"):
            result = result[key.replace("~1", "/").replace("~0", "~")]
        return result

    def normalize(self, value):
        if isinstance(value, bool):
            return value
        if not isinstance(value, dict):
            raise ValueError("Schema must be an object or boolean")
        if "$ref" in value:
            ref = value["$ref"]
            if not ref.startswith("#/components/schemas/"):
                raise ValueError("Unsupported remote/provider reference")
            name = ref.split("/")[-1]
            if name not in self.defs:
                self.defs[name] = {}  # recursive references are local, never fetched
                self.defs[name] = self.normalize(self.resolve(value))
            return {"$ref": "#/$defs/" + name}
        result = {}
        for key, child in value.items():
            if key in ANNOTATIONS or key.startswith("x-") or key == "nullable" or (key == "required" and not isinstance(child, list)):
                continue
            if key == "format" and child not in FORMATS:
                continue  # int64/byte/password are annotations, not JSON formats
            if key == "properties":
                result[key] = {name: self.normalize(schema) for name, schema in child.items()}
            elif key in {"items", "additionalProperties", "not"}:
                result[key] = self.normalize(child) if isinstance(child, (dict, bool)) else child
            elif key in {"minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"} and isinstance(child, str):
                result[key] = float(child) if "." in child else int(child)
            elif key in {"allOf", "oneOf", "anyOf"}:
                result[key] = [self.normalize(schema) for schema in child]
            else:
                result[key] = int(child) if isinstance(child, float) and child.is_integer() else json.loads(json.dumps(child))
        if value.get("nullable"):
            if "type" in result:
                result["type"] = list(dict.fromkeys([*(result["type"] if isinstance(result["type"], list) else [result["type"]]), "null"]))
            else:
                result = {"anyOf": [result, {"type": "null"}]}
            if "enum" in result and None not in result["enum"]:
                result["enum"].append(None)
        # OpenAPI's boolean exclusiveMinimum/Maximum need draft-07 numeric form.
        for key, boundary in [("exclusiveMinimum", "minimum"), ("exclusiveMaximum", "maximum")]:
            if isinstance(result.get(key), bool):
                exclusive = result.pop(key)
                if exclusive and boundary in result:
                    result[key] = result.pop(boundary)
        return result


def object_schema(properties, required=()):
    return {"type": "object", "properties": properties, "required": list(required), "additionalProperties": False}


SENSITIVE = re.compile(r"(?:password|passwd|secret|credential|private.?key|client.?key|master.?auth|environment.?variables|^env$|^envVars$|^headers$|push.?endpoint|access.?token|refresh.?token|authorization|connection.?string|encrypted.?value|cookie|^value$|^content$|^payload$|^command$|^body$|^text$|^output$)", re.I)
EXPANSION_SENSITIVE = re.compile(r"(?:download|upload|signed|plaintext|ciphertext|signature|certificate|token|key$|private.?key|public.?key|^data$|url$|uri$|urlTemplate$)", re.I)


def public_schema(value, schemas, definitions):
    """Build a documented metadata projection, never arbitrary provider JSON."""
    if "$ref" in value:
        name = value["$ref"].split("/")[-1]
        if name not in definitions:
            definitions[name] = {}
            definitions[name] = public_schema(schemas.resolve(value), schemas, definitions)
        return {"$ref": "#/$defs/" + name}
    if schemas.strict_metadata and value.get("allOf") and response_properties(value, schemas):
        # Metadata projection is one closed object. Keeping several closed
        # allOf fragments would make their sibling properties contradict.
        value = {"type": "object", "properties": response_properties(value, schemas)}
    normalized = schemas.normalize(value)
    # A schema with no structure is opaque provider data, deliberately omitted.
    if not normalized:
        return {"type": "null"}
    result = {key: child for key, child in normalized.items() if key not in {"properties", "items", "additionalProperties", "required", "allOf", "anyOf", "oneOf"}}
    if "properties" in value:
        result["properties"] = {key: public_schema(child, schemas, definitions) for key, child in value["properties"].items() if not SENSITIVE.search(key) and not (schemas.strict_metadata and EXPANSION_SENSITIVE.search(key)) and (schemas.public_fields is None or key in schemas.public_fields)}
        result["required"] = [key for key in value.get("required", []) if key in result["properties"]]
        result["additionalProperties"] = False
    elif isinstance(value.get("additionalProperties"), dict):
        result["additionalProperties"] = public_schema(value["additionalProperties"], schemas, definitions)
        result["maxProperties"] = 100
    if "items" in value:
        result["items"] = public_schema(value["items"], schemas, definitions)
        result["maxItems"] = min(value.get("maxItems", 100), 100)
    for keyword in ["allOf", "anyOf", "oneOf"]:
        if keyword in value:
            result[keyword] = [public_schema(child, schemas, definitions) for child in value[keyword]]
    # Undocumented key-value maps are opaque and are not returned.
    if result.get("type") == "object" and "properties" not in result and "additionalProperties" not in result and not any(key in result for key in ["allOf", "anyOf", "oneOf"]):
        result.update(properties={}, additionalProperties=False)
    return result


def response_properties(value, schemas):
    value = schemas.resolve(value)
    props = dict(value.get("properties", {}))
    for keyword in ["allOf", "anyOf", "oneOf"]:
        for child in value.get(keyword, []):
            props.update(response_properties(child, schemas))
    return props


def projected_result(spec, raw, schemas):
    definitions = {}
    if spec["kind"] == "typed_projection":
        if not raw:
            raise ValueError("Expansion response needs a documented JSON schema: " + spec["operation"])
        result = public_schema(raw, schemas, definitions)
        resolved = schemas.resolve(raw)
        if resolved.get("type") == "object" and not response_properties(resolved, schemas):
            raise ValueError("Expansion response has no documented properties: " + spec["operation"])
    elif spec["kind"] == "domain":
        result = object_schema({"status": {"type": "string"}, "custom_hostname": {"type": ["string", "null"]},
            "ownership_verification": {"type": ["object", "null"], "properties": {key: {"type": "string"} for key in ["type", "name", "value"]}, "additionalProperties": False},
            "ssl_validation_records": {"type": "array", "maxItems": 100, "items": object_schema({"txt_name": {"type": "string"}, "txt_value": {"type": "string"}})},
            "validation_error_count": {"type": "integer", "minimum": 0}}, ["status", "custom_hostname", "ownership_verification", "ssl_validation_records", "validation_error_count"])
    elif spec["kind"] == "file_content":
        result = object_schema({"path": {"type": "string", "pattern": "^(?:(?!\\.{1,2}(?:/|$))[A-Za-z0-9_.-]+/)*(?!\\.{1,2}$)[A-Za-z0-9_.-]+$"}, "sha": {"type": "string", "pattern": "^[a-f0-9]{40}$"}, "size": {"type": "integer", "minimum": 0, "maximum": 65536}, "encoding": {"const": "base64"}, "content": {"type": "string", "maxLength": 87384, "pattern": "^[A-Za-z0-9+/]*={0,2}$"}, "type": {"const": "file"}}, ["path", "sha", "size", "encoding", "content", "type"])
    elif spec["kind"] in {"mutation_metadata", "empty"}:
        result = object_schema({"accepted": {"const": True}, "effect_confirmed": {"const": False},
            **{key: {"type": ["string", "number", "boolean", "null"]} for key in ["id", "number", "name", "ref", "sha", "state", "status", "url", "content_sha", "commit_sha", "path"]}}, ["accepted", "effect_confirmed"])
    elif spec["kind"] == "openapi":
        result = object_schema({"version": {"type": ["string", "null"]}, "path_names": {"type": "array", "maxItems": 100, "items": {"type": "string"}}}, ["version", "path_names"])
    else:
        source = schemas.resolve(raw)
        if spec["kind"] == "array":
            if source.get("type") != "array":
                raise ValueError("Reviewed list shape differs from provider contract: " + spec["operation"])
            source = schemas.resolve(source["items"])
        elif spec["kind"] == "object_or_array":
            choices = source.get("oneOf", source.get("anyOf", [source]))
            alternatives = []
            for candidate in choices:
                candidate = schemas.resolve(candidate)
                array = candidate.get("type") == "array"
                item = schemas.resolve(candidate["items"]) if array else candidate
                properties = response_properties(item, schemas)
                chosen = {key: public_schema(properties[key], schemas, definitions) for key in spec["fields"] if key in properties}
                projected = object_schema(chosen, [key for key in item.get("required", []) if key in chosen])
                alternatives.append({"type": "array", "items": projected, "maxItems": 100} if array else projected)
            return {"anyOf": alternatives}, definitions
        props = response_properties(source, schemas)
        fields = spec["fields"] or [key for key in props if not SENSITIVE.search(key)]
        chosen = {key: public_schema(props[key], schemas, definitions) for key in fields if key in props and not SENSITIVE.search(key)}
        if not chosen:
            raise ValueError("Reviewed projection has no documented fields: " + spec["operation"])
        result = object_schema(chosen, [key for key in source.get("required", []) if key in chosen])
        result["minProperties"] = 0
        if spec["kind"] == "array":
            result = {"type": "array", "items": result, "maxItems": 100}
        elif spec["kind"] == "object_or_array":
            result = {"anyOf": [result, {"type": "array", "items": result, "maxItems": 100}]}
        elif spec["kind"] == "scoped_list":
            result = {"type": "array", "items": result, "maxItems": 1}
    return result, definitions


def compile_route(spec, document, source):
    path, method = spec["path"], spec["method"].lower()
    if path not in document["paths"] or method not in document["paths"][path]:
        raise ValueError("Reviewed provider route absent from pinned contract: " + spec["operation"])
    entry = spec.get("_provider_entry", document["paths"][path][method])
    schema = Schemas(document)
    parameters = [schema.resolve(p) for p in [*document["paths"][path].get("parameters", []), *entry.get("parameters", [])]]
    properties, required, sections = {}, [], {}
    bindings = {"ref": PROJECT} if spec["provider"] == "supabase" else {"owner": "ausstyle", "repo": "web-staging"} if spec["provider"] == "github" else {}
    fixed_query = dict(spec["fixed_query"])
    if spec["provider"] == "gcp":
        for parameter in parameters:
            name = parameter["name"]
            pattern = parameter.get("schema", {}).get("pattern", "")
            fixed = None
            binding = spec.get("binding_kind")
            if binding and ((name in {"name", "parent"} and (pattern.startswith("^organizations/") or pattern.startswith("^folders/") or pattern == "^billingAccounts/[^/]+$" or pattern == "^users/[^/]+$")) or (binding == "folder" and name == "parent")):
                fixed = "__configured_" + binding + "__"
            elif name in {"project", "projectId", "project_id", "userProject"}:
                fixed = "projects/" + GCP_PROJECT if pattern.startswith("^projects/") else GCP_PROJECT
            elif name == "zone": fixed = GCP_ZONE
            elif name in {"region", "location"}: fixed = "global" if spec.get("fixed_global_location") else GCP_REGION
            elif name in {"name", "parent", "resource"} and pattern in {"^projects/[^/]+$", "^projects/[^/]+/locations/[^/]+$"}:
                fixed = "projects/" + GCP_PROJECT + ("/locations/" + ("global" if spec.get("fixed_global_location") else GCP_REGION) if "/locations/" in pattern else "")
            if fixed is not None:
                (bindings if parameter["in"] == "path" else fixed_query)[name] = fixed
    for location in ["path", "query"]:
        fields, needed = {}, []
        for parameter in parameters:
            name = parameter["name"]
            if parameter["in"] != location or (location == "path" and name in bindings):
                continue
            if location == "query" and name not in spec["query"]:
                continue
            if location == "query" and name in fixed_query:
                continue
            value = schema.normalize(parameter.get("schema", {"type": "string"}))
            if location == "path":
                # Every public path scalar is bounded before percent encoding.
                if value.get("type") == "string":
                    value = {**value, "minLength": max(1, value.get("minLength", 1)), "maxLength": min(1024, value.get("maxLength", 1024))}
            if location == "query" and value.get("type") == "string":
                value.setdefault("maxLength", 4096)
            if spec["kind"] == "file_content" and location == "path" and name == "path":
                value["pattern"] = "^(?:(?!\\.{1,2}(?:/|$))[A-Za-z0-9_.-]+/)*(?!\\.{1,2}$)[A-Za-z0-9_.-]+$"
            fields[name] = value
            if parameter.get("required"):
                needed.append(name)
        if fields:
            properties[location] = object_schema(fields, needed)
            if needed:
                required.append(location)
        sections[location] = list(fields)
    body = schema.resolve(entry.get("requestBody"))
    if body and "schema" in body.get("content", {}).get("application/json", {}):
        properties["body"] = schema.normalize(body["content"]["application/json"]["schema"])
        if body.get("required"):
            required.append("body")
    elif body and body.get("required"):
        raise ValueError("Reviewed route needs an unsupported non-JSON body: " + spec["operation"])
    input_schema = object_schema(properties, required)
    if schema.defs:
        input_schema["$defs"] = schema.defs
    if spec.get("fixed_body") and "body" in properties:
        body_schema = properties["body"]
        if "$ref" in body_schema:
            body_schema = json.loads(json.dumps(schema.defs[body_schema["$ref"].split("/")[-1]]))
            properties["body"] = body_schema
        for name in spec["fixed_body"]:
            body_schema.get("properties", {}).pop(name, None)
            if name in body_schema.get("required", []): body_schema["required"].remove(name)
        if spec.get("fixed_body_only"):
            body_schema["properties"] = {}
            body_schema["required"] = []
        body_schema["additionalProperties"] = False
        if "body" in required and not body_schema.get("required"): required.remove("body")
    if spec.get("file_write_mode"):
        body_schema = properties["body"]
        if spec["file_write_mode"] == "update":
            body_schema.setdefault("required", []).append("sha")
            body_schema["properties"]["sha"] = {"type": "string", "pattern": "^[a-f0-9]{40}$"}
        else:
            body_schema["not"] = {"required": ["sha"]}
    if spec["kind"] == "file_content":
        properties["range"] = object_schema({"offset": {"type": "integer", "minimum": 0, "maximum": 8388608}, "max_bytes": {"type": "integer", "minimum": 1, "maximum": 65536}}, [])
    input_schema["required"] = list(required)
    # The provider's actual JSON response is validated before any projection.
    response_schemas = {}
    response_builder = Schemas(document)
    raw_response = {}
    for code, response in entry["responses"].items():
        response = schema.resolve(response)
        if code.startswith("2") and "application/json" in response.get("content", {}):
            raw = response["content"]["application/json"].get("schema", {})
            response_schemas[code] = response_builder.normalize(raw)
            if not raw_response:
                raw_response = raw
    # Request and response refs share a closed, pinned definition set.
    input_schema["$defs"] = schema.defs
    result_schema, public_defs = projected_result(spec, raw_response, Schemas(document, None if spec.get("strict_metadata_projection") else set(GCP_FIELDS + ["type", "severity", "category", "resource", "resourceName", "resourceType", "reason", "code", "message", "lastTransitionTime", "email", "uniqueId", "role", "members", "condition", "expression", "title", "disabled", "retentionPeriod", "retentionPolicy", "count", "valueType", "metricKind", "unit", "priority", "direction", "action", "sourceRanges", "destinationRanges", "IPProtocol", "ports", "ttl", "rrdatas", "recordType", "backup", "backupType", "resourceProperties"]) if spec["provider"] == "gcp" else None, strict_metadata=spec.get("strict_metadata_projection", False)))
    if spec["kind"] == "file_content":
        result_schema["properties"].update({"offset": {"type":"integer","minimum":0,"maximum":8388608}, "total_size": {"type":"integer","minimum":0,"maximum":8388608}, "next_offset": {"type":["integer","null"],"minimum":0,"maximum":8388608}, "content_sha256": {"type":"string","pattern":"^[a-f0-9]{64}$"}, "source_sha256": {"type":"string","pattern":"^[a-f0-9]{64}$"}})
    mutation = spec["method"] not in {"GET", "HEAD"} and spec["operation"] != "supabase.network.bans.list" and not spec.get("semantic_read")
    # Variable values can contain secrets; they require approval even though GET.
    needs_grant = mutation or spec["sensitive"] or spec["requires_cost_approval"]
    result = {**{key: value for key, value in spec.items() if not key.startswith("_")}, "provider_operation_id": entry["operationId"], "fixed_bindings": bindings, "fixed_query": fixed_query,
              "input_schema": input_schema, "response_schemas": response_schemas, "$defs": response_builder.defs,
              "result_schema": result_schema, "public_defs": public_defs,
              "is_mutation": mutation, "requires_grant": needs_grant,
              "api_exposed": not needs_grant, "ai_exposed": not needs_grant, "verified": False,
              "source": source["source"], "source_sha256": source["sha256"],
              "permission_scope": "infrastructure:write" if needs_grant else "infrastructure:read"}
    result["output_schema"] = output_schema(result)
    result["contract_sha256"] = hashlib.sha256(json.dumps(result, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    return result


def quota_contracts(schemas, source):
    """Reviewed ProtoJSON subset backed by the pinned HTTP-annotated service.

    Discovery is unavailable; the official protobuf specifies the same REST
    contract. Only project/global bindings and documented safety checks apply.
    """
    parts = source["alternative_contracts"] if "alternative_contracts" in source else source.get("alternative_sources", [])
    if not parts:
        parts = source.get("contract_sources", [])
    if not parts:
        # The manifest intentionally stores these under an explicit format list.
        parts = next((value for value in source.values() if isinstance(value, list) and value and isinstance(value[0], dict) and "cache_file" in value[0]), [])
    pinned = {}
    for part in parts:
        raw = (schemas / part["cache_file"]).read_bytes()
        if hashlib.sha256(raw).hexdigest() != part["sha256"]: raise ValueError("Pinned quota protobuf checksum mismatch")
        pinned[part["cache_file"]] = raw.decode()
    rpc_source = next(part for part in parts if part["cache_file"].endswith("-cloudquotas.proto"))
    text = pinned[rpc_source["cache_file"]]
    resources = next(value for key, value in pinned.items() if key.endswith("-resources.proto"))
    string = {"type": "string"}
    int64 = {"type": "string", "pattern": "^(?:-1|[0-9]+)$"}
    dimensions = {"type": "object", "additionalProperties": {"type": "string", "maxLength": 200}, "maxProperties": 20}
    config = object_schema({"preferredValue": int64, "annotations": {"type": "object", "additionalProperties": string, "maxProperties": 20}}, ["preferredValue"])
    preference = object_schema({"name": string, "dimensions": dimensions, "quotaConfig": config, "etag": string, "service": {"type": "string", "pattern": "^[a-z0-9-]+\\.googleapis\\.com$"}, "quotaId": string, "justification": {"type": "string", "maxLength": 2000}, "contactEmail": {"type": "string", "format": "email"}}, ["quotaConfig", "service", "quotaId"])
    info_properties = {key: string for key in ["name", "quotaId", "metric", "service", "refreshInterval", "metricDisplayName", "quotaDisplayName", "metricUnit"]}
    info_properties.update({key: {"type": "boolean"} for key in ["isPrecise", "isFixed", "isConcurrent"]})
    info_properties.update(containerType={"enum": ["CONTAINER_TYPE_UNSPECIFIED", "PROJECT", "FOLDER", "ORGANIZATION"]}, dimensions={"type": "array", "items": string}, quotaIncreaseEligibility={"type": "object", "properties": {"isEligible": {"type": "boolean"}, "ineligibilityReason": string}})
    info = {"type": "object", "properties": info_properties}
    observed_config = {"type": "object", "properties": {"preferredValue": int64, "grantedValue": int64, "stateDetail": string, "traceId": string}}
    observed_preference = {"type": "object", "properties": {**preference["properties"], "quotaConfig": observed_config, "createTime": string, "updateTime": string, "reconciling": {"type": "boolean"}}}
    schemas_map = {"QuotaInfo": info, "QuotaPreference": observed_preference, "QuotaPreferenceInput": preference,
        "ListQuotaInfosResponse": {"type": "object", "properties": {"quotaInfos": {"type": "array", "items": {"$ref": "#/components/schemas/QuotaInfo"}}, "nextPageToken": string}},
        "ListQuotaPreferencesResponse": {"type": "object", "properties": {"quotaPreferences": {"type": "array", "items": {"$ref": "#/components/schemas/QuotaPreference"}}, "nextPageToken": string}}}
    routes = [
      ("ListQuotaInfos", "gcp.quotas.list", "GET", "/v1/{+parent}/quotaInfos", "ListQuotaInfosResponse", ["quotaInfos", "nextPageToken"], {"parent": "^projects/[^/]+/locations/global/services/[^/]+$"}, ["pageSize", "pageToken"]),
      ("GetQuotaInfo", "gcp.quotas.get", "GET", "/v1/{+name}", "QuotaInfo", list(info_properties), {"name": "^projects/[^/]+/locations/global/services/[^/]+/quotaInfos/[^/]+$"}, []),
      ("ListQuotaPreferences", "gcp.quotas.preferences.list", "GET", "/v1/{+parent}/quotaPreferences", "ListQuotaPreferencesResponse", ["quotaPreferences", "nextPageToken"], {"parent": "^projects/[^/]+/locations/[^/]+$"}, ["pageSize", "pageToken", "filter", "orderBy"]),
      ("GetQuotaPreference", "gcp.quotas.preferences.get", "GET", "/v1/{+name}", "QuotaPreference", list(observed_preference["properties"]), {"name": "^projects/[^/]+/locations/global/quotaPreferences/[^/]+$"}, []),
      ("CreateQuotaPreference", "gcp.quotas.request", "POST", "/v1/{+parent}/quotaPreferences", "QuotaPreference", [], {"parent": "^projects/[^/]+/locations/[^/]+$"}, ["quotaPreferenceId"]),
      ("UpdateQuotaPreference", "gcp.quotas.preferences.update", "PATCH", "/v1/{+name}", "QuotaPreference", [], {"name": "^projects/[^/]+/locations/global/quotaPreferences/[^/]+$"}, ["updateMask", "allowMissing", "validateOnly"]),
    ]
    results = []
    for rpc, operation, method, path, result_type, fields, parameters, query in routes:
        if "rpc " + rpc + "(" not in text: raise ValueError("Missing official quota RPC")
        # These wire fields are reviewed explicitly; fail if the source changes.
        for required_field in ["quota_config", "preferred_value", "quota_id", "contact_email"]:
            if required_field not in resources: raise ValueError("Missing official quota field")
        params = [{"name": name, "in": "path", "required": True, "schema": {"type": "string", "pattern": pattern}} for name, pattern in parameters.items()]
        for name in query:
            schema = {"type": "integer", "minimum": 1, "maximum": 100} if name == "pageSize" else {"type": "boolean"} if name in {"allowMissing", "validateOnly"} else {"type": "string", "maxLength": 4096}
            params.append({"name": name, "in": "query", "schema": schema})
        entry = {"operationId": "google.api.cloudquotas.v1.CloudQuotas." + rpc, "parameters": params, "responses": {"200": {"content": {"application/json": {"schema": {"$ref": "#/components/schemas/" + result_type}}}}}}
        if method in {"POST", "PATCH"}: entry["requestBody"] = {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/QuotaPreferenceInput"}}}}
        document = {"paths": {path: {method.lower(): entry}}, "components": {"schemas": schemas_map}}
        spec = route(operation, "gcp", path, method, fields, query=query, requirement=16, kind="object" if method == "GET" else "mutation_metadata", cost=method != "GET")
        spec.update(service_host="https://cloudquotas.googleapis.com", source_provider="gcp-cloudquotas", semantic_read=method=="GET", fixed_global_location=True, source_contract_parts=parts)
        results.append(compile_route(spec, document, rpc_source))
    return results


def build(schemas, manifest, include_expansion=False):
    sources = {row["provider"]: row for row in manifest}
    documents = {}
    for provider in {route["provider"] for route in REVIEWED}:
        raw = (schemas / (provider + ".json")).read_bytes()
        if hashlib.sha256(raw).hexdigest() != sources[provider]["sha256"]:
            raise ValueError("Pinned provider checksum mismatch: " + provider)
        documents[provider] = json.loads(raw)
    contracts = [compile_route(spec, documents[spec["provider"]], sources[spec["provider"]]) for spec in REVIEWED]
    for service in sorted({item[0] for item in GCP_REVIEWED}):
        provider = "gcp-" + service
        raw = (schemas / (provider + ".json")).read_bytes()
        if hashlib.sha256(raw).hexdigest() != sources[provider]["sha256"]:
            raise ValueError("Pinned Google contract checksum mismatch: " + provider)
        document, specs = discovery_document(json.loads(raw), [item for item in GCP_REVIEWED if item[0] == service])
        contracts.extend(compile_route(spec, document, sources[provider]) for spec in specs)
    contracts.extend(quota_contracts(schemas, sources["gcp-cloudquotas"]))
    if include_expansion:
        from provider_scope_expansion import compile_expansion
        additions, _ = compile_expansion(schemas, manifest, contracts)
        contracts.extend(additions)
    if len({item["operation"] for item in contracts}) != len(contracts):
        raise ValueError("Duplicate reviewed operation")
    return {"contract_version": "1.0.0", "project_ref": PROJECT, "repository": REPOSITORY,
            "gcp_project_id": GCP_PROJECT, "gcp_zone": GCP_ZONE, "gcp_region": GCP_REGION,
            "operations": contracts, "full_provider_scope_complete": False}


def output_schema(contract):
    envelope = object_schema({"ok": {"const": True}, "operation": {"const": contract["operation"]},
        "contract_version": {"const": "1.0.0"}, "provider": {"const": contract["provider"]},
        "request_state": {"enum": ["observed", "accepted"]}, "executed": {"const": True},
        "admission_id": {"type": "string", "format": "uuid"}, "provider_http_status": {"type": "integer"}, "provider_request_id": {"type": ["string", "null"]},
        "result": contract["result_schema"], "possibly_truncated": {"type": "boolean"}, "result_limit": {"type": "integer", "minimum": 1},
        "next_page": {"type": ["integer", "null"], "minimum": 1}},
        ["ok", "operation", "contract_version", "provider", "request_state", "executed", "admission_id", "provider_http_status", "provider_request_id", "result", "possibly_truncated", "result_limit", "next_page"])
    envelope["$defs"] = contract["public_defs"]
    return envelope


def migration(catalogue):
    values = []
    for contract in catalogue["operations"]:
        envelope = output_schema(contract)
        description = ("Fixed scoped " + contract["provider"] + " " + contract["method"] + " adapter for " + contract["provider_operation_id"] +
                       "; projected metadata/receipt, not full provider lifecycle acceptance; contract v1.0.0.")
        vals = [contract["operation"], contract["provider"], description, contract["permission_scope"], contract["is_mutation"],
                contract["input_schema"], envelope, "sandy-provider-operation-api", contract["api_exposed"], False,
                contract["ai_exposed"], False, "source_ready", "ausstyle/web-staging",
                "supabase/functions/sandy-provider-operation-api/index.ts",
                ["enabled_owner_or_scoped_service_api_key", "provider_credential_and_iam", "project_or_repository_binding", *(["verified_exact_contract", "immutable_execution_approval", "one_use_execution_grant"] if contract["requires_grant"] else []), *(["verified_server_scope_binding:" + contract["binding_kind"]] if contract.get("binding_kind") else []), *(["existing_custom_domain_entitlement"] if contract["operation"].startswith("supabase.domains.") else [])],
                {"contract_sha256": contract["contract_sha256"], "provider_source_sha256": contract["source_sha256"], "provider_operation_id": contract["provider_operation_id"], "requires_grant": contract["requires_grant"], "requires_approval": contract["requires_grant"], "api_key_delegable": not contract["requires_grant"] and not contract["requires_cost_approval"], "requires_cost_approval": contract["requires_cost_approval"], "sensitive_response": contract["sensitive"], "requirement": contract["requirement"]}]
        sql = []
        for item in vals:
            if isinstance(item, bool): sql.append("true" if item else "false")
            elif isinstance(item, (dict, list)): sql.append("'" + json.dumps(item, separators=(",", ":")).replace("'", "''") + "'::jsonb")
            else: sql.append("'" + str(item).replace("'", "''") + "'")
        values.append("(" + ",".join(sql) + ")")
    return ("-- Reviewed provider contracts; executable dispatch exists in sandy-provider-operation-api.\n"
            "-- No provider write, plan purchase, exposure of unverified mutations or verification claim.\nBEGIN;\n"
            "INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract) VALUES\n" +
            ",\n".join(values) + "\nON CONFLICT (operation) DO NOTHING;\nCOMMIT;\n")


def compact_manifest(catalogue):
    keys = ["operation", "provider", "is_mutation", "permission_scope", "contract_sha256", "requires_grant", "requires_cost_approval", "requirement", "binding_kind", "secondary_binding_kind"]
    result = {key: value for key, value in catalogue.items() if key != "operations"}
    result["operations"] = []
    for item in catalogue["operations"]:
        value = {key: item[key] for key in keys if key in item}
        for kind in ["input_schema", "output_schema"]:
            value[kind + "_sha256"] = hashlib.sha256(json.dumps(item[kind], sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
        result["operations"].append(value)
    return result


def catalogue_loader(source: bytes) -> str:
    """Transport the same checked-in JSON below the Management upload limit."""
    if not 0 < len(source) <= 16 * 1024 * 1024:
        raise ValueError("provider_catalogue_size_limit")
    buffer = io.BytesIO()
    with gzip.GzipFile(fileobj=buffer, mode="wb", filename="", mtime=0) as compressed:
        compressed.write(source)
    payload = base64.b64encode(buffer.getvalue()).decode("ascii")
    template = '''/** Generated by scripts/sandy/build_provider_operations.py.
 * Standard gzip packaging keeps source upload below the Management proxy limit.
 * The complete reviewable JSON remains in contracts.json. No remote fetch occurs.
 */
export async function decodeProviderCatalogue(payload: string, expectedBytes: number, expectedSha256: string): Promise<unknown> {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > 16 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(expectedSha256)) throw Error("provider_catalogue_integrity_failed");
  let bytes = new Uint8Array();
  try {
    const packed = Uint8Array.from(atob(payload), value => value.charCodeAt(0));
    const reader = new Blob([packed]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > expectedBytes) { await reader.cancel(); throw Error(); } chunks.push(part.value); } } finally { reader.releaseLock(); }
    if (size !== expectedBytes) throw Error();
    bytes = new Uint8Array(size); let offset = 0; for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
  } catch { throw Error("provider_catalogue_integrity_failed"); }
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
  if (actual !== expectedSha256) throw Error("provider_catalogue_integrity_failed");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw Error("provider_catalogue_integrity_failed"); }
}
const catalogue = await decodeProviderCatalogue(__PAYLOAD__, __BYTES__, "__SHA256__");
export default catalogue;
'''
    return (template.replace("__PAYLOAD__", json.dumps(payload))
            .replace("__BYTES__", str(len(source)))
            .replace("__SHA256__", hashlib.sha256(source).hexdigest()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schemas", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, default=Path("docs/sandy-api/provider-schema-manifest.json"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--migration", type=Path)
    parser.add_argument("--gateway-output", type=Path)
    parser.add_argument("--loader-output", type=Path)
    parser.add_argument("--include-expansion", action="store_true", help="Include reviewed constituent actions from provider_scope_expansion.py")
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    baseline = build(args.schemas, manifest)
    result = baseline
    additions = None
    if args.include_expansion:
        from provider_scope_expansion import compile_expansion, expansion_shards
        extra, _ = compile_expansion(args.schemas, manifest, baseline["operations"])
        additions = {**baseline, "operations": extra}
        result = {**baseline, "operations": [*baseline["operations"], *extra]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # This generated catalogue is deployed as an Edge Function dependency.
    # Compact JSON preserves every schema/contract hash while avoiding oversized
    # Management API multipart uploads; human review uses the compiler/tests.
    source = (json.dumps(baseline, separators=(",", ":"), ensure_ascii=False) + "\n").encode()
    args.output.write_bytes(source)
    loader = args.loader_output or args.output.with_name("catalogue.ts")
    loader.write_text(catalogue_loader(source))
    gateway = args.gateway_output or args.output.with_name("gateway_manifest.json")
    gateway.write_text(json.dumps(compact_manifest(baseline), separators=(",", ":"), ensure_ascii=False) + "\n")
    if additions is not None:
        args.output.with_name("expansion_gateway_manifest.json").write_text(json.dumps(compact_manifest(additions), separators=(",", ":"), ensure_ascii=False) + "\n")
        args.output.with_name("expansion_contracts.json").write_text(json.dumps(additions, separators=(",", ":"), ensure_ascii=False) + "\n")
        shards = expansion_shards(additions["operations"], args.output.parent / "expansion_shards")
        args.output.with_name("expansion_shard_manifest.json").write_text(json.dumps(shards, indent=2) + "\n")
    if args.migration:
        args.migration.write_text(migration(additions if additions is not None else result))
    print(json.dumps({"reviewed_operations": len(result["operations"]), "safe_reads": sum(not item["requires_grant"] for item in result["operations"]), "unverified_grant_operations": sum(item["requires_grant"] for item in result["operations"]), "runtime_verified": False}))


if __name__ == "__main__":
    main()
