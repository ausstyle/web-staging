/** Three fixed Engineering job variants, not new operation catalogue entries. */
export const iapRepairProposal='52d56740-59c8-4db1-b7e6-a137c7699b86';
export const iapRepairTarget='sandy-iap-repair:elaborate-haven-511518-a5:sandy-video+sandy-windows';
export const iapRepairOperations=['engineering.implementation.request','engineering.job.execute'] as const;
export const iapRepairJobSchemas=['plan','apply','rollback'].map(mode=>({
 type:'object',required:['change_id','provider','operation','target','idempotency_key','payload'],additionalProperties:false,
 properties:{change_id:{type:'string',const:iapRepairProposal},provider:{type:'string',const:'google_cloud'},
  operation:{type:'string',const:'iap.repair.'+mode},target:{type:'string',const:iapRepairTarget},
  idempotency_key:{type:'string',pattern:'^[A-Za-z0-9:_-]{12,100}$'},
  payload:{type:'object',properties:mode==='plan'?{}:{parent_admission_id:{type:'string',format:'uuid'}},
   required:mode==='plan'?[]:['parent_admission_id'],additionalProperties:false}},
}));
export function iapRepairJobInput(v:unknown):v is Record<string,any>{
 if(!v||typeof v!=='object'||Array.isArray(v))return false;const b=v as Record<string,any>;
 if(Object.keys(b).length!==6||!['change_id','provider','operation','target','idempotency_key','payload'].every(k=>Object.hasOwn(b,k))||
  b.change_id!==iapRepairProposal||b.provider!=='google_cloud'||b.target!==iapRepairTarget||!/^iap\.repair\.(plan|apply|rollback)$/.test(b.operation)||
  typeof b.idempotency_key!=='string'||!/^[A-Za-z0-9:_-]{12,100}$/.test(b.idempotency_key)||!b.payload||typeof b.payload!=='object'||Array.isArray(b.payload))return false;
 return b.operation==='iap.repair.plan'?Object.keys(b.payload).length===0:
  Object.keys(b.payload).length===1&&typeof b.payload.parent_admission_id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(b.payload.parent_admission_id);
}
