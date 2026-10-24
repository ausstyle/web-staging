const endpoint='https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-operation-api';
const uuid=s=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(s);
export function createHostingReadClient(auth,{request=fetch,publicKey}={}){
 return Object.freeze({async getAccount(accountId){
  if(!uuid(accountId))throw Error('Enter a valid hosting account ID.');
  let {data,error}=await auth.getSession();let session=data?.session;
  if(error||!session?.access_token||!session.user?.id)throw Error('Sign in to your Sandy workspace to continue.');
  const actor=session.user.id;
  const send=()=>request(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token,...(publicKey?{apikey:publicKey}:{})},body:JSON.stringify({action:'execute',operation:'hosting.accounts.get',arguments:{account_id:accountId},channel:'api'}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  let response=await send();
  if(response.status===401){const refreshed=await auth.refreshSession();session=refreshed.data?.session;if(refreshed.error||!session?.access_token||session.user?.id!==actor)throw Error('Your session changed. Sign in again.');response=await send();}
  const body=await response.json().catch(()=>null);
  const current=await auth.getSession();if(current.error||current.data?.session?.user?.id!==actor)throw Error('Your session changed. Load the account again.');
  if(response.status===401)throw Error('Your session expired. Sign in again.');
  if(response.status===404)throw Error('No accessible hosting account was found.');
  if(!response.ok||body?.ok!==true||body.operation!=='hosting.accounts.get'||body.executed!==true||body.reconciliation_required===true)throw Error('Hosting account lookup is not available for this workspace yet.');
  const result=body.result;
  if(result?.ok!==true||result.operation!=='hosting.accounts.get'||result.executed!==true||result.contract_version!=='1.0.0'||result.request_state!=='succeeded'||result.reconciliation_required!==false||!uuid(result.request_id))throw Error('The hosting account response could not be verified.');
  const account=result.result;
  if(account?.account_id!==accountId||account.state!=='logical_only'||!['starter','business','premium'].includes(account.requested_plan)||!Number.isSafeInteger(account.version)||account.version<1||account.billing_activated!==false||account.provider_resources_created!==false)throw Error('The hosting account response could not be verified.');
  return Object.freeze({account_id:accountId,requested_plan:account.requested_plan,state:account.state,version:account.version,request_id:result.request_id});
 }});
}
