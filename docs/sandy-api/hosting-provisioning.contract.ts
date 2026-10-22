/**
 * Sandy Hosting v1 — API contract. Source-only, NOT deployed or registered.
 * Owner: SANDY-ENG-0005 (API); tenant/commerce policy SANDY-ENG-0010.
 * Must use Sandy's existing authenticated API gateway, job/outbox and audited provider adapter.
 * No Firebase; customer apps: Cloud Run + Cloud SQL + Cloud Storage.
 */
export const HOSTING_CONTRACT_VERSION = "1.0.0" as const;
export const HOSTING_PROJECT = "elaborate-haven-511518-a5" as const;
export const HOSTING_REGION = "europe-west8" as const;

export const hostingOperationDefinitions = {
  "hosting.accounts.create": {
    method: "POST", path: "/v1/hosting/accounts", mutation: true,
    permission: "hosting:accounts:create", costApprovalRequired: true,
    required: ["plan", "idempotency_key"],
    description: "Create a logical customer hosting account only; never provision billable GCP resources on account creation."
  },
  "hosting.accounts.get": {
    method: "GET", path: "/v1/hosting/accounts/{account_id}", mutation: false,
    permission: "hosting:accounts:read"
  },
  "hosting.sites.create": {
    method: "POST", path: "/v1/hosting/sites", mutation: true,
    permission: "hosting:sites:create", costApprovalRequired: true,
    required: ["account_id", "source", "idempotency_key"],
    description: "Admit durable site job; choose Cloud Run service name; do not report live until provider readback."
  },
  "hosting.sites.deploy": {
    method: "POST", path: "/v1/hosting/sites/{site_id}/deploy", mutation: true,
    permission: "hosting:sites:deploy", required: ["source_ref", "idempotency_key"],
    description: "Build immutable artifact, deploy canary revision, validate, and shift traffic only after acceptance."
  },
  "hosting.databases.create": {
    method: "POST", path: "/v1/hosting/databases", mutation: true,
    permission: "hosting:databases:create", costApprovalRequired: true,
    required: ["site_id", "engine", "idempotency_key"],
    description: "Use Cloud SQL PostgreSQL default; dedicated restricted principal/database; never return passwords."
  },
  "hosting.domains.attach": {
    method: "POST", path: "/v1/hosting/domains", mutation: true,
    permission: "hosting:domains:attach", required: ["site_id", "hostname", "idempotency_key"],
    description: "Verify domain control, configure HTTPS LB/Certificate Manager, and confirm DNS/certificate status."
  },
  "hosting.jobs.get": {
    method: "GET", path: "/v1/hosting/jobs/{job_id}", mutation: false,
    permission: "hosting:jobs:read"
  }
} as const;

export type HostingPlan = "starter" | "business" | "premium";
export type HostingJobState =
  | "accepted" | "awaiting_approval" | "provisioning" | "verifying"
  | "verified_success" | "failed" | "reconciliation_required" | "cancelled";

export type HostingAccountCreate = {
  plan: HostingPlan;
  idempotency_key: string;
  // customer/tenant identity MUST be derived from verified gateway actor context.
};

export type HostingSiteCreate = {
  account_id: string;
  source: { kind: "github"; repository: string; commit_sha: string };
  idempotency_key: string;
};

export type HostingDatabaseCreate = {
  site_id: string;
  engine: "postgresql" | "mysql";
  capacity_tier: "shared" | "dedicated";
  idempotency_key: string;
};

export type HostingJobReceipt = {
  contract_version: typeof HOSTING_CONTRACT_VERSION;
  job_id: string;
  state: HostingJobState;
  accepted: boolean;
  execution_started: boolean;
  provider_resource_ids: string[];
  evidence_refs: string[];
  observed_at: string;
  error?: { code: string; message: string };
};

/** These are mandatory gates, not implementations; fail closed until installed. */
export const hostingReleaseGates = [
  "Verified authenticated actor context; tenant ownership and entitlement checks",
  "Durable idempotent admission with request digest and conflict detection",
  "Approved budget/quota; deny customer requests that exceed delegated limits",
  "Least-privileged provider executor with renewable credentials and no key leaks",
  "Tenant-scoped Cloud Run service identity and Cloud SQL access",
  "Cloud Build provenance, pinned image digest, staging/canary and rollback",
  "Private SQL network connection, secret storage, connection pooling",
  "Domain ownership and DNS verification before routing or certificate activation",
  "Independent provider readbacks, receipts and reconciliation on uncertain outcomes",
  "Backups and recovery checks, metering and deprovision safeguards",
  "Production canary and authenticated MCP discovery/execute acceptance"
] as const;
