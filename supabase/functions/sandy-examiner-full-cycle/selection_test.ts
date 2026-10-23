import assert from "node:assert/strict";
import { selectPilotCases } from "./selection.ts";
const cases=[["failed","fixed read-only question"],["passed","already accepted"]];
Deno.test("focused examiner selection does not rerun successful cases or masquerade as full acceptance",()=>{
 assert.deepEqual(selectPilotCases(cases,["failed"]),{cases:[cases[0]],mode:"focused_regression_v1",minimum:1});
 assert.deepEqual(selectPilotCases(cases,undefined),{cases,mode:"mandatory_full_cycle_v2",minimum:10});
});
Deno.test("examiner selection cannot introduce arbitrary questions or duplicate work",()=>{
 for(const requested of [[],["missing"],["failed","failed"],"failed",[{}],["failed","passed","extra"]])
  assert.throws(()=>selectPilotCases(cases,requested),/invalid_case_selection/);
});
