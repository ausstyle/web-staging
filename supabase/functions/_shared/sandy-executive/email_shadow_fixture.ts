/** Fixed synthetic fixture selection for the existing protected OIDC test bridge.
 * The caller supplies neither a customer/source selector nor arbitrary content.
 * This grants no customer/Owner authority and never invokes a provider itself.
 */
export const emailShadowFixture = Object.freeze({
  subject: "[SANDY QA] Runtime channel continuity acceptance",
  body: "Reply exactly EMAIL_SHADOW_ACCEPTANCE. This is a synthetic comparison only. Do not send messages or change records.",
  sender: "sandy-runtime-fixture",
  baseline: "SYNTHETIC UNSENT COMPARISON BASELINE",
  model: "sandy-synthetic-baseline",
  customer: "Isolated Sandy API service acceptance",
});
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const empty=(r:any)=>!r.error&&Array.isArray(r.data)&&r.data.length===0;
const fail=(code:string):never=>{throw Error(code);};
export async function resolveEmailShadowFixture(db:any,now=Date.now()){
 if(!Number.isFinite(now))fail("email_fixture_clock_invalid");
 const messages=await db.from("email_messages").select("id,customer_id,conversation_id,created_at")
  .eq("direction","incoming").eq("subject",emailShadowFixture.subject).eq("body_text",emailShadowFixture.body).eq("sender_address",emailShadowFixture.sender)
  .gte("created_at",new Date(now-10*60000).toISOString()).lte("created_at",new Date(now).toISOString()).limit(2);
 if(messages.error||!Array.isArray(messages.data)||messages.data.length!==1)fail("email_fixture_missing_or_ambiguous");
 const source=messages.data[0];
 if(!uuid(source.id)||!uuid(source.customer_id)||!uuid(source.conversation_id)||!Number.isFinite(Date.parse(source.created_at))||Date.parse(source.created_at)>now||now-Date.parse(source.created_at)>10*60000)fail("email_fixture_source_invalid");
 const customer=source.customer_id;
 const [owner,accounts,settings,allowed,generation,jobs,outgoing]=await Promise.all([
  db.from("email_customers").select("id,display_name,google_drive_folder_status").eq("id",customer).maybeSingle(),
  db.from("sandy_memory_portal_accounts").select("auth_user_id").eq("customer_id",customer).is("revoked_at",null).limit(2),
  db.from("sandy_memory_settings").select("enabled,learning_enabled,proactive_enabled").eq("customer_id",customer).maybeSingle(),
  db.from("sandy_email_runtime_canary_allowlist").select("enabled").eq("customer_id",customer).maybeSingle(),
  db.from("email_ai_generations").select("customer_id,source_message_id,draft_message_id,status,model_name,provider_response_id").eq("customer_id",customer).eq("source_message_id",source.id).maybeSingle(),
  db.from("sandy_temporal_ingestion_jobs").select("id").eq("customer_id",customer).limit(1),
  db.from("email_messages").select("id").eq("customer_id",customer).eq("direction","outgoing").in("delivery_status",["queued","sent"]).limit(1),
 ]);
 if(owner.error||owner.data?.id!==customer||owner.data?.display_name!==emailShadowFixture.customer||owner.data?.google_drive_folder_status!=="excluded")fail("email_fixture_customer_invalid");
 if(accounts.error||!Array.isArray(accounts.data)||accounts.data.length!==1||!uuid(accounts.data[0].auth_user_id))fail("email_fixture_account_invalid");
 if(settings.error||settings.data?.enabled!==false||settings.data?.learning_enabled!==false||settings.data?.proactive_enabled!==false||allowed.error||allowed.data?.enabled!==true)fail("email_fixture_policy_invalid");
 if(!empty(jobs)||!empty(outgoing))fail("email_fixture_background_work_not_empty");
 if(generation.error||generation.data?.customer_id!==customer||generation.data?.source_message_id!==source.id||!uuid(generation.data?.draft_message_id)||generation.data?.status!=="generated"||generation.data?.model_name!==emailShadowFixture.model||generation.data?.provider_response_id!=null)fail("email_fixture_baseline_invalid");
 const authId=accounts.data[0].auth_user_id;
 const [auth,controller,draft]=await Promise.all([
  db.auth.admin.getUserById(authId),
  db.from("sandy_controller_admins").select("auth_user_id").eq("auth_user_id",authId).limit(1),
  db.from("email_messages").select("id,customer_id,direction,delivery_status,body_text,recipient_addresses").eq("id",generation.data.draft_message_id).eq("customer_id",customer).maybeSingle(),
 ]);
 const user=auth.data?.user;
 if(auth.error||user?.id!==authId||user?.role!=="authenticated"||typeof user.email!=="string"||!user.email.endsWith("@example.invalid")||!user.email_confirmed_at||user.user_metadata?.sandy_api_isolated_session_test!==true||user.app_metadata?.sandy_engineering_test===true||!empty(controller))fail("email_fixture_auth_identity_invalid");
 if(draft.error||draft.data?.customer_id!==customer||draft.data?.direction!=="outgoing"||draft.data?.delivery_status!=="draft"||draft.data?.body_text!==emailShadowFixture.baseline||!Array.isArray(draft.data?.recipient_addresses)||draft.data.recipient_addresses.length!==0)fail("email_fixture_draft_not_unsent");
 return Object.freeze({source_message_id:source.id,customer_id:customer});
}
