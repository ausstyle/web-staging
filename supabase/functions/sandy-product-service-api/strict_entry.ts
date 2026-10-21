/** Deploy coherently with09020 under the existing sandy-product-service-api slug. */
import { createProductHandler, type ProductDependencies } from "./index.ts";
import { productStrictOperations } from "./strict_gateway.ts";
import { executeStrictProductProvider } from "./strict_providers.ts";
import catalogue from "./strict_contracts.json" with { type: "json" };
import { createInterpretedRegistryValidator } from "../sandy-operation-api/registry_schema_interpreter.ts";
export const createStrictProductHandler = (deps: ProductDependencies) =>
  createProductHandler(
    deps,
    productStrictOperations,
    executeStrictProductProvider,
    {
      ...createInterpretedRegistryValidator(),
      providerSchemas: catalogue.provider_result_schemas,
    },
  );
if (import.meta.main) {
  const env = (key: string) => Deno.env.get(key);
  const base = env("SUPABASE_URL") || "";
  if (base !== "https://zmqlyygzqoidkcwdysok.supabase.co") {
    throw Error("fixed_project_configuration_required");
  }
  Deno.serve(
    createStrictProductHandler({
      base,
      service: env("SUPABASE_SERVICE_ROLE_KEY") || "",
      anon: env("SUPABASE_ANON_KEY") || "",
      env,
      fetch,
    }),
  );
}
