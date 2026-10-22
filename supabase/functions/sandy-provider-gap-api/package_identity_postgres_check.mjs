/** Isolated PostgreSQL/WASM policy component fixture; no Auth or cloud writes. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
const {PGlite}=await import(process.env.SANDY_TEST_PGLITE_MODULE??'file:///tmp/sandy-pglite/node_modules/@electric-sql/pglite/dist/index.js');
const db=new PGlite();
const sql=name=>readFileSync(new URL(`../../migrations/${name}`,import.meta.url),'utf8');
const canonical=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const sha=value=>createHash('sha256').update(value).digest('hex');
const actor=randomUUID();let checks=0;
const checked=(v,message)=>{assert.ok(v,message);checks++;};
const scalar=async(s,params=[])=>Object.values((await db.query(s,params)).rows[0])[0];
const rpc=async(name,...args)=>scalar(`SELECT public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')})`,args.map(v=>v&&typeof v==='object'?JSON.stringify(v):v));
const refused=async(fn,code)=>{await assert.rejects(fn,new RegExp(code));checks++;};
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA extensions;
 CREATE FUNCTION extensions.digest(value text,algorithm text) RETURNS bytea LANGUAGE SQL IMMUTABLE AS $$ SELECT pg_catalog.sha256(pg_catalog.convert_to(value,'UTF8')) $$;
 CREATE TABLE public.sandy_controller_admins(auth_user_id uuid PRIMARY KEY,role text,enabled boolean);
 CREATE TABLE public.sandy_engineering_changes(id uuid PRIMARY KEY,status text);
 CREATE TABLE public.sandy_deployment_jobs(id uuid PRIMARY KEY,requested_by text,provider text,operation text,target text,payload jsonb,approved_by text,approved_at timestamptz,engineering_change_id uuid,status text);
 CREATE TABLE public.sandy_operation_registry(operation text PRIMARY KEY,domain text,description text,permission_scope text,is_mutation boolean,input_schema jsonb,output_schema jsonb,handler text,api_exposed boolean,ui_exposed boolean,ai_exposed boolean,verified boolean,implementation_state text,source_repository text,source_path text,dependencies jsonb,retry_policy jsonb,rollback_policy jsonb,error_contract jsonb,updated_at timestamptz);`);
 await db.exec(sql('20261020233000_sandy_api_access_audit.sql'));
 await db.exec(sql('20261021008000_sandy_provider_package_identity.sql'));
 await db.exec(sql('20261021008100_sandy_provider_gap_contracts.sql'));
 await db.query("INSERT INTO public.sandy_controller_admins VALUES($1,'owner',true)",[actor]);
 checked(Number(await scalar("SELECT count(*) FROM public.sandy_operation_registry WHERE handler='sandy-provider-gap-api'"))===35,'all 35 registry rows install');
 checked(Number(await scalar("SELECT count(*) FROM public.sandy_operation_registry WHERE handler='sandy-provider-gap-api' AND verified"))===0,'source installation cannot assert provider verification');
 checked(Number(await scalar("SELECT count(*) FROM public.sandy_operation_registry WHERE handler='sandy-provider-gap-api' AND api_exposed=false"))===25,'all sensitive reads and mutations initially closed');
 checked(!await scalar("SELECT has_table_privilege('service_role','public.sandy_provider_package_identity_proofs','INSERT')"),'service cannot directly forge immutable proof rows');
 checked(!await scalar("SELECT has_function_privilege('authenticated','public.sandy_provider_save_package_proof(uuid,text,jsonb)','EXECUTE')"),'customers cannot access proof RPC');
 await db.exec("UPDATE public.sandy_operation_registry SET api_exposed=true,verified=true WHERE operation LIKE 'github.packages.%'");
 const args={package_type:'npm',package_name:'fixture',expected_package_id:456};
 const proof={repository_id:123,package_id:456,package_type:'npm',package_name:'fixture',version_id:null,response_sha256:'a'.repeat(64),observed_at:new Date().toISOString(),provider_request_id:'fixture-id'};
 async function admission(operation,input=args){
  const id=randomUUID(),approval=randomUUID();await db.query("INSERT INTO public.sandy_deployment_jobs(id)VALUES($1)",[approval]);
  await db.query(`INSERT INTO public.sandy_api_execution_admissions(id,actor_id,operation,request_id,is_mutation,input_sha256,contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,approval_id,state,expires_at)
   SELECT $1,$2,$3,$4,true,$5,error_contract->>'contract_sha256',$6,public.sandy_api_registry_revision(operation),1,$7,'consumed',clock_timestamp()+interval '5 minutes' FROM public.sandy_operation_registry WHERE operation=$3`,[id,actor,operation,randomUUID(),sha(canonical(input)),sha(canonical({provider:'github',repository:'ausstyle/web-staging'})),approval]);return id;
 }
 const deletion=await admission('github.packages.delete');
 await refused(()=>rpc('sandy_provider_save_package_proof',randomUUID(),canonical(args),proof),'package_proof_scoped_admission_required');
 await refused(()=>rpc('sandy_provider_save_package_proof',deletion,canonical({...args,package_name:'foreign'}),proof),'package_proof_scoped_admission_required');
 await refused(()=>rpc('sandy_provider_save_package_proof',deletion,canonical(args),{...proof,package_id:999}),'provider_package_identity_evidence_invalid');
 await refused(()=>rpc('sandy_provider_save_package_proof',deletion,canonical(args),{...proof,observed_at:'2000-01-01T00:00:00Z'}),'provider_package_identity_evidence_stale');
 checked((await rpc('sandy_provider_save_package_proof',deletion,canonical(args),proof)).stored,'actual scoped server preflight proof stores once');
 await refused(()=>rpc('sandy_provider_save_package_proof',deletion,canonical(args),proof),'duplicate key');
 await refused(()=>db.query("UPDATE public.sandy_provider_package_identity_proofs SET package_id=999 WHERE admission_id=$1",[deletion]),'provider_package_identity_proof_immutable');
 const restoration=await admission('github.packages.restore');
 checked(await rpc('sandy_provider_load_package_proof',restoration,canonical(args))===null,'pending delete admission is not an accepted deletion receipt');
 await db.query("UPDATE public.sandy_api_execution_admissions SET state='accepted',provider_http_status=204 WHERE id=$1",[deletion]);
 checked((await rpc('sandy_provider_load_package_proof',restoration,canonical(args))).package_id===456,'restore proof binds accepted original deletion and exact package identity');
 const foreign=await admission('github.packages.restore',{...args,expected_package_id:999});
 checked(await rpc('sandy_provider_load_package_proof',foreign,canonical({...args,expected_package_id:999}))===null,'different package ID cannot reuse proof');
 await db.query("UPDATE public.sandy_controller_admins SET enabled=false WHERE auth_user_id=$1",[actor]);
 await refused(()=>rpc('sandy_provider_load_package_proof',restoration,canonical(args)),'package_proof_scoped_admission_required');
 await db.query("UPDATE public.sandy_controller_admins SET enabled=true WHERE auth_user_id=$1",[actor]);
 await db.exec("UPDATE public.sandy_operation_registry SET output_schema='{}' WHERE operation='github.packages.restore'");
 await refused(()=>rpc('sandy_provider_load_package_proof',restoration,canonical(args)),'package_proof_verified_contract_required');
 console.log(JSON.stringify({ok:true,checks,level:'isolated_postgresql_component',controller_session_tested:false,provider_mutation_tested:false}));
}finally{await db.close();}
