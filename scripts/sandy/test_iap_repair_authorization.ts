/** Isolated PostgreSQL fixtures only. No real Owner session, grant or provider. */
import {PGlite} from 'npm:@electric-sql/pglite@0.3.14';
import assert from 'node:assert/strict';
const owner='10000000-0000-4000-8000-000000000001',workload='10000000-0000-4000-8000-000000000002',os='10000000-0000-4000-8000-000000000003',ws='10000000-0000-4000-8000-000000000004';
Deno.test('proposal and independent IAP delegation preserve distinct authority and fail closed',async(t)=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA extensions;
 CREATE FUNCTION auth.role()RETURNS text LANGUAGE sql AS $$SELECT current_setting('fixture.role',true)$$;
 CREATE FUNCTION auth.uid()RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('fixture.uid',true),'')::uuid$$;
 CREATE FUNCTION auth.jwt()RETURNS jsonb LANGUAGE sql AS $$SELECT current_setting('fixture.jwt',true)::jsonb$$;
 CREATE FUNCTION extensions.digest(text,text)RETURNS bytea LANGUAGE sql IMMUTABLE AS $$SELECT sha256(convert_to($1,'UTF8'))$$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_app_meta_data jsonb);
 CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,not_after timestamptz);
 CREATE TABLE public.sandy_controller_admins(auth_user_id uuid,enabled boolean,role text);
 CREATE FUNCTION public.sandy_api_current_owner(uuid)RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM public.sandy_controller_admins WHERE auth_user_id=$1 AND enabled AND role='owner')$$;
 CREATE TABLE public.sandy_engineering_test_identities(user_id uuid,authorized_by uuid,enabled boolean,revoked_at timestamptz,rotation_state text);
 CREATE TABLE public.sandy_engineering_control_grants(identity_user_id uuid PRIMARY KEY,authorized_by uuid,enabled boolean,revoked_at timestamptz,expires_at timestamptz,allowed_actions text[],scope_prefixes text[],admin_read_revision int,admin_read_policy jsonb,updated_at timestamptz DEFAULT now());
 CREATE TABLE public.sandy_engineering_changes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title text,problem text,expected_behavior text,change_purpose text,feature_improvement text,scope jsonb,regression_rules jsonb,acceptance_criteria jsonb,risk text,requested_by uuid,idempotency_key text,status text);
 CREATE TABLE public.sandy_engineering_change_events(change_id uuid,event_type text,actor uuid,detail jsonb);
 CREATE TABLE public.sandy_engineering_identity_events(id bigserial PRIMARY KEY,identity_user_id uuid,owner_authority_id uuid,actor_kind text,event_type text,detail jsonb);
 CREATE FUNCTION public.sandy_engineering_resolve_identity(a uuid,s uuid,e integer) RETURNS jsonb LANGUAGE sql AS $$SELECT CASE WHEN a='${workload}' AND s='${ws}' AND e=2 AND EXISTS(SELECT 1 FROM auth.sessions WHERE id=s AND (not_after IS NULL OR not_after>clock_timestamp())) THEN jsonb_build_object('ok',true,'owner_authority_id','${owner}') ELSE jsonb_build_object('ok',false) END$$;
 INSERT INTO auth.users VALUES('${owner}','fixture-owner@example.invalid','{}'),('${workload}','sandy-engineering-test@sandy-ai.internal','{"sandy_engineering_test":true}');
 INSERT INTO auth.sessions VALUES('${os}','${owner}',NULL),('${ws}','${workload}',NULL);
 INSERT INTO public.sandy_controller_admins VALUES('${owner}',true,'owner');
 INSERT INTO public.sandy_engineering_test_identities VALUES('${workload}','${owner}',true,NULL,'ready');
 INSERT INTO public.sandy_engineering_control_grants VALUES('${workload}','${owner}',true,NULL,'infinity',ARRAY['register'],ARRAY['sandy-engineering-control'],1,'{"preserved_read_grant":true}');`);
 const raw=await Deno.readTextFile('supabase/migrations/20261024001000_sandy_iap_repair_authorization.sql');
 // Fixed proposal tests use a future fixture cap so they stay deterministic
 // after the real reviewed proposal expires. Production bytes are never changed.
 const fixtureCap=new Date(Date.now()+5*86400000).toISOString().replace(/\.\d{3}Z$/,'Z');
 await db.exec(raw.replaceAll('2026-10-30T21:17:00Z',fixtureCap));
 const context=async(role:string,uid:string,sid:string)=>{await db.query("SELECT set_config('fixture.role',$1,false),set_config('fixture.uid',$2,false),set_config('fixture.jwt',$3,false)",[role,uid,JSON.stringify({session_id:sid,app_metadata:{sandy_engineering_epoch:2,sandy_engineering_test:uid===workload}})]);};
 const value=async(sql:string,params:any[]=[])=>((await db.query(sql,params)).rows[0] as any).v;
 let proposal:any;
 await t.step('authenticated workload submits only a high-risk proposed record, idempotently',async()=>{
  await context('authenticated',workload,ws);proposal=await value('SELECT public.sandy_engineering_submit_iap_repair_proposal() v');assert.equal(proposal.state,'proposed');assert.equal(proposal.risk,'high');assert.equal(proposal.grant_established,false);
  const again=await value('SELECT public.sandy_engineering_submit_iap_repair_proposal() v');assert.equal(again.change_id,proposal.change_id);assert.equal(again.reused,true);
  assert.equal(await value('SELECT iap_repair_revision v FROM public.sandy_engineering_control_grants'),0);
  await assert.rejects(db.query('SELECT public.sandy_engineering_set_iap_repair_delegation(true,$1,0,$2)',[fixtureCap,proposal.change_id]),/genuine_authenticated_owner_required/);
  await context('service_role',workload,ws);assert.equal((await value(`SELECT public.sandy_engineering_resolve_iap_repair('${workload}','${ws}',2) v`)).ok,false);
 });
 await t.step('service and anonymous callers cannot submit or create a grant',async()=>{
  for(const role of ['service_role','anon']){await context(role,owner,os);await assert.rejects(db.query('SELECT public.sandy_engineering_submit_iap_repair_proposal()'));await assert.rejects(db.query('SELECT public.sandy_engineering_set_iap_repair_delegation(true,$1,0,$2)',[fixtureCap,proposal.change_id]));}
  const p=await value("SELECT jsonb_build_object('setter',has_function_privilege('service_role','public.sandy_engineering_set_iap_repair_delegation(boolean,timestamptz,integer,uuid)','EXECUTE'),'column',has_column_privilege('service_role','public.sandy_engineering_control_grants','iap_repair_policy','UPDATE')) v");assert.deepEqual(p,{setter:false,column:false});
 });
 await t.step('only separate authenticated Owner fixture establishes the exact bounded grant',async()=>{
  await context('authenticated',owner,os);
  for(const [expiry,revision,id] of [[new Date(0).toISOString(),0,proposal.change_id],[new Date(Date.now()+6*86400000).toISOString(),0,proposal.change_id],[fixtureCap,1,proposal.change_id],[fixtureCap,0,owner]])await assert.rejects(db.query('SELECT public.sandy_engineering_set_iap_repair_delegation(true,$1,$2,$3)',[expiry,revision,id]));
  const grant=await value('SELECT public.sandy_engineering_set_iap_repair_delegation(true,$1,0,$2) v',[fixtureCap,proposal.change_id]);assert.equal(grant.revision,1);assert.equal(grant.provider_operation_executed,false);
  await context('service_role',workload,ws);const r=await value(`SELECT public.sandy_engineering_resolve_iap_repair('${workload}','${ws}',2) v`);assert.equal(r.ok,true);assert.equal(r.policy.template.member,'serviceAccount:sandy-computer@elaborate-haven-511518-a5.iam.gserviceaccount.com');assert.equal(r.policy.template.targets.length,2);
  await assert.rejects(db.exec("UPDATE public.sandy_engineering_identity_events SET detail=detail||'{\"forged\":true}'"),/audit_immutable/);
 });
 await t.step('revocation and missing current workload session deny subsequent resolution',async()=>{
  await context('authenticated',owner,os);await value('SELECT public.sandy_engineering_set_iap_repair_delegation(false,NULL,1,NULL) v');
  await context('service_role',workload,ws);assert.equal((await value(`SELECT public.sandy_engineering_resolve_iap_repair('${workload}','${ws}',2) v`)).ok,false);
  await db.exec(`DELETE FROM auth.sessions WHERE id='${ws}'`);await context('authenticated',workload,ws);await assert.rejects(db.query('SELECT public.sandy_engineering_submit_iap_repair_proposal()'));
  assert.equal(await value('SELECT admin_read_revision v FROM public.sandy_engineering_control_grants'),1);assert.deepEqual(await value('SELECT admin_read_policy v FROM public.sandy_engineering_control_grants'),{preserved_read_grant:true});
 });
 }finally{await db.close();}
});
