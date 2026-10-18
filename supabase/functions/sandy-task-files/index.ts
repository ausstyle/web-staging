import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.58.0";
const url=Deno.env.get("SUPABASE_URL")!;
const admin=createClient(url,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
const auth=createClient(url,Deno.env.get("SUPABASE_ANON_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
const bucket="sandy-task-attachments";
const origin="https://ausstyle.github.io";
const cors={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Authorization, Content-Type","Vary":"Origin","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
const mimeByExt:Record<string,string>={jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",gif:"image/gif",heic:"image/heic",heif:"image/heif",pdf:"application/pdf",txt:"text/plain",csv:"text/csv",doc:"application/msword",docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",xls:"application/vnd.ms-excel",xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"};
const uuid=(s:unknown)=>typeof s==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
function response(status:number,body:unknown){return new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}})}
const fail=(message:string,status=400)=>response(status,{error:message});
async function user(req:Request){
 const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(token.length<100||token.length>5000)return null;
 const {data,error}=await auth.auth.getUser(token);const u=data?.user;
 if(error||!u?.id||!u.email_confirmed_at||!u.email)return null;
 const email=u.email.trim().toLowerCase();
 const {data:account,error:ae}=await admin.from("sandy_memory_portal_accounts").select("customer_id").eq("auth_user_id",u.id).is("revoked_at",null).maybeSingle();
 if(ae||!account)return null;
 const [primary,access]=await Promise.all([
 admin.from("email_customer_addresses").select("normalized_email").eq("customer_id",account.customer_id).eq("is_primary",true).maybeSingle(),
 admin.from("sandy_agenda_access").select("customer_id").eq("customer_id",account.customer_id).eq("email",email).eq("enabled",true).maybeSingle()
 ]);
 if(primary.error||access.error||primary.data?.normalized_email!==email||!access.data)return null;
 return {customer_id:account.customer_id as string,email};
}
async function canAccess(taskId:string,cid:string){
 if(!uuid(taskId))return null;
 const {data:task,error}=await admin.from("sandy_tasks").select("id,customer_id,parent_task_id,archived_at").eq("id",taskId).maybeSingle();
 if(error||!task||task.archived_at)return null;
 if(task.customer_id===cid)return {owner:task.customer_id,write:true,isOwner:true};
 const [delegations,participants]=await Promise.all([
  admin.from("sandy_task_delegations").select("task_id,scope").eq("assignee_customer_id",cid).eq("owner_customer_id",task.customer_id).eq("status","accepted"),
  admin.from("sandy_task_participants").select("task_id,role,scope").eq("customer_id",cid).eq("status","accepted")
 ]);
 if(delegations.error||participants.error)throw Error("Could not verify sharing permissions");
 const roots=[
 ...(delegations.data||[]).map((x:any)=>({...x,write:true})),
 ...(participants.data||[]).map((x:any)=>({...x,write:x.role==="collaborator"}))
 ];
 let cursor:any=task;const seen=new Set<string>();
 for(let i=0;i<25&&cursor&&!seen.has(cursor.id);i++){
  seen.add(cursor.id);
  const matching=roots.filter(x=>x.task_id===cursor.id);
  if(matching.length)return {owner:task.customer_id,write:matching.some(x=>x.write),isOwner:false};
  if(!cursor.parent_task_id)break;
  const {data:ancestor,error:ae}=await admin.from("sandy_tasks").select("id,parent_task_id,customer_id").eq("id",cursor.parent_task_id).eq("customer_id",task.customer_id).maybeSingle();
  if(ae)throw Error("Could not check task ancestry");
  cursor=ancestor;
 }
 return null;
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return fail("Method not allowed",405);
 if(req.headers.get("origin")&&req.headers.get("origin")!==origin)return fail("Origin not allowed",403);
 try{
 const session=await user(req);if(!session)return fail("Sign in to Sandy to access files",401);
 const body=await req.json().catch(()=>({}));const action=String(body.action||"");
 if(action==="counts"){
  const {data,error}=await admin.from("sandy_task_attachments").select("task_id").eq("customer_id",session.customer_id).eq("status","ready").limit(10000);
  if(error)return fail("Unable to load attachment counts",503);
  const counts:Record<string,number>={};for(const item of data||[])counts[item.task_id]=(counts[item.task_id]||0)+1;
  return response(200,{counts});
 }
 const taskId=String(body.task_id||"");
 const permission=await canAccess(taskId,session.customer_id);
 if(!permission)return fail("Task access denied",403);
 const owner=permission.owner;
 if(action==="list"){
  const {data,error}=await admin.from("sandy_task_attachments").select("id,task_id,original_filename,mime_type,size_bytes,uploaded_by_customer_id,created_at").eq("customer_id",owner).eq("task_id",taskId).eq("status","ready").order("created_at",{ascending:false}).limit(200);
  if(error)return fail("Unable to load attachments",503);
  return response(200,{files:data||[],can_upload:permission.write,can_delete_all:permission.isOwner});
 }
 if(action==="prepare"){
  if(!permission.write)return fail("Only task collaborators can attach files",403);
  const filename=String(body.filename||"").trim().replace(/[\u0000-\u001f\u007f]/g,"").slice(0,255);
  const extension=filename.split(".").pop()?.toLowerCase()||"";
  const mime=mimeByExt[extension];const size=Number(body.size_bytes);
  if(!filename||!mime)return fail("Unsupported file type. Use a photo, PDF, Word, Excel, CSV or text file.");
  if(!Number.isInteger(size)||size<1||size>26214400)return fail("Files must be between 1 byte and 25 MB.");
  const {count,error:countError}=await admin.from("sandy_task_attachments").select("id",{count:"exact",head:true}).eq("task_id",taskId).in("status",["pending","ready"]);
  if(countError)return fail("Unable to check file quota",503);
  if((count||0)>=100)return fail("Maximum 100 attachments per task",409);
  const id=crypto.randomUUID();const path=owner+"/"+taskId+"/"+id+"."+extension;
  const {error:insertErr}=await admin.from("sandy_task_attachments").insert({id,customer_id:owner,task_id:taskId,uploaded_by_customer_id:session.customer_id,storage_path:path,original_filename:filename,mime_type:mime,size_bytes:size,status:"pending"});
  if(insertErr)return fail("Unable to reserve file",503);
  const {data:signed,error:signErr}=await admin.storage.from(bucket).createSignedUploadUrl(path);
  if(signErr||!signed?.token){await admin.from("sandy_task_attachments").delete().eq("id",id).eq("status","pending");return fail("Could not prepare secure upload",503)}
  return response(200,{id,path:signed.path||path,token:signed.token,mime_type:mime});
 }
 const attachmentId=String(body.id||"");
 if(!uuid(attachmentId))return fail("Invalid attachment",400);
 const {data:file,error:fe}=await admin.from("sandy_task_attachments").select("*").eq("id",attachmentId).eq("customer_id",owner).eq("task_id",taskId).maybeSingle();
 if(fe)return fail("Unable to load attachment",503);
 if(!file)return fail("Attachment was not found",404);
 if(action==="complete"){
  if(!permission.write||file.uploaded_by_customer_id!==session.customer_id)return fail("Upload owner mismatch",403);
  if(file.status==="ready")return response(200,{ok:true,file:{id:file.id,original_filename:file.original_filename,mime_type:file.mime_type,size_bytes:file.size_bytes,created_at:file.created_at}});
  if(Date.now()>new Date(file.expires_at).getTime())return fail("Upload expired. Please attach the file again.",409);
  const folder=owner+"/"+taskId;
  const {data:objects,error:storageError}=await admin.storage.from(bucket).list(folder,{limit:100,search:file.storage_path.split("/").at(-1)});
  const object=(objects||[]).find((x:any)=>x.name===file.storage_path.split("/").at(-1));
  if(storageError||!object)return fail("File upload was not verified. Retry the upload.",409);
  const actual=Number(object.metadata?.size||0);
  if(actual!==file.size_bytes)return fail("Uploaded file size did not match the selected file",409);
  const {error:updated}=await admin.from("sandy_task_attachments").update({status:"ready",ready_at:new Date().toISOString()}).eq("id",file.id).eq("status","pending");
  if(updated)return fail("Upload confirmed but attachment could not be recorded",503);
  return response(200,{ok:true,file:{id:file.id,original_filename:file.original_filename,mime_type:file.mime_type,size_bytes:file.size_bytes,created_at:file.created_at}});
 }
 if(file.status!=="ready")return fail("Attachment is not available",409);
 if(action==="download"){
  const {data:signed,error:se}=await admin.storage.from(bucket).createSignedUrl(file.storage_path,120);
  if(se||!signed?.signedUrl)return fail("Unable to open attachment",503);
  return response(200,{url:signed.signedUrl,mime_type:file.mime_type,name:file.original_filename});
 }
 if(action==="remove"){
  if(!permission.write||(!permission.isOwner&&file.uploaded_by_customer_id!==session.customer_id))return fail("Only the owner or person who attached this file can remove it",403);
  const {error:storageError}=await admin.storage.from(bucket).remove([file.storage_path]);
  if(storageError)return fail("Could not remove stored file",503);
  const {error:deleted}=await admin.from("sandy_task_attachments").delete().eq("id",file.id).eq("customer_id",owner);
  if(deleted)return fail("File removed from storage but metadata cleanup failed",503);
  return response(200,{ok:true});
 }
 return fail("Unknown action",404);
 }catch(error){console.error("sandy-task-files",error instanceof Error?error.message:String(error));return fail("Attachment service temporarily unavailable",503)}
});
