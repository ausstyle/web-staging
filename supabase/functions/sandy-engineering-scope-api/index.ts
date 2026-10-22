import {createClient} from "npm:@supabase/supabase-js@2.58.0";
const json=(status:number,data:unknown)=>Response.json(data,{status,headers:{"cache-control":"no-store","content-type":"application/json","x-content-type-options":"nosniff"}});
Deno.serve(async(req:Request)=>{
 if(req.method!=="GET")return json(405,{error:"method_not_allowed"});
 const url=Deno.env.get("SUPABASE_URL")||"",secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",anon=Deno.env.get("SUPABASE_ANON_KEY")||"";
 const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(!url||!secret||!anon)return json(503,{error:"configuration_unavailable"});
 if(!token)return json(401,{error:"authentication_required"});
 const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
 if(token!==secret){
  const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error}=await auth.auth.getUser(token);
  if(error||!user)return json(401,{error:"invalid_session"});
  const {data:admin,error:accessError}=await db.from("sandy_controller_admins").select("role").eq("auth_user_id",user.id).eq("enabled",true).maybeSingle();
  if(accessError)return json(503,{error:"permissions_unavailable"});
  if(!admin)return json(403,{error:"engineering_access_required"});
 }
 const u=new URL(req.url),scopeId=u.searchParams.get("scope_id");
 let query=db.from("sandy_engineering_scope_catalogue").select("scope_id,title,scope_kind,parent_scope_id,document_url,repository_path,source_version,status,priority,last_commit_sha,source_commit_sha,content_sha256,last_synced_at,updated_at").is("archived_at",null);
 if(scopeId){
  if(!/^[A-Za-z0-9-]{3,100}$/.test(scopeId))return json(400,{error:"invalid_scope_id"});
  const {data,error}=await query.eq("scope_id",scopeId).maybeSingle();
  if(error)return json(503,{error:"catalogue_unavailable"});
  return data?json(200,{ok:true,source:"sandy_engineering_scope_catalogue",scope:data}):json(404,{error:"scope_not_found"});
 }
 const {data,error}=await query.order("scope_id").limit(300);
 return error?json(503,{error:"catalogue_unavailable"}):json(200,{ok:true,source:"sandy_engineering_scope_catalogue",scopes:data});
});