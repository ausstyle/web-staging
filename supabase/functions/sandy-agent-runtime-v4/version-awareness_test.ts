import assert from "node:assert/strict";
import { executingBuild, versionFactsForModel } from "./version-awareness.js";

Deno.test("V4 execution identity matches its actual Management function ID", () => {
  const id = "zmqlyygzqoidkcwdysok_00ff46a9-a42a-4ff5-8c59-b47fad941b60_23";
  assert.deepEqual(executingBuild("sandy-agent-runtime-v4", id), {
    component: "sandy-agent-runtime-v4", generation: "v4", revision: 23,
    build_id: id, verified: true, source: "Supabase executing environment",
  });
});
for (const id of [
  "", "23", "sandy-agent-runtime-v4_23",
  "zmqlyygzqoidkcwdysok_aab7521f-a1c2-4149-bb7d-47bae124004f_23",
  "foreign_00ff46a9-a42a-4ff5-8c59-b47fad941b60_23",
  "zmqlyygzqoidkcwdysok_00ff46a9-a42a-4ff5-8c59-b47fad941b60_0",
]) {
  Deno.test(`V4 identity rejects a missing, foreign or malformed executing ID: ${id}`, () => {
    const value = executingBuild("sandy-agent-runtime-v4", id);
    assert.equal(value.verified, false);
    assert.equal(value.revision, null);
    assert.equal(value.generation, "v4");
  });
}
Deno.test("V2 cannot claim the V4 deployment identity", () => {
  assert.equal(executingBuild("sandy-agent-runtime-v2", "zmqlyygzqoidkcwdysok_00ff46a9-a42a-4ff5-8c59-b47fad941b60_23").verified, false);
});
Deno.test("stale module versions remain explicitly unverified", () => {
  const info = versionFactsForModel({ components: [{ revision: 23, version_fresh: false }] });
  assert.equal(info.components[0].revision, null);
  assert.equal(info.components[0].last_known_revision, 23);
});
