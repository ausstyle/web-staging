// Actual multi-connection PostgreSQL tests. CI-only isolated database; no live URL.
import assert from 'node:assert/strict';
import pg from 'npm:pg@8.16.3';
import {recordCloudReference,canonicalCloudReferences} from './cloud_reference.ts';
import {intentDigest} from '../sandy-cloud/postgres/commit.ts';
import type {UploadIntent} from '../sandy-cloud/integrity.ts';
import {ArtifactJournal,type AdmissionBinding} from './journal.ts';
import {scanBytes,type ScanAttestation} from './attestation.ts';
import {lockCustodyPlan,lockCustodyResources,requireCustodyResources,scopedResourceId,type CustodyLockPlan} from './locking.ts';
const url=Deno.env.get('CUSTODY_TEST_DATABASE_URL');
let initialized=false;
const hex=(b:ArrayBuffer)=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');
const latch=()=>{let resolve!:()=>void;return {promise:new Promise<void>(r=>resolve=r),release:()=>resolve()};};
async function setup(tenant:string|null=null){
 if(url!=='postgres://custody_fixture:isolated-ci-only@127.0.0.1:5432/custody_ci')throw Error('ISOLATED_LOCAL_DATABASE_REQUIRED');
 const pool=new pg.Pool({connectionString:url,max:8});
 if(!initialized){
  const existing=await pool.query("SELECT tablename FROM pg_tables WHERE schemaname IN('public','sandy_artifact_custody','sandy_cloud')");
  if(existing.rows.length){await pool.end();throw Error('FRESH_DISPOSABLE_DATABASE_REQUIRED');}
  initialized=true;
 }
 await pool.query(`DROP SCHEMA IF EXISTS sandy_artifact_custody CASCADE;DROP SCHEMA IF EXISTS sandy_cloud CASCADE;DROP TABLE IF EXISTS public.sandy_universal_files,public.sandy_api_execution_admissions,public.fixture_authority CASCADE;
 CREATE TABLE public.sandy_universal_files(id uuid PRIMARY KEY,owner_customer_id uuid,revision int DEFAULT 0);
 CREATE TABLE public.sandy_api_execution_admissions(id uuid PRIMARY KEY,actor_id uuid,tenant_id text,operation text,input_sha256 text,contract_sha256 text,scope_sha256 text,state text,expires_at timestamptz);
 CREATE TABLE fixture_authority(id int PRIMARY KEY,revision text,revoked boolean);INSERT INTO fixture_authority VALUES(1,'1',false);`);
 await pool.query(await Deno.readTextFile(new URL('./schema.sql',import.meta.url)));
 const [actor,customer,admission,file,artifact,receipt,session]=Array.from({length:7},()=>crypto.randomUUID());
 await pool.query('INSERT INTO sandy_universal_files(id,owner_customer_id) VALUES($1,$2)',[file,customer]);
 await pool.query("INSERT INTO sandy_api_execution_admissions VALUES($1,$2,$4,'fixture.only',$3,$3,$3,'consumed',clock_timestamp()+interval '1 hour')",[admission,actor,'a'.repeat(64),tenant]);
 const keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']) as CryptoKeyPair;
 await pool.query("INSERT INTO sandy_artifact_custody.scanner_releases VALUES('fixture-only','ci-v1',$1,1,NULL)",[hex(await crypto.subtle.exportKey('raw',keys.publicKey))]);
 const plan:CustodyLockPlan={actorId:actor,customerId:customer,tenantId:tenant,admissionId:admission,fileId:file,artifactId:artifact,receiptId:receipt,sessionId:session,companyId:crypto.randomUUID(),scanner:{issuer:'fixture-only',release:'ci-v1'}};
 let loseAck=false,hold:{entered:ReturnType<typeof latch>;resume:ReturnType<typeof latch>}|undefined;
 const db={async transaction<T>(work:(tx:any)=>Promise<T>):Promise<T>{
  const client=await pool.connect();let committed=false;
  try{await client.query('BEGIN');const tx={query:(sql:string,args?:unknown[])=>client.query(sql,args)};const result=await work(tx);await client.query('COMMIT');committed=true;if(loseAck){loseAck=false;throw Error('LOST_ACK');}return result;}
  catch(e){if(!committed)await client.query('ROLLBACK');throw e;}finally{client.release();}
 }};
 const owner={async lockAndResolve(tx:any,c:AdmissionBinding){
  assert.equal(c.admissionId,admission);await lockCustodyPlan(tx,plan);
  const result=await tx.query('SELECT * FROM fixture_authority WHERE id=1 FOR SHARE');
  if(result.rows[0].revoked)throw Error('REVOKED');
  if(hold){const h=hold;hold=undefined;h.entered.release();await h.resume.promise;}
  return {customerId:customer,tenantId:tenant,revision:result.rows[0].revision};
 }};
 const journal=new ArtifactJournal(db,owner,{lockAndAuthorizeStatus:owner.lockAndResolve});
 const c:AdmissionBinding={actorId:actor,admissionId:admission,artifactId:artifact,operation:'fixture.only',inputSha256:'a'.repeat(64),contractSha256:'a'.repeat(64),scopeSha256:'a'.repeat(64),bindingSha256:'b'.repeat(64)};
 const now=Date.now(),a:ScanAttestation={version:1,receiptId:receipt,artifactId:artifact,fileId:file,admissionId:admission,actorId:actor,customerId:customer,generation:'1',size:3,sha256:'c'.repeat(64),bindingSha256:c.bindingSha256,issuer:'fixture-only',release:'ci-v1',trustRevision:1,verdict:'CLEAN',issuedAt:now-1000,expiresAt:now+60000};
 const signature=hex(await crypto.subtle.sign('Ed25519',keys.privateKey,new Uint8Array(scanBytes(a))));
 await journal.recordScan(c,a,signature);
 const proof={version:1,kind:'repository_artifact_bytes_verified',artifactId:artifact,generation:a.generation,size:a.size,sha256:a.sha256,bindingSha256:a.bindingSha256};
 return {pool,db,plan,journal,c,a,proof,sign:async(value:ScanAttestation)=>hex(await crypto.subtle.sign('Ed25519',keys.privateKey,new Uint8Array(scanBytes(value)))),holdNext(){const h={entered:latch(),resume:latch()};hold=h;return h;},loseNextAck(){loseAck=true;}};
}
async function blocked(pool:any,pid:number){
 const until=Date.now()+5000;
 while(Date.now()<until){const r=await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid]);if(r.rows[0]?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,10));}
 throw Error('EXPECTED_REAL_POSTGRES_LOCK_WAIT');
}
Deno.test({name:'real PostgreSQL duplicate claims and lost seal acknowledgement publish once',ignore:!url,fn:async()=>{
 const f=await setup();try{
  const results=await Promise.allSettled([f.journal.acquire(f.c,f.a.receiptId),f.journal.acquire(f.c,f.a.receiptId)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const claim=(results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<any>).value;
  f.loseNextAck();await assert.rejects(f.journal.seal(f.c,claim.leaseToken,'private:ci',f.proof),/LOST_ACK/);
  assert.equal((await f.journal.reconcile(f.c)).state,'SEALED');
  assert.equal((await f.pool.query('SELECT count(*)::int n FROM sandy_artifact_custody.claims')).rows[0].n,1);
 }finally{await f.pool.end();}
}});
Deno.test({name:'real PostgreSQL scanner/session/company revocation waits for seal or prevents it',ignore:!url,fn:async()=>{
 for(const resource of ['scanner','session','company'] as const){
  const f=await setup();const client=await f.pool.connect();try{
   const claim=await f.journal.acquire(f.c,f.a.receiptId),h=f.holdNext();
   const sealing=f.journal.seal(f.c,claim.leaseToken,'private:ci',f.proof);await h.entered.promise;
   await client.query('BEGIN');const pid=(await client.query('SELECT pg_backend_pid() pid')).rows[0].pid;
   const id=resource==='scanner'?scopedResourceId('fixture-only','ci-v1'):resource==='session'?f.plan.sessionId!:f.plan.companyId!;
   const revoke=(async()=>{await lockCustodyResources(client,[{kind:resource,id}]);
    if(resource==='scanner')await client.query('UPDATE sandy_artifact_custody.scanner_releases SET revoked_at=clock_timestamp()');
    else await client.query('UPDATE fixture_authority SET revoked=true');
    await client.query('COMMIT');})();
   try{await blocked(f.pool,pid);}finally{h.resume.release();}await sealing;await revoke;
   await assert.rejects(f.journal.reconcile(f.c));
   assert.equal((await f.pool.query('SELECT state FROM sandy_artifact_custody.claims')).rows[0].state,'SEALED');
  }finally{await client.query('ROLLBACK');client.release();await f.pool.end();}
 }
}});
Deno.test({name:'real PostgreSQL complete gates serialize SHARE-to-UPDATE file upgrades and reject late gates',ignore:!url,fn:async()=>{
 const f=await setup(),one=await f.pool.connect(),two=await f.pool.connect();try{
  await one.query('BEGIN');await two.query('BEGIN');
  const foreignFile=crypto.randomUUID();
  const simultaneous=await Promise.allSettled([lockCustodyPlan(one,f.plan),lockCustodyResources(one,[{kind:'file',id:foreignFile}])]);
  assert.equal(simultaneous[0].status,'fulfilled');assert.equal(simultaneous[1].status,'rejected');
  assert.match(String((simultaneous[1] as PromiseRejectedResult).reason),/CONCURRENT_CUSTODY_LOCK_INITIALIZATION/);
  await assert.rejects(requireCustodyResources(one,[{kind:'file',id:foreignFile}]),/COMPLETE_CUSTODY_LOCK_PLAN_REQUIRED/);
  await requireCustodyResources(one,[{kind:'actor',id:f.plan.actorId.toUpperCase()}]);
  await one.query('SELECT * FROM sandy_universal_files WHERE id=$1 FOR SHARE',[f.plan.fileId]);
  const pid=(await two.query('SELECT pg_backend_pid() pid')).rows[0].pid;
  const second=lockCustodyPlan(two,{...f.plan,actorId:crypto.randomUUID(),admissionId:crypto.randomUUID()});
  await blocked(f.pool,pid);
  await assert.rejects(lockCustodyResources(one,[{kind:'file',id:crypto.randomUUID()}]),/LATE_CUSTODY_LOCK_EXPANSION/);
  await one.query('UPDATE sandy_universal_files SET revision=revision+1 WHERE id=$1',[f.plan.fileId]);await one.query('COMMIT');await second;
  const revision=(await two.query('SELECT revision FROM sandy_universal_files WHERE id=$1 FOR SHARE',[f.plan.fileId])).rows[0].revision;assert.equal(revision,1);
  await two.query('UPDATE sandy_universal_files SET revision=revision+1 WHERE id=$1',[f.plan.fileId]);await two.query('COMMIT');
  await assert.rejects(requireCustodyResources(one,[{kind:'file',id:f.plan.fileId}]),/COMPLETE_CUSTODY_LOCK_PLAN_REQUIRED/);
 }finally{await one.query('ROLLBACK');await two.query('ROLLBACK');one.release();two.release();await f.pool.end();}
}});
Deno.test({name:'real PostgreSQL deadlock rolls back failed transaction without automatic replay',ignore:!url,fn:async()=>{
 const f=await setup();try{
  await f.pool.query('CREATE TABLE deadlock_fixture(id int PRIMARY KEY,value int);INSERT INTO deadlock_fixture VALUES(1,0),(2,0)');
  const a=latch(),b=latch();let attempts=0;
  const run=(first:number,second:number,own:ReturnType<typeof latch>,other:ReturnType<typeof latch>)=>f.db.transaction(async tx=>{attempts++;await tx.query('UPDATE deadlock_fixture SET value=value+1 WHERE id=$1',[first]);own.release();await other.promise;await tx.query('UPDATE deadlock_fixture SET value=value+1 WHERE id=$1',[second]);});
  const results=await Promise.allSettled([run(1,2,a,b),run(2,1,b,a)]);
  assert.equal(attempts,2);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const rejected=results.find(r=>r.status==='rejected') as PromiseRejectedResult;assert.equal(rejected.reason.code,'40P01');
  assert.deepEqual((await f.pool.query('SELECT value FROM deadlock_fixture ORDER BY id')).rows,[{value:1},{value:1}]);
 }finally{await f.pool.end();}
}});

Deno.test({name:'real PostgreSQL canonical Cloud reference uses pinned Cloud digest and signed journal',ignore:!url,fn:async()=>{
 const moduleUrl=new URL('../../cloud-contract/packages/sandy-cloud/postgres/shared_scan.ts',import.meta.url).href;
 const {cloudScanBindingDigest,sharedScanOwner}=await import(moduleUrl);
 const f=await setup('fixture-tenant');try{
  await f.pool.query(`CREATE SCHEMA sandy_cloud;
   CREATE TABLE sandy_cloud.workspaces(tenant_id text,workspace_id text,customer_id uuid,policy_epoch bigint,PRIMARY KEY(tenant_id,workspace_id));
   CREATE TABLE sandy_cloud.upload_intents(tenant_id text,workspace_id text,intent_id text,actor_id text,file_id uuid,input_sha256 text,policy_epoch bigint,state text,ref jsonb,expires_at timestamptz,PRIMARY KEY(tenant_id,workspace_id,intent_id));`);
  await f.pool.query(await Deno.readTextFile(new URL('./cloud_reference_schema.sql',import.meta.url)));
  const i:UploadIntent={id:'intent-ci',actorId:f.c.actorId,traceId:'trace-ci',expectedRevision:0,idempotencyKey:'ci-once',expiresAt:Date.now()+60000,ref:{tenantId:'fixture-tenant',workspaceId:'workspace-ci',bucket:'fixture',key:'file',generation:'1',size:3,sha256:f.a.sha256}};
  f.plan.cloud={workspaceId:i.ref.workspaceId,intentId:i.id};f.plan.receiptId=crypto.randomUUID();
  const input={intent:i,fileId:f.plan.fileId,admission:{customerId:f.plan.customerId,policyEpoch:1}};
  f.c.bindingSha256=cloudScanBindingDigest(input,f.c);
  const a={...f.a,receiptId:f.plan.receiptId,bindingSha256:f.c.bindingSha256};
  await f.pool.query('INSERT INTO sandy_cloud.workspaces VALUES($1,$2,$3,1)',[i.ref.tenantId,i.ref.workspaceId,f.plan.customerId]);
  await f.pool.query("INSERT INTO sandy_cloud.upload_intents VALUES($1,$2,$3,$4,$5,$6,1,'OPEN',$7,clock_timestamp()+interval '1 hour')",[i.ref.tenantId,i.ref.workspaceId,i.id,i.actorId,f.plan.fileId,intentDigest(i),i.ref]);
  await f.journal.recordScan(f.c,a,await f.sign(a));
  const codec={operation:f.c.operation,contractSha256:f.c.contractSha256,digest:cloudScanBindingDigest};
  await f.db.transaction(async tx=>{await lockCustodyPlan(tx,f.plan);await recordCloudReference(tx,{intent:i,fileId:f.plan.fileId,receiptId:a.receiptId,binding:f.c},f.journal,codec);});
  const cloud=sharedScanOwner(f.journal,canonicalCloudReferences,{operation:f.c.operation,sha256:f.c.contractSha256});
  await f.db.transaction(async tx=>{await lockCustodyPlan(tx,f.plan);const verified=await cloud.verifyInTransaction(tx,{...input,proof:{state:'BYTES_VERIFIED',ref:i.ref,bytesRead:3,sha256:i.ref.sha256}});assert.equal(verified.receiptId,a.receiptId);});
  await assert.rejects(f.db.transaction(tx=>canonicalCloudReferences.lock(tx,i,f.plan.fileId)),/COMPLETE_CUSTODY_LOCK_PLAN_REQUIRED/);
  await assert.rejects(f.db.transaction(async tx=>{await lockCustodyPlan(tx,f.plan);return canonicalCloudReferences.lock(tx,{...i,ref:{...i.ref,key:'substituted'}},f.plan.fileId);}),/CANONICAL_CLOUD_REFERENCE_REFUSED/);
  await assert.rejects(f.pool.query("UPDATE sandy_artifact_custody.cloud_scan_references SET binding='{}'"),/IMMUTABLE_SCAN_RECEIPT/);
  assert.equal((await f.pool.query('SELECT count(*)::int n FROM sandy_artifact_custody.claims')).rows[0].n,0);
  const rls=await f.pool.connect();try{
   await rls.query('CREATE ROLE custody_untrusted NOLOGIN NOBYPASSRLS;GRANT USAGE ON SCHEMA sandy_artifact_custody TO custody_untrusted;GRANT SELECT ON sandy_artifact_custody.cloud_scan_references TO custody_untrusted;SET ROLE custody_untrusted');
   assert.equal((await rls.query('SELECT count(*)::int n FROM sandy_artifact_custody.cloud_scan_references')).rows[0].n,0);
  }finally{await rls.query('RESET ROLE');rls.release();}

 }finally{await f.pool.end();}
}});
