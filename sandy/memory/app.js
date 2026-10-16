
import {createClient} from "https://esm.sh/@supabase/supabase-js@2.105.0";
const $=id=>document.getElementById(id),h=(tag,cls,text)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(text!==undefined)x.textContent=String(text);return x};
const API="https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-memory-centre",SB="https://zmqlyygzqoidkcwdysok.supabase.co";
const auth=createClient(SB,"sb_publishable_OVP7LUMDhtcymPRzZuCK3Q_8JkLC3ts",{auth:{detectSessionInUrl:true,persistSession:true,storage:localStorage,autoRefreshToken:true,experimental:{passkey:true}}});
let state=null,view="home",session=null,noticeTimer=null;
const fmt=v=>{if(!v)return "No date";const d=new Date(v);return Number.isNaN(d.getTime())?"No date":new Intl.DateTimeFormat("en-AU",{month:"short",day:"numeric",year:"numeric"}).format(d)};
const clear=x=>{x.replaceChildren();return x},add=(p,...nodes)=>{nodes.forEach(n=>p.append(n));return p};
const text=(p,t,cls="")=>add(p,h("p",cls,t||""));
function notify(m){$("toast").textContent=m;$("toast").classList.remove("hide");clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$("toast").classList.add("hide"),3800)}
async function api(op,body={}){const s=(await auth.auth.getSession()).data.session;if(!s?.access_token)throw Error("Please sign in again.");const r=await fetch(API+"?op="+encodeURIComponent(op),{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+s.access_token},body:JSON.stringify(body),cache:"no-store"});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||"Request unsuccessful");return j}
function aBtn(title,onClick,cls="smallbutton"){const b=h("button",cls,title);b.type="button";b.addEventListener("click",onClick);return b}
function badge(t){const s=h("span","tag",t.replaceAll("_"," "));if(/failed|error/i.test(t))s.classList.add("bad");else if(/approval|pending/i.test(t))s.classList.add("warn");else if(/complete|done|approved/i.test(t))s.classList.add("good");return s}
function para(x){return String(x||"").replace(/\s+/g," ").slice(0,230)}
function line(title,desc="",right=null){const row=h("div","lineitem");add(row,h("strong","",title));if(desc)text(row,desc);if(right)row.append(right);return row}
function panel(title){const p=h("section","panel");p.append(h("h2","",title));return p}
function sourceButton(s){const label=s.channel?String(s.channel)+" • "+fmt(s.date):s.type||"Stored record";return aBtn("↗ "+label,async()=>{if(s.type==="historical_record"||s.channel)await evidence(s.id);else showDrawer(s.title||s.type, s.excerpt||"This information is stored in Sandy's customer profile or task register.")},"sourcebtn")}
function showDrawer(title,content,actions=[]){$("drawerTitle").textContent=title;const d=clear($("drawerContent"));d.append(h("div","",content));actions.forEach(x=>d.append(x));$("drawer").classList.remove("hide")}
async function evidence(id){try{const v=(await api("evidence",{id})).item;const actions=h("div","actions");actions.append(aBtn("Forget indexed copy",async()=>{if(!confirm("Remove this indexed memory copy? The original source email, file or voice record remains in its original system."))return;await api("forget",{id,confirm:true});$("drawer").classList.add("hide");notify("Indexed copy forgotten");await load()},"smallbutton danger"));showDrawer(v.channel+" • "+fmt(v.occurred_at),v.content,[actions])}catch(e){notify(e.message)}}
async function load(){const j=await api("overview");state=j.overview;$("userName").textContent=state.name||"Your Sandy";$("avatar").textContent=(state.name||"S").charAt(0).toUpperCase();const n=state.insights.length+state.execution.filter(x=>["awaiting_approval","failed"].includes(x.status)).length;$("attentionCount").textContent=n;$("attentionCount").classList.toggle("hide",!n);render()}
function switchView(v){view=v;document.querySelectorAll("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===v));render();window.scrollTo({top:0,behavior:"smooth"})}
function headings(top,title,sub){$("sectionTop").textContent=top;$("pageHeading").textContent=title;$("pageSubtitle").textContent=sub}
function home(){headings("YOUR PERSONAL KNOWLEDGE","Everything in one place.","What Sandy remembers, what is underway, and what may need you.");const root=clear($("pageview")),stats=h("div","stats");const numbers=[[state.total,"Stored records"],[state.facts.length,"Saved facts"],[state.checklist.filter(x=>x.status!=="done").length,"Open personal tasks"]];numbers.forEach(x=>{const n=h("div","stat");add(n,h("strong","",x[0]),h("small","",x[1]));stats.append(n)});root.append(stats);
const row=h("div","cards");const know=h("div","card"),working=h("div","card"),attention=h("div","card");
know.append(h("div","cardhead","◇  What Sandy knows"),h("h3","","Your story, remembered"));text(know,para(state.profile?.profile_summary)||"Your profile is being built from verified conversations and your instructions.");know.append(aBtn("Explore memory →",()=>switchView("knowledge")));
working.append(h("div","cardhead","☑  Currently in motion"),h("h3","","Real progress, visible"));const live=state.execution.filter(x=>!["completed","failed"].includes(x.status));text(working,live.length?live.length+" execution requests currently need action or resolution.":"No verified agent work is currently running. Personal checklist items are tracked separately.");working.append(aBtn("Review tasks →",()=>switchView("tasks")));
attention.append(h("div","cardhead","✦  Worth your attention"),h("h3","","Nothing slips through"));const waiting=state.execution.filter(x=>["awaiting_approval","failed"].includes(x.status));text(attention,waiting.length?waiting.length+" recorded execution requests need review.":"Sandy checks recorded commitments and suggestions for anything important.");attention.append(aBtn("See priorities →",()=>switchView("attention")));add(row,know,working,attention);root.append(row);
const ms=panel("Your active matters");if(!state.matters.length)ms.append(h("div","empty","No active matters are currently recorded."));else state.matters.slice(0,6).forEach(x=>ms.append(line(x.title,para(x.summary),badge(x.status))));ms.style.marginTop="23px";root.append(ms)}

function rememberUI(){const form=document.getElementById("rememberForm");form.classList.toggle("hide");form.querySelector("textarea")?.focus()}
function rememberForm(){const form=h("form","hide");form.id="rememberForm";const input=h("textarea");input.style.width="100%";input.style.minHeight="88px";input.style.border="1px solid #dce5dd";input.style.borderRadius="9px";input.style.padding="12px";input.style.marginTop="13px";input.maxLength=5000;input.placeholder="Remember that…";const save=h("button","primary","Save to memory");save.type="submit";add(form,input,save);form.addEventListener("submit",async e=>{e.preventDefault();const note=input.value.trim();if(note.length<3)return;const id=crypto.randomUUID();try{await api("remember",{text:note,request_id:id});notify("Added to Sandy's memory");await load()}catch(e){notify(e.message)}});return form}
async function correctFact(f,remove){let value=null;if(!remove){value=prompt("What should Sandy remember instead?",f.fact_value);if(value===null)return;if(!value.trim())return notify("Enter the correct information.")}else if(!confirm("Mark this saved fact as incorrect so Sandy stops using it?"))return;try{await api("fact_correct",{id:f.id,new_value:value,confirm:true});notify(remove?"Fact marked incorrect":"Fact corrected");await load()}catch(e){notify(e.message)}}
function knowledge(){headings("WHAT SHE KNOWS","Your memory.","Profile facts, important relationships, active matters and their sources.");const root=clear($("pageview"));const p=panel("Your profile");text(p,state.profile?.profile_summary||"No completed profile summary yet.");root.append(p);
const notePanel=panel("Things you've told Sandy to remember");
notePanel.append(aBtn("＋ Remember something",()=>rememberUI(),"secondary"));notePanel.append(rememberForm());
if(!state.notes?.length)notePanel.append(h("div","empty","No direct memory notes yet. Add anything Sandy should remember."));
else state.notes.forEach(n=>{const row=h("div","lineitem");text(row,n.content);const actions=h("div","actions");actions.append(aBtn("View source",()=>evidence(n.id)));row.append(actions);notePanel.append(row)});
root.append(notePanel);const gp={};state.facts.forEach(f=>{const key=f.category||"Other";(gp[key]??=[]).push(f)});const facts=panel("Saved facts");Object.entries(gp).forEach(([key,items])=>{facts.append(h("div","eyebrow",key.toUpperCase()));items.slice(0,25).forEach(f=>{const r=line(String(f.fact_key).replaceAll("_"," "),f.fact_value,badge(f.confidence||"saved"));const b=h("div","actions");b.append(aBtn("Correct",()=>correctFact(f,false)));b.append(aBtn("Not correct",()=>correctFact(f,true),"smallbutton danger"));r.append(b);facts.append(r)})});if(!state.facts.length)facts.append(h("div","empty","No saved profile facts yet."));root.append(facts);const matters=panel("Tracked matters");state.matters.forEach(m=>matters.append(line(m.title,m.summary,badge(m.status))));if(!state.matters.length)matters.append(h("div","empty","No active matters recorded."));root.append(matters)}
function taskLine(x){const row=h("div","listrow"),main=h("div","rowmain"),check=h("div","checkrow"),box=h("input");box.type="checkbox";box.checked=x.status==="done";box.title="Mark this personal checklist item complete";box.addEventListener("change",async()=>{try{await api("task_status",{id:x.id,status:box.checked?"done":"open"});notify(box.checked?"Marked done":"Reopened");await load()}catch(e){box.checked=!box.checked;notify(e.message)}});const t=h("div");t.append(h("strong",x.status==="done"?"done":"",x.title));if(x.description||x.due_at)text(t,((x.description||"")+(x.due_at?" · Due "+fmt(x.due_at):"")).slice(0,270));add(check,box,t);main.append(check);const right=h("div","rowright");right.append(aBtn("+ Subtask",()=>quickTask(x.id),"smallbutton"));right.append(aBtn("×",async()=>{if(!confirm("Delete this checklist item and its subtasks?"))return;try{await api("task_delete",{id:x.id,confirm:true});await load()}catch(e){notify(e.message)}},"smallbutton danger"));add(row,main,right);return row}
function quickTask(parent=null){const root=$("pageview");const target=parent?document.getElementById("taskAdd-"+parent):document.getElementById("taskAdd-main");if(!target)return;target.classList.toggle("hide");target.querySelector("input")?.focus()}
function taskForm(parent=null){const wrap=h("form","taskform hide");wrap.id=parent?"taskAdd-"+parent:"taskAdd-main";const input=h("input");input.required=true;input.maxLength=360;input.placeholder=parent?"Add a subtask":"What needs doing?";const date=h("input");date.type="date";date.title="Optional due date";const save=h("button","primary","Add");save.type="submit";add(wrap,input,date,save);wrap.addEventListener("submit",async e=>{e.preventDefault();try{await api("task_add",{title:input.value,parent_id:parent,due_at:date.value?date.value+"T17:00:00":null});notify("Added to your checklist");await load()}catch(er){notify(er.message)}});return wrap}
function tasks(){headings("TASKS & COMMITMENTS","Work in progress.","Your personal checklist is separate from Sandy's verified execution history.");const root=clear($("pageview"));const mine=panel("Your personal checklist");mine.append(aBtn("＋ Add a task",()=>quickTask(),"secondary"));mine.append(taskForm());const roots=state.checklist.filter(t=>!t.parent_id);roots.sort((a,b)=>(a.status==="done")-(b.status==="done"));if(!roots.length)mine.append(h("div","empty","Add your first task, then break it into subtasks."));roots.forEach(x=>{const group=h("div");group.append(taskLine(x));group.append(taskForm(x.id));const subs=state.checklist.filter(y=>y.parent_id===x.id);if(subs.length){const sub=h("div","subtasks");subs.forEach(y=>sub.append(taskLine(y)));group.append(sub)}mine.append(group)});root.append(mine);
const real=panel("Sandy's execution requests");text(real,"These are actual recorded requests. Checking off personal tasks does not change their status.");if(!state.execution.length&&!state.agent.length)real.append(h("div","empty","No execution requests recorded."));state.execution.forEach(x=>real.append(line(x.instruction, "Source: "+x.source_channel+" · Updated "+fmt(x.updated_at)+(x.error_code?" · "+x.error_code:""),badge(x.status))));state.agent.slice(0,12).forEach(x=>real.append(line(x.user_request,"Agent run · "+fmt(x.updated_at),badge(x.status))));root.append(real)}
function attention(){headings("PROACTIVE ASSISTANCE","Needs your attention.","Verified outstanding work and suggestions for review — never automatic external actions.");const root=clear($("pageview"));const p=panel("Tasks needing a decision");const t=state.execution.filter(x=>["awaiting_approval","failed"].includes(x.status));if(!t.length)p.append(h("div","empty","No known blocked or failed execution requests."));t.forEach(x=>p.append(line(x.instruction, "Source: "+x.source_channel+" · "+fmt(x.updated_at),badge(x.status))));root.append(p);const q=panel("Sandy's suggestions");text(q,"These are ideas inferred from stored history. Keeping a suggestion does not instruct Sandy to act.");if(!state.insights.length)q.append(h("div","empty","No outstanding suggestions currently require your review."));state.insights.forEach(x=>{const row=h("div","lineitem");add(row,h("strong","",x.title));text(row,x.detail);const acts=h("div","actions");acts.append(badge(x.insight_type));if(x.evidence_source_id)acts.append(aBtn("See evidence",()=>evidence(x.evidence_source_id)));acts.append(aBtn("Keep on radar",async()=>{try{await api("insight",{id:x.id,status:"approved"});notify("Kept on your radar — no action performed");await load()}catch(e){notify(e.message)}}));acts.append(aBtn("Dismiss",async()=>{try{await api("insight",{id:x.id,status:"dismissed"});await load()}catch(e){notify(e.message)}}));row.append(acts);q.append(row)});root.append(q);
const due=state.checklist.filter(x=>x.status!=="done"&&x.due_at).sort((a,b)=>new Date(a.due_at)-new Date(b.due_at));if(due.length){const d=panel("Upcoming checklist dates");due.forEach(x=>d.append(line(x.title,"Due "+fmt(x.due_at))));root.append(d)}}
function search(){headings("SEARCH EVERYTHING","Search your history.","Look across stored emails, voice conversations, messages and document references.");const root=clear($("pageview")),p=panel("Find a memory"),form=h("form","searchbar"),inp=h("input");inp.id="historyQuery";inp.placeholder="Search a person, project, decision or document";const submit=h("button","primary","Search");submit.type="submit";add(form,inp,submit);p.append(form);const results=h("div");p.append(results);form.addEventListener("submit",async e=>{e.preventDefault();clear(results);results.append(h("div","loading","Searching your indexed history…"));try{const j=await api("search",{query:inp.value,limit:20});clear(results);if(!j.matches?.length)results.append(h("div","empty","No matching records found. Try a more specific keyword."));j.matches?.forEach(x=>{const row=h("div","searchhit");add(row,badge(x.channel+" · "+x.role));text(row,x.excerpt);row.append(aBtn("View original indexed record →",()=>evidence(x.id)));results.append(row)})}catch(er){results.textContent=er.message}});root.append(p)}

function passkeySettingsPanel(){
 const p=panel("Fast, secure sign-in"),intro=h("p","","Add a passkey on your personal device to sign in with Face ID, Touch ID or your device PIN. Your browser can stay signed in between visits.");p.append(intro);
 const buttonRow=h("div","actions"),addKey=aBtn("＋ Add a passkey",async()=>{
   addKey.disabled=true;securityStatus.textContent="Opening your device's secure passkey prompt…";
   try{
     if(!auth.auth.registerPasskey)throw Error("Passkeys are not supported by this client.");
     const {error}=await auth.auth.registerPasskey();
     if(error)throw error;
     securityStatus.textContent="Passkey added. Next time, choose Continue with passkey.";
     await listKeys();
   }catch(e){securityStatus.textContent=e.code==="passkey_disabled"?"Passkeys are not yet enabled in Sandy's Supabase Auth settings. Your existing login remains available.":(e.message||"Could not add passkey.").slice(0,220)}
   finally{addKey.disabled=false}
 },"secondary"),refresh=aBtn("Manage passkeys",async()=>await listKeys(),"smallbutton");
 add(buttonRow,addKey,refresh);p.append(buttonRow);
 const securityStatus=h("div","auth-security-status",""),listed=h("div","passkeylist");p.append(securityStatus,listed);
 async function listKeys(){
  listed.replaceChildren();securityStatus.textContent="Checking your saved passkeys…";
  try{
   if(!auth.auth.passkey?.list)throw Error("Passkey management unavailable.");
   const {data,error}=await auth.auth.passkey.list();if(error)throw error;
   const keys=Array.isArray(data)?data:(data?.passkeys||[]);
   securityStatus.textContent=keys.length?keys.length+" passkey"+(keys.length===1?"":"s")+" registered.":"No passkeys registered yet.";
   keys.forEach(k=>{
     const line=h("div","passkeyitem"),info=h("div",""),remove=aBtn("Remove",async()=>{
       if(!confirm("Remove this passkey? You may need email sign-in on this device afterwards."))return;
       remove.disabled=true;const {error:e}=await auth.auth.passkey.delete({passkeyId:k.id});
       if(e){securityStatus.textContent=e.message;remove.disabled=false;return}
       await listKeys();
     },"smallbutton danger");
     add(info,h("strong","",k.friendly_name||"Passkey"),h("small","",k.created_at?"Added "+fmt(k.created_at):"Secure device credential"));add(line,info,remove);listed.append(line);
   });
  }catch(e){securityStatus.textContent=e.code==="passkey_disabled"?"Passkeys need to be enabled in Supabase Authentication → Passkeys.":(e.message||"Unable to read passkeys.").slice(0,220)}
 }
 p.append(h("p","", "Only add passkeys on devices you own. This temporary site uses the GitHub Pages domain; passkeys must be enrolled again when Sandy moves to a permanent domain."));
 return p;
}
function settings(){headings("PRIVATE & USER-CONTROLLED","Memory settings.","You decide what Sandy remembers and how she uses it.");const root=clear($("pageview")),p=panel("Your preferences");const options=[["enabled","Memory access","Allow Sandy to store and retrieve your knowledge for approved channels."],["learning_enabled","Learn from conversations","Index new content and derive useful long-term understanding."],["proactive_enabled","Proactive suggestions","Look for reminders, outstanding commitments and things requiring attention."]];options.forEach(([k,title,desc])=>{const row=h("div","settingrow");const left=h("div");add(left,h("strong","",title),h("p","",desc));const box=h("input","toggle");box.type="checkbox";box.checked=!!state.settings?.[k];box.addEventListener("change",async()=>{try{await api("settings",{[k]:box.checked});notify("Setting saved");await load()}catch(e){box.checked=!box.checked;notify(e.message)}});add(row,left,box);p.append(row)});root.append(p);const about=panel("Your data & permissions");text(about,"Turning memory off stops the Memory Centre from searching your archive. It does not delete original emails, voice transcripts, WhatsApp records or files.");text(about,"Search results offer a Forget indexed copy action. Original messages must be removed separately from their source systems if you want complete deletion.");text(about,"Only your confirmed customer account can open this space. External actions still require the permissions appropriate to the action.");root.append(about);root.append(passkeySettingsPanel())}

let lifeInfo=null,lifeSpace=null;
function lf(label,placeholder="",type="text"){
 const wrap=h("label","lf");const name=h("span","",label),field=h(type==="textarea"?"textarea":"input","lfinput");
 if(type!=="textarea")field.type=type;field.placeholder=placeholder;add(wrap,name,field);return {wrap,field};
}
function ls(label,items){
 const wrap=h("label","lf"),field=h("select","lfinput");wrap.append(h("span","",label));
 items.forEach(x=>{const opt=h("option","",x.title||x.name);opt.value=x.id||x.area_key;field.append(opt)});
 wrap.append(field);return {wrap,field};
}
async function refreshLife(){
 const [a,b]=await Promise.all([api("life_brief"),api("life_spaces")]);
 lifeInfo={brief:a.brief,...b};life();
}
function life(){
 headings("YOUR PERSONAL ORGANISER","Your life, in one place.","Manage personal, home and work without sharing information between them.");
 const root=clear($("pageview"));
 if(!lifeInfo){text(root,"Loading life organiser…");refreshLife().catch(e=>notify(e.message));return}
 const {brief,spaces,areas,suggestions}=lifeInfo;
 const stats=h("div","stats");
 [[brief.open_tasks||0,"Open tasks"],[(brief.goals||[]).length,"Active goals"],[suggestions.length,"Suggestions"],[brief.unsorted_documents||0,"Unsorted records"]].forEach(x=>{
 const n=h("div","stat");add(n,h("strong","",x[0]),h("small","",x[1]));stats.append(n)});
 root.append(stats);
 const spaceButtons=h("div","lifespaces");
 spaceButtons.append(aBtn("All",()=>{lifeSpace=null;refreshLife()},"smallbutton"));
 spaces.forEach(s=>spaceButtons.append(aBtn(s.title,()=>{lifeSpace=s.id;refreshLife()},"smallbutton")));
 root.append(spaceButtons);
 const cards=h("div","cards"),finding=panel("Find anything"),task=panel("Add a task");
 const search=lf("Your question or search","Search emails, files, tasks, history");
 const results=h("div","liferesults");
 const go=aBtn("Search",async()=>{
  if(search.field.value.trim().length<2)return notify("Enter a search phrase");
  clear(results);text(results,"Searching…");
  try{const r=await api("life_search",{query:search.field.value,space_id:lifeSpace});clear(results);
   if(!r.results.length)text(results,"No indexed matches.");
   r.results.forEach(item=>{
    const row=line(item.title,item.record_type+" • "+String(item.excerpt||"").slice(0,130));
    row.append(aBtn("View",()=>showDrawer(item.title,item.excerpt||"")));results.append(row)
   });
  }catch(e){clear(results);text(results,e.message)}
 },"primary");
 search.field.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();go.click()}});
 add(finding,search.wrap,go,results);
 const t=lf("Task","e.g. Complete tax return"),sub=lf("Subtasks (one per line)","Gather bank records\nReview Xero","textarea");
 const scoped=ls("Space",spaces.filter(s=>s.space_key!=="inbox")),area=ls("Life area",areas.filter(a=>a.area_key!=="inbox"));
 const make=aBtn("Create task",async()=>{
  try{await api("life_task",{title:t.field.value,subtasks:sub.field.value.split("\n").map(x=>x.trim()).filter(Boolean),
   space_id:scoped.field.value,area_key:area.field.value});notify("Task created");await load();lifeInfo=null;switchView("life")}
  catch(e){notify(e.message)}
 },"primary");
 add(task,t.wrap,sub.wrap,scoped.wrap,area.wrap,make);add(cards,finding,task);root.append(cards);
 const goals=panel("Goals");
 const g=lf("Your goal","e.g. Organise family finances"),gs=ls("Space",spaces.filter(s=>s.space_key!=="inbox")),ga=ls("Area",areas.filter(a=>a.area_key!=="inbox"));
 add(goals,g.wrap,gs.wrap,ga.wrap,aBtn("Add goal",async()=>{
  try{await api("life_goal",{title:g.field.value,space_id:gs.field.value,area_key:ga.field.value});notify("Goal added");refreshLife()}
  catch(e){notify(e.message)}
 },"smallbutton"));
 (brief.goals||[]).forEach(x=>goals.append(line(x.title,x.status)));
 root.append(goals);
 const open=panel("Outstanding tasks");
 if(!(brief.tasks||[]).length)text(open,"Nothing outstanding.");
 (brief.tasks||[]).forEach(x=>{
  const r=line(x.title,x.due_at?"Due "+fmt(x.due_at):x.status);
  r.append(aBtn("✓ Done",async()=>{try{await api("life_done",{id:x.id});notify("Completed");await load();lifeInfo=null;switchView("life")}catch(e){notify(e.message)}}));
  open.append(r)
 });root.append(open);
 const suggestionsPanel=panel("Suggested filing");
 text(suggestionsPanel,"Sandy's suggestions remain private and require your confirmation.");
 suggestions.forEach(x=>{
  const space=spaces.find(s=>s.id===x.space_id);
  const r=line(x.title,(space?.title||"Personal")+" • "+x.area_key);
  r.append(aBtn("Confirm",async()=>{
   try{await api("life_file",{document_id:x.document_id,space_id:x.space_id,area_key:x.area_key});notify("Filed");refreshLife()}
   catch(e){notify(e.message)}
  }));suggestionsPanel.append(r)
 });root.append(suggestionsPanel);
}

