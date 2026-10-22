/** Additive08600 source metadata and guarded private-state dispatch extension. */
import { boundContracts } from "../../supabase/functions/sandy-provider-bound-api/contracts.ts";
import { gapContracts } from "../../supabase/functions/sandy-provider-gap-api/contracts.ts";
import { argumentDigest } from "../../supabase/functions/_shared/sandy_api_protocol.ts";
const quote = (v: string) => "'" + v.replaceAll("'", "''") + "'",
  json = (v: unknown) => quote(JSON.stringify(v)) + "::jsonb";
async function digest(v: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
const previous = await Deno.readTextFile(
  "supabase/migrations/20261021008500_sandy_provider_sensitive.sql",
);
const body = (name: string) => {
  const start = previous.indexOf("CREATE OR REPLACE FUNCTION public." + name),
    fragment = previous.slice(start);
  const match = fragment.match(/ AS '((?:''|[^'])*)';/);
  if (start < 0 || !match) throw Error("reviewed08500_source_missing");
  return match[1].replaceAll("''", "'");
};
const context = body("sandy_provider_supplement_context"),
  consumer = body("sandy_credential_resolve_consumer");
const ops = Object.values(boundContracts).sort((a, b) =>
  a.operation < b.operation ? -1 : 1
);
if (ops.length !== 48) throw Error("bound48_required");
const paged = ops.filter((op) => op.opaque_pagination).map((op) =>
  op.operation
);
if (paged.length !== 2) throw Error("reviewed2_cursor_methods_required");
const cases = [
  ` WHEN admission.operation='supabase.branches.diff.bound' THEN target !~ '^https://api\\.supabase\\.com/v1/branches/([a-z]{20}|[a-fA-F0-9-]{36})/diff(?:\\?(?:included_schemas=(?:[A-Za-z0-9*._+-]|%[0-9A-F]{2})*(?:&pgdelta=(?:[A-Za-z0-9*._+-]|%[0-9A-F]{2})*)?|pgdelta=(?:[A-Za-z0-9*._+-]|%[0-9A-F]{2})*))?$'`,
  ` WHEN admission.operation='gcp.firewall_policies.list.bound' THEN target !~ '^https://compute\\.googleapis\\.com/compute/v1/locations/global/firewallPolicies\\?(?:[^#[:space:]]*&)?parentId=(folders|organizations)%2F[0-9]+(?:&[^#[:space:]]*)?$'`,
  ` WHEN admission.operation='gcp.pubsub.snapshots.list.bound' THEN target !~ '^https://pubsub\\.googleapis\\.com/v1/projects/elaborate-haven-511518-a5/snapshots\\?[^#[:space:]]*$'`,
].join("\n");
let updated = context.replace(
  "entry.handler NOT IN ('sandy-provider-supplement-api','sandy-provider-sensitive-api')",
  "entry.handler IS NULL OR entry.handler NOT IN ('sandy-provider-supplement-api','sandy-provider-sensitive-api','sandy-provider-bound-api')",
)
  .replace(" ELSE true END) THEN", () => cases + "\n ELSE true END) THEN");
