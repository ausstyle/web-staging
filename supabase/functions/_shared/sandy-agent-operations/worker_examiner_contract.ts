import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
export const examinerReviewOperation="agent.reliability.interaction.review",examinerReviewVersion="1.0.0";
export const internalExaminerReviewContract=Object.freeze({
 description:"Assess response quality for an actual recorded source interaction through existing internal automation. Preserve real customer or unknown-channel scope. A qualitative model verdict never proves external provider execution or customer objective completion.",
 permission_scope:"worker:reliability",internal_only:true,sensitive:true,is_mutation:true,consumes_model_resources:true,api_exposed:false,ui_exposed:false,ai_exposed:false,verified:false,requirements:[155,160],
 input_schema:{type:"object",properties:{},required:[],additionalProperties:false},
 output_schema:{type:"object",properties:{ok:{const:true},operation:{const:examinerReviewOperation},contract_version:{const:examinerReviewVersion},principal_kind:{const:"trusted_internal_worker"},auth_user_id:{type:"null"},customer_id:{type:["string","null"],format:"uuid"},channel:{enum:["web","whatsapp","email","voice"]},source_id:{type:"string",minLength:1,maxLength:128},run_key:{type:"string",minLength:1,maxLength:200},review_id:{type:"string",pattern:"^[0-9]+$"},verdict:{enum:["pass","needs_review","potential_issue","unverifiable"]},reason:{type:"string",minLength:1,maxLength:90},quality_score:{type:["integer","null"],minimum:1,maximum:5},review_status:{enum:["evaluated","not_run","judge_unavailable"]},model_request_attempted:{type:["boolean","null"]},reused_record:{type:"boolean"},external_actions_performed:{const:0},execution_verified:{const:false}},required:["ok","operation","contract_version","principal_kind","auth_user_id","customer_id","channel","source_id","run_key","review_id","verdict","reason","quality_score","review_status","model_request_attempted","reused_record","external_actions_performed","execution_verified"],additionalProperties:false,
 allOf:[{if:{properties:{channel:{const:"whatsapp"}}},then:{properties:{customer_id:{const:null}}}},{if:{properties:{review_status:{const:"evaluated"}}},then:{properties:{model_request_attempted:{const:true}}}}]},
});
const ajv=new Ajv({strict:false,formats:fullFormats}),input=ajv.compile(internalExaminerReviewContract.input_schema),output=ajv.compile(internalExaminerReviewContract.output_schema);
export const validExaminerReviewInput=(value:unknown)=>input(value)===true;
export const validExaminerReviewOutput=(value:unknown)=>output(value)===true;
