/** New08500 metadata/guarded custody extension only; never applies SQL. */
import { sensitiveContracts } from "../../supabase/functions/sandy-provider-sensitive-api/contracts.ts";
import { argumentDigest } from "../../supabase/functions/_shared/sandy_api_protocol.ts";
const quote = (v: string) => "'" + v.replaceAll("'", "''") + "'";
const json = (v: unknown) => quote(JSON.stringify(v)) + "::jsonb";
async function digest(v: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
const previous = await Deno.readTextFile(
  "supabase/migrations/20261021008400_sandy_provider_supplement.sql",
);
const context = previous.match(
  /CREATE FUNCTION public\.sandy_provider_supplement_context\(p_context jsonb\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/,
)?.[1];
if (!context) throw Error("reviewed08400_context_source_missing");
const original = await Deno.readTextFile(
  "supabase/migrations/20261021008300_sandy_provider_gap_consumer.sql",
);
const consumer = original.match(/AS \$\$([\s\S]*?)\$\$;/)?.[1]?.replace(
  "'sandy-provider-read-api','sandy-provider-gap-api')",
  "'sandy-provider-read-api','sandy-provider-gap-api','sandy-provider-supplement-api')",
);
if (!consumer) throw Error("reviewed08400_consumer_source_missing");
const ops = Object.values(sensitiveContracts).sort((a, b) =>
  a.operation < b.operation ? -1 : 1
);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const branches = ops.map((op) => {
  const resource =
    (op.input_schema.properties as Record<string, Record<string, unknown>>)
      .resource.pattern as string;
  let target = escape(op.host + op.path);
  target = target.replace(
    escape(`{+${op.resource_parameter}}`),
    resource.replace(/^\^|\$$/g, ""),
  )
    .replace(
      escape(`{${op.resource_parameter}}`),
      resource.replace(/^\^|\$$/g, ""),
    );
  const query =
    (op.input_schema.properties as Record<string, Record<string, unknown>>)
      .query;
  if (query) {
    const names = Object.keys(query.properties as Record<string, unknown>);
    target += `(?:\\?(?:${names.join("|")})=[^#[:space:]]*(?:&(?:${
      names.join("|")
    })=[^#[:space:]]*)*)?`;
  }
  return ` WHEN admission.operation=${quote(op.operation)} THEN target !~ ${
    quote("^" + target + "$")
  }`;
}).join("\n");
const updated = context.replace(
  "entry.handler IS DISTINCT FROM 'sandy-provider-supplement-api'",
  "entry.handler NOT IN ('sandy-provider-supplement-api','sandy-provider-sensitive-api')",
)
  .replace(" ELSE true END) THEN", () => branches + "\n ELSE true END) THEN");
if (updated === context || !updated.includes(ops[0].operation)) {
  throw Error("sensitive_context_extension_failed");
}
const consumerUpdated = consumer.replace(
  "'sandy-provider-supplement-api')",
  "'sandy-provider-supplement-api','sandy-provider-sensitive-api')",
);
const rows = ops.map((op) =>
  "(" +
  [
    quote(op.operation),
    "'gcp'",
    quote(
      "Private bounded provider protocol capture; raw plaintext, key material, verification code and access token never appear in operation results. Capture does not activate any credential or attest provider behavior.",
    ),
    quote(op.permission_scope),
    String(op.is_mutation),
    json(op.input_schema),
    json(op.output_schema),
    "'sandy-provider-sensitive-api'",
    "false",
    "false",
    "false",
    "false",
    "'source_ready'",
    "'ausstyle/web-staging'",
    "'supabase/functions/sandy-provider-sensitive-api/index.ts'",
    json([
      "normal_owner_session",
      "enabled_controller_owner",
      "explicit_exact_scope_approval",
      "one_use_exact_scope_admission",
      "verified_contract",
      "runtime_provider_egress",
      "credential_consumer_schema",
      "private_media_custody_schema",
      "authorized_exact_resource_fixture",
    ]),
    json({
      version: "1.0.0",
      contract_sha256: op.contract_sha256,
      requires_grant: true,
      requires_approval: true,
      api_key_delegable: false,
      requires_cost_approval: false,
      requirement_ids: [op.requirement],
      source_review_only: true,
      provider_schema_verified: true,
      runtime_provider_verified: false,
      provider_source: op.source,
      provider_source_sha256: op.source_sha256,
      provider_operation_id: op.provider_operation_id,
      canonical_operation: op.operation,
      private_response_only: true,
      credential_activation: false,
      unknown_outcome:
        "No automatic redispatch after possible effects; reconcile provider state with a new read admission",
    }),
    json({ automatic: false, safe_to_retry: !op.is_mutation }),
    json({
      automatic: false,
      applicable: false,
      reason: "Separate approved provider-specific compensation",
    }),
  ].join(",") + ")"
);
const sql =
  `-- Guarded08500 private sensitive provider protocols. No provider calls or credential activation.\nBEGIN;\nDO $guard$\nDECLARE context_source text; consumer_source text;\nBEGIN\n SELECT prosrc INTO context_source FROM pg_proc WHERE oid='public.sandy_provider_supplement_context(jsonb)'::regprocedure AND prosecdef;\n SELECT prosrc INTO consumer_source FROM pg_proc WHERE oid='public.sandy_credential_resolve_consumer(text,uuid,uuid,text)'::regprocedure AND prosecdef;\n IF encode(extensions.digest(context_source,'sha256'),'hex') IS DISTINCT FROM '${await digest(
    context,
  )}' OR encode(extensions.digest(consumer_source,'sha256'),'hex') IS DISTINCT FROM '${await digest(
    consumer,
  )}' THEN RAISE EXCEPTION 'reviewed08400_private_boundary_required'; END IF;\nEND $guard$;\nCREATE OR REPLACE FUNCTION public.sandy_provider_supplement_context(p_context jsonb) RETURNS public.sandy_api_execution_admissions LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS ${
    quote(updated)
  };\nCREATE OR REPLACE FUNCTION public.sandy_credential_resolve_consumer(p_consumer text,p_actor uuid,p_admission uuid,p_operation text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS ${
    quote(consumerUpdated)
  };\nREVOKE ALL ON FUNCTION public.sandy_provider_supplement_context(jsonb) FROM PUBLIC,anon,authenticated,service_role;\nREVOKE ALL ON FUNCTION public.sandy_credential_resolve_consumer(text,uuid,uuid,text) FROM PUBLIC,anon,authenticated;\nGRANT EXECUTE ON FUNCTION public.sandy_credential_resolve_consumer(text,uuid,uuid,text) TO service_role;\nINSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES\n${
    rows.join(",\n")
  };\nCOMMIT;\n`;
await Deno.writeTextFile(
  "supabase/migrations/20261021008500_sandy_provider_sensitive.sql",
  sql,
);
await Deno.writeTextFile(
  "supabase/functions/sandy-provider-sensitive-api/contracts.json",
  JSON.stringify(ops, null, 2) + "\n",
);
const compact = await Promise.all(
  ops.map(async (op) => ({
    operation: op.operation,
    provider: op.provider,
    kind: op.kind,
    is_mutation: op.is_mutation,
    requires_grant: true,
    requires_approval: true,
    permission_scope: op.permission_scope,
    requirement: op.requirement,
    contract_sha256: op.contract_sha256,
    input_schema_sha256: await argumentDigest(op.input_schema),
    output_schema_sha256: await argumentDigest(op.output_schema),
  })),
);
await Deno.writeTextFile(
  "supabase/functions/sandy-provider-sensitive-api/gateway_manifest.json",
  JSON.stringify({ operations: compact }, null, 2) + "\n",
);
await Deno.writeTextFile(
  "docs/sandy-api/provider-sensitive-coverage.json",
  JSON.stringify(
    {
      schema_version: "1.0.0",
      methods: 18,
      implemented_boundary: "bounded_fixed_project_private_protocol_capture",
      api_exposed: false,
      verified: false,
      provider_called: false,
      auth_session_tested: false,
      all_161_requirements_completed: false,
      limits: [
        "64KiB per crypto input field",
        "1MiB private JSON response",
        "fixed project/europe-west1 and europe-west1-b",
        "No public payload retrieval, credential activation or general signing service",
      ],
      operations: ops.map((op) => ({
        operation: op.operation,
        provider_operation_id: op.provider_operation_id,
        requirement: op.requirement,
        source_sha256: op.source_sha256,
        contract_sha256: op.contract_sha256,
        provider_verified: false,
      })),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    generated: ops.length,
    all_closed_unverified: true,
    context_source_sha256: await digest(updated),
    consumer_source_sha256: await digest(consumerUpdated),
  }),
);
