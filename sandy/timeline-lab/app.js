import {seed,clone,ms,iso,dateText,HOUR,DAY,SNAP,byId,duration,topo,requiredStart,move,link,unlink,completion,reorder,criticalPath,addTask,setFields,visibleTasks,record,validateAll} from "./engine.js";
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const KEY="sandy.timeline.lab.v1";
let state;try{state=JSON.parse(localStorage.getItem(KEY))}catch{}if(!state?.tasks?.length)state=seed();
let scenario=null,scenarioBase=null,view="timeline",selected=null,collapsed=new Set(),search="",owner="",zoom=2,showCritical=true,showBaseline=false,showEvents=false;
let undo=[],redo=[],dragId=null,activeLink=null,scrollPosition=null,toastTimer=null,dragging=false;
const ZOOMS=[{name:"Hours",px:48,tick:4},{name:"Day",px:13,tick:12},{name:"Week",px:4.7,tick:24},{name:"Month",px:2.0,tick:24},{name:"Quarter",px:.85,tick:24*7}];
const active=()=>scenario||state;
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){console.warn("Browser storage unavailable",e)}};
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function notice(text,error=false){const e=$("#toast");e.textContent=text;e.className="toast"+(error?" error":"");clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.classList.add("hidden"),4700)}
function commit(fn){
 const before=clone(active());
 try{
  const next=fn(before);if(!next)throw Error("No change to save");
  if(scenario)scenario=next;else state=next;
  undo.push(before);if(undo.length>60)undo.shift();redo=[];save();render();return true;
 }catch(e){notice(e.message,true);render();return false}
}
function undoChange(){if(!undo.length)return;redo.push(clone(active()));const v=undo.pop();if(scenario)scenario=v;else state=v;save();render();notice("Undone")}
function redoChange(){if(!redo.length)return;undo.push(clone(active()));const v=redo.pop();if(scenario)scenario=v;else state=v;save();render();notice("Redone")}
function init(){
 $$(".rail-link").forEach(b=>b.onclick=()=>{view=b.dataset.view;setView();render()});
 $("#undo").onclick=undoChange;$("#redo").onclick=redoChange;
 $("#reset").onclick=()=>{showConfirm("Reset all lab data?","Your browser's demo changes and scenarios will be lost.",()=>{state=seed();scenario=null;undo=[];redo=[];save();render();notice("Demo data reset")})};
 $("#newTask").onclick=()=>newTask();
 $("#quick").onkeydown=e=>{if(e.key==="Enter"&&e.target.value.trim()){const name=e.target.value.trim();e.target.value="";commit(s=>addTask(s,name))}};
 $("#search").oninput=e=>{search=e.target.value;renderView()};
 $("#ownerFilter").onchange=e=>{owner=e.target.value;renderView()};
 $("#critical").onchange=e=>{showCritical=e.target.checked;renderView()};
 $("#baseline").onchange=e=>{showBaseline=e.target.checked;renderView()};
 $("#events").onchange=e=>{showEvents=e.target.checked;renderView()};
 $("#zoomIn").onclick=()=>{zoom=Math.max(0,zoom-1);renderView()};
 $("#zoomOut").onclick=()=>{zoom=Math.min(ZOOMS.length-1,zoom+1);renderView()};
 $("#today").onclick=()=>{renderView();const sc=$(".timeline-scroll");if(sc)sc.scrollLeft=Math.max(0,(Date.now()-Number(sc.dataset.origin))/HOUR*ZOOMS[zoom].px-350)};
 $("#template").onclick=()=>templateMenu();
 $("#addLink").onclick=()=>linkDialog();
 $("#export").onclick=()=>exportMenu();
 $("#askForm").onsubmit=e=>{e.preventDefault();askDemo($("#askInput").value);$("#askInput").value=""};
 document.addEventListener("keydown",e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="z"){e.preventDefault();e.shiftKey?redoChange():undoChange()}if(e.key==="Escape"){hideMenu();closeDetail();activeLink=null}});
 document.addEventListener("pointerdown",e=>{if(!e.target.closest("#menu,#popover"))hideMenu()});
 setView();render();
}
function setView(){
 $$(".rail-link").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
 const titles={timeline:"Timeline",outline:"Task outline",network:"Dependencies",calendar:"Calendar",workload:"Workload",activity:"Activity history",scenarios:"Scenario planning"};
 const subtitles={timeline:"Move, nest and connect tasks with minute-accurate scheduling.",outline:"Fast editing, nesting, completion and reordering.",network:"Inspect prerequisites, critical path and blocked work.",calendar:"Review example calendar events alongside tasks.",workload:"Capacity, assignments and simulated Mission states.",activity:"Auditable history of changes to demo data.",scenarios:"Try alternatives without changing the baseline."};
 $("#viewTitle").textContent=titles[view];$("#viewSubtitle").textContent=subtitles[view];
}
function metrics(){
 const s=active(),tasks=s.tasks.filter(t=>!s.tasks.some(c=>c.parent===t.id)||duration(t)>0),done=tasks.filter(t=>t.status==="completed").length,critical=criticalPath(s).ids;
 $("#metrics").innerHTML=[
 ["Tasks complete",done+" / "+tasks.length,Math.round(done/Math.max(1,tasks.length)*100)+"%"],
 ["Critical path",critical.length+" tasks","Longest dependency sequence"],
 ["Waiting / blocked",tasks.filter(t=>t.status==="waiting"||t.status==="blocked").length,"Attention required"],
 ["Sandy missions",tasks.filter(t=>t.mission&&t.mission!=="none").length,"Simulated execution states"]
 ].map(([name,value,sub])=>'<div class="metric"><label>'+name+'</label><strong>'+esc(value)+'</strong><small>'+esc(sub)+'</small></div>').join("");
 $("#undo").disabled=!undo.length;$("#redo").disabled=!redo.length;
 const owners=[...new Set(s.tasks.map(t=>t.owner))];let select=$("#ownerFilter"),prev=select.value;select.innerHTML='<option value="">Everyone</option>'+owners.map(o=>'<option value="'+esc(o)+'">'+esc(o)+'</option>').join("");select.value=prev||owner;
 $("#zoomLabel").textContent=ZOOMS[zoom].name;
}
function render(){metrics();renderView();if(selected&&$("#detail").classList.contains("hidden")===false)openDetail(selected)}
function renderView(){const v=$("#view");if(view==="timeline")renderTimeline();else if(view==="outline")renderOutline();else if(view==="network")renderNetwork();else if(view==="calendar")renderCalendar();else if(view==="workload")renderWorkload();else if(view==="activity")renderHistory();else renderScenarios()}
function filteredRows(){
 let rows=visibleTasks(active(),collapsed,search);
 if(owner)rows=rows.filter(x=>x.task.owner===owner);
 return rows;
}
function timeBounds(s){
 const vals=s.tasks.flatMap(t=>[ms(t.start),ms(t.end)]).filter(Number.isFinite),min=Math.min(...vals,Date.now()),max=Math.max(...vals,Date.now());
 const origin=Math.floor((min-DAY*2)/DAY)*DAY;
 const hours=Math.max(14*24,Math.ceil((max-origin+4*DAY)/HOUR));
 return {origin,hours};
}
function renderTimeline(){
 const root=$("#view"),s=active(),rows=filteredRows(),{origin,hours}=timeBounds(s),scale=ZOOMS[zoom].px,trackWidth=Math.min(90000,Math.max(1250,hours*scale));
 const fullWidth=310+trackWidth,totalH=rows.length*54,critical=new Set(showCritical?criticalPath(s).ids:[]);
 const scrollLeft=$(".timeline-scroll")?.scrollLeft??scrollPosition?.left??0,scrollTop=$(".timeline-scroll")?.scrollTop??scrollPosition?.top??0;
 root.innerHTML='<div class="timeline-scroll" data-origin="'+origin+'"><div class="timeline-canvas" style="width:'+fullWidth+'px"><div class="time-head"><div class="sticky-name">PROJECT / TASK</div><div class="ticks" id="ticks" style="width:'+trackWidth+'px"></div></div><div class="time-body" style="height:'+Math.max(54,totalH)+'px"><div id="rows"></div><svg id="links" class="line-overlay" width="'+fullWidth+'" height="'+Math.max(54,totalH)+'" viewBox="0 0 '+fullWidth+' '+Math.max(54,totalH)+'" aria-label="Dependency links"></svg></div></div></div>';
 const sc=$(".timeline-scroll");sc.scrollLeft=scrollLeft;sc.scrollTop=scrollTop;sc.onscroll=()=>{scrollPosition={left:sc.scrollLeft,top:sc.scrollTop}};
 const ticks=$("#ticks"),tickHours=ZOOMS[zoom].tick;for(let h=0;h<hours;h+=tickHours){const ts=origin+h*HOUR;const tick=document.createElement("div");tick.className="tick";tick.style.width=(tickHours*scale)+"px";tick.textContent=new Intl.DateTimeFormat(undefined,tickHours<24?{weekday:"short",hour:"numeric"}:{month:"short",day:"numeric"}).format(new Date(ts));ticks.append(tick)}
 const layer=$("#rows");
 const x=t=>((ms(t)-origin)/HOUR)*scale;
 for(const [i,{task:t,depth}] of rows.entries()){
  const row=document.createElement("div");row.className="time-row";row.dataset.id=t.id;row.style.width=fullWidth+"px";row.style.height="54px";
  const hasChildren=s.tasks.some(c=>c.parent===t.id);
  row.innerHTML='<div class="task-name" style="padding-left:'+(8+depth*17)+'px"><button class="task-toggle" aria-label="'+(collapsed.has(t.id)?"Expand":"Collapse")+'" '+(hasChildren?"":"disabled")+">"+(hasChildren?(collapsed.has(t.id)?"▸":"▾"):"·")+'</button><input class="task-checkbox" type="checkbox" aria-label="Complete '+esc(t.name)+'" '+(t.status==="completed"?"checked":"")+'><button class="task-text '+(t.status==="completed"?"done":"")+'" title="Edit task">'+esc(t.name)+'</button><span class="task-mini">'+(t.mission&&t.mission!=="none"?"✳":"")+'</span><span class="task-grip" draggable="true" title="Drag to reorder or nest task" aria-label="Drag task">⠿</span></div><div class="time-track" style="width:'+trackWidth+'px;--stripe:'+(24*scale)+'px"></div>';
  layer.append(row);
  row.querySelector(".task-toggle").onclick=()=>{collapsed.has(t.id)?collapsed.delete(t.id):collapsed.add(t.id);renderView()};
  row.querySelector(".task-checkbox").onchange=()=>commit(a=>completion(a,t.id));
  row.querySelector(".task-text").onclick=()=>openDetail(t.id);
  installReorder(row,t);
  const track=row.querySelector(".time-track");const left=x(t.start),w=Math.max(0,x(t.end)-left),milestone=duration(t)===0;
  if(showEvents)for(const ev of s.events){const b=document.createElement("div");b.className="event-band";b.style.left=x(ev.at)+"px";b.style.width=Math.max(4,ev.duration/60*scale)+"px";b.title=ev.name+" · "+dateText(ev.at);track.append(b)}
  if(showBaseline){const bl=s.baseline?.[t.id];if(bl){const b=document.createElement("div");b.className="baseline-bar";b.style.left=x(bl.start)+"px";b.style.width=Math.max(3,x(bl.end)-x(bl.start))+"px";track.append(b)}}
  if(Number.isFinite(left)&&left>=-20&&left<trackWidth+40){
   const bar=document.createElement("div");bar.className="bar "+(milestone?"milestone ":"")+(critical.has(t.id)?"critical ":"")+(t.status==="completed"?"completed ":"")+(t.status==="waiting"||t.status==="blocked"?"blocked":"");
   bar.style.left=left+"px";if(!milestone)bar.style.width=Math.max(3,w)+"px";
   bar.tabIndex=0;bar.setAttribute("role","button");bar.setAttribute("aria-label",esc(t.name)+" "+dateText(t.start)+" to "+dateText(t.end));
   bar.title=t.name+" · "+dateText(t.start)+" → "+dateText(t.end);
   if(t.progress>0&&t.status!=="completed"&&!milestone){bar.innerHTML='<div class="bar-progress" style="width:'+t.progress+'%"></div>'}
   if(!milestone){const a=document.createElement("span"),b=document.createElement("span");a.className="handle start";a.dataset.handle="start";b.className="handle finish";b.dataset.handle="finish";bar.append(a,b)}
   const c=document.createElement("span");c.className="handle link-handle";c.dataset.handle="link";c.title="Drag to another task to create a dependency";bar.append(c);
   c.addEventListener("pointerdown",e=>beginLinkDrag(e,t,row,origin,scale));
   bar.addEventListener("pointerdown",e=>beginBarDrag(e,t,bar,track,origin,scale));
   bar.addEventListener("keydown",e=>{if(e.key==="Enter")openDetail(t.id)});
   track.append(bar);
  }
 }
 const nowLine=document.createElement("div");nowLine.className="today-line";nowLine.style.left=(310+x(Date.now()))+"px";$("#links").before(nowLine);
 nowLine.style.height=totalH+"px";
 drawLinks(rows,origin,scale);
 if(!scrollPosition){sc.scrollLeft=Math.max(0,x(Date.now())-360)}
}
function installReorder(row,t){
 const grip=row.querySelector(".task-grip"),cell=row.querySelector(".task-name");
 grip.ondragstart=e=>{dragId=t.id;e.dataTransfer.setData("text/plain",t.id);e.dataTransfer.effectAllowed="move"};
 grip.ondragend=()=>{dragId=null;$$(".task-name").forEach(n=>n.classList.remove("drop-before","drop-after","drop-inside"))};
 const zone=e=>{const r=cell.getBoundingClientRect(),fraction=(e.clientY-r.top)/r.height;return fraction<.27?"before":fraction>.73?"after":"inside"};
 cell.ondragover=e=>{if(!dragId||dragId===t.id)return;e.preventDefault();cell.classList.remove("drop-before","drop-after","drop-inside");cell.classList.add("drop-"+zone(e))};
 cell.ondragleave=e=>{if(!cell.contains(e.relatedTarget))cell.classList.remove("drop-before","drop-after","drop-inside")};
 cell.ondrop=e=>{if(!dragId||dragId===t.id)return;e.preventDefault();const from=dragId,z=zone(e);dragId=null;commit(s=>reorder(s,from,t.id,z))}
}
function drawLinks(rows,origin,scale){
 const svg=$("#links"),visible=new Map(rows.map(({task},i)=>[task.id,i])),s=active();if(!svg)return;
 for(const dep of s.dependencies){
  const ai=visible.get(dep.from),bi=visible.get(dep.to);if(ai===undefined||bi===undefined)continue;
  const a=byId(s,dep.from),b=byId(s,dep.to);
  const sx=310+(ms(a.end)-origin)/HOUR*scale,ex=310+(ms(b.start)-origin)/HOUR*scale,sy=ai*54+27,ey=bi*54+27;
  const near=Math.abs(sx-ex)<.75;
  const bend=sx+Math.min(29,Math.max(12,(ex-sx)/2));
  const d=near?"M"+sx+" "+sy+" V"+ey:"M"+sx+" "+sy+" H"+bend+" V"+ey+" H"+ex;
  const path=document.createElementNS("http://www.w3.org/2000/svg","path");path.setAttribute("d",d);path.setAttribute("class","dependency-route");svg.append(path);
  const tip=document.createElementNS("http://www.w3.org/2000/svg","title");tip.textContent=a.name+" → "+b.name+" ("+dep.type+", "+(dep.lag||0)+" minute lag)";path.append(tip);
  const hit=document.createElementNS("http://www.w3.org/2000/svg","path");hit.setAttribute("d",d);hit.setAttribute("fill","none");hit.setAttribute("stroke","transparent");hit.setAttribute("stroke-width","15");hit.setAttribute("class","dependency-hit");hit.setAttribute("tabindex","0");hit.setAttribute("role","button");hit.setAttribute("aria-label",tip.textContent);svg.append(hit);
  const edit=e=>{e.preventDefault();e.stopPropagation();showDependencyMenu(dep,e.clientX||innerWidth/2,e.clientY||innerHeight/2)};
  hit.addEventListener("contextmenu",edit);hit.addEventListener("click",edit);
  hit.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){edit(e)}});
 }
}
function setBubble(label,x,y){
 const b=$("#dragBubble");b.textContent=label;b.classList.remove("hidden");const half=Math.min(230,Math.max(68,b.offsetWidth/2));b.style.left=Math.max(half+9,Math.min(innerWidth-half-9,x))+"px";b.style.top=Math.max(8,y-49)+"px";
}
function hideBubble(){$("#dragBubble").classList.add("hidden")}
function beginBarDrag(e,t,bar,track,origin,scale){
 if(e.button!==0||e.target.closest(".link-handle"))return;
 const mode=duration(t)===0?"move":e.target.dataset.handle||"move",id=e.pointerId,startX=e.clientX,startY=e.clientY,start=ms(t.start),end=ms(t.end);
 const preview=ev=>{
  const diff=Math.round(((ev.clientX-startX)/scale*HOUR)/SNAP)*SNAP;
  let a=start,b=end;
  if(mode==="start")a=Math.min(end,start+diff);
  else if(mode==="finish")b=Math.max(start,end+diff);
  else{a=start+diff;b=end+diff}
  const left=(a-origin)/HOUR*scale;bar.style.left=left+"px";if(duration(t)!==0)bar.style.width=Math.max(3,(b-a)/HOUR*scale)+"px";
  const edge=bar.getBoundingClientRect();
  const shown=mode==="start"?"START  "+dateText(a):mode==="finish"?"FINISH  "+dateText(b):dateText(a)+"  →  "+dateText(b);
  setBubble(shown,mode==="start"?edge.left:mode==="finish"?edge.right:ev.clientX,edge.top);
  return {a,b,diff};
 };
 dragging=true;bar.classList.add("is-dragging");preview(e);
 const onMove=ev=>{if(ev.pointerId===id)preview(ev)};
 const cleanup=()=>{document.removeEventListener("pointermove",onMove,true);document.removeEventListener("pointerup",onUp,true);document.removeEventListener("pointercancel",onCancel,true);bar.classList.remove("is-dragging");dragging=false;hideBubble()};
 const onCancel=ev=>{if(ev.pointerId!==id)return;cleanup();renderView()};
 const onUp=ev=>{if(ev.pointerId!==id)return;const p=preview(ev);cleanup();if(Math.abs(ev.clientX-startX)<4){openDetail(t.id);return}commit(s=>move(s,t.id,p.a,p.b,mode))};
 document.addEventListener("pointermove",onMove,true);document.addEventListener("pointerup",onUp,true);document.addEventListener("pointercancel",onCancel,true);
 e.preventDefault();e.stopPropagation();
}
function beginLinkDrag(e,source,row,origin,scale){
 if(e.button!==0)return;e.stopPropagation();e.preventDefault();
 const id=e.pointerId;
 const move=ev=>{if(ev.pointerId===id)setBubble("Link from "+source.name+" — release on target",ev.clientX,ev.clientY-4)};
 const end=ev=>{if(ev.pointerId!==id)return;cleanup();const target= document.elementFromPoint(ev.clientX,ev.clientY)?.closest(".time-row");if(!target||target.dataset.id===source.id)return;const to=target.dataset.id;showLinkConfirm(source.id,to,ev.clientX,ev.clientY)};
 const cancel=()=>cleanup();
 const cleanup=()=>{document.removeEventListener("pointermove",move,true);document.removeEventListener("pointerup",end,true);document.removeEventListener("pointercancel",cancel,true);hideBubble()};
 move(e);document.addEventListener("pointermove",move,true);document.addEventListener("pointerup",end,true);document.addEventListener("pointercancel",cancel,true)
}
function hideMenu(){$("#menu").classList.add("hidden");$("#popover").classList.add("hidden")}
function menuAt(element,x,y){element.classList.remove("hidden");const r=element.getBoundingClientRect();element.style.left=Math.max(8,Math.min(innerWidth-r.width-8,x))+"px";element.style.top=Math.max(8,Math.min(innerHeight-r.height-8,y))+"px"}
function showConfirm(title,text,yes,x=innerWidth/2,y=innerHeight/3){
 const box=$("#popover");box.innerHTML='<h3>'+esc(title)+'</h3><div class="muted">'+esc(text)+'</div><div class="actions"><button data-a="cancel">Cancel</button><button class="primary" data-a="yes">Confirm</button></div>';
 menuAt(box,x,y);box.querySelector('[data-a="cancel"]').onclick=hideMenu;box.querySelector('[data-a="yes"]').onclick=()=>{hideMenu();yes()};
}
function showLinkConfirm(from,to,x,y){const a=byId(active(),from),b=byId(active(),to);if(!a||!b)return;showConfirm("Create dependency?",b.name+" starts as "+a.name+" finishes. Its duration stays unchanged.",()=>commit(s=>link(s,from,to)),x,y)}
function showDependencyMenu(dep,x,y){
 const s=active(),a=byId(s,dep.from),b=byId(s,dep.to),menu=$("#menu");if(!a||!b)return;
 menu.innerHTML='<div class="muted" style="padding:6px 10px">'+esc(a.name)+' → '+esc(b.name)+'</div><button id="editDep">Edit relationship</button><button id="removeDep" class="danger">Remove dependency</button>';
 menuAt(menu,x,y);
 $("#editDep").onclick=()=>{hideMenu();editDependency(dep,x,y)};
 $("#removeDep").onclick=()=>{hideMenu();showConfirm("Remove dependency?",a.name+" → "+b.name+" · Task dates will not be changed.",()=>commit(s=>unlink(s,dep.id)),x,y)};
}
function editDependency(dep,x,y){
 const pop=$("#popover");pop.innerHTML='<h3>Edit dependency</h3><div class="muted">'+esc(byId(active(),dep.from)?.name)+" → "+esc(byId(active(),dep.to)?.name)+'</div><label>Relationship</label><select id="depType"><option>FS</option><option>SS</option><option>FF</option><option>SF</option></select><label>Lag / lead (minutes)</label><input type="number" step="15" id="depLag"><div class="actions"><button id="cancelDep">Cancel</button><button id="saveDep" class="primary">Save</button></div>';
 menuAt(pop,x,y);$("#depType").value=dep.type;$("#depLag").value=dep.lag||0;$("#cancelDep").onclick=hideMenu;
 $("#saveDep").onclick=()=>{const type=$("#depType").value,lag=Number($("#depLag").value);hideMenu();commit(s=>{const next=unlink(s,dep.id);return link(next,dep.from,dep.to,type,lag)})};
}
function linkDialog(){
 const tasks=active().tasks,options=tasks.map(t=>'<option value="'+t.id+'">'+esc(t.name)+'</option>').join("");
 const pop=$("#popover");pop.innerHTML='<h3>Add a dependency</h3><label>Predecessor</label><select id="fromLink">'+options+'</select><label>Successor</label><select id="toLink">'+options+'</select><label>Relationship</label><select id="typeLink"><option value="FS">Finish → Start</option><option value="SS">Start → Start</option><option value="FF">Finish → Finish</option><option value="SF">Start → Finish</option></select><label>Lag / lead (minutes)</label><input id="lagLink" type="number" value="0" step="15"><div class="actions"><button id="cancelLink">Cancel</button><button id="saveLink" class="primary">Link tasks</button></div>';
 menuAt(pop,innerWidth/2-140,170);$("#cancelLink").onclick=hideMenu;
 $("#toLink").selectedIndex=1;
 $("#saveLink").onclick=()=>{const from=$("#fromLink").value,to=$("#toLink").value,type=$("#typeLink").value,lag=Number($("#lagLink").value);hideMenu();commit(s=>link(s,from,to,type,lag))}
}
function closeDetail(){selected=null;$("#detail").classList.add("hidden")}
function openDetail(id){
 const s=active(),t=byId(s,id);if(!t){closeDetail();return}selected=id;const detail=$("#detail");detail.classList.remove("hidden");
 const opts=(arr,val)=>arr.map(v=>'<option value="'+esc(v)+'" '+(v===val?"selected":"")+'>'+esc(v)+'</option>').join("");
 const deps=s.dependencies.filter(d=>d.to===id).map(d=>'<span class="chip">'+esc(byId(s,d.from)?.name)+" "+d.type+'</span>').join("")||'<span class="muted">None</span>';
 detail.innerHTML='<div class="detail-actions"><button id="closeDetail">← Back</button><button id="completeDetail">'+(t.status==="completed"?"Reopen task":"✓ Complete now")+'</button><button id="deleteTask" class="light">Delete</button></div><h3>'+esc(t.name)+'</h3><div class="row2"><div><label>Task name</label><input id="taskName" value="'+esc(t.name)+'"></div><div><label>Owner</label><select id="taskOwner">'+opts(["You","Sandy","Jemma","External"],t.owner)+'</select></div></div><div class="row2"><div><label>Start date/time</label><input type="datetime-local" id="taskStart"></div><div><label>Finish date/time</label><input type="datetime-local" id="taskEnd"></div></div><div class="row2"><div><label>Priority</label><select id="taskPriority">'+opts(["low","normal","high","urgent"],t.priority)+'</select></div><div><label>Status</label><select id="taskStatus">'+opts(["todo","in_progress","waiting","blocked","completed"],t.status)+'</select></div></div><label>Must finish by (optional)</label><input type="datetime-local" id="taskConstraint"><label>Description / notes</label><textarea id="taskDescription">'+esc(t.description||"")+'</textarea><div class="section-title">Dependencies</div>'+deps+'<div class="section-title">Mission execution (simulated)</div><select id="missionStatus">'+opts(["none","queued","working","awaiting","completed"],t.mission||"none")+'</select><label>Progress (%)</label><input id="taskProgress" type="number" min="0" max="100" value="'+(t.progress||0)+'"><div class="section-title">Evidence / references (demo)</div><input id="taskEvidence" type="text" placeholder="Paste reference or filename"><div class="muted">'+(t.evidence||[]).map(x=>esc(x)).join(" · ")+'</div><div class="section-title">Comments</div><div class="muted">'+(t.comments||[]).map(c=>'<p>• '+esc(c)+'</p>').join("")+'</div><input id="taskComment" placeholder="Add a comment"><div class="detail-actions" style="margin-top:18px"><button class="primary" id="saveDetail">Save task</button><button id="addChild">+ Subtask</button></div>';
 $("#closeDetail").onclick=closeDetail;
 const localTime=x=>{const d=new Date(x),n=new Date(d.getTime()-d.getTimezoneOffset()*60000);return n.toISOString().slice(0,16)};
 const asUTC=x=>new Date(x).toISOString();
 $("#taskStart").value=localTime(t.start);$("#taskEnd").value=localTime(t.end);$("#taskConstraint").value=t.constraint?localTime(t.constraint):"";
 $("#completeDetail").onclick=()=>{commit(a=>completion(a,id));openDetail(id)};
 $("#deleteTask").onclick=()=>showConfirm("Delete this test task?",t.name+" and its dependencies will be removed from the demo.",()=>{commit(a=>{const next=clone(a);next.tasks=next.tasks.filter(x=>x.id!==id);next.dependencies=next.dependencies.filter(x=>x.from!==id&&x.to!==id);next.tasks.filter(x=>x.parent===id).forEach(x=>x.parent=t.parent);record(next,"Deleted · "+t.name);return next});closeDetail()})};
 $("#addChild").onclick=()=>{const name=prompt("Subtask name");if(name?.trim())commit(a=>addTask(a,name.trim(),id))};
 $("#saveDetail").onclick=()=>{
  const name=$("#taskName").value.trim(),start=$("#taskStart").value,end=$("#taskEnd").value,status=$("#taskStatus").value;
  if(!name||!start||!end)return notice("Provide a name and both schedule times",true);
  const fields={name,owner:$("#taskOwner").value,priority:$("#taskPriority").value,status,description:$("#taskDescription").value,mission:$("#missionStatus").value,progress:Math.max(0,Math.min(100,Number($("#taskProgress").value)||0)),constraint:$("#taskConstraint").value?asUTC($("#taskConstraint").value):"",comments:[...(t.comments||[]),...($("#taskComment").value.trim()?[$("#taskComment").value.trim()]:[])],evidence:[...(t.evidence||[]),...($("#taskEvidence").value.trim()?[$("#taskEvidence").value.trim()]:[])]};
  const ok=commit(a=>{let n=setFields(a,id,{...fields,status:t.status});n=move(n,id,ms(asUTC(start)),ms(asUTC(end)),"edit");if(status==="completed"&&t.status!=="completed")n=completion(n,id);else if(status!=="completed")n=setFields(n,id,{status});return n});
  if(ok)openDetail(id);
 }
}
function newTask(parent=null){
 const name=prompt(parent?"Subtask title":"Task title");
 if(name?.trim())commit(s=>addTask(s,name.trim(),parent))
}
function templateMenu(){showConfirm("Create example project template?","Add a three-step project with two finish-to-start dependencies.",()=>commit(s=>{let n=addTask(s,"Template project");const p=n.tasks.at(-1).id;n=addTask(n,"Plan",p);const a=n.tasks.at(-1).id;n=addTask(n,"Execute",p);const b=n.tasks.at(-1).id;n=addTask(n,"Review",p);const c=n.tasks.at(-1).id;return link(link(n,a,b),b,c)}))}
function exportMenu(){
 const menu=$("#menu");menu.innerHTML='<button id="exportJson">Export demo JSON</button><button id="exportCsv">Export tasks CSV</button><button id="printTimeline">Print / Save PDF</button>';menuAt(menu,innerWidth-265,79);
 $("#exportJson").onclick=()=>{hideMenu();download("sandy-timeline-lab.json",JSON.stringify(active(),null,2),"application/json")};
 $("#exportCsv").onclick=()=>{hideMenu();const fields=["id","name","parent","start","end","status","owner","priority"];const data=[fields.join(","),...active().tasks.map(t=>fields.map(f=>'"'+String(t[f]??"").replaceAll('"','""')+'"').join(","))].join("\n");download("sandy-timeline-lab.csv",data,"text/csv")};
 $("#printTimeline").onclick=()=>{hideMenu();window.print()};
}
function download(name,content,type){const a=document.createElement("a"),url=URL.createObjectURL(new Blob([content],{type}));a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000)}
function askDemo(q){
 q=q.trim();if(!q)return;
 if(/critical path/i.test(q)){const path=criticalPath(active());return notice("Critical path: "+path.ids.map(id=>byId(active(),id)?.name).join(" → "))}
 if(/blocked|waiting/i.test(q))return notice("Waiting: "+active().tasks.filter(t=>["blocked","waiting"].includes(t.status)).map(t=>t.name).join(", ")||"No waiting tasks");
 const m=q.match(/delay\s+(.+?)\s+by\s+(\d+)\s+days?/i);
 if(m){const t=active().tasks.find(t=>t.name.toLowerCase()===m[1].toLowerCase());if(!t)return notice("Task not found",true);return commit(s=>move(s,t.id,ms(t.start)+Number(m[2])*DAY,ms(t.end)+Number(m[2])*DAY,"demo command"))}
 notice("Demo parser supports: critical path, what's blocked, delay [exact task name] by [n] days. Real Sandy AI integration is not enabled.",true)
}
function renderOutline(){
 const s=active(),rows=filteredRows();$("#view").innerHTML='<div class="panel-view"><div class="muted">Outline and Timeline share the same demo task records. Drag a task by its grip in the Timeline to nest/reorder.</div><div id="outlineList"></div></div>';
 const root=$("#outlineList");for(const {task:t,depth}of rows){const r=document.createElement("div");r.className="table-row";r.style.paddingLeft=(15+depth*22)+"px";r.innerHTML='<span><input type="checkbox" '+(t.status==="completed"?"checked":"")+' aria-label="Complete '+esc(t.name)+'"> <b>'+esc(t.name)+'</b> <small>'+dateText(t.start)+' → '+dateText(t.end)+'</small></span><button>Details</button>';r.querySelector("input").onchange=()=>commit(a=>completion(a,t.id));r.querySelector("button").onclick=()=>openDetail(t.id);root.append(r)}}
