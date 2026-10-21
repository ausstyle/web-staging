/** Version1.1 selects strict resources in the same execution/auth/receipt engine.
 * Deploy this entrypoint under the existing sandy-commerce-ledger-api slug only
 * with09120 and the matching strict gateway revision; no second AJV factory. */
import { type CommerceDependencies, createCommerceHandler } from "./index.ts";
import { commerceStrictOperations } from "./strict_gateway.ts";
export const createStrictCommerceHandler = (deps: CommerceDependencies) =>
  createCommerceHandler(deps, commerceStrictOperations);
if (import.meta.main) {
  const base = Deno.env.get("SUPABASE_URL") || "";
  if (base !== "https://zmqlyygzqoidkcwdysok.supabase.co") {
    throw Error("fixed_project_configuration_required");
  }
  Deno.serve(
    createStrictCommerceHandler({
      base,
      anon: Deno.env.get("SUPABASE_ANON_KEY") || "",
      service: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
      fetch,
    }),
  );
}
