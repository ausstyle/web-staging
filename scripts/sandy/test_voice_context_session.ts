/** Isolated PostgreSQL contracts. Fixture claims/Vault are simulated; this is
 * not normal Auth or production/customer acceptance. No network/providers. */
import assert from "node:assert/strict";
import {PGlite} from "npm:@electric-sql/pglite@0.3.14";
const U1="11000000-0000-4000-8000-000000000001",U2="11000000-0000-4000-8000-000000000002";
const A1="12000000-0000-4000-8000-000000000001",A2="12000000-0000-4000-8000-000000000002";
const C1="13000000-0000-4000-8000-000000000001",C2="13000000-0000-4000-8000-000000000002";
Deno.test("normal-customer context-only voice authority is atomic, private, bounded, replay-safe and revocable",async()=>{
 const db=new PGlite();let checks=0;
 try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA extensions;CREATE SCHEMA vault;
   CREATE FUNCTION auth.jwt()RETURNS jsonb LANGUAGE sql AS $$SELECT current_setting('request.jwt.claims',true)::jsonb$$;
   CREATE FUNCTION auth.uid()RETURNS uuid LANGUAGE sql AS $$SELECT (auth.jwt()->>'sub')::uuid$$;
   CREATE FUNCTION auth.role()RETURNS text LANGUAGE sql AS $$SELECT auth.jwt()->>'role'$$;
   CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,banned_until timestamptz);
   CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,not_after timestamptz);
   CREATE TABLE public.sandy_memory_portal_accounts(auth_user_id uuid,customer_id uuid,revoked_at timestamptz);
   CREATE TABLE public.email_customer_addresses(customer_id uuid,normalized_email text,is_primary boolean,verified_at timestamptz);
   CREATE TABLE public.sandy_memory_settings(customer_id uuid PRIMARY KEY,enabled boolean);
   CREATE TABLE public.sandy_voice_call_links(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_customer_id uuid,token_sha256 text,created_at timestamptz DEFAULT now(),expires_at timestamptz,revoked_at timestamptz,max_starts integer DEFAULT 1,starts integer DEFAULT 0,last_started_at timestamptz,trusted_memory boolean DEFAULT false);
   CREATE TABLE public.sandy_voice_call_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),link_id uuid REFERENCES public.sandy_voice_call_links,owner_customer_id uuid,created_at timestamptz DEFAULT now(),connected_at timestamptz,ended_at timestamptz,state text,openai_call_id text,error_code text,review_status text);
   CREATE TABLE public.sandy_voice_private_auth(session_id uuid PRIMARY KEY,owner_customer_id uuid,code_hash text,attempts integer,sent_count integer,last_sent_at timestamptz,expires_at timestamptz,verified_at timestamptz);
   ALTER TABLE public.sandy_voice_call_links ENABLE ROW LEVEL SECURITY;ALTER TABLE public.sandy_voice_call_sessions ENABLE ROW LEVEL SECURITY;ALTER TABLE public.sandy_voice_private_auth ENABLE ROW LEVEL SECURITY;
   CREATE TABLE public.sandy_customer_mutation_receipts(mutation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid,auth_user_id uuid,operation text,idempotency_key text,arguments_sha256 text,result jsonb,created_at timestamptz DEFAULT now(),UNIQUE(auth_user_id,operation,idempotency_key));
   CREATE FUNCTION extensions.digest(text,text)RETURNS bytea LANGUAGE sql AS $$SELECT sha256(convert_to($1,'UTF8'))$$;
   CREATE FUNCTION extensions.gen_random_bytes(integer)RETURNS bytea LANGUAGE sql AS $$SELECT decode(replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),'hex')$$;
   CREATE TABLE vault.secrets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),secret text);
   CREATE VIEW vault.decrypted_secrets AS SELECT id,secret AS decrypted_secret FROM vault.secrets;
   CREATE FUNCTION vault.create_secret(p_secret text)RETURNS uuid LANGUAGE plpgsql AS $$DECLARE result uuid;BEGIN INSERT INTO vault.secrets(secret)VALUES(p_secret)RETURNING id INTO result;RETURN result;END$$;
   INSERT INTO auth.users VALUES('${U1}','one@example.invalid',now(),NULL),('${U2}','two@example.invalid',now(),NULL);
   INSERT INTO auth.sessions VALUES('${A1}','${U1}',now()+interval '1 hour'),('${A2}','${U2}',now()+interval '1 hour');
   INSERT INTO public.sandy_memory_portal_accounts VALUES('${U1}','${C1}',NULL),('${U2}','${C2}',NULL);
   INSERT INTO public.email_customer_addresses VALUES('${C1}','one@example.invalid',true,now()),('${C2}','two@example.invalid',true,now());
   INSERT INTO public.sandy_memory_settings VALUES('${C1}',true),('${C2}',true);`);
  const source=await Deno.readTextFile(new URL("../../supabase/migrations/20261024005400_sandy_voice_context_session.sql",import.meta.url));
  assert(source.includes("RAISE EXCEPTION 'bounded_voice_context_expiry_scheduler_required'"));checks++;
  // pg_cron cannot run in PostgreSQL/WASM. Production requires the existing
  // scheduler; only that independently checked installation block is omitted.
  await db.exec(source.split("-- Existing database scheduler,")[0]+"COMMIT;");
  const claims=async(user=U1,session=A1)=>{await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:"authenticated",aud:"authenticated",sub:user,session_id:session,exp:Math.floor(Date.now()/1000)+3600})]);};
  const call=async(name:string,arg:string)=>((await db.query<{result:any}>(`SELECT public.${name}($1::uuid) result`,[arg])).rows[0].result);
  const current=async(sid:string)=>await call("sandy_voice_context_authority_current",sid);
  const denied=async(fn:()=>Promise<unknown>,code:string)=>{await assert.rejects(fn,(e:any)=>e.code===code);checks++;};
  const privileges=(await db.query("SELECT has_function_privilege('anon','public.sandy_voice_context_session_issue(uuid)','EXECUTE') anon,has_function_privilege('service_role','public.sandy_voice_context_session_issue(uuid)','EXECUTE') service,has_function_privilege('authenticated','public.sandy_voice_context_session_issue(uuid)','EXECUTE') customer")).rows[0];
  assert.deepEqual(privileges,{anon:false,service:false,customer:true});checks++;
  await db.exec("SET ROLE service_role");await denied(()=>call("sandy_voice_context_session_issue",crypto.randomUUID()),"42501");await db.exec("RESET ROLE");
  await claims();const request=crypto.randomUUID(),issued=await call("sandy_voice_context_session_issue",request);
  assert.equal(issued.purpose,"context_only");assert.equal(issued.state,"starting");assert.equal(issued.media_connected,false);assert.equal(issued.provider_operations,0);assert.match(issued.token,/^[a-f0-9]{64}$/);checks++;
  assert.equal(await current(issued.session_id),true);checks++;
  await denied(()=>db.query("UPDATE public.sandy_voice_call_links SET starts=1 WHERE id=(SELECT link_id FROM public.sandy_voice_call_sessions WHERE id=$1)",[issued.session_id]),"23514");
  const row=(await db.query("SELECT connected_at,openai_call_id,state FROM public.sandy_voice_call_sessions WHERE id=$1",[issued.session_id])).rows[0];
  assert.deepEqual(row,{connected_at:null,openai_call_id:null,state:"starting"});checks++;
  const replay=await call("sandy_voice_context_session_issue",request);assert.equal(replay.token,issued.token);assert.equal(replay.receipt_id,issued.receipt_id);assert.equal(replay.reused,true);checks++;
  const receipt=(await db.query("SELECT result FROM public.sandy_customer_mutation_receipts WHERE mutation_id=$1",[issued.receipt_id])).rows[0];assert(!JSON.stringify(receipt).includes(issued.token));checks++;
  await claims(U2,A2);await denied(()=>call("sandy_voice_context_session_retire",issued.session_id),"42501");
  const other=await call("sandy_voice_context_session_issue",request);assert.notEqual(other.session_id,issued.session_id);assert.notEqual(other.token,issued.token);checks++;
  await claims();await db.query("UPDATE public.sandy_memory_settings SET enabled=false WHERE customer_id=$1",[C1]);assert.equal(await current(issued.session_id),false);checks++;
  await denied(()=>call("sandy_voice_context_session_issue",crypto.randomUUID()),"42501");await db.query("UPDATE public.sandy_memory_settings SET enabled=true WHERE customer_id=$1",[C1]);
  await call("sandy_voice_context_session_issue",crypto.randomUUID());await call("sandy_voice_context_session_issue",crypto.randomUUID());await denied(()=>call("sandy_voice_context_session_issue",crypto.randomUUID()),"54000");
  await db.query("DELETE FROM auth.sessions WHERE id=$1",[A1]);assert.equal(await current(issued.session_id),false);checks++;
  assert.equal((await db.query<{n:number}>("SELECT public.sandy_voice_context_expire() n")).rows[0].n,3);checks++;
  assert.equal((await db.query<{n:number}>("SELECT count(*)::int n FROM vault.secrets")).rows[0].n,1);checks++;
  await claims(U2,A2);await db.query("UPDATE public.sandy_memory_portal_accounts SET revoked_at=now() WHERE auth_user_id=$1",[U2]);const ended=await call("sandy_voice_context_session_retire",other.session_id);assert.equal(ended.state,"ended");assert.equal(await current(other.session_id),false);checks++;
  const retired=await call("sandy_voice_context_session_retire",other.session_id);assert.equal(retired.reused,true);assert.equal(retired.receipt_id,ended.receipt_id);checks++;
  assert.equal((await db.query<{n:number}>("SELECT count(*)::int n FROM vault.secrets")).rows[0].n,0);checks++;
  await db.query("UPDATE public.sandy_memory_portal_accounts SET revoked_at=NULL WHERE auth_user_id=$1",[U2]);
  await denied(()=>call("sandy_voice_context_session_issue",request),"23505");
  console.log(JSON.stringify({test_class:"isolated_postgresql_wasm",checks,normal_Auth_provider_verified:false,Vault_encryption_simulated:true,media_or_provider_operations:0}));
 }finally{await db.close();}
});
