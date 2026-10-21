/** Deterministic additive closed registry metadata; never applies SQL. */
import { supplementContracts } from "../../supabase/functions/sandy-provider-supplement-api/contracts.ts";
import { argumentDigest } from "../../supabase/functions/_shared/sandy_api_protocol.ts";
const migration =
  "supabase/migrations/20261021008400_sandy_provider_supplement.sql";
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const json = (value: unknown) => quote(JSON.stringify(value)) + "::jsonb";
const prefix = (await Deno.readTextFile(migration)).split(
  "-- GENERATED_CONSUMER_AND_REGISTRY",
)[0];
const original = await Deno.readTextFile(
  "supabase/migrations/20261021008300_sandy_provider_gap_consumer.sql",
);
const oldBody = original.match(/AS \$\$([\s\S]*?)\$\$;/)?.[1];
if (
  !oldBody ||
  !oldBody.includes("'sandy-provider-read-api','sandy-provider-gap-api')")
) throw Error("reviewed_consumer_source_missing");
const bytes = new TextEncoder().encode(oldBody);
const oldHash = Array.from(
  new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  (b) => b.toString(16).padStart(2, "0"),
).join("");
if (
  oldHash !== "ff5e15282be44ce823b77e71d477dc3be74bb93c58a7ded1d279e0f2bdd3999c"
) throw Error("reviewed08300_source_mismatch");
const consumer =
  `DO $consumer$\nDECLARE original text; updated text;\nBEGIN\n SELECT prosrc INTO original FROM pg_proc WHERE oid='public.sandy_credential_resolve_consumer(text,uuid,uuid,text)'::regprocedure AND prosecdef;\n IF encode(extensions.digest(original,'sha256'),'hex') IS DISTINCT FROM '${oldHash}' THEN RAISE EXCEPTION 'reviewed08300_consumer_required'; END IF;\n updated:=replace(original,${
    quote("'sandy-provider-read-api','sandy-provider-gap-api')")
  },${
    quote(
      "'sandy-provider-read-api','sandy-provider-gap-api','sandy-provider-supplement-api')",
    )
  });\n IF updated IS NOT DISTINCT FROM original THEN RAISE EXCEPTION 'consumer_allowlist_replacement_failed'; END IF;\n EXECUTE 'CREATE OR REPLACE FUNCTION public.sandy_credential_resolve_consumer(p_consumer text,p_actor uuid,p_admission uuid,p_operation text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS '||quote_literal(updated);\nEND $consumer$;\nREVOKE ALL ON FUNCTION public.sandy_credential_resolve_consumer(text,uuid,uuid,text) FROM PUBLIC,anon,authenticated;\nGRANT EXECUTE ON FUNCTION public.sandy_credential_resolve_consumer(text,uuid,uuid,text) TO service_role;\n`;
const operations = Object.values(supplementContracts).sort((a, b) =>
  a.operation < b.operation ? -1 : 1
);
const partial = (kind: string) =>
  kind === "effective_security" || kind.startsWith("download_");
const rows = operations.map((op) => {
  const limit = op.kind === "effective_security"
    ? "Provider response schema absent in pinned discovery; private capture only, typed effective-policy semantics remain missing"
    : op.kind.startsWith("download_")
    ? "Documented302 private initiation implemented; following signed download URL requires reviewed documented storage-host policy"
    : op.is_mutation
    ? "Bounded1MiB transfer/acceptance only; no durable provider outcome certification"
    : "Bounded1MiB private capture or exact authorized-resource metadata only";
  const error = {
    version: "1.0.0",
    contract_sha256: op.contract_sha256,
    requires_grant: true,
    requires_approval: true,
    requires_cost_approval: false,
    api_key_delegable: false,
    requirement_ids: [op.requirement],
    source_review_only: true,
    provider_schema_verified: op.kind !== "effective_security",
    runtime_provider_verified: false,
    provider_source: op.source,
    provider_source_sha256: op.source_sha256,
    provider_operation_id: op.provider_operation_id,
    canonical_operation: op.operation,
    adapter_limitations: limit,
    payload_transfer_complete: false,
    unknown_outcome:
      "No automatic mutation redispatch; reconcile authoritative provider state with a fresh read admission",
    provider_acceptance_is_effect_verification: false,
  };
  return "(" +
    [
      quote(op.operation),
      quote(op.provider),
      quote(limit),
      quote(op.permission_scope),
      String(op.is_mutation),
      json(op.input_schema),
      json(op.output_schema),
      "'sandy-provider-supplement-api'",
      "false",
      "false",
      "false",
      "false",
      "'source_ready'",
      "'ausstyle/web-staging'",
      "'supabase/functions/sandy-provider-supplement-api/index.ts'",
      json([
        "normal_owner_session",
        "enabled_controller_owner",
        "explicit_exact_scope_approval",
        "one_use_exact_scope_admission",
        "verified_contract",
        "runtime_provider_egress",
        "credential_consumer_schema",
        "private_media_custody_schema",
      ]),
      json(error),
      json({ automatic: false, safe_to_retry: !op.is_mutation }),
      json({
        automatic: false,
        applicable: false,
        reason: "Separate approved provider-specific compensation",
      }),
    ].join(",") + ")";
});
await Deno.writeTextFile(
  migration,
  prefix + "-- GENERATED_CONSUMER_AND_REGISTRY\n" + consumer +
    "INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES\n" +
    rows.join(",\n") + ";\nCOMMIT;\n",
);
const catalogue = await Promise.all(
  operations.map(async (op) => ({
    operation: op.operation,
    kind: op.kind,
    provider: op.provider,
    requirement: op.requirement,
    provider_operation_id: op.provider_operation_id,
    is_mutation: op.is_mutation,
    requires_grant: true,
    requires_approval: true,
    permission_scope: op.permission_scope,
    contract_sha256: op.contract_sha256,
    input_schema_sha256: await argumentDigest(op.input_schema),
    output_schema_sha256: await argumentDigest(op.output_schema),
  })),
);
await Deno.writeTextFile(
  "supabase/functions/sandy-provider-supplement-api/gateway_manifest.json",
  JSON.stringify({ operations: catalogue }, null, 2) + "\n",
);
await Deno.writeTextFile(
  "supabase/functions/sandy-provider-supplement-api/contracts.json",
  JSON.stringify(operations, null, 2) + "\n",
);
await Deno.writeTextFile(
  "docs/sandy-api/provider-supplement-coverage.json",
  JSON.stringify(
    {
      schema_version: "1.0.0",
      immutable_baseline: "a1dd1d4",
      original_inventory_methods: 1860,
      dedicated_adapters: operations.length,
      fully_implemented_bounded_adapters: operations.filter((op) =>
        !partial(op.kind)
      ).length,
      partial_adapters: operations.filter((op) => partial(op.kind)).length,
      provider_execution_performed: false,
      auth_session_tested: false,
      provider_verified_operations: 0,
      all_161_requirements_completed: false,
      operations: operations.map((op) => ({
        operation: op.operation,
        provider_operation_id: op.provider_operation_id,
        requirement: op.requirement,
        implementation: partial(op.kind)
          ? "partial_transport_capture_or_initiation"
          : "bounded_dedicated_source_ready",
        api_exposed: false,
        verified: false,
        provider_tested: false,
        contract_sha256: op.contract_sha256,
      })),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({ generated: operations.length, closed_unverified: true }),
);
