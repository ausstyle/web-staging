import assert from 'node:assert/strict';
import {computerEligibilityFetch} from './eligibility.ts';
const now=Date.now();
function fixture(){
 const task:any={id:'task',session_id:'session',status:'claimed',attempts:1,lease_until:new Date(now+60000).toISOString(),requires_approval:false};
 const session:any={id:'session',provider:'daytona',provider_session_id:'sandbox',state:'running',expires_at:new Date(now+120000).toISOString(),control_mode:'agent'};
 const db={from:(table:string)=>{const q:any={select:()=>q,eq:()=>q,single:async()=>({data:table==='sandy_computer_tasks'?task:session,error:null})};return q;}};
 let calls=0;const request=computerEligibilityFetch(db,{taskId:'task',sessionId:'session',sandboxId:'sandbox',attempt:1,agent:true},async()=>{calls++;return new Response('{}');},()=>now);
 return {task,session,request,calls:()=>calls};
}
Deno.test('dispatch guard rechecks expiry and human takeover after a prior request',async()=>{
 for(const mutate of [(s:any)=>s.control_mode='human',(s:any)=>s.expires_at=new Date(now).toISOString(),(s:any)=>s.state='terminated',(s:any)=>s.provider_session_id='different']){
  const f=fixture();await f.request('https://fixture.invalid');mutate(f.session);await assert.rejects(f.request('https://fixture.invalid'),/eligibility_refused/);assert.equal(f.calls(),1);
 }
});
Deno.test('revoked, reclaimed, unapproved and expired tasks cannot dispatch',async()=>{
 for(const patch of [{status:'cancelled'},{attempts:2},{requires_approval:true},{lease_until:new Date(now).toISOString()},{session_id:'other'}]){
  const f=fixture();Object.assign(f.task,patch);await assert.rejects(f.request('https://fixture.invalid'),/eligibility_refused/);assert.equal(f.calls(),0);
 }
});
Deno.test('resume remains separately guarded; no unbounded session can dispatch',async()=>{
 const f=fixture();f.session.state='stopped';await f.request('https://fixture.invalid');f.session.expires_at=null;await assert.rejects(f.request('https://fixture.invalid'));assert.equal(f.calls(),1);
});
Deno.test('actual source worker refuses expired tasks and stops after model-time takeover',async()=>{
 const source=await Deno.readTextFile(new URL('./index.ts',import.meta.url));
 const helper=new URL('./eligibility.ts',import.meta.url).href;
 for(const takeover of [false,true]){
  const session:any={id:'session',provider:'daytona',provider_session_id:'d3000000-0000-4000-8000-000000000001',state:'running',expires_at:new Date(Date.now()+(takeover?120000:-1)).toISOString(),control_mode:'agent'};
  const task:any={id:'task',session_id:'session',status:'claimed',attempts:1,lease_until:new Date(Date.now()+60000).toISOString(),requires_approval:false,task_type:'browser_agent',task_payload:{origin:'sandy_internal'},instruction:'Inspect the approved fixture'};
  const effects:string[]=[];let queued=false;
  const db={rpc:async(name:string)=>({data:name==='sandy_computer_worker_auth'?true:[task],error:null}),from:(table:string)=>{
   const q:any={select:()=>q,eq:()=>q,single:async()=>({data:table==='sandy_computer_tasks'?task:session,error:null}),update:(v:any)=>{if(v.status==='queued')queued=true;Object.assign(table==='sandy_computer_tasks'?task:session,v);return q;},insert:()=>q,then:(f:any)=>Promise.resolve({error:null}).then(f)};return q;
  }};
  const context:any={db,env:{get:(key:string)=>({DAYTONA_API_KEY:'fixture',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',SUPABASE_URL:'https://fixture.invalid',OPENAI_API_KEY:'fixture-model'} as any)[key]},serve:(handler:any)=>context.handler=handler,fetch:async(input:any)=>{
   const url=String(input);if(url.endsWith('/sandy-windows-ai'))return Response.json({});
   effects.push(url);
   if(url.endsWith('/responses')){session.control_mode='human';return Response.json({output:[{content:[{type:'output_text',text:'{"action":"click","x":1,"y":1}'}]}]});}
   if(url.includes('/screenshot/'))return Response.json({screenshot:'fixture'});
   if(url.endsWith('/sandbox/'+session.provider_session_id))return Response.json({state:'running'});
   throw Error('unexpected provider action');
  }};
  (globalThis as any).__computerFixture=context;
  const candidate=source.replace('import {computerEligibilityFetch} from "./eligibility.ts";',`import {computerEligibilityFetch} from ${JSON.stringify(helper)};`).replace('import {createClient} from "https://esm.sh/@supabase/supabase-js@2.57.0";','const context=(globalThis as any).__computerFixture;const Deno=context;const fetch=context.fetch;const createClient=()=>context.db;');
  await import('data:application/typescript;base64,'+btoa(candidate)+'#'+crypto.randomUUID());
  const result=await context.handler(new Request('https://fixture.invalid',{method:'POST',headers:{'x-sandy-worker-token':'fixture'}}));
  assert.equal(result.status,takeover?409:403);assert.equal(queued,false);assert.equal(effects.some(u=>u.includes('/mouse/')),false);
  if(!takeover)assert.equal(effects.length,0);else assert.equal(effects.some(u=>u.endsWith('/responses')),true);
 }
 delete (globalThis as any).__computerFixture;
});
