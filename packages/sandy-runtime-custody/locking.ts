/** Source-only common transaction gates. These are not permissions. Every
 * admission/relation/session/scanner/file writer must adopt this protocol before
 * activation; a successful test does not imply a live revoker participates. */
import type {SqlTransaction} from '../sandy-cloud/postgres/commit.ts';
export type CustodyResourceKind='actor'|'session'|'company'|'tenant'|'customer'|'admission'|'workspace'|'intent'|'file'|'artifact'|'receipt'|'scanner'|'writer';
export interface CustodyResource {kind:CustodyResourceKind; id:string}
const kinds=new Set(['actor','session','company','tenant','customer','admission','workspace','intent','file','artifact','receipt','scanner','writer']);
const initializing=new WeakSet<object>();
const held=new WeakMap<object,{transaction:string;keys:ReadonlySet<string>}>();
const key=(r:CustodyResource)=>{
 if(!r||!kinds.has(r.kind)||typeof r.id!=='string'||!r.id||r.id.length>1000)throw Error('INVALID_CUSTODY_RESOURCE');
 const id=['actor','company','customer','admission','file','artifact','receipt','session'].includes(r.kind)&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(r.id)?r.id.toLowerCase():r.id;
 return JSON.stringify(['sandy.custody.lock.v1',r.kind,id]);
};
export const scopedResourceId=(...ids:string[])=>JSON.stringify(ids);
async function transaction(tx:SqlTransaction){
 const r=await tx.query('SELECT pg_current_xact_id()::text AS transaction_id');
 const id=r.rows[0]?.transaction_id;
 if(typeof id!=='string'||!/^\d+$/.test(id))throw Error('PINNED_TRANSACTION_REQUIRED');
 return id;
}
/** Declare the COMPLETE resource set before any row lock. Nested components may
 * request subsets, never extend the set: extending an already held set can
 * reverse the global order. Reused connections get a fresh transaction identity.
 * Hash collisions only over-serialize; they cannot grant authority. */
export async function lockCustodyResources(tx:SqlTransaction,resources:readonly CustodyResource[]){
 if(initializing.has(tx))throw Error('CONCURRENT_CUSTODY_LOCK_INITIALIZATION');
 initializing.add(tx);
 try{
 if(!resources.length||resources.length>256)throw Error('INVALID_CUSTODY_LOCK_PLAN');
 const keys=[...new Set(resources.map(key))].sort(),id=await transaction(tx),prior=held.get(tx);
 if(prior?.transaction===id){
  if(keys.some(k=>!prior.keys.has(k)))throw Error('LATE_CUSTODY_LOCK_EXPANSION');
  return;
 }
 for(const k of keys)await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[k]);
 if(await transaction(tx)!==id)throw Error('PINNED_TRANSACTION_REQUIRED');
 held.set(tx,{transaction:id,keys:new Set(keys)});
 }finally{initializing.delete(tx);}
}
export async function requireCustodyResources(tx:SqlTransaction,resources:readonly CustodyResource[]){
 const prior=held.get(tx);
 if(!prior||prior.transaction!==await transaction(tx)||resources.some(r=>!prior.keys.has(key(r))))throw Error('COMPLETE_CUSTODY_LOCK_PLAN_REQUIRED');
}
export interface CustodyLockPlan {
 actorId:string; customerId:string; tenantId:string|null; admissionId:string;
 fileId:string; artifactId:string; receiptId:string;
 scanner:{issuer:string;release:string}; sessionId?:string; companyId?:string;
 cloud?:{workspaceId:string;intentId:string;writerAssignmentId?:string};
}
export function custodyResources(p:Readonly<CustodyLockPlan>):CustodyResource[]{
 const r:CustodyResource[]=[{kind:'actor',id:p.actorId},{kind:'customer',id:p.customerId},{kind:'admission',id:p.admissionId},{kind:'file',id:p.fileId},{kind:'artifact',id:p.artifactId},{kind:'receipt',id:p.receiptId},{kind:'scanner',id:scopedResourceId(p.scanner.issuer,p.scanner.release)}];
 if(p.tenantId!==null)r.push({kind:'tenant',id:p.tenantId});
 if(p.sessionId)r.push({kind:'session',id:p.sessionId});
 if(p.companyId)r.push({kind:'company',id:p.companyId});
 if(p.cloud){
  if(p.tenantId===null)throw Error('CLOUD_TENANT_REQUIRED');
  r.push({kind:'workspace',id:scopedResourceId(p.tenantId,p.cloud.workspaceId)},{kind:'intent',id:scopedResourceId(p.tenantId,p.cloud.workspaceId,p.cloud.intentId)});
  if(p.cloud.writerAssignmentId)r.push({kind:'writer',id:p.cloud.writerAssignmentId});
 }
 r.forEach(key);return r;
}
export async function lockCustodyPlan(tx:SqlTransaction,p:Readonly<CustodyLockPlan>){await lockCustodyResources(tx,custodyResources(p));}
