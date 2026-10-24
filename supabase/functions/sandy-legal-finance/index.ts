import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.58.0";
const base=Deno.env.get("SUPABASE_URL")||"";
const db=createClient(base,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",{auth:{persistSession:false,autoRefreshToken:false}});
const auth=createClient(base,Deno.env.get("SANDY_PUBLIC_KEY")||"sb_publishable_OVP7LUMDhtcymPRzZuCK3Q_8JkLC3ts",{auth:{persistSession:false,autoRefreshToken:false}});
const headers={"content-type":"application/json; charset=utf-8","access-control-allow-origin":"https://ausstyle.github.io","access-control-allow-methods":"POST, OPTIONS","access-control-allow-headers":"authorization, content-type, apikey, x-client-info","vary":"Origin","cache-control":"no-store"};
const respond=(s:number,d:unknown)=>new Response(JSON.stringify(d),{status:s,headers});
const fail=(s:number,code:string)=>respond(s,{ok:false,error:code});
const str=(v:unknown,n:number)=>typeof v==="string"?v.trim().slice(0,n):"";
const uid=(v:unknown)=>typeof v==="string"&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const validDate=(v:unknown)=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+"T12:00:00Z"));
const money=(v:unknown)=>v==null||v===""?null:(typeof v==="number"&&Number.isFinite(v)&&v>=0&&v<=1e14?Math.round(v*100)/100:undefined);
const kinds=["invoice","costs_order","recovery_action","engagement","trust_statement"];
async function session(req:Request){
 const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(token.length<30)return null;
 const {data,error}=await auth.auth.getUser(token);
 const u=data?.user;if(error||!u?.id||!u?.email||!u.email_confirmed_at)return null;
 const {data:p,error:pe}=await db.from("sandy_memory_portal_accounts").select("customer_id").eq("auth_user_id",u.id).is("revoked_at",null).maybeSingle();
 if(pe||!p?.customer_id)return null;
 const {data:a,error:ae}=await db.from("email_customer_addresses").select("normalized_email").eq("customer_id",p.customer_id).eq("is_primary",true).maybeSingle();
 if(ae||a?.normalized_email!==u.email.toLowerCase())return null;
 return {cid:p.customer_id as string,uid:u.id as string};
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST")return fail(405,"method_not_allowed");
 try{
  const actor=await session(req);if(!actor)return fail(401,"sandy_sign_in_required");
  if(Number(req.headers.get("content-length")||0)>22000)return fail(413,"request_too_large");
  let o:any;try{o=await req.json()}catch{return fail(400,"invalid_json")}
  if(!o||typeof o!=="object"||Array.isArray(o))return fail(400,"invalid_payload");
  const action=str(o.action,60),cid=actor.cid;
  if(action==="list"){
   const matter=o.matter_id;
   if(!uid(matter))return fail(400,"invalid_matter");
   const {data:m,error:me}=await db.from("sandy_legal_matters").select("id").eq("owner_customer_id",cid).eq("id",matter).maybeSingle();
   if(me||!m)return fail(404,"matter_not_found");
   const columns="id,matter_id,proceeding_id,entry_type,title,counterparty,invoice_number,reference_number,issue_date,due_date,currency,gross_amount,outstanding_amount,verified_paid_amount,gst_amount,status,amount_basis,source_provider,source_attachment_name,source_document_url,source_message_url,notes,verified_at,updated_at,created_at";
   const [own,linked]=await Promise.all([
    db.from("sandy_legal_financial_items").select(columns).eq("owner_customer_id",cid).eq("matter_id",matter).order("created_at",{ascending:false}).limit(600),
    db.from("sandy_legal_financial_matter_links").select("financial_item_id,relation_type,origin_description").eq("owner_customer_id",cid).eq("view_matter_id",matter).limit(600)
   ]);
   if(own.error||linked.error)return fail(503,"finance_list_failed");
   const links=linked.data||[];
   let linked_items:any[]=[];
   if(links.length){
    const ids=links.map(l=>l.financial_item_id);
    const {data:items,error:ie}=await db.from("sandy_legal_financial_items").select(columns).eq("owner_customer_id",cid).in("id",ids).limit(600);
    if(ie)return fail(503,"linked_finance_unavailable");
    const all=items||[];
    const originIds=[...new Set(all.map(f=>f.matter_id))];
    const {data:origins,error:oe}=await db.from("sandy_legal_matters").select("id,title").eq("owner_customer_id",cid).in("id",originIds).limit(600);
    if(oe)return fail(503,"related_matter_lookup_failed");
    const originNames=new Map((origins||[]).map(m=>[m.id,m.title]));
    const linkMap=new Map(links.map(l=>[l.financial_item_id,l]));
    linked_items=all.map(f=>({
      ...f,
      relationship:linkMap.get(f.id)?.relation_type||"other_indemnity_evidence",
      source_matter_title:originNames.get(f.matter_id)||linkMap.get(f.id)?.origin_description||"Related matter"
    })).filter(f=>f.matter_id!==matter).sort((x,y)=>String(x.title).localeCompare(String(y.title)));
   }
   return respond(200,{
    ok:true,items:own.data||[],linked_items,
    truncated:(own.data||[]).length===600||links.length===600
   });
  }
  if(action==="create"){
   const matter=o.matter_id,kind=str(o.entry_type,50),title=str(o.title,300),gross=money(o.gross_amount);
   if(!uid(matter)||!kinds.includes(kind)||title.length<2||gross===undefined)return fail(400,"invalid_financial_item");
   const {data:m}=await db.from("sandy_legal_matters").select("id").eq("owner_customer_id",cid).eq("id",matter).maybeSingle();
   if(!m)return fail(404,"matter_not_found");
   if(o.issue_date&&!validDate(o.issue_date))return fail(400,"invalid_issue_date");
   if(o.due_date&&!validDate(o.due_date))return fail(400,"invalid_due_date");
   let proceeding_id=null;
   if(o.proceeding_id){if(!uid(o.proceeding_id))return fail(400,"invalid_proceeding"); const {data:p}=await db.from("sandy_legal_proceedings").select("id").eq("owner_customer_id",cid).eq("matter_id",matter).eq("id",o.proceeding_id).maybeSingle();if(!p)return fail(403,"proceeding_scope");proceeding_id=p.id;}
   const c=str(o.currency,3)||"AUD";if(!/^[A-Z]{3}$/.test(c))return fail(400,"currency_invalid");
   const fields={owner_customer_id:cid,matter_id:matter,proceeding_id,entry_type:kind,title,counterparty:str(o.counterparty,260),invoice_number:str(o.invoice_number,120),reference_number:str(o.reference_number,160),issue_date:o.issue_date||null,due_date:o.due_date||null,currency:c,gross_amount:gross,notes:str(o.notes,10000),status:"awaiting_review",amount_basis:"estimate",source_provider:"manual",created_by:actor.uid,updated_by:actor.uid};
   const {data,error}=await db.from("sandy_legal_financial_items").insert(fields).select("id").single();
   if(error)return fail(503,"finance_create_failed");return respond(201,{ok:true,id:data.id,status:"awaiting_review"});
  }
  if(action==="update"){
   if(!uid(o.id))return fail(400,"invalid_id");
   const {data:prior,error:pe}=await db.from("sandy_legal_financial_items").select("id,matter_id,updated_at").eq("owner_customer_id",cid).eq("id",o.id).maybeSingle();
   if(pe||!prior)return fail(404,"item_not_found");
   if(!o.expected_updated_at||o.expected_updated_at!==prior.updated_at)return fail(409,"item_changed_refresh");
   const fields:any={updated_by:actor.uid};
   if(o.notes!==undefined)fields.notes=str(o.notes,10000);
   if(o.status!==undefined){
    if(!["awaiting_review","disputed","recovery_pending","closed"].includes(o.status))return fail(400,"verified_finance_proof_required");
    fields.status=o.status;
   }
   if(Object.keys(fields).length===1)return fail(400,"no_change");
   const {data,error}=await db.from("sandy_legal_financial_items").update(fields).eq("owner_customer_id",cid).eq("id",o.id).eq("updated_at",prior.updated_at).select("id").maybeSingle();
   if(error)return fail(503,"finance_update_failed");if(!data)return fail(409,"item_changed_refresh");
   return respond(200,{ok:true,id:data.id});
  }
  return fail(400,"unknown_action");
 }catch(e){console.error("sandy_legal_finance_error",(e as Error)?.name);return fail(503,"finance_unavailable")}
});