function renderNetwork(){
 const s=active(),order=topo(s),cp=new Set(criticalPath(s).ids),layers=new Map();
 for(const id of order){const parents=s.dependencies.filter(d=>d.to===id);layers.set(id,Math.max(0,...parents.map(d=>(layers.get(d.from)||0)+1)))}
 const columns=[...new Set(layers.values())].sort((a,b)=>a-b);
 $("#view").innerHTML='<div class="panel-view"><p class="muted">Directed dependency network. Select a task to inspect details, or edit links in Timeline.</p><div style="display:flex;gap:13px;overflow:auto" id="networkCols"></div></div>';
 const root=$("#networkCols");for(const c of columns){const el=document.createElement("div");el.style.cssText="width:225px;flex:none";el.innerHTML='<div class="section-title">Stage '+(c+1)+'</div>';for(const [id,level]of layers)if(level===c){const t=byId(s,id),n=document.createElement("div");n.className="network-card "+(cp.has(id)?"critical":"");n.style.marginBottom="9px";n.innerHTML='<b>'+esc(t.name)+'</b><div class="muted">'+dateText(t.start)+' → '+dateText(t.end)+'</div><small>'+s.dependencies.filter(d=>d.to===id).map(d=>esc(byId(s,d.from)?.name)+" "+d.type).join(" · ")+'</small>';n.onclick=()=>openDetail(id);el.append(n)}root.append(el)}}
