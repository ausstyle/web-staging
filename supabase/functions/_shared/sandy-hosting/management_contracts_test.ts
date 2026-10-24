import {strict as assert} from 'node:assert';
import {createRegistrySchemaValidator} from '../../sandy-operation-api/registry_schema_validator.ts';
import contracts from './management_contracts.json' with {type:'json'};
const validator=createRegistrySchemaValidator();const id='10000000-0000-4000-8000-000000000001';
const period={account_id:id,period_start:'2026-10-01T00:00:00Z',period_end:'2026-11-01T00:00:00Z'};
Deno.test('unknown usage is explicit and cannot silently become zero charge',()=>{
 const v={...period,status:'unavailable',estimate:null,approved_limit:null,observed_charge:null,provider_receipt_ids:[]};assert.equal(validator.isValid(contracts.schemas.usage_view,v),true);
 assert.equal(validator.isValid(contracts.schemas.usage_view,{...v,observed_charge:{amount:{currency:'USD',amount_micros:0}}}),false);
});
Deno.test('observed charges require receipts and cannot be negative',()=>{
 const charge={amount:{currency:'USD',amount_micros:12},observed_at:'2026-10-24T00:00:00Z',provider_receipt_ids:[id]};const v={...period,status:'available',estimate:null,approved_limit:null,observed_charge:charge,provider_receipt_ids:[id]};assert.equal(validator.isValid(contracts.schemas.usage_view,v),true);
 assert.equal(validator.isValid(contracts.schemas.usage_view,{...v,observed_charge:{...charge,provider_receipt_ids:[]}}),false);
 assert.equal(validator.isValid(contracts.schemas.usage_view,{...v,observed_charge:{...charge,amount:{currency:'USD',amount_micros:-1}}}),false);
});
Deno.test('estimate and approved limit have distinct evidence contracts',()=>{
 const quote={amount:{currency:'USD',amount_micros:100},quote_id:id,expires_at:'2026-10-25T00:00:00Z'};
 const v={...period,status:'available',estimate:quote,approved_limit:null,observed_charge:null,provider_receipt_ids:[]};assert.equal(validator.isValid(contracts.schemas.usage_view,v),true);assert.equal(validator.isValid(contracts.schemas.usage_view,{...v,approved_limit:quote}),false);
});
Deno.test('backup creation cannot assert successful restore',()=>{
 const b={account_id:id,backup_id:id,source_resource_id:id,created_at:'2026-10-24T00:00:00Z',backup_receipt_id:id,state:'created',restore_verified:false,restore_receipt_id:null,restored_at:null};assert.equal(validator.isValid(contracts.schemas.backup_view,b),true);assert.equal(validator.isValid(contracts.schemas.backup_view,{...b,restore_verified:true}),false);
});
Deno.test('restore plan stays isolated, non-executable and authorization/cost gated',()=>{
 const p={account_id:id,backup_id:id,isolated_target_id:id,expected_target_version:1,plan_sha256:'a'.repeat(64),estimated_cost:null,requires_owner_authorization:true,requires_cost_approval:true,production_cutover:false,executable:false};assert.equal(validator.isValid(contracts.schemas.isolated_restore_plan,p),true);
 for(const patch of [{executable:true},{production_cutover:true},{requires_cost_approval:false},{requires_owner_authorization:false}])assert.equal(validator.isValid(contracts.schemas.isolated_restore_plan,{...p,...patch}),false);
});
