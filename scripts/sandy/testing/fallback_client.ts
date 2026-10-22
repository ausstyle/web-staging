// Import-map replacement used only by fallback_runtime_test.ts. It deliberately
// has no HTTP client, credentials, or live database connection.
let current: any;
export const setRuntimeDatabase = (db: any) => { current = db; };
export function createClient(_url?: string, _key?: string, _options?: any) {
  if (!current) throw Error("runtime_test_database_not_bound");
  return current;
}
