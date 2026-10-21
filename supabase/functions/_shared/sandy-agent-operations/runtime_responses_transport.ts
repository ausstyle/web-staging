// Fixed provider transport shared by internal runtime compatibility profiles.
// No HTTP handler accepts these parameters or selects this implementation.
export function fixedRuntimeResponses(
  body: Record<string, unknown>,
  openaiKey: string,
  timeout: 45000 | 65000 | 80000 | 100000,
  request: typeof fetch,
  strictRedirect: boolean,
): Promise<Response> {
  if (!openaiKey || ![45000, 65000, 80000, 100000].includes(timeout)) {
    throw Error("runtime_response_transport_invalid");
  }
  return request("https://api.openai.com/v1/responses", {
    method: "POST",
    ...(strictRedirect ? { redirect: "error" as const } : {}),
    headers: { authorization: "Bearer " + openaiKey, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
}
