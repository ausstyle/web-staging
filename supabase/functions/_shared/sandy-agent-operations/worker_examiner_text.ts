// Preserve the original UTF-16 unit budgets without splitting a surrogate pair.
// Actual PostgreSQL text is valid Unicode; invalid local scalar input refuses.
export function examinerUtf16Prefix(value:string,budget:number):string{
 if(!Number.isInteger(budget)||budget<0)throw Error("invalid_examiner_text_budget");let result="",units=0;
 for(const point of value){const code=point.codePointAt(0)!;if(code>=0xd800&&code<=0xdfff)throw Error("invalid_examiner_unicode");if(units+point.length>budget)break;result+=point;units+=point.length}return result;
}
const hashedText=new Set(["question","response","subject","body_text","body","text","processing_status"]);
export async function examinerSourceWitness(source:Record<string,unknown>):Promise<Record<string,unknown>>{
 const witness:Record<string,unknown>={};for(const[key,value]of Object.entries(source)){
  if(!hashedText.has(key)||value===null){witness[key]=value;continue}
  if(typeof value!=="string")throw Error("examiner_actual_text_type_required");
  // Null stays JSON null; empty text has the non-null SHA256 of empty UTF8.
  const bytes=new TextEncoder().encode(value);witness[key]={sha256:Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(v=>v.toString(16).padStart(2,"0")).join("")};
 }return witness;
}
