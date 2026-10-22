/**
 * Sandy universal Google REST Discovery wrapper.
 * Library only: invoke from the canonical Sandy API admission and durable job
 * handler, never as an unauthenticated standalone endpoint.
 */
export type GoogleCall={api:string;version:string;methodId:string;pathParams?:Record<string,string>;query?:Record<string,string|number|boolean>;body?:unknown};
export type GoogleIdentity={token:()=>Promise<string>;assertAuthorized:(call:GoogleCall,method:"GET"|"POST"|"PATCH"|"PUT"|"DELETE")=>Promise<void>;audit:(event:Record<string,unknown>)=>Promise<void>};
type Method={id:string;path:string;httpMethod:string;parameters?:Record<string,{required?:boolean;location?:string;type?:string}>;request?:unknown};
type Discovery={rootUrl:string;servicePath?:string;resources?:Record<string,unknown>;methods?:Record<string,Method>};
const PROJECT="elaborate-haven-511518-a5";
const hostOK=(host:string)=>host.endsWith(".googleapis.com")||host==="www.googleapis.com";
const identifier=(v:string)=>/^[a-z][a-z0-9._-]{0,80}$/i.test(v);
const cache=new Map<string,{expiry:number;doc:Discovery}>();
const fetchChecked=async (url:string,init?:RequestInit,fetcher:typeof fetch=fetch)=>{
 const response=await fetcher(url,{...init,redirect:"error",signal:AbortSignal.timeout(20000)});
 const raw=await response.text();
 let data:unknown;try{data=JSON.parse(raw)}catch{throw Error("google_non_json_response")}
 if(!response.ok)throw Error("google_http_"+response.status+":"+JSON.stringify(data).slice(0,250));
 return data;
};
export async function listGoogleAPIs(fetcher:typeof fetch=fetch){
 const data=await fetchChecked("https://discovery.googleapis.com/discovery/v1/apis?preferred=true",undefined,fetcher) as {items?:Array<{name:string;version:string;title:string}>};
 return (data.items??[]).map(x=>({api:x.name,version:x.version,title:x.title}));
}
async function discovery(api:string,version:string,fetcher:typeof fetch):Promise<Discovery>{
 if(!identifier(api)||!identifier(version))throw Error("invalid_google_api_identifier");
 const id=api+":"+version,hit=cache.get(id);
 if(hit&&hit.expiry>Date.now())return hit.doc;
 // Google's directory is the authoritative source for the exact discovery URL.
 const directory=await fetchChecked("https://discovery.googleapis.com/discovery/v1/apis/"+encodeURIComponent(api)+"/"+encodeURIComponent(version)+"/rest",undefined,fetcher) as Discovery;
 const root=new URL(directory.rootUrl);
 if(root.protocol!=="https:"||!hostOK(root.hostname)||root.username||root.password)throw Error("invalid_google_discovery_root");
 cache.set(id,{expiry:Date.now()+3600000,doc:directory});
 return directory;
}
function allMethods(d:Discovery):Method[]{
 const found:Method[]=[];
 const visit=(r:{methods?:Record<string,Method>;resources?:Record<string,unknown>})=>{
  Object.values(r.methods??{}).forEach(m=>found.push(m));
  Object.values(r.resources??{}).forEach(n=>visit(n as typeof r));
 };
 visit(d);return found;
}
export async function searchGoogleMethods(api:string,version:string,term:string,fetcher:typeof fetch=fetch){
 const d=await discovery(api,version,fetcher);
 return allMethods(d).filter(m=>(m.id+" "+m.path).toLowerCase().includes(term.toLowerCase())).slice(0,100).map(m=>({id:m.id,path:m.path,httpMethod:m.httpMethod,parameters:m.parameters}));
}
export async function describeGoogleMethod(api:string,version:string,methodId:string,fetcher:typeof fetch=fetch){
 const d=await discovery(api,version,fetcher);const m=allMethods(d).find(x=>x.id===methodId);
 if(!m)throw Error("google_method_not_found");return m;
}
export async function executeGoogleMethod(call:GoogleCall,identity:GoogleIdentity,fetcher:typeof fetch=fetch){
 const d=await discovery(call.api,call.version,fetcher);
 const m=allMethods(d).find(x=>x.id===call.methodId);
 if(!m)throw Error("google_method_not_found");
 const verb=m.httpMethod.toUpperCase();
 if(!["GET","POST","PATCH","PUT","DELETE"].includes(verb))throw Error("unsupported_google_verb");
 const httpVerb=verb as "GET"|"POST"|"PATCH"|"PUT"|"DELETE";
 const given=call.pathParams??{},params=m.parameters??{};
 let path=m.path.replace(/\\?\{(\+?)([^}]+)\}/g,(_whole,plus:string,key:string)=>{
   if(!(key in given))throw Error("missing_path_parameter:"+key);
   const v=given[key];
   if(typeof v!=="string"||v.length>500||v.includes("?")||v.includes("#")||v.includes("://"))throw Error("invalid_path_parameter");
   if(v.includes("projects/")&&!v.includes("projects/"+PROJECT))throw Error("cross_project_request");
   return plus?v.split("/").map(encodeURIComponent).join("/"):encodeURIComponent(v);
 });
 if(/[{}]/.test(path)||path.includes(".."))throw Error("unresolved_google_path");
 const root=new URL(d.rootUrl);if(!hostOK(root.hostname))throw Error("invalid_google_host");
 const base=new URL((d.servicePath??"")+path,root);
 if(!hostOK(base.hostname)||base.protocol!=="https:")throw Error("invalid_google_destination");
 for(const [key,value] of Object.entries(call.query??{})){
  if(!(key in params)||params[key].location!=="query")throw Error("unknown_query_parameter:"+key);
  if(typeof value!=="string"&&typeof value!=="number"&&typeof value!=="boolean")throw Error("invalid_query_value");
  base.searchParams.set(key,String(value));
 }
 // Mandatory tenant/project validation must occur in caller admission for API
 // methods whose target is in the JSON body, not only the URL.
 await identity.assertAuthorized(call,httpVerb);
 const token=await identity.token();if(!token)throw Error("google_credentials_unavailable");
 let status=0,provider:unknown;
 try {
   const response=await fetcher(base.toString(),{method:httpVerb,redirect:"error",headers:{"authorization":"Bearer "+token,"accept":"application/json",...(call.body===undefined?{}:{"content-type":"application/json"})},body:call.body===undefined?undefined:JSON.stringify(call.body),signal:AbortSignal.timeout(25000)});
   status=response.status;
   provider=await response.json().catch(()=>({error:"non_json_google_response"}));
   return {ok:response.ok,status,provider,operation:call.methodId};
 }finally{
   await identity.audit({provider:"google_cloud",method:call.methodId,api:call.api,version:call.version,httpStatus:status,project:PROJECT});
 }
}
