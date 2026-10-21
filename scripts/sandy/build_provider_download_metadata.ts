/** Additive08700 evidence metadata; never applies SQL or verifies an operation. */
import { supplementContracts } from "../../supabase/functions/sandy-provider-supplement-api/contracts.ts";
import { argumentDigest } from "../../supabase/functions/_shared/sandy_api_protocol.ts";
import { actionsDownloadHostPolicy } from "../../supabase/functions/sandy-provider-supplement-api/github_download.ts";
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
const json = (v: unknown) => quote(JSON.stringify(v)) + "::jsonb";
const bytes = await Deno.readFile(
  "docs/sandy-api/provider-sources/github-runner-essential-communications.md",
);
const sourceSHA = Array.from(
  new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  (b) => b.toString(16).padStart(2, "0"),
).join("");
if (sourceSHA !== actionsDownloadHostPolicy.documentation_sha256) {
  throw Error("reviewed_host_policy_snapshot_required");
}
const operations = Object.values(supplementContracts).filter((op) =>
  op.kind.startsWith("download_")
).sort((a, b) => a.operation.localeCompare(b.operation));
if (operations.length !== 5) {
  throw Error("reviewed5_download_contracts_required");
}
const limits =
  "Bounded1MiB documented-host single-hop private capture; no public payload retrieval, no runtime/provider verification";
const guards = operations.map((op) =>
  ` IF NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation=${
    quote(op.operation)
  } AND handler='sandy-provider-supplement-api' AND error_contract->>'contract_sha256'=${
    quote(op.contract_sha256)
  } AND error_contract->>'requires_grant'='true' AND error_contract->>'requires_approval'='true' AND error_contract->>'api_key_delegable'='false' AND NOT api_exposed AND NOT ai_exposed AND NOT ui_exposed AND NOT verified) THEN RAISE EXCEPTION 'reviewed_closed_download_contract_required'; END IF;`
).join("\n");
const evidence = {
  adapter_limitations: limits,
  private_capture_complete_supported: true,
  public_payload_retrieval_supported: false,
  payload_transfer_complete: false,
  source_review_only: true,
  runtime_provider_verified: false,
  provider_download_host_policy_sha256: sourceSHA,
  provider_download_host_policy_source:
    actionsDownloadHostPolicy.documentation_source,
  max_private_capture_bytes: 1048576,
  signed_url_returned: false,
  credentials_forwarded_to_storage: false,
};
const sql =
  `--08700 source-ready private download protocol, no exposure or verification activation.\nBEGIN;\nDO $guard$\nBEGIN\n${guards}\nEND $guard$;\nUPDATE public.sandy_operation_registry SET description=${
    quote(limits)
  },error_contract=error_contract||${json(evidence)} WHERE operation IN (${
    operations.map((op) => quote(op.operation)).join(",")
  });\nCOMMIT;\n`;
await Deno.writeTextFile(
  "supabase/migrations/20261021008700_sandy_actions_private_download.sql",
  sql,
);
await Deno.writeTextFile(
  "docs/sandy-api/provider-download-coverage.json",
  JSON.stringify(
    {
      schema_version: "1.0.0",
      original_supplement_methods: 28,
      now_bounded_source_ready: 27,
      remaining_typed_policy_semantics_gap: 1,
      new_api_operations: 0,
      upgraded_existing_methods: 5,
      host_policy: actionsDownloadHostPolicy,
      provider_called: false,
      auth_session_tested: false,
      provider_verified_operations: 0,
      all_161_requirements_completed: false,
      public_payload_retrieval_supported: false,
      remaining_gaps: [
        "Compute getEffectiveSecurityPolicies lacks a response schema in pinned discovery; private raw capture does not establish typed policy semantics",
        "Public byte delivery is separate from private capture and requires a fresh approved artifact-class boundary",
        "Payloads above1MiB need a separately governed streaming transfer protocol",
      ],
      operations: await Promise.all(operations.map(async (op) => ({
        operation: op.operation,
        provider_operation_id: op.provider_operation_id,
        contract_sha256: op.contract_sha256,
        input_schema_sha256: await argumentDigest(op.input_schema),
        output_schema_sha256: await argumentDigest(op.output_schema),
        implementation: "bounded_documented_host_private_capture_source_ready",
        api_exposed: false,
        verified: false,
        provider_tested: false,
        explicit_approval_required: true,
      }))),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    generated: operations.length,
    new_api_operations: 0,
    all_closed_unverified: true,
    host_policy_sha256: sourceSHA,
  }),
);
