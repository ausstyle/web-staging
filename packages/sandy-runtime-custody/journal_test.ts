// Synthetic keys/rows in isolated PostgreSQL only. No production scanner claim.
import assert from 'node:assert/strict';
import {PGlite} from 'npm:@electric-sql/pglite@0.3.14';
import {ArtifactJournal,lockCanonicalScope,type AdmissionBinding} from './journal.ts';
import {scanBytes,type ScanAttestation} from './attestation.ts';
const hex=(a:ArrayBuffer)=>Array.from(new Uint8Array(a),x=>x.toString(16).padStart(2,'0')).join('');
async function fixture(){
 const pg=new PGlite();
 const ids=Array.from({length:6},()=>crypto.randomUUID()),[actor,customer,admission,file,artifact,receipt]=ids;
 await pg.exec(`CREATE TABLE public.sandy_universal_files(id uuid PRIMARY KEY,owner_customer_id uuid);
 CREATE TABLE public.sandy_api_execution_admissions(id uuid PRIMARY KEY,actor_id uuid,tenant_id text,operation text,input_sha256 text,contract_sha256 text,scope_sha256 text,state text,expires_at timestamptz);
 CREATE TABLE fixture_authority(id int PRIMARY KEY,revision text,revoked boolean);INSERT INTO fixture_authority VALUES(1,'1',false);`);
 await pg.exec(await Deno.readTextFile(new URL('./schema.sql',import.meta.url)));
 await pg.query('INSERT INTO sandy_universal_files VALUES($1,$2)',[file,customer]);
 await pg.query("INSERT INTO sandy_api_execution_admissions VALUES($1,$2,NULL,'github.files.create',$3,$3,$3,'consumed',clock_timestamp()+interval '1 hour')",[admission,actor,'a'.repeat(64)]);
 const keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']) as CryptoKeyPair;
 await pg.query("INSERT INTO sandy_artifact_custody.scanner_releases VALUES('fixture-only','test-v1',$1,1,NULL)",[hex(await crypto.subtle.exportKey('raw',keys.publicKey))]);
 let tail=Promise.resolve(),loseAck=false;
 const db={async transaction<T>(work:(tx:any)=>Promise<T>):Promise<T>{
  const prior=tail;let unlock!:()=>void;tail=new Promise<void>(r=>unlock=r);await prior;
  let committed=false;
  try{await pg.exec('BEGIN');const r=await work(pg);await pg.exec('COMMIT');committed=true;if(loseAck){loseAck=false;throw Error('SIMULATED_LOST_ACK');}return r;}
  catch(e){if(!committed)await pg.exec('ROLLBACK');throw e;}finally{unlock();}
 }};
 const owner={async lockAndResolve(tx:any,c:AdmissionBinding){
  await lockCanonicalScope(tx,{actorId:c.actorId,admissionId:c.admissionId,customerId:customer});
  const {rows}=await tx.query('SELECT * FROM fixture_authority WHERE id=1 FOR SHARE');
  if(rows[0].revoked)throw Error('FIXTURE_AUTHORITY_REVOKED');
  return {customerId:customer,tenantId:null,revision:rows[0].revision};
 }};
 const journal=new ArtifactJournal(db,owner);
 const c:AdmissionBinding={artifactId:artifact,admissionId:admission,actorId:actor,operation:'github.files.create',inputSha256:'a'.repeat(64),contractSha256:'a'.repeat(64),scopeSha256:'a'.repeat(64),bindingSha256:'b'.repeat(64)};
 const now=Date.now();const a:ScanAttestation={version:1,receiptId:receipt,artifactId:artifact,fileId:file,admissionId:admission,actorId:actor,customerId:customer,generation:'immutable:1',size:3,sha256:'c'.repeat(64),bindingSha256:c.bindingSha256,issuer:'fixture-only',release:'test-v1',trustRevision:1,verdict:'CLEAN',issuedAt:now-1000,expiresAt:now+60000};
 const sign=async(v:ScanAttestation)=>hex(await crypto.subtle.sign('Ed25519',keys.privateKey,new Uint8Array(scanBytes(v))));
 const proof={version:1,kind:'repository_artifact_bytes_verified',artifactId:artifact,generation:a.generation,size:a.size,sha256:a.sha256,bindingSha256:a.bindingSha256};
 return {pg,journal,c,a,sign,proof,loseNextAck(){loseAck=true;}};
}
Deno.test('signed generation binding, duplicate claim and committed-but-lost seal reconcile once',async()=>{
 const f=await fixture();try{
  const signature=await f.sign(f.a);
  await assert.rejects(f.journal.recordScan(f.c,{...f.a,generation:'replaced'},signature),/INVALID_SCAN_SIGNATURE/);
  await f.journal.recordScan(f.c,f.a,signature);
  const claims=await Promise.allSettled([f.journal.acquire(f.c,f.a.receiptId),f.journal.acquire(f.c,f.a.receiptId)]);
  assert.equal(claims.filter(x=>x.status==='fulfilled').length,1);
  const claim=(claims.find(x=>x.status==='fulfilled') as PromiseFulfilledResult<any>).value;
  await assert.rejects(f.journal.seal(f.c,crypto.randomUUID(),'private:test',f.proof),/CLAIM_LOST/);
  await assert.rejects(f.journal.seal(f.c,claim.leaseToken,'private:test',{...f.proof,generation:'replaced'}),/BYTE_PROOF/);
  f.loseNextAck();await assert.rejects(f.journal.seal(f.c,claim.leaseToken,'private:test',f.proof),/SIMULATED_LOST_ACK/);
  assert.deepEqual(await f.journal.reconcile(f.c),{state:'SEALED',privateHandle:'private:test',proof:f.proof});
  assert.deepEqual(await f.journal.reconcile(f.c),{state:'SEALED',privateHandle:'private:test',proof:f.proof});
  await assert.rejects(f.journal.seal(f.c,claim.leaseToken,'private:second',f.proof),/CLAIM_LOST/);
  assert.equal((await f.pg.query<{n:number}>('SELECT count(*)::int n FROM sandy_artifact_custody.claims')).rows[0].n,1);
  await assert.rejects(f.pg.exec("UPDATE sandy_artifact_custody.claims SET state='CLAIMED',private_handle=NULL,proof=NULL"),/TERMINAL_CUSTODY/);
 }finally{await f.pg.close();}
});
Deno.test('scanner revocation and authority changes between acquire and seal fail closed',async()=>{
 for(const mode of ['scanner','authority','revision']){
  const f=await fixture();try{
   await f.journal.recordScan(f.c,f.a,await f.sign(f.a));const claim=await f.journal.acquire(f.c,f.a.receiptId);
   if(mode==='scanner')await f.pg.exec('UPDATE sandy_artifact_custody.scanner_releases SET revoked_at=clock_timestamp()');
   if(mode==='authority')await f.pg.exec('UPDATE fixture_authority SET revoked=true');
   if(mode==='revision')await f.pg.exec("UPDATE fixture_authority SET revision='2'");
   await assert.rejects(f.journal.seal(f.c,claim.leaseToken,'private:test',f.proof));
   assert.equal((await f.pg.query<{state:string}>('SELECT state FROM sandy_artifact_custody.claims')).rows[0].state,'CLAIMED');
  }finally{await f.pg.close();}
 }
});
Deno.test('foreign admission and forged clean receipt cannot acquire custody',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.journal.recordScan({...f.c,actorId:crypto.randomUUID()},f.a,await f.sign(f.a)),/ADMISSION_BINDING/);
  await assert.rejects(f.journal.recordScan(f.c,{...f.a,customerId:crypto.randomUUID()},await f.sign(f.a)),/INVALID_SCAN_SIGNATURE/);
  await f.journal.recordScan(f.c,f.a,await f.sign(f.a));
  await assert.rejects(f.pg.exec("UPDATE sandy_artifact_custody.scan_receipts SET attestation=attestation||'{\"verdict\":\"CLEAN\"}'"),/IMMUTABLE_SCAN/);
  await assert.rejects(f.journal.acquire({...f.c,bindingSha256:'d'.repeat(64)},f.a.receiptId),/CLEAN_BOUND_SCAN/);
  assert.equal((await f.pg.query<{n:number}>('SELECT count(*)::int n FROM sandy_artifact_custody.claims')).rows[0].n,0);
 }finally{await f.pg.close();}
});
Deno.test('crash before seal stays reconcilable and expired scan never grants another claim',async()=>{
 const f=await fixture();try{
  const a={...f.a,expiresAt:Date.now()+1000};
  await f.journal.recordScan(f.c,a,await f.sign(a));await f.journal.acquire(f.c,a.receiptId);
  assert.deepEqual(await f.journal.reconcile(f.c),{state:'RECONCILIATION_REQUIRED'});
  await assert.rejects(f.journal.acquire(f.c,a.receiptId));
  await new Promise(r=>setTimeout(r,1100));
  await assert.rejects(f.journal.reconcile(f.c),/CLEAN_BOUND_SCAN/);
  assert.equal((await f.pg.query<{state:string}>('SELECT state FROM sandy_artifact_custody.claims')).rows[0].state,'CLAIMED');
 }finally{await f.pg.close();}
});
