/** Candidate shared API/Cloud journal. No route, credentials, role or worker.
 * SqlDatabase pins ONE connection; never auto-retries an uncertain commit. */
import { randomUUID } from 'node:crypto';
import { type ScanAttestation, verifyScanSignature } from './attestation.ts';
import type { SqlDatabase,SqlTransaction } from '../sandy-cloud/postgres/commit.ts';
export interface AdmissionBinding {
 artifactId:string; admissionId:string; actorId:string; operation:string;
 inputSha256:string; contractSha256:string; scopeSha256:string; bindingSha256:string;
}
export interface AuthorityOwner {
 /** Resolve canonical actor/tenant/customer relation, lock its revocation rows,
  * re-read current permission and return revision. No cached authorization.
  * Revocation writers must hold the same locks through their own COMMIT. */
 lockAndResolve(tx:SqlTransaction,c:Readonly<AdmissionBinding>):Promise<{customerId:string;tenantId:string|null;revision:string}>;
}
export interface StatusAuthorityOwner {
 /** Independently authorize this actor's CURRENT status-only access to the exact
  * historical binding. Lock/re-read current canonical relation/revocation rows.
  * The expired admission or a past scan is never this authorization. */
 lockAndAuthorizeStatus(tx:SqlTransaction,c:Readonly<AdmissionBinding>):Promise<{customerId:string;tenantId:string|null;revision:string}>;
}
export async function lockCanonicalScope(tx:SqlTransaction,scope:{actorId:string;admissionId?:string;tenantId?:string;customerId?:string}) {
 const keys=Object.entries(scope).map(([kind,id])=>{
  if(typeof id!=='string'||!id||id.length>200)throw Error('INVALID_AUTHORITY_LOCK');
  return `sandy-artifact-authority-v1:${kind}:${id}`;
 }).sort();
 for(const key of keys)await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);
}
const fail=(code:string):never=>{throw Error(code);};
export class ArtifactJournal {
 constructor(private db:SqlDatabase,private authority:AuthorityOwner,private statusAuthority?:StatusAuthorityOwner){}
 private async admitted(tx:SqlTransaction,c:AdmissionBinding){
  const owner=await this.authority.lockAndResolve(tx,Object.freeze({...c}));
  if(!owner?.customerId||!owner.revision)fail('CANONICAL_AUTHORITY_REQUIRED');
  const {rows}=await tx.query(`SELECT actor_id,tenant_id,operation,input_sha256,contract_sha256,scope_sha256,state,
   expires_at>clock_timestamp() live FROM public.sandy_api_execution_admissions WHERE id=$1 FOR SHARE`,[c.admissionId]);
  const a=rows[0];
  if(!a||a.actor_id!==c.actorId||a.tenant_id!==owner.tenantId||a.operation!==c.operation||a.input_sha256!==c.inputSha256||
   a.contract_sha256!==c.contractSha256||a.scope_sha256!==c.scopeSha256||a.state!=='consumed'||!a.live)fail('ADMISSION_BINDING_REFUSED');
  return owner;
 }
 private async trusted(tx:SqlTransaction,a:ScanAttestation,signature:string){
  const {rows}=await tx.query(`SELECT public_key_hex,trust_revision,revoked_at,
   floor(extract(epoch from clock_timestamp())*1000)::bigint now_ms
   FROM sandy_artifact_custody.scanner_releases WHERE issuer=$1 AND release=$2 FOR SHARE`,[a.issuer,a.release]);
  const key=rows[0];
  if(!key||key.revoked_at!==null||Number(key.trust_revision)!==a.trustRevision)fail('SCANNER_RELEASE_UNTRUSTED');
  await verifyScanSignature(a,signature,String(key.public_key_hex),Number(key.now_ms));
 }
 /** Trusted scanner ingress supplies signed bytes, not a trusted verdict flag.
  * The existing file/admission relation is checked in the receipt transaction. */
 async recordScan(c:AdmissionBinding,a:ScanAttestation,signature:string){
  c=Object.freeze({...c});a=Object.freeze({...a});
  return await this.db.transaction(async tx=>{
   const owner=await this.admitted(tx,c);await this.trusted(tx,a,signature);
   if(a.artifactId!==c.artifactId||a.admissionId!==c.admissionId||a.actorId!==c.actorId||a.customerId!==owner.customerId||a.bindingSha256!==c.bindingSha256)fail('SCAN_BINDING_REFUSED');
   const {rows}=await tx.query('SELECT owner_customer_id FROM public.sandy_universal_files WHERE id=$1 FOR SHARE',[a.fileId]);
   if(rows[0]?.owner_customer_id!==owner.customerId)fail('FILE_OWNER_REFUSED');
   await tx.query(`INSERT INTO sandy_artifact_custody.scan_receipts
    (id,artifact_id,file_id,admission_id,issuer,release,trust_revision,attestation,signature_hex,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,to_timestamp($10/1000.0))`,
    [a.receiptId,a.artifactId,a.fileId,a.admissionId,a.issuer,a.release,a.trustRevision,JSON.stringify(a),signature,a.expiresAt]);
  });
 }
 private async scan(tx:SqlTransaction,c:AdmissionBinding,receiptId:string,customerId:string){
  const {rows}=await tx.query(`SELECT id,file_id,issuer,release,trust_revision,attestation,signature_hex FROM sandy_artifact_custody.scan_receipts
   WHERE id=$1 AND artifact_id=$2 AND admission_id=$3 AND expires_at>clock_timestamp() FOR SHARE`,[receiptId,c.artifactId,c.admissionId]);
  const a=rows[0]?.attestation as ScanAttestation|undefined;
  if(!a||a.receiptId!==receiptId||a.artifactId!==c.artifactId||a.admissionId!==c.admissionId||a.fileId!==rows[0].file_id||a.issuer!==rows[0].issuer||a.release!==rows[0].release||a.trustRevision!==Number(rows[0].trust_revision)||a.verdict!=='CLEAN'||a.actorId!==c.actorId||a.customerId!==customerId||a.bindingSha256!==c.bindingSha256)fail('CLEAN_BOUND_SCAN_REQUIRED');
  await this.trusted(tx,a!,String(rows[0].signature_hex));
  const file=await tx.query('SELECT owner_customer_id FROM public.sandy_universal_files WHERE id=$1 FOR SHARE',[a!.fileId]);
  if(file.rows[0]?.owner_customer_id!==customerId)fail('FILE_OWNER_REFUSED');
  return a!;
 }
 /** Cloud calls this on its existing pinned commit transaction, retaining locks
  * until that caller commits. It neither starts a transaction nor claims custody. */
 async verifyScanInTransaction(tx:SqlTransaction,c:AdmissionBinding,receiptId:string){
  c=Object.freeze({...c});
  const owner=await this.admitted(tx,c);
  const record=await this.scan(tx,c,receiptId,owner.customerId);
  return {record,customerId:owner.customerId,tenantId:owner.tenantId,authorityRevision:owner.revision};
 }
 async acquire(c:AdmissionBinding,receiptId:string){
  c=Object.freeze({...c});
  return await this.db.transaction(async tx=>{
   const owner=await this.admitted(tx,c),a=await this.scan(tx,c,receiptId,owner.customerId),leaseToken=randomUUID();
   // INSERT, never UPSERT: expired, abandoned and uncertain claims are not free.
   const {rows}=await tx.query(`INSERT INTO sandy_artifact_custody.claims
    (artifact_id,receipt_id,admission_id,binding_sha256,authority_revision,lease_token,expires_at,state)
    VALUES($1,$2,$3,$4,$5,$6,LEAST(clock_timestamp()+interval '30 seconds',to_timestamp($7/1000.0)),'CLAIMED')
    RETURNING floor(extract(epoch from expires_at)*1000)::bigint expires_ms`,[c.artifactId,receiptId,c.admissionId,c.bindingSha256,owner.revision,leaseToken,a.expiresAt]);
   const expiresAt=Number(rows[0].expires_ms);
   if(!Number.isSafeInteger(expiresAt)||expiresAt<0)fail('INVALID_CLAIM_EXPIRY');
   return {leaseToken,expiresAt,record:a,authorityRevision:owner.revision,customerId:owner.customerId,tenantId:owner.tenantId};
  });
 }
 async seal(c:AdmissionBinding,leaseToken:string,privateHandle:string,proof:Record<string,unknown>){
  c=Object.freeze({...c});proof=Object.freeze({...proof});
  if(!/^[A-Za-z0-9_.:-]{1,200}$/.test(privateHandle))fail('OPAQUE_PRIVATE_HANDLE_REQUIRED');
  return await this.db.transaction(async tx=>{
   const owner=await this.admitted(tx,c);
   const {rows}=await tx.query(`SELECT * FROM sandy_artifact_custody.claims WHERE artifact_id=$1
    AND admission_id=$2 AND binding_sha256=$3 AND lease_token=$4 AND expires_at>clock_timestamp() FOR UPDATE`,[c.artifactId,c.admissionId,c.bindingSha256,leaseToken]);
   const claim=rows[0];
   if(!claim||claim.state!=='CLAIMED'||claim.authority_revision!==owner.revision)fail('CLAIM_LOST_OR_AUTHORITY_CHANGED');
   const a=await this.scan(tx,c,String(claim.receipt_id),owner.customerId);
   if(proof.version!==1||proof.kind!=='repository_artifact_bytes_verified'||proof.artifactId!==a.artifactId||proof.generation!==a.generation||proof.size!==a.size||proof.sha256!==a.sha256||proof.bindingSha256!==a.bindingSha256||Object.keys(proof).length!==7)fail('BYTE_PROOF_REFUSED');
   const committed=await tx.query("UPDATE sandy_artifact_custody.claims SET state='SEALED',private_handle=$2,proof=$3::jsonb WHERE artifact_id=$1 AND expires_at>clock_timestamp() AND EXISTS(SELECT 1 FROM public.sandy_api_execution_admissions a WHERE a.id=admission_id AND a.expires_at>clock_timestamp()) RETURNING artifact_id",[c.artifactId,privateHandle,JSON.stringify(proof)]);
   if(committed.rows.length!==1)fail('CLAIM_EXPIRED_BEFORE_SEAL');
   return {privateHandle,proof};
  });
 }
 /** Historical status only, independently authorized NOW. No handle, proof,
  * bytes, scan verdict, renewed lease or authority to publish is returned. */
 async reconcileStatus(c:AdmissionBinding){
  c=Object.freeze({...c});
  const statusAuthority=this.statusAuthority;
  if(!statusAuthority)fail('CURRENT_STATUS_AUTHORITY_REQUIRED');
  return await this.db.transaction(async tx=>{
   const owner=await statusAuthority!.lockAndAuthorizeStatus(tx,c);
   if(!owner?.customerId||!owner.revision)fail('CURRENT_STATUS_AUTHORITY_REQUIRED');
   const admission=await tx.query(`SELECT actor_id,tenant_id,operation,input_sha256,contract_sha256,scope_sha256
    FROM public.sandy_api_execution_admissions WHERE id=$1 FOR SHARE`,[c.admissionId]);
   const a=admission.rows[0];
   if(!a||a.actor_id!==c.actorId||a.tenant_id!==owner.tenantId||a.operation!==c.operation||a.input_sha256!==c.inputSha256||a.contract_sha256!==c.contractSha256||a.scope_sha256!==c.scopeSha256)fail('STATUS_BINDING_REFUSED');
   const {rows}=await tx.query(`SELECT c.state,r.attestation,f.owner_customer_id FROM sandy_artifact_custody.claims c
    JOIN sandy_artifact_custody.scan_receipts r ON r.id=c.receipt_id
    JOIN public.sandy_universal_files f ON f.id=r.file_id
    WHERE c.artifact_id=$1 AND c.admission_id=$2 AND c.binding_sha256=$3 FOR SHARE`,[c.artifactId,c.admissionId,c.bindingSha256]);
   const row=rows[0],attestation=row?.attestation as ScanAttestation|undefined;
   if(!row||!attestation||row.owner_customer_id!==owner.customerId||attestation.customerId!==owner.customerId||attestation.actorId!==c.actorId||attestation.bindingSha256!==c.bindingSha256)fail('STATUS_BINDING_REFUSED');
   return {state:row.state==='SEALED'?'SEALED':row.state==='ABANDONED'?'ABANDONED':'RECONCILIATION_REQUIRED'};
  });
 }
 /** Read after unknown acknowledgement; never repeats append/seal work. */
 async reconcile(c:AdmissionBinding){
  c=Object.freeze({...c});
  return await this.db.transaction(async tx=>{
   const owner=await this.admitted(tx,c);
   const {rows}=await tx.query('SELECT * FROM sandy_artifact_custody.claims WHERE artifact_id=$1 AND admission_id=$2 AND binding_sha256=$3 FOR SHARE',[c.artifactId,c.admissionId,c.bindingSha256]);
   const row=rows[0];if(!row||row.authority_revision!==owner.revision)fail('CLAIM_UNAVAILABLE');
   await this.scan(tx,c,String(row.receipt_id),owner.customerId);
   return row.state==='SEALED'?{state:'SEALED',privateHandle:row.private_handle,proof:row.proof}:{state:'RECONCILIATION_REQUIRED'};
  });
 }
}
