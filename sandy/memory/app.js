
import {createClient} from "https://esm.sh/@supabase/supabase-js@2.105.0";
import {installSandyIdleLock} from "../security-lock.js";
const $=id=>document.getElementById(id),h=(tag,cls,text)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(text!==undefined)x.textContent=String(text);return x};
const API="https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-memory-centre",SB="https://zmqlyygzqoidkcwdysok.supabase.co";
const auth=createClient(SB,"sb_publishable_OVP7LUMDhtcymPRzZuCK3Q_8JkLC3ts",{auth:{detectSessionInUrl:true,persistSession:true,storage:localStorage,autoRefreshToken:true,experimental:{passkey:true}}});
const idle=installSandyIdleLock(auth);
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
function home(){headings("YOUR PERSONAL KNOWLEDGE","Everything in one place.","What Sandy remembers, what is underway, and what may need you.");const root=clear($("pageview")),stats=h("div","stats");const numbers=[[state.total,"Stored records","search"],[state.facts.length,"Saved facts","knowledge"],[state.checklist.filter(x=>x.status!=="done").length,"Open personal tasks","tasks"]];numbers.forEach(([count,label,target])=>{const n=h("button","stat statLink");n.type="button";n.setAttribute("aria-label","View "+label.toLowerCase());add(n,h("strong","",count),h("small","",label));n.addEventListener("click",()=>switchView(target));stats.append(n)});root.append(stats);
const row=h("div","cards");const know=h("div","card"),working=h("div","card"),attention=h("div","card");
know.append(h("div","cardhead","◇  What Sandy knows"),h("h3","","Your story, remembered"));text(know,"Explore what Sandy remembers about your people, companies, projects, preferences and ongoing matters. Review the details by topic, check their sources and correct anything that is incomplete or outdated.");know.append(aBtn("Explore memory →",()=>switchView("knowledge")));
working.append(h("div","cardhead","☑  Currently in motion"),h("h3","","Real progress, visible"));const live=state.execution.filter(x=>!["completed","failed"].includes(x.status));text(working,live.length?live.length+" execution requests currently need action or resolution.":"No verified agent work is currently running. Personal checklist items are tracked separately.");working.append(aBtn("Review tasks →",()=>switchView("tasks")));
attention.append(h("div","cardhead","✦  Worth your attention"),h("h3","","Nothing slips through"));const waiting=state.execution.filter(x=>["awaiting_approval","failed"].includes(x.status));text(attention,waiting.length?waiting.length+" recorded execution requests need review.":"Sandy checks recorded commitments and suggestions for anything important.");attention.append(aBtn("See priorities →",()=>switchView("attention")));add(row,know,working,attention);root.append(row);
const ms=panel("Your active matters");if(!state.matters.length)ms.append(h("div","empty","No active matters are currently recorded."));else state.matters.slice(0,6).forEach(x=>ms.append(line(x.title,para(x.summary),badge(x.status))));ms.style.marginTop="23px";root.append(ms)}