function renderCalendar(){
 const s=active(),today=new Date();today.setHours(0,0,0,0);const monday=new Date(today);monday.setDate(today.getDate()-((today.getDay()+6)%7));
 $("#view").innerHTML='<div class="panel-view"><p class="muted">Example calendar overlay. Events and task dates are demo records, not your connected calendar.</p><div class="calendar-grid" id="calendarGrid"></div></div>';
 for(let i=0;i<14;i++){const when=monday.getTime()+i*DAY,cell=document.createElement("div");cell.className="day-cell"+(i===(today.getDay()+6)%7?" today":"");cell.innerHTML='<b>'+new Date(when).toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"})+'</b>';
  for(const ev of s.events.filter(x=>Math.abs(ms(x.at)-when)<DAY&&new Date(x.at).getDate()===new Date(when).getDate()))cell.innerHTML+='<div class="day-item" style="background:#f9f0df">'+esc(ev.name)+'</div>';
  for(const t of s.tasks.filter(x=>Math.floor(ms(x.start)/DAY)===Math.floor(when/DAY))){const b=document.createElement("div");b.className="day-item";b.textContent=t.name;b.onclick=()=>openDetail(t.id);cell.append(b)}$("#calendarGrid").append(cell)}}
function renderWorkload(){
 const s=active(),owners=[...new Set(s.tasks.map(t=>t.owner))],total=Math.max(1,...owners.map(o=>s.tasks.filter(t=>t.owner===o).reduce((h,t)=>h+duration(t)/HOUR,0)));
 $("#view").innerHTML='<div class="panel-view"><p class="muted">Illustrative workload by scheduled elapsed hours; availability and calendars are not yet connected.</p><div class="card-grid" id="workloadCards"></div></div>';
 for(const o of owners){const list=s.tasks.filter(t=>t.owner===o),h=list.reduce((v,t)=>v+duration(t)/HOUR,0),card=document.createElement("div");card.className="info-card";card.innerHTML='<h3>'+esc(o)+'</h3><b>'+h.toFixed(1)+' scheduled hours</b><div class="progress-track"><div class="progress-fill" style="width:'+Math.round(h/total*100)+'%"></div></div><p>'+list.length+' tasks</p>'+list.filter(t=>t.mission&&t.mission!=="none").map(t=>'<p>✳ '+esc(t.name)+' <span class="status-pill">'+esc(t.mission)+'</span></p>').join("");$("#workloadCards").append(card)}}
