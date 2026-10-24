import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.58.0";

const url=Deno.env.get("SUPABASE_URL")||"";
const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const publishable=Deno.env.get("SANDY_PUBLIC_KEY")||"sb_publishable_OVP7LUMDhtcymPRzZuCK3Q_8JkLC3ts";
const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
const auth=createClient(url,publishable,{auth:{persistSession:false,autoRefreshToken:false}});
const cors={"access-control-allow-origin":"https://ausstyle.github.io","access-control-allow-methods":"POST, OPTIONS","access-control-allow-headers":"authorization, content-type, apikey, x-client-info","vary":"Origin"};
const output=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff",...cors}});
const error=(status:number,code:string)=>output(status,{ok:false,error:code});
const uuid=(v:unknown)=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const text=(v:unknown,n:number)=>typeof v==="string"?v.trim().slice(0,n):"";
const validDate=(v:unknown)=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+"T00:00:00Z"));
const validTime=(v:unknown)=>typeof v==="string"&&!Number.isNaN(Date.parse(v))&&v.length<=40;
const money=(v:unknown)=>v===undefined||v===null||v===""?null:(typeof v==="number"&&Number.isFinite(v)&&Math.abs(v)<=1e14?Math.round(v*100)/100:undefined);
const kinds=new Set(["document","deadline","hearing","order","contact","engagement","cost","correspondence","instruction","evidence","note"]);
async function actor(req:Request){
 const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(token.length<30)return null;
 const {data,error:e}=await auth.auth.getUser(token);const user=data?.user;
 if(e||!user?.id||!user?.email||!user.email_confirmed_at)return null;
 const {data:a,error:ae}=await db.from("sandy_memory_portal_accounts").select("customer_id").eq("auth_user_id",user.id).is("revoked_at",null).maybeSingle();
 if(ae||!a?.customer_id)return null;
 const {data:m,error:me}=await db.from("email_customer_addresses").select("normalized_email").eq("customer_id",a.customer_id).eq("is_primary",true).maybeSingle();
 if(me||m?.normalized_email!==user.email.toLowerCase())return null;
 return {customer_id:a.customer_id as string,user_id:user.id as string};
}
async function ownsMatter(cid:string,id:unknown){
 if(!uuid(id))return false;
 const {data,error:e}=await db.from("sandy_legal_matters").select("id").eq("owner_customer_id",cid).eq("id",id).maybeSingle();
 return !e&&!!data;
}
async function ownsProceeding(cid:string,id:unknown,mid:string){
 if(id===null||id===undefined||id==="")return true;
 if(!uuid(id))return false;
 const {data,error:e}=await db.from("sandy_legal_proceedings").select("id").eq("owner_customer_id",cid).eq("matter_id",mid).eq("id",id).maybeSingle();
 return !e&&!!data;
}
async function ownsFile(cid:string,id:unknown){
 if(id===null||id===undefined||id==="")return true;
 if(!uuid(id))return false;
 const {data,error:e}=await db.from("sandy_universal_files").select("id").eq("owner_customer_id",cid).eq("id",id).neq("library_state","trashed").maybeSingle();
 return !e&&!!data;
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return error(405,"method_not_allowed");
 try{
  const owner=await actor(req);if(!owner)return error(401,"verified_sandy_sign_in_required");
  const length=Number(req.headers.get("content-length")||0);if(length>40000)return error(413,"request_too_large");
  let input:any;try{input=await req.json()}catch{return error(400,"invalid_json")}
  if(!input||typeof input!=="object"||Array.isArray(input))return error(400,"invalid_payload");
  const action=text(input.action,80),cid=owner.customer_id,uid=owner.user_id;
  if(action==="list"){
   const [m,p,r]=await Promise.all([
    db.from("sandy_legal_matters").select("id,company_id,title,description,status,matter_type,jurisdiction,created_at,updated_at").eq("owner_customer_id",cid).order("updated_at",{ascending:false}).limit(200),
    db.from("sandy_legal_proceedings").select("id,matter_id,status").eq("owner_customer_id",cid).limit(800),
    db.from("sandy_legal_records").select("id,matter_id,kind,status,due_at,event_date").eq("owner_customer_id",cid).neq("status","archived").limit(1800)
   ]);
   if(m.error||p.error||r.error)return error(503,"legal_register_unavailable");
   const rows=(m.data||[]).map(x=>({
     ...x,proceedings:(p.data||[]).filter(z=>z.matter_id===x.id).length,
     documents:(r.data||[]).filter(z=>z.matter_id===x.id&&z.kind==="document").length,
     dates:(r.data||[]).filter(z=>z.matter_id===x.id&&(z.kind==="deadline"||z.kind==="hearing")&&z.due_at&&new Date(z.due_at).getTime()>=Date.now()).sort((a,b)=>String(a.due_at).localeCompare(String(b.due_at))).slice(0,1)
   }));
   return output(200,{ok:true,matters:rows,truncated:(m.data||[]).length===200});
  }
  if(action==="matter_get"){
   const id=input.id;if(!(await ownsMatter(cid,id)))return error(404,"matter_not_found");
   const [matter,proceedings,records]=await Promise.all([
    db.from("sandy_legal_matters").select("id,company_id,title,description,status,matter_type,jurisdiction,created_at,updated_at").eq("owner_customer_id",cid).eq("id",id).single(),
    db.from("sandy_legal_proceedings").select("id,matter_id,court,case_number,proceeding_type,stage,status,notes,created_at,updated_at").eq("owner_customer_id",cid).eq("matter_id",id).order("created_at",{ascending:false}).limit(150),
    db.from("sandy_legal_records").select("id,matter_id,proceeding_id,kind,title,details,status,event_date,due_at,amount,currency,contact_name,contact_email,organisation,file_id,source_note,reviewed_at,created_at,updated_at").eq("owner_customer_id",cid).eq("matter_id",id).order("created_at",{ascending:false}).limit(700)
   ]);
   if(matter.error||proceedings.error||records.error)return error(503,"matter_read_failed");
   return output(200,{ok:true,matter:matter.data,proceedings:proceedings.data||[],records:records.data||[],truncated:(records.data||[]).length===700});
  }
  if(action==="companies"){
   const {data,error:e}=await db.from("sandy_agenda_companies").select("id,name").eq("customer_id",cid).order("name").limit(100);
   if(e)return error(503,"company_list_unavailable");
   return output(200,{ok:true,companies:data||[]});
  }
  if(action==="files"){
   const {data,error:e}=await db.from("sandy_universal_files").select("id,display_name,mime_type,created_at").eq("owner_customer_id",cid).neq("library_state","trashed").order("created_at",{ascending:false}).limit(150);
   if(e)return error(503,"file_list_unavailable");
   return output(200,{ok:true,files:data||[],limited:true});
  }
  if(action==="matter_create"){
   const title=text(input.title,241);if(title.length<3||title.length>240)return error(400,"matter_title_required");
   const company_id=input.company_id||null;
   if(company_id){if(!uuid(company_id))return error(400,"invalid_company");const {data:co}=await db.from("sandy_agenda_companies").select("id").eq("id",company_id).eq("customer_id",cid).maybeSingle();if(!co)return error(403,"company_not_owned")}
   const {data,error:e}=await db.from("sandy_legal_matters").insert({owner_customer_id:cid,company_id,title,description:text(input.description,12000),jurisdiction:text(input.jurisdiction,180)||"Australia",matter_type:text(input.matter_type,100)||"litigation",created_by:uid,updated_by:uid}).select("id").single();
   if(e||!data)return error(503,"matter_create_failed");
   return output(201,{ok:true,id:data.id,status:"active"});
  }
  if(action==="matter_update"){
   const id=input.id;if(!(await ownsMatter(cid,id)))return error(404,"matter_not_found");
   const fields:any={updated_by:uid};
   if(input.title!==undefined){const t=text(input.title,241);if(t.length<3||t.length>240)return error(400,"invalid_title");fields.title=t}
   if(input.description!==undefined)fields.description=text(input.description,12000);
   if(input.status!==undefined){if(!["active","on_hold","appeal","closed","archived"].includes(input.status))return error(400,"invalid_status");fields.status=input.status}
   const {data,error:e}=await db.from("sandy_legal_matters").update(fields).eq("owner_customer_id",cid).eq("id",id).select("id").maybeSingle();
   if(e||!data)return error(503,"matter_update_failed");
   return output(200,{ok:true,id});
  }
  if(action==="proceeding_create"){
   const matter_id=input.matter_id;
   if(!(await ownsMatter(cid,matter_id)))return error(404,"matter_not_found");
   const court=text(input.court,241);if(court.length<2||court.length>240)return error(400,"court_required");
   const {data,error:e}=await db.from("sandy_legal_proceedings").insert({owner_customer_id:cid,matter_id,court,case_number:text(input.case_number,160),stage:text(input.stage,200),proceeding_type:text(input.proceeding_type,120)||"originating",notes:text(input.notes,12000),created_by:uid,updated_by:uid}).select("id").single();
   if(e||!data)return error(503,"proceeding_create_failed");
   return output(201,{ok:true,id:data.id});
  }
  if(action==="record_create"){
   const matter_id=input.matter_id,kind=text(input.kind,50),title=text(input.title,301);
   if(!(await ownsMatter(cid,matter_id)))return error(404,"matter_not_found");
   if(!kinds.has(kind)||title.length<2||title.length>300)return error(400,"invalid_record");
   if(!(await ownsProceeding(cid,input.proceeding_id,matter_id)))return error(403,"proceeding_not_in_matter");
   if(!(await ownsFile(cid,input.file_id)))return error(403,"file_not_owned");
   if(input.event_date&&!validDate(input.event_date))return error(400,"invalid_date");
   if(input.due_at&&!validTime(input.due_at))return error(400,"invalid_time");
   const amount=money(input.amount);if(amount===undefined)return error(400,"invalid_amount");
   const caution=["deadline","hearing","order"].includes(kind);
   const {data,error:e}=await db.from("sandy_legal_records").insert({
    owner_customer_id:cid,matter_id,proceeding_id:input.proceeding_id||null,kind,title,details:text(input.details,18000),
    status:caution?"awaiting_review":"recorded",event_date:input.event_date||null,due_at:input.due_at||null,amount,
    currency: text(input.currency,3)||"AUD",contact_name:text(input.contact_name,200)||null,
    contact_email:text(input.contact_email,320)||null,organisation:text(input.organisation,240)||null,
    file_id:input.file_id||null,source_note:text(input.source_note,2000),created_by:uid,updated_by:uid
   }).select("id,status").single();
   if(e||!data)return error(503,"record_create_failed");
   return output(201,{ok:true,id:data.id,status:data.status});
  }
  if(action==="record_update"){
   if(!uuid(input.id))return error(400,"invalid_record_id");
   const {data:existing,error:ee}=await db.from("sandy_legal_records").select("id,matter_id,kind").eq("owner_customer_id",cid).eq("id",input.id).maybeSingle();
   if(ee||!existing)return error(404,"record_not_found");
   const f:any={updated_by:uid};
   if(input.title!==undefined){const t=text(input.title,301);if(t.length<2||t.length>300)return error(400,"invalid_title");f.title=t}
   if(input.details!==undefined)f.details=text(input.details,18000);
   if(input.status!==undefined){
    if(!["recorded","proposed","awaiting_review","archived","disputed"].includes(input.status))return error(400,"status_requires_verified_workflow");
    if(["deadline","order","hearing"].includes(existing.kind)&&input.status==="recorded")return error(400,"review_required_for_court_event");
    f.status=input.status;
   }
   const {data,error:e}=await db.from("sandy_legal_records").update(f).eq("owner_customer_id",cid).eq("id",input.id).select("id").maybeSingle();
   if(e||!data)return error(503,"record_update_failed");
   return output(200,{ok:true,id:input.id});
  }
  return error(400,"unknown_action");
 }catch(e){console.error("sandy_legal_failure",String((e as Error).name||"error"));return error(503,"legal_service_unavailable")}
});
