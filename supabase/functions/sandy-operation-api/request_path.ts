/** Supabase Edge receives either the public gateway prefix or the function-name
 * prefix. Match whole segments so a lookalike function cannot select a route. */
export function operationRequestPath(pathname: string): string {
  return pathname.replace(
    /^(?:\/functions\/v1)?\/sandy-operation-api(?=\/|$)/,
    "",
  );
}
