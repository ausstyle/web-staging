type Obj = Record<string,unknown>;
const object=(v:unknown):v is Obj=>!!v&&typeof v==="object"&&!Array.isArray(v);
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<=1e9;
const dollars=(v:unknown)=>{
 if(typeof v!=="number"&&typeof v!=="string")return null;
 if(typeof v==="string"&&!/^\d+(\.\d+)?$/.test(v))return null;
 const n=Number(v);return Number.isFinite(n)&&n>=0&&n<=1e6?n:null;
};
/** Metadata from the actual bounded provider envelope. No prompt, output text,
 * provider identifier, credential or model judgement enters this projection.
 * Duration includes the existing gateway/network path, not provider compute.
 */
export function receiptModelMetrics(response:unknown,startedAt:number,finishedAt:number,rate:unknown=null){
 const r=object(response)?response:null,u=r&&object(r.usage)?r.usage:null;
 const model=r&&typeof r.model==="string"&&/^[a-zA-Z0-9_.:-]{1,200}$/.test(r.model)?r.model:null;
 const duration=Number.isFinite(startedAt)&&Number.isFinite(finishedAt)&&finishedAt>=startedAt&&finishedAt-startedAt<=86400000?Math.round(finishedAt-startedAt):null;
 const input=u&&integer(u.input_tokens)?u.input_tokens:null,output=u&&integer(u.output_tokens)?u.output_tokens:null;
 const details=u&&object(u.input_tokens_details)?u.input_tokens_details:null;
 const cached=details&&integer(details.cached_tokens)&&input!==null&&details.cached_tokens<=input?details.cached_tokens:null;
 const total=u&&integer(u.total_tokens)&&input!==null&&output!==null&&u.total_tokens===input+output?u.total_tokens:null;
 const usage=input!==null&&output!==null?{input_tokens:input,output_tokens:output,cached_input_tokens:cached,total_tokens:total}:null;
 let cost:null|number=null,basis="unavailable_usage_or_model",rateVerifiedAt:null|string=null;
 if(model&&usage){
  basis="unavailable_exact_fresh_rate";
  if(object(rate)&&rate.model_name===model&&typeof rate.verified_at==="string"){
   const verified=Date.parse(rate.verified_at),age=startedAt-verified;
   const i=dollars(rate.input_usd_per_million),o=dollars(rate.output_usd_per_million),c=dollars(rate.cached_input_usd_per_million);
   if(Number.isFinite(age)&&age>=0&&age<=30*86400000&&i!==null&&o!==null&&cached!==null&&(cached===0||c!==null)){
    const estimate=((input!-cached)*i+cached*(c??0)+output!*o)/1e6;
    if(Number.isFinite(estimate)&&estimate>=0&&estimate<=1e9){cost=Math.round(estimate*1e9)/1e9;basis="estimated_exact_model_verified_rate";rateVerifiedAt=new Date(verified).toISOString();}
   }
  }
 }
 return {schema_version:"1",source:"received_provider_envelope",model_returned:model,request_duration_ms:duration,usage,
  estimated_cost_usd:cost,cost_basis:basis,rate_verified_at:rateVerifiedAt,provider_effect_verified:false};
}
export async function collectReceiptModelMetrics(db:any,response:unknown,startedAt:number,finishedAt:number){
 const base=receiptModelMetrics(response,startedAt,finishedAt);
 if(!base.model_returned||!base.usage)return base;
 try{
  const {data,error}=await db.from("email_ai_model_rates").select("model_name,input_usd_per_million,cached_input_usd_per_million,output_usd_per_million,verified_at").eq("model_name",base.model_returned).maybeSingle();
  return receiptModelMetrics(response,startedAt,finishedAt,error?null:data);
 }catch{return base;}
}
