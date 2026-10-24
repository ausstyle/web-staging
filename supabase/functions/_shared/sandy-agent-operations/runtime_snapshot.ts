import { isAgentPrincipal, isRuntimeConversationTask, type AgentPrincipal, type RuntimeConversationTask } from "./identity.ts";

// Exact counts are evidence, not defaults. Missing/malformed transport metadata
// must never become an authoritative zero in the model's initial context.
function exactCount(result:any):number|null {
 return !result?.error&&Number.isSafeInteger(result?.count)&&result.count>=0?result.count:null;
}
function completeIdentityRows(result:any,key:string):boolean {
 return !result?.error&&Array.isArray(result.data)&&result.data.length<200&&
  result.data.every((row:any)=>row&&typeof row[key]==='string'&&row[key].trim().length>0);
}

/** Shared read-only context dependency of the versioned conversation and
 * inspection services. The extracted 82-line fact collector is byte-identical
 * across the original three runtimes. A nullable conversation task can only
 * collect global policy plus empty tenant facts; it never supplies a tenant.
 */
export async function collectRuntimeSnapshot(
 identity: AgentPrincipal | RuntimeConversationTask,
 db: any,
 expected: { channel: string; requestId: string; conversationId: string | null },
){
 const customerBound=isAgentPrincipal(identity)&&identity.kind==="trusted_runtime"&&!!identity.taskId;
 const anonymous=isRuntimeConversationTask(identity)&&identity.customerId===null;
 if(!customerBound&&!anonymous)throw Error("runtime_snapshot_task_required");
 const customerId=customerBound?identity.customerId:null;
 const channel=expected.channel,conversationId=expected.conversationId;
 const {data:task,error:bindingError}=await db.from("sandy_agent_tasks").select("id,customer_id,channel,request_id,status,user_request").eq("id",identity.taskId).maybeSingle();
 if(bindingError||!task||task.id!==identity.taskId||task.customer_id!==customerId||task.channel!==channel||
    task.request_id!==expected.requestId||task.user_request!==identity.requestText||!["queued","running"].includes(task.status))throw Error("runtime_snapshot_persisted_scope_mismatch");
 if(anonymous&&(identity.requestId!==expected.requestId||identity.channel!==channel||conversationId!==null))throw Error("runtime_snapshot_anonymous_scope_mismatch");
 // V2 executive: a live scoped snapshot is a source of truth, not a model assertion.
 const v2ModeResult=await db.from("sandy_v2_runtime_policy").select("mode").eq("policy_key","executive_runtime").maybeSingle();
 const v2Mode=!v2ModeResult.error?(v2ModeResult.data?.mode||"disabled"):"disabled";
 const v2ModelModeResult=await db.from("sandy_v2_runtime_policy").select("mode").eq("policy_key","adaptive_model_routing").maybeSingle();
 const v2ModelMode=!v2ModelModeResult.error?(v2ModelModeResult.data?.mode||"disabled"):"disabled";
 let v2Connections:any[]=[];let v2ConnectionError:string|null=null;
 let v2WorkspaceNames=new Map<string,string>();
 if(customerId){
   const [conn,cos]=await Promise.all([
     db.from("sandy_composio_connections").select("connected_account_id,toolkit_slug,company_id,status,updated_at").eq("customer_id",customerId).limit(100),
     db.from("sandy_agenda_companies").select("id,name").eq("customer_id",customerId).limit(100)
   ]);
   if(conn.error||cos.error){v2ConnectionError="connections_unavailable";}
   else{v2Connections=conn.data||[];v2WorkspaceNames=new Map((cos.data||[]).map((c:any)=>[c.id,c.name]));}
 }

 // Live operational self-awareness: counts come from this tenant's database, not
 // short model context, a prompt heuristic, or a global aggregate.
 let activityFacts:any={status:"not_checked",scope:"web_only"};
 if(customerId&&(channel==="web"||channel==="test")){
   const total=db.from("sandy_web_turns").select("id",{count:"exact",head:true}).eq("customer_id",customerId);
   const current=conversationId?db.from("sandy_web_conversations").select("id").eq("id",conversationId).eq("customer_id",customerId).maybeSingle():Promise.resolve({data:null,error:null});
   const [allWeb,owned]=await Promise.all([total,current]);
   if(exactCount(allWeb)===null||owned.error)activityFacts={status:"unavailable",scope:"web_only"};
   else{
     activityFacts={status:"verified",scope:"web_only",all_web_messages:exactCount(allWeb),
       current_conversation_messages:null,current_conversation_state:owned.data?"verified":"not_supplied_or_not_authorized"};
     if(owned.data){
       const {count,error}=await db.from("sandy_web_turns").select("id",{count:"exact",head:true})
         .eq("customer_id",customerId).eq("conversation_id",conversationId);
       if(exactCount({count,error})===null)activityFacts.current_conversation_state="unavailable";
       else activityFacts.current_conversation_messages=count;
     }
   }
 }

 // Cross-channel telemetry is an authorised metadata read, not a language-model assertion.
 // Email is customer-linked incoming mail: without verified sender identity it is NOT counted as messages authored by this user.
 let communicationFacts:any={status:"unavailable",scope:"customer_scoped_recorded_messages"};
 if(customerId){
   const [webResult,voiceResult,emailResult,identityResult,addressResult]=await Promise.all([
     db.from("sandy_web_turns").select("id",{count:"exact",head:true}).eq("customer_id",customerId),
     db.from("sandy_voice_transcript_turns").select("id",{count:"exact",head:true}).eq("owner_customer_id",customerId).eq("role","user"),
     db.from("email_messages").select("id",{count:"exact",head:true}).eq("customer_id",customerId).eq("direction","incoming"),
     db.from("sandy_whatsapp_identities").select("wa_id").eq("customer_id",customerId).eq("verification_status","verified").limit(200),
     db.from("email_customer_addresses").select("normalized_email").eq("customer_id",customerId).not("verified_at","is",null).limit(200)
   ]);
   const hasIdentities=completeIdentityRows(identityResult,"wa_id");
   const ids=hasIdentities?[...new Set((identityResult.data||[]).map((x:any)=>x.wa_id).filter(Boolean))]:[];
   const whatsappResult=!identityResult.error&&hasIdentities?
     (ids.length?await db.from("sandy_whatsapp_messages").select("id",{count:"exact",head:true}).eq("direction","inbound").in("sender_wa_id",ids):{count:0,error:null}):{count:null,error:{code:"identity_lookup_unavailable"}};
   // Count only verified email senders; an empty verified-address list means UNKNOWN, not zero.
   const emailIds=completeIdentityRows(addressResult,"normalized_email")?
     [...new Set(addressResult.data.map((x:any)=>String(x.normalized_email||"").toLowerCase()).filter(Boolean))]:[];
   const emailAuthored=!completeIdentityRows(addressResult,"normalized_email")?{count:null,error:{code:"verified_addresses_unavailable"}}:
     (emailIds.length?await db.from("email_messages").select("id",{count:"exact",head:true})
       .eq("customer_id",customerId).eq("direction","incoming").in("sender_address",emailIds):
       {count:null,error:{code:"no_verified_sender_addresses"}});
   const counts={
     web_messages:exactCount(webResult),
     whatsapp_inbound_verified_identity:exactCount(whatsappResult),
     voice_user_turns:exactCount(voiceResult),
     email_incoming_customer_linked:exactCount(emailResult),
     email_authored_by_verified_customer:exactCount(emailAuthored)
   };
   const missing=Object.entries(counts).filter(([,v])=>v===null).map(([k])=>k);
   const verifiedOriginated=["web_messages","whatsapp_inbound_verified_identity","voice_user_turns"] as const;
   const subset=verifiedOriginated.every(k=>counts[k]!==null)?
     verifiedOriginated.reduce((total,k)=>total+Number(counts[k]),0):null;
   const knownSubset=Number.isSafeInteger(subset)?subset:null;
   communicationFacts={status:missing.length?"partial":"verified",scope:"customer_scoped_recorded_messages",
     counts,known_customer_originated_subset:knownSubset,missing_or_unverified:missing,
     source_provenance:{web:"sandy_web_turns customer_id",whatsapp:"sandy_whatsapp_messages inbound linked to verified sandy_whatsapp_identities",
       voice:"sandy_voice_transcript_turns role=user and owner_customer_id",
       email:"email_messages direction=incoming customer_id; incoming does not mean authored by this customer"},
     completeness:"Counts cover only records held by Sandy; never claim all historic conversations or every external connected mailbox.",
     caveat:"Web messages, WhatsApp inbound messages and voice user turns are unlike units. Email records may be from other senders. Do not combine unverified email counts into a total of messages the customer personally sent."};
 }
 const v2Services=v2Connections.filter((x:any)=>String(x.status).toUpperCase()==="ACTIVE").map((x:any)=>({
    service:x.toolkit_slug, workspace:x.company_id?(v2WorkspaceNames.get(x.company_id)||"Unknown company"):"Personal",
    chat_actions:x.toolkit_slug==="gmail"?"configured_only_gmail_search_and_confirmed_send_not_executed_by_this_read":"not_verified_executable_in_this_chat",
    state:"locally_recorded_active_not_provider_verified"
 }));
 return {v2Mode,v2ModelMode,v2Connections,v2ConnectionError,v2WorkspaceNames,activityFacts,communicationFacts,v2Services};
}
