/** Focused regressions reuse the fixed read-only pilot questions. A selection
 * cannot add prompts, channels, customers, tools or change the full-cycle gate. */
export function selectPilotCases<T extends readonly string[]>(cases: readonly T[], requested: unknown): {
 cases: readonly T[]; mode: "mandatory_full_cycle_v2"|"focused_regression_v1"; minimum: number;
} {
 if(requested===undefined)return {cases,mode:"mandatory_full_cycle_v2",minimum:10};
 if(!Array.isArray(requested)||requested.length===0||requested.length>cases.length||
   requested.some(key=>typeof key!=="string")||new Set(requested).size!==requested.length)
  throw Error("invalid_case_selection");
 const keys=new Set(requested), selected=cases.filter(row=>keys.has(row[0]));
 if(selected.length!==requested.length)throw Error("invalid_case_selection");
 return {cases:selected,mode:"focused_regression_v1",minimum:selected.length};
}