updated = updated.replace(
  "'gcp.billing.accounts.list_filtered'))",
  "'gcp.billing.accounts.list_filtered','gcp.firewall_policies.list.bound','gcp.pubsub.snapshots.list.bound'))",
);
if (
  updated === context || !updated.includes("sandy-provider-bound-api") ||
  !updated.includes("'gcp.pubsub.snapshots.list.bound'))")
) throw Error("bound_context_extension_failed");
const consumerUpdated = consumer.replace(
  "'sandy-provider-sensitive-api')",
  "'sandy-provider-sensitive-api','sandy-provider-bound-api')",
);
if (consumerUpdated === consumer) {
  throw Error("bound_consumer_extension_failed");
}
const rows = ops.map((op) =>
  "(" + [
    quote(op.operation),
    quote(op.provider),
    quote(
      "Typed fixed-resource metadata/acceptance with fresh relationship proofs. No provider execution or full lifecycle verification is attested by source readiness.",
    ),
    quote(op.permission_scope),
    String(op.is_mutation),
    json(op.input_schema),
    json(op.output_schema),
    "'sandy-provider-bound-api'",
    "false",
    "false",
    "false",
    "false",
    "'source_ready'",
    "'ausstyle/web-staging'",
    "'supabase/functions/sandy-provider-bound-api/index.ts'",
    json([
      "normal_owner_session",
      "enabled_controller_owner",
      "explicit_exact_scope_approval",
      "one_use_exact_scope_admission",
      "verified_contract",
      "runtime_provider_egress",
      "credential_consumer_schema",
      "authorized_resource_fixture",
      ...(op.service === "compute"
        ? ["verified_hierarchical_parent_binding"]
        : []),
    ]),
    json({
      version: "1.0.0",
      contract_sha256: op.contract_sha256,
      requires_grant: true,
      requires_approval: true,
      api_key_delegable: false,
      requires_cost_approval:
        (op as unknown as Record<string, unknown>).requires_cost_approval ===
          true,
      requirement_ids: [op.requirement],
      provider_source: op.source,
      provider_source_sha256: op.source_sha256,
      provider_operation_id: op.provider_operation_id,
      canonical_operation: op.operation,
      relationship_guard: op.relationship_guard,
      source_review_only: true,
      provider_schema_verified: true,
      runtime_provider_verified: false,
      unknown_outcome:
        "No automatic redispatch after possible effects; reconcile with an exact read admission",
      provider_acceptance_is_effect_verification: false,
      boundary: op.private_diff_capture
        ? "private_text_diff_capture_only"
        : op.is_mutation
        ? "typed_provider_acceptance_only"
        : "bounded_typed_metadata_only",
    }),
    json({ automatic: false, safe_to_retry: !op.is_mutation }),
    json({
      automatic: false,
      applicable: false,
      reason:
        "Separate approved provider-specific compensation; locked retention cannot be automatically reversed",
    }),
  ].join(",") + ")"
);
const sql =
  `--08600 relationship-bound source; no provider execution or activation.\nBEGIN;\nDO $guard$\nDECLARE context_source text; consumer_source text;\nBEGIN\n SELECT prosrc INTO context_source FROM pg_proc WHERE oid='public.sandy_provider_supplement_context(jsonb)'::regprocedure AND prosecdef;\n SELECT prosrc INTO consumer_source FROM pg_proc WHERE oid='public.sandy_credential_resolve_consumer(text,uuid,uuid,text)'::regprocedure AND prosecdef;\n IF encode(extensions.digest(context_source,'sha256'),'hex') IS DISTINCT FROM '${await digest(
    context,
  )}' OR encode(extensions.digest(consumer_source,'sha256'),'hex') IS DISTINCT FROM '${await digest(
    consumer,
  )}' THEN RAISE EXCEPTION 'reviewed08500_private_boundary_required'; END IF;\nEND $guard$;\nCREATE OR REPLACE FUNCTION public.sandy_provider_supplement_context(p_context jsonb) RETURNS public.sandy_api_execution_admissions LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS ${
    quote(updated)
  };\nCREATE OR REPLACE FUNCTION public.sandy_credential_resolve_consumer(p_consumer text,p_actor uuid,p_admission uuid,p_operation text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS ${
    quote(consumerUpdated)
  };\nREVOKE ALL ON FUNCTION public.sandy_provider_supplement_context(jsonb) FROM PUBLIC,anon,authenticated,service_role;\nREVOKE ALL ON FUNCTION public.sandy_credential_resolve_consumer(text,uuid,uuid,text) FROM PUBLIC,anon,authenticated;\nGRANT EXECUTE ON FUNCTION public.sandy_credential_resolve_consumer(text,uuid,uuid,text) TO service_role;\nINSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES\n${
    rows.join(",\n")
  };\nCOMMIT;\n`;
await Deno.writeTextFile(
  "supabase/migrations/20261021008600_sandy_provider_resource_relationships.sql",
  sql,
);
await Deno.writeTextFile(
  "supabase/functions/sandy-provider-bound-api/contracts.json",
  JSON.stringify(ops, null, 2) + "\n",
);
const compact = await Promise.all(
  ops.map(async (op) => ({
    operation: op.operation,
    provider: op.provider,
    service: op.service,
    method_name: op.method_name,
    is_mutation: op.is_mutation,
    permission_scope: op.permission_scope,
    requires_grant: true,
    requires_approval: true,
    requirement: op.requirement,
    contract_sha256: op.contract_sha256,
    input_schema_sha256: await argumentDigest(op.input_schema),
    output_schema_sha256: await argumentDigest(op.output_schema),
  })),
);
await Deno.writeTextFile(
  "supabase/functions/sandy-provider-bound-api/gateway_manifest.json",
  JSON.stringify({ operations: compact }, null, 2) + "\n",
);
const mapped = Object.values(gapContracts).flatMap((op) =>
  op.provider_operation_id.startsWith("packages/")
    ? op.provider_operation_id.split("|").map((id) => ({
      provider_operation_id: id,
      canonical_operation: op.operation,
    }))
    : []
);
await Deno.writeTextFile(
  "docs/sandy-api/provider-binding-coverage.json",
  JSON.stringify(
    {
      schema_version: "1.0.0",
      inventory_binding_methods: 64,
      new_bound_methods: 48,
      existing_package_method_variants: mapped.length,
      provider_called: false,
      auth_session_tested: false,
      all_161_requirements_completed: false,
      boundary:
        "Typed bounded metadata/acceptance and private branch diff capture; provider outcomes/IAM/fixtures/configuration remain unverified",
      operations: ops.map((op) => ({
        operation: op.operation,
        provider_operation_id: op.provider_operation_id,
        requirement: op.requirement,
        relationship_guard: op.relationship_guard,
        implementation_missing: false,
        verified: false,
        api_exposed: false,
        external_dependencies: [
          "authorized_resource_fixture",
          "provider_IAM",
          "Controller_session",
          "runtime_egress",
          ...(op.service === "compute"
            ? ["verified_hierarchical_parent_binding"]
            : []),
        ],
      })),
      existing_package_variants: mapped,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({
  generated: ops.length,
  paged: paged.length,
  existing_package_variants: mapped.length,
  all_closed_unverified: true,
  context_source_sha256: await digest(updated),
  consumer_source_sha256: await digest(consumerUpdated),
}));
