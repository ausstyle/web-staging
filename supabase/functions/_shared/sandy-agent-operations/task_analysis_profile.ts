export const taskAnalysisInstructions = "Extract configuration facts only; NEVER rewrite titles, descriptions or create tasks. JSON: {contact_name:string|null,priority:'high'|'normal'|'low'|null, time_text:string|null, hour:number|null,minute:number|null,timezone:'AEST'|'AEDT'|null,date_text:string|null,date_ymd:string|null,due_date_ymd:string|null}. time_text must be exact substring in original title and must include clock time. hour 0-23, minute 0-59. date_text must be exact source substring ('today','tomorrow', or explicit date). date_ymd only with explicit date. due_date_ymd only for explicit due dates. Additionally return relative_text (exact substring e.g. 'in 15 minutes') and relative_minutes (positive integer duration in minutes), or both null. Interpret natural relative durations including written numbers. If unspecified set null. Never assume a date yourself. No invented people or contacts.";
export const taskAnalysisModel="gpt-4.1-mini";
export const taskAnalysisOutputTokens=512;
export const taskAnalysisCapability="task.configuration.extract";
export function literalTaskTitle(title:string){return (title.startsWith('"')&&title.endsWith('"'))||(title.startsWith("“")&&title.endsWith("”"));}
export function taskAnalysisRequest(title:string){return {model:taskAnalysisModel,store:false,temperature:0,instructions:taskAnalysisInstructions,input:title,text:{format:{type:"json_object"}},max_output_tokens:taskAnalysisOutputTokens};}
type Obj=Record<string,unknown>;
export function taskAnalysisValue(value:unknown,title:string):Obj|null{
 if(!value||typeof value!=="object"||Array.isArray(value))return null;
 const v=value as Obj,result:Obj={};
 for(const key of ["contact_name","time_text","date_text","relative_text"]){const x=v[key];if(x!==null&&x!==undefined&&(typeof x!=="string"||x.length>240||!title.toLowerCase().includes(x.toLowerCase())))return null;result[key]=typeof x==="string"&&x.trim()?x:null;}
 for(const key of ["date_ymd","due_date_ymd"]){const x=v[key];if(x!==null&&x!==undefined&&(typeof x!=="string"||!/^20\d{2}-\d{2}-\d{2}$/.test(x)))return null;result[key]=x??null;}
 for(const [key,min,max] of [["hour",0,23],["minute",0,59],["relative_minutes",1,525600]] as const){const x=v[key];if(x!==null&&x!==undefined&&(!Number.isInteger(x)||Number(x)<min||Number(x)>max))return null;result[key]=x??null;}
 for(const [key,allowed] of [["priority",["high","normal","low"]],["timezone",["AEST","AEDT"]]] as const){const x=v[key];if(x!==null&&x!==undefined&&!allowed.includes(x as never))return null;result[key]=x??null;}
 return result;
}
