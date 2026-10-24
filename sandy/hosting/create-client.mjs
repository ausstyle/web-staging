import {createHostingReadClient} from './read-client.mjs';
const endpoint='https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-operation-api';
const uuid=s=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(s);
export function createHostingClient(auth,{request=fetch,publicKey,storage=localStorage,newKey=()=>crypto.randomUUID()}={}){
 const reader=createHostingReadClient(auth,{request,publicKey});let busy=false;
 async function session(){const {data,error}=await auth.getSession();if(error||!uuid(data?.session?.user?.id)||!data.session.access_token)throw Error('Sign in to your Sandy workspace to continue.');return data.session}
 return Object.freeze({...reader,async createAccount(){
  if(busy)throw Error('Account setup is already running.');busy=true;
  try{
   const s=await session(),actor=s.user.id,key='sandy.hosting.logical-create.v1:'+actor;
   const unchanged=async()=>{if((await session()).user.id!==actor)throw Error('Your session changed. Return to the original account before retrying.')};
   let saved;
   try{const raw=storage.getItem(key);saved=raw?JSON.parse(raw):{idempotency_key:newKey(),plan:'starter'};
    if(!uuid(saved.idempotency_key)||saved.plan!=='starter'||(saved.account_id&&!uuid(saved.account_id)))throw Error();
    storage.setItem(key,JSON.stringify(saved));if(storage.getItem(key)!==JSON.stringify(saved))throw Error();
   }catch{throw Error('Unable to preserve the setup request in this browser. Enable site storage before continuing; do not clear an existing setup request.')}
   await unchanged();
   if(!saved.account_id){
    let response,body;
    try{response=await request(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.access_token,...(publicKey?{apikey:publicKey}:{})},body:JSON.stringify({action:'execute',operation:'hosting.accounts.create',arguments:{plan:'starter',idempotency_key:saved.idempotency_key},channel:'api'}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});body=await response.json()}catch{throw Error('Setup outcome is not confirmed. Retry or reload in this browser; your original request is saved.')}
    await unchanged();
    if(response.status===401)throw Error('Sign in again, then retry in this browser. Your original setup request is saved.');
    if(!response.ok)throw Error('Account setup was not confirmed (HTTP '+response.status+'). Your request is saved; retry uses the same key.');
    const r=body?.result,a=r?.result;
    if(body?.ok!==true||body.executed!==true||body.operation!=='hosting.accounts.create'||body.reconciliation_required===true||r?.ok!==true||r.executed!==true||r.operation!=='hosting.accounts.create'||r.contract_version!=='1.0.0'||r.request_state!=='succeeded'||r.reconciliation_required!==false||!uuid(r.request_id)||!uuid(a?.account_id)||a.requested_plan!=='starter'||a.state!=='logical_only'||a.billing_activated!==false||a.provider_resources_created!==false)throw Error('Setup response could not be verified. Retry with your saved request; do not start a new request.');
    saved.account_id=a.account_id;
    try{storage.setItem(key,JSON.stringify(saved))}catch{throw Error('Setup returned an account but saving its ID failed. Retry in this browser with the original request.')}
   }
   await unchanged();const account=await reader.getAccount(saved.account_id);await unchanged();return account;
  }finally{busy=false}
 }});
}
