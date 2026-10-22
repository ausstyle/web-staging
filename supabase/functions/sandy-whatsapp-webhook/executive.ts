import {pairedChannelHistory} from "../_shared/sandy-executive/history.ts";
/** Only deliver's existing verified database identity and sender/phone-scoped
 * transcript reach this formatter. It supplies no identity or additional grant. */
export function whatsappRuntimeRequest(customerId:string,requestId:string,text:string,context:{role:string;content:string}[],canary:boolean,gmailBranch=false){
 const retry=/(^(try again|retry|go ahead|yes please)[.!\s]*$|(?:last|latest|recent)\s+(?:five|5)\s+subjects?|my (?:5|five) last emails|why (?:not|only) (?:5|five|three|3) emails?)/i.test(text.trim());
 return {channel:"whatsapp",request_id:requestId,customer_id:customerId,
  request:!canary&&gmailBranch&&retry?"Search my connected Gmail inbox and list my five most recent emails, including sender and subject.":text,
  ...(canary?{history:pairedChannelHistory(context)}:{}),
 };
}
