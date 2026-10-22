/** Small, side-effect-free descriptors for the canonical Sandy API gateway. */
import manifest from "./gateway_manifest.json" with { type: "json" };
import type { CredentialContract } from "./contracts.ts";
export { credentialExecutionScope } from "./scope.ts";
export type { Target } from "./types.ts";
export const credentialOperations: Readonly<
  Record<string, CredentialContract>
> = Object.freeze(
  Object.fromEntries(
    (manifest.operations as unknown as CredentialContract[]).map(
      (item) => [item.operation, item],
    ),
  ),
);
