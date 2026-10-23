/** A smaller regression subset of the already authorized fixed pilot run.
 * Called only after the existing repository/workflow/main OIDC checks. Inputs
 * cannot select a customer, endpoint, model, prompt, question or credential. */
export function examinerLaunchScope(body:unknown){
 if(!body||typeof body!=="object"||Array.isArray(body))return null;
 const b=body as Record<string,unknown>;
 if(b.operation!=="v2_full_examiner_rerun"||Object.keys(b).some(k=>!["operation","focused_regression"].includes(k))||
  b.focused_regression!==undefined&&typeof b.focused_regression!=="boolean")return null;
 const focused=b.focused_regression===true;
 return {mode:focused?"focused_regression_v1":"mandatory_full_cycle_v2",minimum:focused?3:12,
  caseKeys:focused?["current_time","task_overview","tool_evidence"]:undefined,threadReviewRequired:!focused};
}
