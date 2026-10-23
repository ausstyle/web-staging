import assert from "node:assert/strict";
import {examinerLaunchScope} from "./examiner_scope.ts";
Deno.test("OIDC focused assessment retains exact fixed read-only subset and full mode stays default",()=>{
 assert.deepEqual(examinerLaunchScope({operation:"v2_full_examiner_rerun",focused_regression:true}),{mode:"focused_regression_v1",minimum:3,caseKeys:["current_time","task_overview","tool_evidence"],threadReviewRequired:false});
 assert.deepEqual(examinerLaunchScope({operation:"v2_full_examiner_rerun"}),{mode:"mandatory_full_cycle_v2",minimum:12,caseKeys:undefined,threadReviewRequired:true});
});
Deno.test("OIDC subset cannot inject customer, target, prompt, cases or credentials",()=>{
 for(const body of [null,[],{operation:"other"},{operation:"v2_full_examiner_rerun",focused_regression:"true"},...["customer_id","url","question","case_keys","credential"].map(k=>({operation:"v2_full_examiner_rerun",focused_regression:true,[k]:"untrusted"}))])
  assert.equal(examinerLaunchScope(body),null);
});
