import { uuid } from "./uuid.ts";
Deno.test("Controller resource IDs accept canonical UUIDs and reject malformed or coerced targets", () => {
  for (
    const value of [
      "11111111-1111-4111-8111-111111111111",
      "AABBCCDD-AABB-CCDD-AABB-AABBCCDDEEFF",
    ]
  ) {
    if (!uuid(value)) throw Error("canonical resource ID rejected");
  }
  for (
    const value of [
      null,
      undefined,
      {},
      { toString: () => "11111111-1111-4111-8111-111111111111" },
      111111111111,
      "",
      " ",
      "11111111-1111-4111-8111-111111111111\n",
      "11111111-1111-4111-8111-11111111111",
      "11111111-1111-4111-8111-111111111111 OR true",
      "gggggggg-1111-4111-8111-111111111111",
    ]
  ) {
    if (uuid(value)) throw Error("malformed resource ID accepted");
  }
});
