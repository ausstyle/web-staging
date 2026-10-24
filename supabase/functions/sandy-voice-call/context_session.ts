/** Existing customer authentication creates only bounded context authority.
 * No provider, media, messages, Owner identity or administrative client. */
type Obj=Record<string,unknown>;
type Dependencies={base:string;anonKey:string;createClient:(base:string,key:string,options:any)=>any;now?:()=>number};
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const object=(v:unknown):v is Obj=>!!v&&typeof v==="object"&&!Array.isArray(v);
export async function handleVoiceContextSession(request:Request,deps:Dependencies):Promise<Response>{
 const url=new URL(request.url),origin=request.headers.get("origin");
 const origins=[url.origin,"https://ausstyle.github.io","https://35-241-239-80.sslip.io"];
 const headers:Record<string,string>={"cache-control":"no-store, private","referrer-policy":"no-referrer","vary":"origin"};
 if(origin&&origins.includes(origin)){headers["access-control-allow-origin"]=origin;headers["access-control-allow-headers"]="authorization,content-type,apikey,x-client-info";headers["access-control-allow-methods"]="POST,OPTIONS";}
 const reply=(body:unknown,status=200)=>Response.json(body,{status,headers});
 if(origin&&!origins.includes(origin))return reply({error:"invalid_origin"},403);
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(request.method!=="POST")return reply({error:"method_not_allowed"},405);
 const issue=url.pathname.endsWith("/context/session"),retire=url.pathname.endsWith("/context/retire");
 if(!issue&&!retire)return reply({error:"not_found"},404);
 const authorization=request.headers.get("authorization")??"";
 if(!/^Bearer [^\s]{100,10000}$/.test(authorization))return reply({error:"normal_customer_auth_required"},401);
 if(!deps.base||!deps.anonKey)return reply({error:"customer_auth_configuration_unavailable"},503);
 const token=authorization.slice(7),client=deps.createClient(deps.base,deps.anonKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
 let user:any;
 try{const auth=await client.auth.getUser(token);if(auth.error)throw Error();user=auth.data?.user;}catch{return reply({error:"normal_customer_auth_required"},401);}
 if(!uuid(user?.id)||user.role!=="authenticated"||!user.email_confirmed_at||typeof user.email!=="string")return reply({error:"verified_normal_customer_required"},403);
 let value:unknown;const reader=request.body?.getReader();let size=0;
 try{
  if(!reader)throw Error();const parts:Uint8Array[]=[];
  for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>8192){await reader.cancel();return reply({error:"request_too_large"},413);}parts.push(next.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
 }catch{return reply({error:"invalid_request"},400);}finally{reader?.releaseLock();}
 const key=issue?"request_id":"session_id";
 if(!object(value)||Object.keys(value).length!==1||!uuid(value[key]))return reply({error:"invalid_request"},400);
 let data:any,error:any;
 try{({data,error}=await client.rpc(issue?"sandy_voice_context_session_issue":"sandy_voice_context_session_retire",{[issue?"p_request_id":"p_session_id"]:value[key]}));}catch{return reply({error:"voice_context_state_unavailable"},503);}
 if(error){const status=error.code==="42501"?403:error.code==="23505"?409:error.code==="54000"?429:503;return reply({error:status===403?"voice_context_authorization_denied":status===409?"voice_context_request_conflict":status===429?"voice_context_quota":"voice_context_state_unavailable"},status);}
 if(!object(data)||data.ok!==true||!uuid(data.session_id)||!uuid(data.receipt_id)||data.purpose!=="context_only"||data.media_connected!==false||data.provider_operations!==0||typeof data.reused!=="boolean")return reply({error:"voice_context_receipt_unavailable"},503);
 if(issue&&(data.state!=="starting"||typeof data.token!=="string"||!/^[a-f0-9]{64}$/.test(data.token)||typeof data.expires_at!=="string"||!Number.isFinite(Date.parse(data.expires_at))||Date.parse(data.expires_at)<=(deps.now??Date.now)()||Date.parse(data.expires_at)>(deps.now??Date.now)()+301000))return reply({error:"voice_context_receipt_unavailable"},503);
 if(retire&&(data.state!=="ended"||Object.hasOwn(data,"token")))return reply({error:"voice_context_receipt_unavailable"},503);
 // Return the reviewed projection only; provider responses cannot add secrets.
 return reply({ok:true,session_id:data.session_id,receipt_id:data.receipt_id,purpose:"context_only",state:data.state,media_connected:false,provider_operations:0,reused:data.reused,...(issue?{token:data.token,expires_at:data.expires_at}:{})});
}
