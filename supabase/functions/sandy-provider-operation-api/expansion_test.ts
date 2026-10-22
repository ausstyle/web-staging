import assert from "node:assert/strict";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import {
  clearExpandedProviderCatalogue,
  expandedProviderCatalogueStats,
  expansionOperationIndex,
  loadExpandedProviderOperation,
} from "./expansion.ts";
import {
  expandedProviderExecutionScope,
  providerExpansionOperations,
} from "./expansion_gateway.ts";
import {
  clearProviderValidators,
  providerExecutionScope,
  type ProviderOperation,
  providerOperations,
  providerValidatorStats,
  validateProviderContract,
} from "./index.ts";
Deno.test("all additive typed contracts are lazily executable and retain exact compact fingerprints within bounded caches", async () => {
  let count = 0, maxRss = 0;
  for (const [operation, location] of Object.entries(expansionOperationIndex)) {
    const full = await loadExpandedProviderOperation(
      operation,
    ) as unknown as ProviderOperation;
    assert.equal(full.operation, operation);
    assert.equal(full.contract_sha256, location.contract_sha256);
    const gateway = providerExpansionOperations[operation];
    assert.equal(gateway.contract_sha256, full.contract_sha256);
    assert.equal(
      await argumentDigest(full.input_schema),
      gateway.input_schema_sha256,
    );
    assert.equal(
      await argumentDigest(full.output_schema),
      gateway.output_schema_sha256,
    );
    assert.equal(full.requires_grant, true);
    assert.equal(full.api_exposed, false);
    assert.equal(full.verified, false);
    try {
      validateProviderContract(full);
    } catch (error) {
      throw Error(
        operation + ": " +
          (error instanceof Error ? error.message : "schema_invalid"),
      );
    }
    const stats = expandedProviderCatalogueStats();
    assert.ok(stats.cached_plaintext_bytes <= stats.max_cached_plaintext_bytes);
    const validators = providerValidatorStats();
    assert.ok(validators.entries <= validators.max_entries);
    assert.ok(validators.schema_bytes <= validators.max_schema_bytes);
    maxRss = Math.max(maxRss, Deno.memoryUsage().rss);
    count++;
  }
  console.log(
    JSON.stringify({
      additive_contracts_validated: count,
      max_rss_bytes: maxRss,
      decoded_cache: expandedProviderCatalogueStats(),
      validator_cache: providerValidatorStats(),
    }),
  );
  assert.equal(count, Object.keys(providerExpansionOperations).length);
  clearExpandedProviderCatalogue();
  clearProviderValidators();
});
Deno.test("descriptor scopes match shipped provider authority and never broaden project or repository scope", () => {
  for (
    const [provider, old] of [
      ["supabase", "supabase.project.config.auth.get"],
      ["github", "github.repos.get"],
      ["gcp", "gcp.compute.instances.get"],
    ]
  ) {
    const next = Object.values(providerExpansionOperations).find((op) =>
      op.provider === provider && !op.binding_kind
    )!;
    assert.deepEqual(
      expandedProviderExecutionScope(next.operation),
      providerExecutionScope(old),
    );
    assert.throws(() =>
      expandedProviderExecutionScope(next.operation, {
        gcpProjectId: "foreign",
      })
    );
  }
  assert.equal(Object.keys(providerOperations).length, 595);
});
