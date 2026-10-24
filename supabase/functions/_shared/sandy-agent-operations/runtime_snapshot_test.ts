// Real isolated SQL rows through the existing authentication, snapshot and
// operational-inspection implementations. No model/provider or live fixtures.
import assert from 'node:assert/strict';
import {PGlite} from 'npm:@electric-sql/pglite@0.3.14';
import {authenticateRuntime,bindRuntimeTask} from './identity.ts';
import {collectRuntimeSnapshot} from './runtime_snapshot.ts';
import {bindRuntimeOperationalContext,runtimeOperationalOperation} from './runtime_operational.ts';
async function fixture(overrides:Record<string,unknown>={}){
 const pg=new PGlite();const customer=crypto.randomUUID(),foreign=crypto.randomUUID(),task=crypto.randomUUID(),conversation=crypto.randomUUID();
 await pg.exec(`CREATE TABLE sandy_agent_tasks(id text,customer_id text,channel text,request_id text,status text,user_request text,plan jsonb);
 CREATE TABLE sandy_capability_catalog(feature_key text,channels jsonb,last_verified_at text,verification_note text);
 CREATE TABLE sandy_ai_integrations(integration_key text,enabled boolean,deployment_status text,last_verified_at text);
 CREATE TABLE sandy_module_status(module_key text,operational_status text,last_tested_at text);
 CREATE TABLE sandy_master_modules(module_key text,sort_order int);
 CREATE TABLE sandy_v2_runtime_policy(policy_key text,mode text);
 CREATE TABLE sandy_composio_connections(customer_id text);
 CREATE TABLE sandy_agenda_companies(customer_id text,id text,name text);
 CREATE TABLE sandy_web_turns(id text,customer_id text,conversation_id text);
 CREATE TABLE sandy_web_conversations(id text,customer_id text);
 CREATE TABLE sandy_voice_transcript_turns(id text,owner_customer_id text,role text);
 CREATE TABLE email_messages(id text,customer_id text,direction text,sender_address text);
 CREATE TABLE sandy_whatsapp_identities(customer_id text,wa_id text,verification_status text);
 CREATE TABLE sandy_whatsapp_messages(id text,sender_wa_id text,direction text);
 CREATE TABLE email_customer_addresses(customer_id text,normalized_email text,verified_at text);`);
 await pg.query("INSERT INTO sandy_agent_tasks VALUES($1,$2,'web','request','running','Count my messages','{}')",[task,customer]);
 await pg.query('INSERT INTO sandy_web_conversations VALUES($1,$2)',[conversation,customer]);
 for(const c of [customer,foreign]){
  await pg.query('INSERT INTO sandy_web_turns VALUES($1,$2,$3)',[crypto.randomUUID(),c,conversation]);
  await pg.query("INSERT INTO sandy_voice_transcript_turns VALUES($1,$2,'user'),($3,$2,'assistant')",[crypto.randomUUID(),c,crypto.randomUUID()]);
  await pg.query("INSERT INTO email_messages VALUES($1,$2,'incoming','own@example.invalid'),($3,$2,'incoming','other@example.invalid')",[crypto.randomUUID(),c,crypto.randomUUID()]);
  await pg.query("INSERT INTO email_customer_addresses VALUES($1,'own@example.invalid','2026-01-01')",[c]);
  await pg.query("INSERT INTO sandy_whatsapp_identities VALUES($1,$2,'verified')",[c,c]);
  await pg.query("INSERT INTO sandy_whatsapp_messages VALUES($1,$2,'inbound')",[crypto.randomUUID(),c]);
 }
 const db={from(table:string){
  assert.match(table,/^[a-z_][a-z0-9_]*$/);const clauses:string[]=[],values:unknown[]=[];let count=false,single=false,limit=10000;
  const filter=(column:string,operator:string,value:unknown)=>{assert.match(column,/^[a-z_][a-z0-9_]*$/);values.push(value);clauses.push(`${column} ${operator} $${values.length}`);return builder;};
  const builder:any={select(_columns:string,options:any){count=options?.count==='exact';return builder;},eq:(k:string,v:unknown)=>filter(k,'=',v),in:(k:string,v:unknown[])=>filter(k,'= ANY',v),not(k:string,op:string,v:unknown){assert.equal(op,'is');assert.equal(v,null);assert.match(k,/^[a-z_][a-z0-9_]*$/);clauses.push(k+' IS NOT NULL');return builder;},order(_column:string){return builder;},limit(n:number){limit=n;return builder;},maybeSingle(){single=true;return builder;},async then(resolve:any,reject:any){try{
   // ANY needs parentheses around its bind parameter.
   const where=clauses.map(x=>x.replace(/= ANY (\$\d+)/,'= ANY ($1)')).join(' AND ');
   const rows=(await pg.query(`SELECT * FROM ${table}${where?' WHERE '+where:''} LIMIT ${limit}`,values)).rows;
   if(Object.hasOwn(overrides,table+"_result"))return resolve(overrides[table+"_result"]);
   return resolve({data:single?rows[0]??null:rows,error:null,count:count?(Object.hasOwn(overrides,table)?overrides[table]:rows.length):null});
  }catch(error){return reject(error);}}};return builder;
 }};
 const auth=await authenticateRuntime(new Request('https://fixture.invalid',{headers:{authorization:'Bearer synthetic-test'}}),db,'synthetic-test');assert.ok(auth);
 const principal=await bindRuntimeTask(auth,db,{taskId:task,customerId:customer,channel:'web',requestId:'request'});assert.ok(principal);
 const inspect=async()=>{
  const snapshot=await collectRuntimeSnapshot(principal,db,{channel:'web',requestId:'request',conversationId:conversation});
  const capability=bindRuntimeOperationalContext(principal,{channel:'web',activityFacts:snapshot.activityFacts,communicationFacts:snapshot.communicationFacts,services:[],connectionError:null,clock:'2026-10-24T00:00:00Z',timezone:'UTC'});
  return {snapshot,communication:await runtimeOperationalOperation(principal,'agent.runtime.operational.communication',db,capability),activity:await runtimeOperationalOperation(principal,'agent.runtime.operational.activity',db,capability),capability};
 };
 return {pg,db,principal,inspect,customer,foreign,task};
}
Deno.test('cross-channel inspection counts only own records and verified sender identities',async()=>{
 const f=await fixture();try{const r=await f.inspect();assert.equal(r.communication.status,'verified');assert.deepEqual(r.communication.counts,{web_messages:1,whatsapp_inbound_verified_identity:1,voice_user_turns:1,email_incoming_customer_linked:2,email_authored_by_verified_customer:1});assert.equal(r.communication.known_customer_originated_subset,3);assert.equal(r.activity.all_web_messages,1);assert.equal(r.activity.current_conversation_messages,1);
 await f.pg.query('UPDATE sandy_agent_tasks SET customer_id=$1 WHERE id=$2',[f.foreign,f.task]);
 assert.equal((await runtimeOperationalOperation(f.principal,'agent.runtime.operational.communication',f.db,r.capability)).error,'runtime_operational_task_binding_mismatch');
 }finally{await f.pg.close();}
});
Deno.test('missing or malformed channel counts remain unknown through inspection',async()=>{
 for(const invalid of [null,undefined,-1,1.5,'0',Number.MAX_SAFE_INTEGER+1]){
  const f=await fixture({sandy_voice_transcript_turns:invalid});try{const r=await f.inspect();assert.equal(r.communication.status,'partial');assert.equal(r.communication.counts.voice_user_turns,null);assert.equal(r.communication.counts.web_messages,1);assert.equal(r.communication.known_customer_originated_subset,null);assert.ok(r.communication.missing_or_unverified.includes('voice_user_turns'));}finally{await f.pg.close();}
 }
});
Deno.test('unknown web counts are not a verified empty conversation',async()=>{
 const f=await fixture({sandy_web_turns:null});try{const r=await f.inspect();assert.equal(r.activity.error,'conversation_activity_unavailable');assert.equal(r.snapshot.activityFacts.status,'unavailable');assert.equal(r.communication.counts.web_messages,null);}finally{await f.pg.close();}
});
Deno.test('genuine empty counts survive; malformed identity rows do not become zero',async()=>{
 const f=await fixture();try{
 await f.pg.exec('DELETE FROM sandy_web_turns;DELETE FROM sandy_voice_transcript_turns;DELETE FROM email_messages;DELETE FROM sandy_whatsapp_identities');
 let r=await f.inspect();assert.equal(r.activity.all_web_messages,0);assert.equal(r.communication.counts.whatsapp_inbound_verified_identity,0);assert.equal(r.communication.known_customer_originated_subset,0);
 await f.pg.query("INSERT INTO sandy_whatsapp_identities VALUES($1,NULL,'verified')",[f.customer]);
 r=await f.inspect();assert.equal(r.communication.counts.whatsapp_inbound_verified_identity,null);assert.equal(r.communication.known_customer_originated_subset,null);
 }finally{await f.pg.close();}
});

