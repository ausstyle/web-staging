import assert from 'node:assert/strict';
import {candidateHealth,deniedChecks} from './verify_iap_closed_candidate.ts';
const target='https://sandy-iap-repair-review---sandy-engineering-mcp-fixture-ew.a.run.app',source='a'.repeat(64),revision='sandy-engineering-mcp-iap-40000000000-1';
Deno.test('closed acceptance uses normal MCP and protected Control denial, with no provider request or Owner identity',async()=>{
 const calls:any[]=[];
 const request=async(url:RequestInfo|URL,init?:RequestInit)=>{
  calls.push({url,init});assert.ok(!String(url).includes('googleapis.com'));
  if(String(url).endsWith('/healthz'))return Response.json({ok:true});
  assert.equal(new Headers(init?.headers).get('authorization'),'Bearer normal-workload-fixture');
  const b=JSON.parse(String(init?.body));
  if(String(url).endsWith('/mcp')){assert.equal(b.method,'tools/call');assert.equal(b.params.name,'engineering.implementation.request');return Response.json({error:'sandy_api_access_required'},{status:403});}
  if(b.action==='implementation_request')return Response.json({error:'independent_iap_repair_job_authorization_required',executed:false},{status:403});
  if(b.action==='gcp_iap_repair_claim'){assert.equal(b.source_sha256,source);return Response.json({error:'expected_google_repair_runtime_required'},{status:403});}
  return Response.json({ok:false,error:'protected_repair_admission_refused',executed:false,administrator_token_issued:false,token_recorded:false,OS_commands:0,provider_receipts:[]},{status:403});
 };
 const result=await deniedChecks(target,source,revision,'normal-workload-fixture','public-anon-fixture',request as typeof fetch);assert.equal(calls.length,5);assert.equal(result.administrator_token_issued,false);assert.equal(result.Google_provider_requests,0);
});
Deno.test('closed acceptance refuses unexpected target or a worker that reports administrator issuance',async()=>{
 await assert.rejects(()=>deniedChecks('https://evil.invalid',source,revision,'fixture','anon',async()=>{throw Error('must not request');}));
 let n=0;const request=async()=>{n++;if(n===1)return Response.json({ok:true});if(n===2)return Response.json({error:'sandy_api_access_required'},{status:403});if(n===3)return Response.json({error:'independent_iap_repair_job_authorization_required',executed:false},{status:403});if(n===4)return Response.json({error:'expected_google_repair_runtime_required'},{status:403});return Response.json({ok:false,error:'protected_repair_admission_refused',executed:false,administrator_token_issued:true,token_recorded:false,OS_commands:0,provider_receipts:[]},{status:403});};
 await assert.rejects(()=>deniedChecks(target,source,revision,'fixture','anon',request),/must_deny_before_administrator_issuance/);
});

Deno.test('health diagnostic preserves exact HTTP status and safe classification without body or credentials',async()=>{
 for(const status of [401,403,404,500]){const result=await candidateHealth(target,async()=>new Response('PRIVATE_TOKEN_BODY',{status,headers:{'content-type':'text/html','x-private-token':'PRIVATE_HEADER'}}));assert.equal(result.http_status,status);assert.equal(result.healthy,false);assert.equal(result.response_body_recorded,false);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);}
 const transport=await candidateHealth(target,async()=>{throw Error('PRIVATE_NETWORK_ERROR');});assert.equal(transport.classification,'health_transport_unavailable');assert.equal(transport.http_status,null);
 const invalid=await candidateHealth(target,async()=>Response.json({ok:false,token:'PRIVATE'}));assert.equal(invalid.classification,'invalid_application_health');assert.equal(JSON.stringify(invalid).includes('PRIVATE'),false);
});
