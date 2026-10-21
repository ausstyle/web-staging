/** Additive fingerprints kept separate from shipped595 until reviewed release. */
import raw from "./expansion_gateway_manifest.json" with { type: "json" };
import type { ProviderConfig, ProviderGatewayOperation } from "./gateway.ts";
import { descriptorExecutionScope } from "./scope_from_descriptor.ts";
export const providerExpansionOperations: Readonly<
  Record<string, ProviderGatewayOperation>
> = Object.freeze(
  Object.fromEntries(
    raw.operations.map((
      op,
    ) => [op.operation, op as unknown as ProviderGatewayOperation]),
  ),
);
export function expandedProviderExecutionScope(
  operation: string,
  config: ProviderConfig = {},
) {
  const op = providerExpansionOperations[operation];
  if (!op) throw Error("operation_not_implemented");
  return descriptorExecutionScope(op, config);
}