Deno.test('capability inspection rejects malformed/future/stale verification evidence on real SQL rows',async()=>{
 const f=await fixture();const originalNow=Date.now,now=Date.parse('2026-10-24T04:00:00Z');
 try{
  Date.now=()=>now;
  const cases:[string,string|null,boolean][]=[['missing',null,true],['invalid','not-a-date',true],['future',new Date(now+1).toISOString(),true],['expired',new Date(now-86400000).toISOString(),true],['recent',new Date(now-86399999).toISOString(),false],['current',new Date(now).toISOString(),false]];
  for(const [key,timestamp] of cases)await f.pg.query("INSERT INTO sandy_module_status VALUES($1,'operational',$2)",[key,timestamp]);
  const {capability}=await f.inspect();
  const result=await runtimeOperationalOperation(f.principal,'agent.runtime.operational.capabilities',f.db,capability);
  assert.equal(result.ok,true);
  for(const [key,,stale] of cases){const row=result.modules.find((m:any)=>m.module_key===key);assert.equal(row.stale,stale,key);assert.equal(row.operational_status,stale?'unverified':'operational',key);}
 }finally{Date.now=originalNow;await f.pg.close();}
});
Deno.test('unavailable capability registries never report a successful empty catalogue',async()=>{
 for(const table of ['sandy_capability_catalog','sandy_ai_integrations','sandy_module_status','sandy_master_modules']){
  for(const invalid of [{data:[],error:{message:'synthetic private diagnostic'}},{data:null,error:null},{data:{},error:null}]){
   const f=await fixture({[table+'_result']:invalid});try{
    const {capability}=await f.inspect();
    assert.deepEqual(await runtimeOperationalOperation(f.principal,'agent.runtime.operational.capabilities',f.db,capability),{error:'capability_catalog_unavailable'});
   }finally{await f.pg.close();}
  }
 }
 const f=await fixture();try{const {capability}=await f.inspect();const result=await runtimeOperationalOperation(f.principal,'agent.runtime.operational.capabilities',f.db,capability);assert.equal(result.ok,true);assert.deepEqual(result.modules,[]);assert.deepEqual(result.master_modules,[]);}finally{await f.pg.close();}
});
