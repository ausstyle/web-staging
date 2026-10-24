/** Actual worker handler, synthetic authorized DB/provider inputs only.
 * No browser, customer, VM or provider execution acceptance is inferred. */
import assert from "node:assert/strict";
import {computerEligibilityFetch} from "./eligibility.ts";

Deno.test("actual browser worker keeps model stopping claims separate from independently verified completion", async () => {
  const source=await Deno.readTextFile(new URL("./index.ts",import.meta.url));
  for(const done of [true,false]){
    const session:any={id:"session",provider:"daytona",provider_session_id:"d3000000-0000-4000-8000-000000000001",state:"running",expires_at:new Date(Date.now()+120000).toISOString(),control_mode:"agent"};
    const task:any={id:"task",session_id:"session",status:"claimed",attempts:1,lease_until:new Date(Date.now()+60000).toISOString(),requires_approval:false,task_type:"browser_agent",task_payload:{origin:"sandy_internal"},instruction:"Inspect the explicitly permitted fixture"};
    const events:any[]=[],effects:string[]=[];
    const db={rpc:async(name:string)=>({data:name==="sandy_computer_worker_auth"?true:[task],error:null}),from:(table:string)=>{
      const q:any={select:()=>q,eq:()=>q,single:async()=>({data:table==="sandy_computer_tasks"?task:session,error:null}),update:(v:any)=>{Object.assign(task,v);return q;},insert:(v:any)=>{events.push(v);return q;},then:(f:any)=>Promise.resolve({error:null}).then(f)};return q;
    }};
    const context:any={db,guard:computerEligibilityFetch,env:{get:(key:string)=>({DAYTONA_API_KEY:"fixture",SUPABASE_SERVICE_ROLE_KEY:"fixture-service",SUPABASE_URL:"https://fixture.invalid",OPENAI_API_KEY:"fixture-model"}as any)[key]},serve:(handler:any)=>context.handler=handler,fetch:async(input:any)=>{
      const url=String(input);if(url.endsWith("/sandy-windows-ai"))return Response.json({});
      effects.push(url);
      if(url.endsWith("/responses"))return Response.json({output:[{content:[{type:"output_text",text:JSON.stringify(done?{action:"done",summary:"Everything was completed successfully"}:{action:"scroll",x:10,y:10,direction:"down",amount:1})}]}]});
      if(url.includes("/screenshot/"))return Response.json({screenshot:"fixture"});
      if(url.endsWith("/sandbox/"+session.provider_session_id))return Response.json({state:"running"});
      if(url.endsWith("/mouse/scroll"))return Response.json({});
      throw Error("unexpected provider action");
    }};
    (globalThis as any).__computerTruthFixture=context;
    try{
      const candidate=source.replace('import {computerEligibilityFetch} from "./eligibility.ts";','const computerEligibilityFetch=(globalThis as any).__computerTruthFixture.guard;').replace('import {createClient} from "https://esm.sh/@supabase/supabase-js@2.57.0";','const context=(globalThis as any).__computerTruthFixture;const Deno=context;const fetch=context.fetch;const createClient=()=>context.db;');
      await import("data:application/typescript;base64,"+btoa(candidate)+"#"+crypto.randomUUID());
      const response=await context.handler(new Request("https://fixture.invalid",{method:"POST",headers:{"x-sandy-worker-token":"fixture"}}));
      const result=await response.json();
      assert.equal(response.status,200);
      assert.equal(result.status,"completed"); // Original worker-attempt lifecycle preserved.
      for(const projection of [result,task.result,events.at(-1).metadata]){
        assert.equal(projection.complete,false);
        assert.equal(projection.execution_verified,false);
        assert.equal(projection.objective_verified,false);
        assert.equal(projection.model_declared_done,done);
      }
      assert.equal(task.status,"completed");
      assert.equal(task.lease_until,null);
      assert.equal(effects.filter(url=>url.endsWith("/mouse/scroll")).length,done?0:4);
      assert.equal(effects.filter(url=>url.endsWith("/responses")).length,done?1:4);
      if(done)assert.equal(result.summary,"Everything was completed successfully");
    }finally{delete(globalThis as any).__computerTruthFixture;}
  }
});