function render(){if(!state)return;({home,life,knowledge,tasks,attention,search,settings}[view]||home)()}
async function question(q){$("askInput").value=q;$("answerBox").classList.remove("hide");$("answerText").textContent="Looking through your records…";clear($("answerSources"));$("askButton").disabled=true;try{const r=await api("ask",{query:q});$("answerText").textContent=r.answer||"Sandy could not form a supported answer.";r.sources?.forEach(s=>$("answerSources").append(sourceButton(s)))}catch(e){$("answerText").textContent=e.message}finally{$("askButton").disabled=false}}
function enter(){session=true;$("authgate").classList.add("hide");$("app").classList.remove("hide");load().catch(e=>notify(e.message))}
function exit(){session=null;state=null;$("app").classList.add("hide");$("authgate").classList.remove("hide")}
async function start(){
document.querySelectorAll("[data-view]").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.view)));
document.querySelectorAll("[data-ask]").forEach(b=>b.addEventListener("click",()=>question(b.dataset.ask)));
$("askForm").addEventListener("submit",e=>{e.preventDefault();const q=$("askInput").value.trim();if(q.length>3)question(q)});
$("closeAnswer").addEventListener("click",()=>$("answerBox").classList.add("hide"));
$("closeDrawer").addEventListener("click",()=>$("drawer").classList.add("hide"));
$("drawer").addEventListener("click",e=>{if(e.target===$("drawer"))$("drawer").classList.add("hide")});
$("refresh").addEventListener("click",()=>load().then(()=>notify("Updated")).catch(e=>notify(e.message)));
$("logout").addEventListener("click",async()=>{await auth.auth.signOut();exit()});
$("emailToggle").addEventListener("click",()=>{
 const form=$("loginForm"),open=form.classList.toggle("hide")===false;
 $("emailToggle").setAttribute("aria-expanded",String(open));
 if(open)$("email").focus();
});
$("passkeyLogin").addEventListener("click",async()=>{
 const btn=$("passkeyLogin");btn.disabled=true;$("authMessage").textContent="Confirm sign-in with your device…";
 try{
  if(!window.PublicKeyCredential||!auth.auth.signInWithPasskey)throw Error("Your browser does not support this sign-in method. Use your secure email link.");
  const {error}=await auth.auth.signInWithPasskey();if(error)throw error;
  $("authMessage").textContent="Signed in securely.";
 }catch(er){
  if(er.code==="passkey_disabled")$("authMessage").textContent="Passkeys are not yet enabled for Sandy. Use email for now; once enabled, you can add a passkey in Settings.";
  else if(er.code==="webauthn_credential_not_found")$("authMessage").textContent="This device does not have a Sandy passkey yet. Sign in using email once, then add your passkey in Settings.";
  else $("authMessage").textContent=(er.message||"Passkey sign-in was cancelled or unavailable.").slice(0,240);
 }finally{btn.disabled=false}
});
$("loginForm").addEventListener("submit",async e=>{
 e.preventDefault();const email=$("email").value.trim().toLowerCase(),b=$("sendLink");b.disabled=true;
 $("authMessage").textContent="Requesting a secure sign-in link…";
 try{
  const {error}=await auth.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:window.location.origin+window.location.pathname}});
  if(error)throw error;
  $("authMessage").textContent="Check your email once to sign in. You can then add a passkey in Settings and avoid emails on future visits.";
 }catch(er){$("authMessage").textContent="Could not send the sign-in link: "+(er.message||"Try again.").slice(0,200)}
 finally{b.disabled=false}
});
auth.auth.onAuthStateChange((_e,s)=>{if(s?.access_token&&!session)enter();else if(!s?.access_token&&session)exit()});
const {data}=await auth.auth.getSession();if(data.session)enter();else exit();
}
start().catch(e=>{$("authMessage").textContent="Could not initialise sign-in: "+e.message});
