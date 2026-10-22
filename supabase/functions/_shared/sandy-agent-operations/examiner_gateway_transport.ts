/** The existing gateway's private service-auth contract. Provider credentials
 * stay in that gateway; this adapter issues no identities or provider requests. */
export function fixedExaminerGateway(
  body: Record<string, unknown>,
  broker: { base: string; serviceCredential: string },
  request: typeof fetch = fetch,
): Promise<Response> {
  if (broker.base !== "https://zmqlyygzqoidkcwdysok.supabase.co" || !broker.serviceCredential) {
    throw Error("examiner_gateway_binding_invalid");
  }
  return request(broker.base + "/functions/v1/sandy-openai-gateway-v4", {
    method: "POST",
    headers: {
      authorization: "Bearer " + broker.serviceCredential,
      "x-sandy-purpose": "examiner",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(21000),
  });
}