function rememberUI(){document.getElementById("rememberForm")?.querySelector("textarea")?.focus()}
function rememberForm(){
 const form=h("form","");form.id="rememberForm";
 const input=h("textarea","factInput");input.style.width="100%";input.rows=2;input.maxLength=5000;input.placeholder="Tell Sandy something you want her to remember…";
 const save=h("button","primary","Tell Sandy");save.type="submit";form.append(input,save);
 form.addEventListener("submit",async e=>{
  e.preventDefault();const note=input.value.trim();if(note.length<3)return;
  save.disabled=true;
  try{
   const result=await api("remember",{text:note,request_id:crypto.randomUUID()});
   if(!result.fact_id)throw Error("Sandy saved the note but could not create an editable fact.");
   notify("Remembered under "+(result.category||"your memory")+". Sandy has a follow-up question.");
   await load();
   const fact=state?.facts?.find(f=>f.id===result.fact_id);
   if(fact){const row=document.querySelector('[data-fact-id="'+fact.id+'"]');if(row){row.scrollIntoView({behavior:"smooth",block:"center"});row.querySelector(".factAction")?.click()}}
  }catch(err){notify("Could not finish saving: "+err.message)}
  finally{save.disabled=false}
 });return form;
}
async function correctFact(f,remove){
 if(remove){
  if(window._memoryUpdating)return;window._memoryUpdating=true;
  try{
   await api("fact_correct",{id:f.id,new_value:null,confirm:true});
   notify("Removed from active memory. Sandy will remember this assertion was incorrect.");
   await load();
  }catch(e){notify(e.message)}finally{window._memoryUpdating=false}
  return;
 }
 const target=document.querySelector('[data-fact-id="'+f.id+'"]');
 if(!target)return;
 const existing=target.querySelector(".factEditor");if(existing){existing.querySelector("input")?.focus();return}
 const area=h("form","factEditor");const input=h("input","factInput");input.type="text";input.maxLength=1000;input.value=f.fact_value;input.setAttribute("aria-label","Correct saved fact");area.append(input);
 const cancel=aBtn("Cancel",()=>area.remove(),"smallbutton");
 const submit=h("button","smallbutton primary","Save correction");submit.type="submit";
 area.append(cancel,submit);
 area.addEventListener("submit",async e=>{
  e.preventDefault();const value=input.value.trim();if(value.length<2){notify("Enter the correct information.");return}
  submit.disabled=true;try{await api("fact_correct",{id:f.id,new_value:value,confirm:true});notify("Corrected. Sandy will prefer this value and keep the earlier claim as incorrect.");await load()}catch(err){notify(err.message);submit.disabled=false}
 });
 target.append(area);input.focus();input.select()
}
function knowledge(){
 headings("YOUR MEMORY","What Sandy knows","A clear view of what Sandy has learned, what you've told her, and the statements you've corrected.");
 const root=clear($("pageview"));
 const hero=h("div","memoryHero");
 const hText=h("div","memoryHeroText");
 hText.append(h("div","eyebrow","YOUR PERSONAL KNOWLEDGE BASE"),h("h2","","Your memory, in your control."));
 hText.append(h("p","","Review what Sandy believes, correct anything that isn't right, and teach her what to remember. Corrections remain recorded so she doesn't make the same assumption again."));
 hero.append(hText);
 const count=h("div","memoryStats");
 for(const [number,label,target] of [[state.facts.length,"Active facts","memoryFactsList"],[(state.rejected_facts||[]).length,"Corrections","memoryCorrectionsList"],[state.notes?.length||0,"Your notes","memoryNotesList"]]){
  const tile=h("button","memoryStat statLink");tile.type="button";tile.setAttribute("aria-label","View "+label.toLowerCase());tile.append(h("strong","",number),h("span","",label+" →"));tile.addEventListener("click",()=>{if(target==="memoryCorrectionsList"&&document.querySelector("#memoryCorrectionsList .rejectedBody")?.hidden)document.querySelector("#memoryCorrectionsList .rejectedHeader")?.click();document.getElementById(target)?.scrollIntoView({behavior:"smooth",block:"start"})});count.append(tile)
 }hero.append(count);root.append(hero);
 const notePanel=h("section","memoryNotesBlock");notePanel.id="memoryNotesList";
 const noteHead=h("div","memoryBlockTitle");noteHead.append(h("div","","Tell Sandy something"));
 notePanel.append(noteHead,h("p","memoryHint","Sandy will categorise what you tell her, save it as an editable fact below and ask what else would be useful to know."));
 notePanel.append(rememberForm());root.append(notePanel);
 const panelRoot=h("section","memoryFactSection");panelRoot.id="memoryFactsList";
 const bar=h("div","memoryFactTop");const titleWrap=h("div","");
 titleWrap.append(h("h2","","Saved facts"),h("p","memoryHint","Only active facts are used as current information. Mark something incorrect with one click."));
 bar.append(titleWrap);
 const filter=h("input","memoryFind");filter.type="search";filter.placeholder="Search saved facts";filter.setAttribute("aria-label","Search saved facts");
 bar.append(filter);panelRoot.append(bar);
 const groups=h("div","memoryFactGroups");panelRoot.append(groups);
 let memoryTree=null;
 async function improveFact(f){
  const row=document.querySelector('[data-fact-id="'+f.id+'"]');if(!row)return;
  row.querySelectorAll(".factEditor").forEach(el=>el.remove());
  const box=h("div","factEditor"),heading=h("strong","","Improve: "+String(f.fact_key).replaceAll("_"," "));
  const conversation=h("div",""),actions=h("div","actions");
  const answer=h("textarea","factInput");answer.maxLength=1800;answer.rows=3;answer.placeholder="Your answer to Sandy…";
  let stopped=false,turn=null,saved=0;
  const stop=aBtn("Stop improving",()=>{stopped=true;box.remove();if(saved)load()},"smallbutton");
  const submit=aBtn("Save & continue",async()=>{
   const value=answer.value.trim();if(!value)return notify("Please answer Sandy's question.");
   if(!turn||stopped)return;
   submit.disabled=true;stop.disabled=true;
   try{
    await api("enrich_answer",{turn_id:turn.id,answer:value});
    saved++;answer.value="";notify("Answer saved to Sandy's memory");
    conversation.replaceChildren(document.createTextNode("Saved. Finding a useful next question…"));
    stop.disabled=false;await nextQuestion();
   }catch(e){notify("Could not save or continue: "+e.message);submit.disabled=false;stop.disabled=false}
  },"smallbutton primary");
  async function nextQuestion(){
   if(stopped||!box.isConnected)return;
   submit.disabled=true;
   try{
    let r=null;
    for(let attempt=0;attempt<3;attempt++){
     const candidate=await api("enrich_question",{id:f.id});
     const q=String(candidate?.turn?.question||"").trim();
     if(q.length>=12&&q.length<=240&&q.endsWith("?")&&!/^(got it|understood|thanks|thank you|noted|i.ll remember|you (have|are|own|attended))/i.test(q)){r=candidate;break}
     if(candidate?.turn?.id)await api("enrich_skip",{turn_id:candidate.turn.id,reason:"Automatic rejection: response not a question"}).catch(()=>{});
    }
    if(!r)throw Error("Sandy returned a statement rather than a question.");
    if(stopped||!box.isConnected)return;
    turn=r.turn;conversation.replaceChildren(document.createTextNode(turn.question));submit.disabled=false;skip.disabled=false;answer.focus();
   }catch(e){
    if(stopped||!box.isConnected)return;
    text(conversation,"Sandy could not generate the next question: "+e.message);
    submit.disabled=true;
    const retry=aBtn("Try again",()=>{retry.remove();text(conversation,"Sandy is thinking…");nextQuestion()},"smallbutton");actions.prepend(retry);
   }
  }
  answer.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.isComposing){e.preventDefault();if(!submit.disabled)submit.click()}});
  const skip=aBtn("Skip question",async()=>{
   if(!turn||submit.disabled)return;
   submit.disabled=true;skip.disabled=true;
   try{
    await api("enrich_skip",{turn_id:turn.id,reason:"User marked this question as unnecessary"});
    conversation.replaceChildren(document.createTextNode("Skipped. Finding a more useful question…"));
    await nextQuestion();
   }catch(e){notify("Could not skip: "+e.message);submit.disabled=false;skip.disabled=false}
  },"smallbutton");
  actions.append(stop,skip,submit);box.append(heading,conversation,answer,actions);row.append(box);
  text(conversation,"Sandy is thinking of a relevant question…");await nextQuestion();
 }
 function drawFacts(){
  groups.replaceChildren();
  const q=filter.value.trim().toLocaleLowerCase();
  const chosen=state.facts.filter(f=>(String(f.fact_key)+" "+String(f.fact_value)+" "+String(f.category)).toLocaleLowerCase().includes(q));
  if(!chosen.length){groups.append(h("div","memoryEmpty",q?"No matching facts.":"Sandy has no active saved facts yet."));return}
  function factRow(f){
   const row=h("div","memoryFactRow");row.dataset.factId=f.id;
   const info=h("div","factBody");
   info.append(h("div","factLabel",String(f.fact_key).startsWith("manual_")?"What you told Sandy":String(f.fact_key).replaceAll("_"," ")));
   info.append(h("p","factValue",f.fact_value));row.append(info);
   const controls=h("div","factControls");
   controls.append(aBtn("Improve this topic",()=>improveFact(f),"factAction"));
   controls.append(aBtn("Edit",()=>correctFact(f,false),"factAction"));
   controls.append(aBtn("Not correct",()=>correctFact(f,true),"factReject"));
   row.append(controls);return row
  }
  function section(title,items,depth=0){
   if(!items.length)return;
   const node=h("section","factGroup");
   const head=h("button","factGroupHead");head.type="button";head.style.width="100%";head.style.textAlign="left";
   head.append(h("h3","",title),h("span","factCount",items.length+" facts  ▾"));
   const body=h("div","");items.forEach(f=>body.append(factRow(f)));
   head.addEventListener("click",()=>{body.hidden=!body.hidden;head.lastChild.textContent=items.length+" facts  "+(body.hidden?"▸":"▾")});
   node.append(head,body);if(depth)node.style.marginLeft=Math.min(depth,4)*12+"px";groups.append(node)
  }
  if(!memoryTree){
   const buckets=new Map();for(const f of chosen){const k=(f.category||"General").replaceAll("_"," ");if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(f)}
   for(const [k,v] of buckets)section(k.charAt(0).toUpperCase()+k.slice(1),v);return
  }
  const subjects=memoryTree.subjects||[],links=memoryTree.links||[];
  const assigned=new Set(),visited=new Set();
  const bySubject=new Map();
  const factById=new Map(chosen.map(f=>[f.id,f]));
  for(const link of links){const f=factById.get(link.fact_id);if(!f||assigned.has(f.id))continue;assigned.add(f.id);if(!bySubject.has(link.subject_id))bySubject.set(link.subject_id,[]);bySubject.get(link.subject_id).push(f)}
  function renderSubject(subject,depth=0){
   if(visited.has(subject.id))return;visited.add(subject.id);
   const children=subjects.filter(s=>s.parent_id===subject.id);
   const local=bySubject.get(subject.id)||[];
   const group=h("section","factGroup");group.style.marginLeft=Math.min(depth,4)*12+"px";
   const head=h("button","factGroupHead");head.type="button";head.style.width="100%";head.style.textAlign="left";
   head.append(h("h3","",subject.title),h("span","factCount",(local.length+children.length)+" items ▾"));
   const body=h("div","");local.forEach(f=>body.append(factRow(f)));
   group.append(head,body);
   head.addEventListener("click",()=>{body.hidden=!body.hidden;head.lastChild.textContent=(local.length+children.length)+" items "+(body.hidden?"▸":"▾")});
   for(const child of children)body.append(renderSubject(child,depth+1));
   return group
  }
  subjects.filter(s=>!s.parent_id||!subjects.some(p=>p.id===s.parent_id)).forEach(s=>groups.append(renderSubject(s)));
  const unassigned=chosen.filter(f=>!assigned.has(f.id));if(unassigned.length){const byCategory=new Map();for(const f of unassigned){const k=(f.category||"Personal").replaceAll("_"," ");if(!byCategory.has(k))byCategory.set(k,[]);byCategory.get(k).push(f)}for(const [k,v] of byCategory)section(k.charAt(0).toUpperCase()+k.slice(1),v)}
 }
 api("memory_tree").then(t=>{if(root.isConnected){memoryTree=t;if(!root.querySelector(".factEditor"))drawFacts()}}).catch(e=>{notify("Topic grouping unavailable: "+e.message);});
 filter.addEventListener("input",drawFacts);drawFacts();root.append(panelRoot);
 const rejects=state.rejected_facts||[];
 const rejections=h("section","memoryRejectedSection");rejections.id="memoryCorrectionsList";
 const rejectHeader=h("button","rejectedHeader");
 rejectHeader.type="button";rejectHeader.setAttribute("aria-expanded","false");
 rejectHeader.append(h("span","","↳ Corrections and rejected claims"),h("span","",rejects.length+" recorded  ▸"));
 rejections.append(rejectHeader);
 const rejectBody=h("div","rejectedBody");rejectBody.hidden=true;
 rejectBody.append(h("p","memoryHint","These are not claims Sandy should trust. They stay here as negative evidence, not as active facts."));
 if(rejects.length){for(const r of rejects){
  const row=h("div","rejectedFactRow");
  const value=h("div","");value.append(h("strong","",String(r.fact_key||"Earlier statement").replaceAll("_"," ")),h("p","",r.rejected_value));
  if(r.corrected_value)value.append(h("p","rejectedCorrection","Corrected to: "+r.corrected_value));
  row.append(value,h("span","rejectedLabel",r.corrected_value?"Corrected":"Incorrect"));rejectBody.append(row)
 }}else rejectBody.append(h("div","memoryEmpty","No rejected statements yet."));
 rejections.append(rejectBody);
 rejectHeader.addEventListener("click",()=>{rejectBody.hidden=!rejectBody.hidden;rejectHeader.setAttribute("aria-expanded",String(!rejectBody.hidden));rejectHeader.lastChild.textContent=rejects.length+" recorded  "+(rejectBody.hidden?"▸":"▾")});
 root.append(rejections);
 const matters=panel("Tracked matters");
 const info=h("p","memoryHint","Ongoing subjects from Sandy's conversations. These are not necessarily tasks or confirmed actions.");
 matters.append(info);
 state.matters.forEach(m=>matters.append(line(m.title,m.summary,badge(m.status))));
 if(!state.matters.length)matters.append(h("div","empty","No tracked matters yet."));
 root.append(matters)
}
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
async function enter(){if(await idle.check())return;session=true;$("authgate").classList.add("hide");$("app").classList.remove("hide");load().catch(e=>notify(e.message))}
function exit(){session=null;state=null;$("app").classList.add("hide");$("authgate").classList.remove("hide")}
async function start(){
if(await idle.check())return;
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
  const r=await fetch(SB+"/functions/v1/sandy-login-email",{
   method:"POST",
   headers:{"Content-Type":"application/json"},
   body:JSON.stringify({email}),
   cache:"no-store"
  });
  const result=await r.json().catch(()=>({}));
  if(!r.ok){
   if(result.error==="delivery_status_uncertain"){
    $("authMessage").textContent="Sandy couldn't confirm the email's delivery status. Please check your inbox before requesting another link.";
    return;
   }
   throw Error(result.message||"Secure email service unavailable. Please try again.");
  }
  $("authMessage").textContent=result.message||"If registered, you'll receive a sign-in link from ai@email.com.au.";
 }catch(er){$("authMessage").textContent="Could not send the sign-in link: "+(er.message||"Try again.").slice(0,200)}
 finally{b.disabled=false}
});
auth.auth.onAuthStateChange((_e,s)=>{if(s?.access_token&&!session)enter();else if(!s?.access_token&&session)exit()});
// Magic links are transported in the fragment (never sent to the web server).
// Erase the one-time credential from browser history before exchanging it.
const loginHash=new URLSearchParams(window.location.hash.replace(/^#/,"")).get("sandy_login");
if(loginHash){
 window.history.replaceState(null,"",window.location.pathname+window.location.search);
 $("authMessage").textContent="Verifying your secure Sandy sign-in link…";
 try{
  if(!/^[a-f0-9]{40,128}$/i.test(loginHash))throw Error("Invalid sign-in link");
  const {error}=await auth.auth.verifyOtp({token_hash:loginHash,type:"magiclink"});
  if(error)throw error;
  $("authMessage").textContent="Verified. Welcome back to Sandy.";
 }catch(er){
  $("authMessage").textContent="This sign-in link could not be verified or has expired. Request a new link from ai@email.com.au.";
 }
}
const {data}=await auth.auth.getSession();if(data.session)enter();else exit();
}

fetch(SB+"/auth/v1/settings",{headers:{apikey:"sb_publishable_OVP7LUMDhtcymPRzZuCK3Q_8JkLC3ts"}}).then(r=>r.json()).then(settings=>{
 if(settings.passkeys_enabled===false){$("passkeyLogin").disabled=true;$("passkeyLogin").textContent="Passkeys · activation pending";$("authMessage").textContent="Passkeys are not yet enabled. For now, sign in with a secure email link.";}
}).catch(()=>{});
start().catch(e=>{$("authMessage").textContent="Could not initialise sign-in: "+e.message});
