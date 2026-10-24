/** Candidate canonical reference implementation for Cloud's supplied tx seam.
 * No route, credentials, identity mapping or scanner trust is provisioned.
 * Cloud owns its digest encoding; pass its reviewed cloudScanBindingDigest.
 */
import {intentDigest,type SqlTransaction} from '../sandy-cloud/postgres/commit.ts';
import type {UploadIntent} from '../sandy-cloud/integrity.ts';
import type {AdmissionBinding,ArtifactJournal} from './journal.ts';
import {requireCustodyResources,scopedResourceId} from './locking.ts';
export interface CloudBindingCodec {
 operation:string; contractSha256:string;
 digest(input:{intent:Readonly<UploadIntent>;fileId:string;admission:{customerId:string;policyEpoch:number}},binding:Omit<AdmissionBinding,'bindingSha256'>):string;
}
const deny=():never=>{throw Error('CANONICAL_CLOUD_REFERENCE_REFUSED');};
const sha=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
function frozenIntent(i:UploadIntent):Readonly<UploadIntent>{return Object.freeze({...i,ref:Object.freeze({...i.ref})});}
async function gates(tx:SqlTransaction,i:Readonly<UploadIntent>,fileId:string){
 await requireCustodyResources(tx,[{kind:'actor',id:i.actorId},{kind:'tenant',id:i.ref.tenantId},{kind:'workspace',id:scopedResourceId(i.ref.tenantId,i.ref.workspaceId)},{kind:'intent',id:scopedResourceId(i.ref.tenantId,i.ref.workspaceId,i.id)},{kind:'file',id:fileId}]);
}
/** Called after a signed scan exists, never from caller JSON. Canonical API
 * authority and scanner/file validation still execute in journal on THIS tx. */
export async function recordCloudReference(tx:SqlTransaction,input:{intent:UploadIntent;fileId:string;receiptId:string;binding:AdmissionBinding},journal:Pick<ArtifactJournal,'verifyScanInTransaction'>,codec:CloudBindingCodec){
 const i=frozenIntent(input.intent),fileId=input.fileId,receiptId=input.receiptId,b=Object.freeze({...input.binding});
 codec=Object.freeze({...codec});
 await gates(tx,i,fileId);
 await requireCustodyResources(tx,[{kind:'admission',id:b.admissionId},{kind:'artifact',id:b.artifactId},{kind:'receipt',id:receiptId}]);
 // Same row order as Cloud: workspace -> intent -> shared scan -> file projection.
 const workspace=await tx.query('SELECT customer_id,policy_epoch FROM sandy_cloud.workspaces WHERE tenant_id=$1 AND workspace_id=$2 FOR SHARE',[i.ref.tenantId,i.ref.workspaceId]);
 const w=workspace.rows[0],epoch=Number(w?.policy_epoch);
 if(!w||typeof w.customer_id!=='string'||!Number.isSafeInteger(epoch)||epoch<1)deny();
 await requireCustodyResources(tx,[{kind:'customer',id:String(w.customer_id)}]);
 const stored=await tx.query(`SELECT actor_id,file_id,input_sha256,policy_epoch,state,ref=$4::jsonb ref_matches,
 expires_at>clock_timestamp() live FROM sandy_cloud.upload_intents WHERE tenant_id=$1 AND workspace_id=$2 AND intent_id=$3 FOR SHARE`,[i.ref.tenantId,i.ref.workspaceId,i.id,JSON.stringify(i.ref)]);
 const row=stored.rows[0];
 if(!row||row.actor_id!==i.actorId||row.file_id!==fileId||row.input_sha256!==intentDigest(i)||Number(row.policy_epoch)!==epoch||row.state!=='OPEN'||!row.live||!row.ref_matches||b.actorId!==i.actorId||b.operation!==codec.operation||b.contractSha256!==codec.contractSha256||![b.inputSha256,b.scopeSha256,b.contractSha256,b.bindingSha256].every(sha)||b.bindingSha256!==codec.digest({intent:i,fileId,admission:{customerId:String(w.customer_id),policyEpoch:epoch}},b))deny();
 const discovery=await tx.query('SELECT issuer,release FROM sandy_artifact_custody.scan_receipts WHERE id=$1',[receiptId]);
 if(!discovery.rows[0])deny();
 await requireCustodyResources(tx,[{kind:'scanner',id:scopedResourceId(String(discovery.rows[0].issuer),String(discovery.rows[0].release))}]);
 const v=await journal.verifyScanInTransaction(tx,b,receiptId),a=v.record;
 if(v.customerId!==w.customer_id||v.tenantId!==i.ref.tenantId||a.fileId!==fileId||a.generation!==i.ref.generation||a.sha256!==i.ref.sha256||a.size!==i.ref.size)deny();
 await tx.query(`INSERT INTO sandy_artifact_custody.cloud_scan_references
 (tenant_id,workspace_id,intent_id,file_id,receipt_id,artifact_id,admission_id,intent_sha256,binding)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,[i.ref.tenantId,i.ref.workspaceId,i.id,fileId,receiptId,b.artifactId,b.admissionId,intentDigest(i),JSON.stringify(b)]);
}
/** Structural implementation of CloudScanReferenceOwner. Caller already holds
 * its complete common gates and Cloud row locks; no nested transaction starts. */
export const canonicalCloudReferences={
 async lock(tx:SqlTransaction,intent:Readonly<UploadIntent>,fileId:string):Promise<{receiptId:string;binding:AdmissionBinding}|null>{
  const i=frozenIntent(intent);await gates(tx,i,fileId);
  const {rows}=await tx.query(`SELECT receipt_id,artifact_id,admission_id,binding,intent_sha256 FROM sandy_artifact_custody.cloud_scan_references
   WHERE tenant_id=$1 AND workspace_id=$2 AND intent_id=$3 AND file_id=$4 FOR SHARE`,[i.ref.tenantId,i.ref.workspaceId,i.id,fileId]);
  if(!rows.length)return null;
  const row=rows[0],b=row.binding as AdmissionBinding;
  if(!b||row.intent_sha256!==intentDigest(i)||b.actorId!==i.actorId||b.artifactId!==row.artifact_id||b.admissionId!==row.admission_id)deny();
  await requireCustodyResources(tx,[{kind:'admission',id:b.admissionId},{kind:'artifact',id:b.artifactId},{kind:'receipt',id:String(row.receipt_id)}]);
  return {receiptId:String(row.receipt_id),binding:Object.freeze({...b})};
 }
};
