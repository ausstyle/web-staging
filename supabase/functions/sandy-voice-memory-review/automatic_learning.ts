/** Private consent/source snapshots. No customer identity or consent is created. */
type Obj=Record<string,any>;
const fields=["session_id","customer_id","link_id","session_created_at","private_verified_at","policy_updated_at","consent_at","source_not_before","source_cutoff"];
const object=(v:unknown):v is Obj=>!!v&&typeof v==="object"&&!Array.isArray(v);
export async function voiceLearningSource(db:any,sessionId:string,customerId:string,cutoff?:string):Promise<Obj|null>{
 try{
  const result=await db.rpc("sandy_voice_automatic_learning_source",{p_session:sessionId,p_expected_customer:customerId,p_source_cutoff:cutoff??null});
  const source=result.data;
  if(result.error||!object(source)||source.ok!==true||source.session_id!==sessionId||source.customer_id!==customerId||fields.some(k=>typeof source[k]!=="string"||!source[k]))return null;
  if(fields.slice(3).some(k=>!Number.isFinite(Date.parse(source[k]))))return null;
  return source;
 }catch{return null;}
}
export async function sameVoiceLearningSource(db:any,source:Obj):Promise<boolean>{
 const current=await voiceLearningSource(db,source.session_id,source.customer_id,source.source_cutoff);
 return !!current&&fields.every(key=>current[key]===source[key]);
}
export async function persistVoiceLearning(db:any,source:Obj,result:Obj):Promise<{state:"persisted"|"denied"|"unknown";result?:Obj}>{
 try{
  const response=await db.rpc("sandy_voice_automatic_learning_persist",{p_session:source.session_id,p_expected_customer:source.customer_id,p_expected_source:source,p_result:result});
  if(response.error||!object(response.data))return{state:"unknown"};
  const value=response.data;
  if(value.ok===false&&value.persisted===false)return{state:"denied"};
  if(value.ok===true&&value.persisted===true&&value.status==="complete"&&["committed","review_required","rejected"].every(k=>Number.isSafeInteger(value[k])&&value[k]>=0&&value[k]<=12))return{state:"persisted",result:value};
  return{state:"unknown"};
 }catch{return{state:"unknown"};}
}
