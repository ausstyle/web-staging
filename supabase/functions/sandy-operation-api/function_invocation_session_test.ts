import { strict as assert } from "node:assert";
import { functionInvocationSessionHeaders as headers } from "./function_invocation_session.ts";
const actor = "10000000-0000-4000-8000-000000000001";
const claims = {
  sub: actor,
  role: "authenticated",
  aud: "authenticated",
  session_id: "10000000-0000-4000-8000-000000000002",
  exp: 4102444800,
};
const token = (value: unknown) =>
  "fixture." + btoa(JSON.stringify(value)) + ".fixture";
Deno.test("function invocation selects only the already verified same-caller normal session", () => {
  const jwt = token(claims);
  assert.deepEqual(headers("supabase.functions.invoke", jwt, actor, null), {
    "x-sandy-user-session": jwt,
  });
  for (
    const change of [
      { sub: "another-actor" },
      { role: "service_role" },
      { aud: "service_role" },
      { exp: 1 },
      { is_anonymous: true },
      { session_id: null },
      { app_metadata: { sandy_engineering_test: true } },
    ]
  ) {
    assert.deepEqual(
      headers(
        "supabase.functions.invoke",
        token({ ...claims, ...change }),
        actor,
        null,
      ),
      {},
    );
  }
  assert.deepEqual(
    headers("supabase.functions.invoke", jwt, actor, { kind: "api_key" }),
    {},
  );
  assert.deepEqual(headers("supabase.projects.create", jwt, actor, null), {});
  assert.deepEqual(
    headers("supabase.functions.invoke", "unrelated-secret", actor, null),
    {},
  );
});
