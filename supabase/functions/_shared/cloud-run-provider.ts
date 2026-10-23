/**
 * Provider-side Cloud Run REST adapter.
 * Called only through Sandy's existing authenticated/approved job executor.
 * Never publish as a public standalone function.
 */
export type CloudRunInput =
  | {operation:"cloud_run.service.get";project:string;region:string;service:string}
  | {operation:"cloud_run.service.deploy_image";project:string;region:string;service:string;image:string;approved:boolean;requestId:string};
const PROJECT="elaborate-haven-511518-a5";
const REGION="europe-west1";
const SERVICE="sandy-marketing";
const ID=/^[a-z][a-z0-9-]{0,62}$/;
export async function cloudRunProvider(
 input:CloudRunInput, 
 context:{getGoogleAccessToken:()=>Promise<string>;fetcher?:typeof fetch}
):Promise<{httpStatus:number;response:unknown}> {
 if(input.project!==PROJECT||input.region!==REGION||input.service!==SERVICE)
   throw new Error("cloud_run_target_not_allowlisted");
 const token=await context.getGoogleAccessToken();
 if(!token)throw new Error("google_workload_identity_unavailable");
 if(!ID.test(input.service))throw new Error("invalid_service");
 const root=`https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}`;
 let method="GET",payload:unknown;
 if(input.operation==="cloud_run.service.deploy_image"){
   if(!input.approved)throw new Error("deployment_approval_required");
   if(!/^[0-9a-f-]{36}$/i.test(input.requestId))throw new Error("idempotency_key_required");
   if(!input.image.startsWith(`${REGION}-docker.pkg.dev/${PROJECT}/sandy-web/sandy-marketing@`)||
      !/@sha256:[a-f0-9]{64}$/.test(input.image))throw new Error("immutable_image_digest_required");
   method="PATCH";
   payload={
     name:`projects/${PROJECT}/locations/${REGION}/services/${SERVICE}`,
     template:{containers:[{image:input.image,ports:[{containerPort:8080}]}]},
   };
 }
 const response=await (context.fetcher??fetch)(root,{
  method,headers:{"authorization":`Bearer ${token}`,"accept":"application/json",...(payload?{"content-type":"application/json"}:{})},
  body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(25000)
 });
 const responseBody=await response.json().catch(()=>({error:"unparseable_google_response"}));
 return {httpStatus:response.status,response:responseBody};
}
