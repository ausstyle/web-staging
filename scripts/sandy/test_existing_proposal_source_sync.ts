/** Actual captured scanner and additive bridge; no model/provider/network calls. */
import {PGlite} from 'npm:@electric-sql/pglite@0.3.14';
import assert from 'node:assert/strict';
Deno.test('existing proposal source review resumes idempotently without repeated diagnosis or self-authority',async(t)=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE public.sandy_qa_engineering_handoffs(id uuid PRIMARY KEY,issue_key text,status text,target_function text,evidence jsonb,created_at timestamptz DEFAULT now()-interval '1 hour');
 CREATE TABLE public.sandy_auto_improve_runs(id uuid PRIMARY KEY,source_type text,source_ref text,proposed_fix jsonb);
 CREATE TABLE public.sandy_autonomous_engineering_cycles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),issue_key text UNIQUE,source_handoff_id uuid,phase text,status text,next_action text,evidence jsonb,attempt_count int DEFAULT 0,risk_level text DEFAULT 'unassessed',updated_at timestamptz DEFAULT now());
 CREATE TABLE public.sandy_autonomous_engineering_events(id bigserial,cycle_id uuid,event_key text UNIQUE,event_type text,evidence jsonb);
 CREATE TABLE public.sandy_engineering_change_events(id bigserial,change_id uuid,event_type text,detail jsonb,occurred_at timestamptz DEFAULT now());
 CREATE TABLE public.sandy_v2_qa_runs(run_key text,status text);
 CREATE TABLE public.sandy_v2_qa_executions(run_key text,case_key text,request_id text,verdict text,evidence jsonb);`);
 await db.exec(await Deno.readTextFile('scripts/sandy/fixtures/autonomous-scan-v1.sql'));
 await db.exec(`REVOKE ALL ON FUNCTION public.sandy_autonomous_engineering_scan() FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.sandy_autonomous_engineering_scan() TO service_role;`);
 const value=async(sql:string,params:any[]=[])=>((await db.query(sql,params)).rows[0] as any).v;
 const cases=['v2_dynamic_qa_clock','v2_dynamic_qa_task_count','v2_dynamic_qa_cross_channel'];
 const ids:string[]=[];
 for(const ref of cases){
  const id=crypto.randomUUID(),diagnosis=crypto.randomUUID();ids.push(id);
  await db.query("INSERT INTO public.sandy_auto_improve_runs VALUES($1,'qa_failure',$2,'{\"root_cause\":\"hypothesis\"}')",[diagnosis,ref]);
  await db.query("INSERT INTO public.sandy_qa_engineering_handoffs(id,issue_key,status,evidence) VALUES($1,$2,'fix_proposed',$3)",[id,'v2:auto_qa:'+ref,{source_type:'qa_failure',source_ref:ref,diagnosis_id:diagnosis,proposal_only:true}]);
 }
 await db.exec(await Deno.readTextFile('supabase/migrations/20261024005700_sandy_existing_proposal_source_sync.sql'));
 await t.step('persisted proposals bypass a duplicate paid investigation while retaining missing-source status',async()=>{
  const result=await value('SELECT public.sandy_autonomous_engineering_scan() v');assert.equal(result.new_cycles,3);assert.equal(result.proposal_source_reviews_resumed,3);
  const rows=(await db.query("SELECT phase,status,next_action,attempt_count,risk_level,evidence->'proposal_source_review' review FROM public.sandy_autonomous_engineering_cycles")).rows as any[];
  assert.equal(rows.length,3);for(const row of rows){assert.equal(row.phase,'source_evidence');assert.equal(row.status,'waiting_evidence');assert.equal(row.next_action,'refresh_reviewed_source_snapshots');assert.equal(row.attempt_count,0);assert.equal(row.risk_level,'unassessed');assert.equal(row.review.capability_accepted,false);assert.equal(row.review.paid_investigation_replayed,false);assert.equal(row.review.primary_target,'sandy-agent-runtime-v4');}
  assert.equal((await value('SELECT public.sandy_autonomous_engineering_scan() v')).proposal_source_reviews_resumed,0);
  assert.equal(await value('SELECT count(*)::int v FROM public.sandy_autonomous_engineering_events'),3);
 });
 const snapshot=async(target:string,patch:any={})=>{
  await db.query("INSERT INTO public.sandy_engineering_change_events(change_id,event_type,detail) VALUES($1,'runtime_slice_snapshot_verified',$2)",[crypto.randomUUID(),{source_commit:'a'.repeat(40),all_module_digests_verified:true,source_snapshot:{contract:'reviewed-runtime-source-snapshot-v1',function:target,metadata_version:38,verify_jwt:true,bundle_sha256:'b'.repeat(64),entrypoint_sha256:'c'.repeat(64),module_digests:{[target+'/index.ts']:'c'.repeat(64)},...patch}}]);
 };
 await t.step('typed protected snapshots resume the same cycles; overlapping evidence remains partial',async()=>{
  await snapshot('sandy-agent-runtime-v4');await snapshot('sandy-examiner-full-cycle',{entrypoint_sha256:'bad'});
  assert.equal((await value('SELECT public.sandy_autonomous_engineering_scan() v')).proposal_source_reviews_resumed,3);
  assert.equal(await value("SELECT count(*)::int v FROM public.sandy_autonomous_engineering_cycles WHERE next_action='refresh_reviewed_source_snapshots'"),3);
  await snapshot('sandy-examiner-full-cycle');
  await db.exec(`INSERT INTO public.sandy_v2_qa_runs VALUES('production:c706fc05-5dcb-49b4-adda-1ab9cd00279c','complete');
  INSERT INTO public.sandy_v2_qa_executions VALUES('production:c706fc05-5dcb-49b4-adda-1ab9cd00279c','current_time','fixture-clock','pass','{"mode":"focused_regression_v1"}'),('production:c706fc05-5dcb-49b4-adda-1ab9cd00279c','task_overview','fixture-tasks','needs_review','{"mode":"focused_regression_v1"}');`);
  assert.equal((await value('SELECT public.sandy_autonomous_engineering_scan() v')).proposal_source_reviews_resumed,3);
  for(const row of (await db.query("SELECT issue_key,next_action,evidence->'proposal_source_review' review FROM public.sandy_autonomous_engineering_cycles")).rows as any[]){
   assert.equal(row.next_action,'review_existing_proposal_against_bound_source');assert.equal(row.review.source_snapshots.length,2);assert.equal(row.review.independent_source_review_complete,false);
   if(row.issue_key.endsWith('cross_channel'))assert.equal(row.review.related_grounding,null);
   else assert.equal(row.review.related_grounding.full_handoff_accepted,false);
  }
  const count=await value('SELECT count(*)::int v FROM public.sandy_autonomous_engineering_events');await value('SELECT public.sandy_autonomous_engineering_scan() v');assert.equal(await value('SELECT count(*)::int v FROM public.sandy_autonomous_engineering_events'),count);
 });
 await t.step('unknown cases, malformed provenance and advanced cycles are never promoted or regressed',async()=>{
  const before=await value("SELECT jsonb_agg(to_jsonb(h)) v FROM public.sandy_qa_engineering_handoffs h");
  await db.query("UPDATE public.sandy_autonomous_engineering_cycles SET phase='verification',status='waiting_evidence',next_action='real_world_qa' WHERE source_handoff_id=$1",[ids[0]]);
  await snapshot('sandy-agent-runtime-v4');await value('SELECT public.sandy_autonomous_engineering_scan() v');
  assert.equal(await value('SELECT phase v FROM public.sandy_autonomous_engineering_cycles WHERE source_handoff_id=$1',[ids[0]]),'verification');
  const id=crypto.randomUUID();await db.query("INSERT INTO public.sandy_qa_engineering_handoffs(id,issue_key,status,evidence) VALUES($1,'v2:auto_qa:unreviewed_case','fix_proposed','{\"proposal_only\":true}')",[id]);
  await value('SELECT public.sandy_autonomous_engineering_scan() v');assert.equal(await value('SELECT phase v FROM public.sandy_autonomous_engineering_cycles WHERE source_handoff_id=$1',[id]),'investigate');
  assert.deepEqual(await value('SELECT jsonb_agg(to_jsonb(h)) v FROM public.sandy_qa_engineering_handoffs h WHERE id=ANY($1::uuid[])',[ids]),before);
  for(const role of ['anon','authenticated','service_role'])assert.equal(await value(`SELECT has_function_privilege('${role}','public.sandy_autonomous_proposal_source_review(uuid)','EXECUTE') v`),false);
  assert.equal(await value("SELECT has_function_privilege('service_role','public.sandy_autonomous_engineering_scan()','EXECUTE') v"),true);
 });
 }finally{await db.close();}
});