function renderHistory(){$("#view").innerHTML='<div class="panel-view"><p class="muted">Changes made in this demo browser are recorded locally.</p>'+active().history.map(h=>'<div class="table-row"><span>'+esc(h.message)+'</span><small>'+dateText(h.at)+'</small></div>').join("")+'</div>'}
function renderScenarios(){
 const root=$("#view");root.innerHTML='<div class="panel-view"><div class="info-card"><h3>'+ (scenario?"Working in a scenario":"Try a what-if schedule")+'</h3><p>'+ (scenario?"Edits are isolated until you explicitly apply them.":"Create a separate version of this demo project and try moving dependencies or dates without affecting the main demo schedule.")+'</p><div class="group"><button class="primary" id="scenarioStart">'+(scenario?"Discard scenario":"Create scenario")+'</button><button id="scenarioApply" '+(!scenario?"disabled":"")+'>Apply scenario to demo plan</button><button id="scenarioTimeline" '+(!scenario?"disabled":"")+'>View scenario timeline</button></div></div>'+(scenario?'<p style="margin-top:18px">Scenario is active · '+(scenario.version-state.version)+' changes since the main plan.</p>':'')+'</div>';
 $("#scenarioStart").onclick=()=>{if(scenario){scenario=null;scenarioBase=null;undo=[];redo=[];notice("Scenario discarded")}else{scenario=clone(state);scenarioBase=clone(state);undo=[];redo=[];notice("Scenario created — edits are now isolated")}render()};
 $("#scenarioApply").onclick=()=>showConfirm("Apply scenario to demo plan?","Replace the current local demo schedule. This does not affect Sandy's live data.",()=>{if(!scenario)return;state=clone(scenario);scenario=null;undo=[];redo=[];save();render();notice("Scenario applied")});
 $("#scenarioTimeline").onclick=()=>{view="timeline";setView();render()};
}
init();