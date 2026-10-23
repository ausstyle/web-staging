/** Exact inspected production RPC body, isolated synthetic engineering cycles.
 * No real Owner, codegen run, deployment or provider operation is executed. */
import {PGlite} from 'npm:@electric-sql/pglite@0.3.14';
import assert from 'node:assert/strict';
Deno.test('late Architect outcomes are audit-only and cannot regress or certify an advanced engineering cycle',async(t)=>{
 const db=new PGlite();try{
 await db.exec(`CREATE TABLE public.sandy_autonomous_engineering_cycles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),issue_key text UNIQUE,source_handoff_id uuid,phase text,status text,risk_level text,next_action text,evidence jsonb DEFAULT '{}',attempt_count int DEFAULT 0,last_attempt_at timestamptz,next_eligible_at timestamptz,updated_at timestamptz DEFAULT now());
 CREATE TABLE public.sandy_qa_engineering_handoffs(id uuid PRIMARY KEY,status text,approval_required boolean,verification jsonb);
 CREATE TABLE public.sandy_autonomous_engineering_events(id bigserial,cycle_id uuid,event_key text UNIQUE,event_type text,evidence jsonb);
 INSERT INTO public.sandy_autonomous_engineering_cycles(issue_key,phase,status,next_action) VALUES('fixture-current','architect','queued','dispatch_architect');`);
 await db.exec(await Deno.readTextFile('scripts/sandy/fixtures/autonomous-record-event-v1.sql'));
 await db.exec(await Deno.readTextFile('supabase/migrations/20261024003300_sandy_superseded_architect_outcomes.sql'));
 const value=async(sql:string,params:any[]=[])=>((await db.query(sql,params)).rows[0] as any).v;
 const event=(key:string,type:string,evidence:any)=>value("SELECT public.sandy_autonomous_engineering_record_event('fixture-current',$1,$2,$3) v",[key,type,evidence]);
 await t.step('existing valid Architect and PR transitions remain operational',async()=>{
  const ready=await event('fixture-ready-event','architect_ready',{decision:'READY',run_id:'123456789'});assert.equal(ready.phase,'engineering');
  const pr=await event('fixture-pr-created','engineering_pr_created',{run_id:'123456789',pr_number:'123'});assert.equal(pr.phase,'review');assert.equal(pr.status,'waiting_approval');
 });
 await t.step('verified late BLOCKED and READY outcomes append immutable evidence without any state or acceptance change',async()=>{
  await db.exec("UPDATE public.sandy_autonomous_engineering_cycles SET phase='verification',status='waiting_evidence',next_action='real_world_qa',attempt_count=4,next_eligible_at='2030-01-01'");
  const before=await value("SELECT to_jsonb(c) v FROM public.sandy_autonomous_engineering_cycles c WHERE issue_key='fixture-current'");
  for(const decision of ['BLOCKED','READY']){const result=await event('fixture-late-'+decision,'architect_'+decision.toLowerCase(),{decision,run_id:'999999999',source:'github_oidc_observer'});assert.equal(result.superseded,true);assert.equal(result.phase,'verification');assert.equal(result.status,'waiting_evidence');assert.equal(result.production_acceptance_inferred,false);}
  assert.deepEqual(await value("SELECT to_jsonb(c) v FROM public.sandy_autonomous_engineering_cycles c WHERE issue_key='fixture-current'"),before);
  assert.equal(await value("SELECT count(*)::int v FROM public.sandy_autonomous_engineering_events WHERE event_type='architect_outcome_superseded'"),2);
  assert.equal((await event('fixture-late-BLOCKED','architect_blocked',{decision:'BLOCKED',run_id:'999999999',source:'github_oidc_observer'})).duplicate,true);
 });
 await t.step('unverified, mismatched or absent provenance is rejected; no QA or deployment guard is relaxed',async()=>{
  for(const evidence of [{decision:'BLOCKED',run_id:'999999999'},{decision:'READY',run_id:'999999999',source:'github_oidc_observer'},{decision:'BLOCKED',run_id:'bad',source:'github_oidc_observer'}])await assert.rejects(event('fixture-invalid-'+crypto.randomUUID(),'architect_blocked',evidence),/Verified superseded Architect observation required/);
  await assert.rejects(event('fixture-false-qa','qa_verified',{}),/Real-world production verification absent/);
  await db.exec("DELETE FROM public.sandy_autonomous_engineering_events WHERE event_type='engineering_pr_created'");await assert.rejects(event('fixture-no-pr','architect_blocked',{decision:'BLOCKED',run_id:'999999999',source:'github_oidc_observer'}),/Invalid architect state/);
 });
 }finally{await db.close();}
});
