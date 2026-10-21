// Timeline Lab scheduling engine. Demo-only: no Sandy production database access.
export const HOUR=3600000, DAY=24*HOUR, SNAP=15*60000;
export const clone=x=>structuredClone(x);
export const ms=x=>typeof x==="number"?x:Date.parse(x);
export const iso=x=>new Date(x).toISOString();
export const dateText=x=>new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(x));
const day=(base,n,h=9)=>iso(base+n*DAY+(h-9)*HOUR);
export function seed(){
 const d=new Date();d.setHours(9,0,0,0);const b=d.getTime();
 const t=(id,name,at,length,extra={})=>({id,name,start:day(b,at),end:day(b,at)+length*HOUR*0 /* replaced below */,order:at, parent:null,status:"todo",priority:"normal",owner:"You",description:"",constraint:"",mission:"",comments:[],evidence:[],...extra});
 function item(id,name,offset,duration,extra={}){return {...t(id,name,offset,0,extra),end:iso(ms(day(b,offset))+duration*HOUR),baselineStart:day(b,offset),baselineEnd:iso(ms(day(b,offset))+duration*HOUR)}}
 const tasks=[
 item("A","Project kickoff",0,0,{priority:"high",owner:"You",order:100}),
 item("B","Collect supporting documents",0,28,{parent:"A",order:100,owner:"You"}),
 item("C","Prepare information pack",2,32,{parent:"A",order:200,owner:"Sandy",mission:"working",progress:65}),
 item("D","Review pack",4,16,{parent:"A",order:300,owner:"Jemma",priority:"high"}),
 item("E","External approval",5,0,{parent:"A",order:400,status:"waiting",owner:"External",constraint:"",description:"Awaiting third-party decision"}),
 item("F","Submit final package",6,24,{parent:"A",order:500,priority:"urgent",owner:"Sandy",mission:"queued"}),
 item("G","Second project",0,0,{order:200,owner:"You"}),
 item("H","Prepare correspondence",1,16,{parent:"G",order:100,owner:"You"}),
 item("I","Schedule appointment",3,1,{parent:"G",order:200,owner:"Sandy",mission:"awaiting"}),
 item("J","Attend appointment",6,2,{parent:"G",order:300,owner:"You"}),
 item("K","Archive and follow up",7,12,{parent:"G",order:400,owner:"Sandy"}),
 item("L","Independent research",1,24,{order:300,owner:"Sandy",mission:"working",progress:30})
 ];
 const dependencies=[
 {id:"d1",from:"B",to:"C",type:"FS",lag:0},
 {id:"d2",from:"C",to:"D",type:"FS",lag:0},
 {id:"d3",from:"D",to:"E",type:"FS",lag:0},
 {id:"d4",from:"E",to:"F",type:"FS",lag:0},
 {id:"d5",from:"H",to:"I",type:"FS",lag:0},
 {id:"d6",from:"I",to:"J",type:"FS",lag:0},
 {id:"d7",from:"J",to:"K",type:"FS",lag:0}
 ];
 const base={tasks,dependencies,events:[
 {id:"ev1",name:"Project review",at:day(b,4,11),duration:60,owner:"You"},
 {id:"ev2",name:"Planning meeting",at:day(b,6,14),duration:45,owner:"Jemma"}
 ],history:[{at:iso(Date.now()),message:"Demo schedule loaded"}],version:1};
 // Demo baseline starts from a valid calculated schedule.
 for(const d of dependencies){try{align(base,d.to)}catch{}}
 base.baseline=Object.fromEntries(base.tasks.map(t=>[t.id,{start:t.start,end:t.end}]));
 return base;
}
export function byId(state,id){return state.tasks.find(t=>t.id===id)}
export function duration(t){return Math.max(0,ms(t.end)-ms(t.start))}
export function topo(state){
 const ids=new Set(state.tasks.map(t=>t.id)), indegree=new Map([...ids].map(id=>[id,0])), out=new Map([...ids].map(id=>[id,[]]));
 for(const d of state.dependencies){if(!ids.has(d.from)||!ids.has(d.to))continue;indegree.set(d.to,indegree.get(d.to)+1);out.get(d.from).push(d.to)}
 const queue=[...ids].filter(id=>indegree.get(id)===0),sorted=[];
 while(queue.length){const id=queue.shift();sorted.push(id);for(const to of out.get(id)){indegree.set(to,indegree.get(to)-1);if(indegree.get(to)===0)queue.push(to)}}
 if(sorted.length!==ids.size)throw Error("Circular dependencies are not allowed");
 return sorted;
}
export function requiredStart(state,id){
 const t=byId(state,id);if(!t)return null;
 const incoming=state.dependencies.filter(d=>d.to===id);if(!incoming.length)return null;
 let required=-Infinity,from=null;
 for(const d of incoming){
  const p=byId(state,d.from);if(!p)continue;
  const lag=(Number(d.lag)||0)*60000, dur=duration(t);
  const bound=d.type==="SS"?ms(p.start)+lag:d.type==="FF"?ms(p.end)+lag-dur:d.type==="SF"?ms(p.start)+lag-dur:ms(p.end)+lag;
  if(bound>required){required=bound;from=d.from}
 }
 return Number.isFinite(required)?{at:required,from}:null;
}
function validate(t){
 if(ms(t.end)<ms(t.start))throw Error("Finish cannot precede start");
 if(t.constraint&&ms(t.end)>ms(t.constraint))throw Error(t.name+" exceeds its fixed finish deadline");
}
export function align(state,id){
 const order=topo(state),affected=new Set([id]);
 for(const x of order){
  if(affected.has(x))for(const d of state.dependencies.filter(d=>d.from===x))affected.add(d.to);
 }
 for(const x of order){
  if(!affected.has(x))continue;
  const t=byId(state,x);if(!t||t.status==="completed"||t.status==="cancelled")continue;
  const req=requiredStart(state,x);if(!req)continue;
  const dur=duration(t);t.start=iso(req.at);t.end=iso(req.at+dur);validate(t);
 }
 return state;
}
export function cascade(state,id){
 const order=topo(state),affected=new Set([id]);
 for(const x of order){if(affected.has(x))for(const d of state.dependencies.filter(d=>d.from===x))affected.add(d.to)}
 for(const x of order){
  if(x===id||!affected.has(x))continue;
  const t=byId(state,x);if(!t||["completed","cancelled"].includes(t.status))continue;
  const req=requiredStart(state,x);if(!req)continue;
  const dur=duration(t);t.start=iso(req.at);t.end=iso(req.at+dur);validate(t);
 }
 return state;
}
export function move(state,id,newStart,newEnd,mode="move"){
 const next=clone(state),t=byId(next,id);if(!t)throw Error("Task not found");
 if(t.status==="completed")throw Error("Reopen completed tasks before rescheduling");
 const start=ms(newStart),end=ms(newEnd);if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)throw Error("Invalid start/finish");
 const req=requiredStart(next,id);if(req&&start<req.at-1000)throw Error("This task must not begin before "+byId(next,req.from).name+" satisfies its dependency");
 t.start=iso(start);t.end=iso(end);validate(t);
 cascade(next,id);record(next,mode+" · "+t.name);
 return next;
}
export function link(state,from,to,type="FS",lag=0){
 const next=clone(state);if(!byId(next,from)||!byId(next,to)||from===to)throw Error("Choose two different tasks");
 if(next.dependencies.some(d=>d.from===from&&d.to===to))throw Error("Dependency already exists");
 if(!["FS","SS","FF","SF"].includes(type))throw Error("Unsupported dependency type");
 if(!Number.isFinite(Number(lag)))throw Error("Invalid lag time");
 next.dependencies.push({id:"dep-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,6),from,to,type,lag:Number(lag)});
 topo(next);align(next,to);record(next,"Dependency added · "+byId(next,from).name+" → "+byId(next,to).name);
 return next;
}
export function unlink(state,id){
 const next=clone(state),old=next.dependencies.find(d=>d.id===id);
 next.dependencies=next.dependencies.filter(d=>d.id!==id);
 if(old)record(next,"Dependency removed");
 return next;
}
export function completion(state,id,when=Date.now()){
 const next=clone(state),t=byId(next,id);if(!t)throw Error("Task not found");
 if(t.status==="completed"){t.status="todo";t.completedAt=null;record(next,"Reopened · "+t.name);return next}
 const at=ms(when);t.status="completed";t.completedAt=iso(at);t.end=iso(at);
 if(ms(t.start)>at)t.start=iso(at);
 cascade(next,id);record(next,"Completed · "+t.name+" at "+dateText(at));
 return next;
}
export function reorder(state,id,targetId,zone){
 const next=clone(state),t=byId(next,id),target=byId(next,targetId);
 if(!t||!target||id===targetId)throw Error("Invalid task move");
 const parent=zone==="inside"?targetId:target.parent;
 let test=parent;
 while(test){if(test===id)throw Error("A task cannot contain itself");test=byId(next,test)?.parent}
 t.parent=parent;
 const peers=next.tasks.filter(x=>x.id!==id&&x.parent===parent).sort((a,b)=>a.order-b.order);
 const ix=zone==="inside"?peers.length:Math.max(0,peers.findIndex(x=>x.id===targetId)+(zone==="after"?1:0));
 peers.splice(ix,0,t);peers.forEach((x,j)=>x.order=(j+1)*100);
 record(next,"Reordered · "+t.name);
 return next;
}
export function criticalPath(state){
 const order=topo(state),distance=new Map(),previous=new Map();
 for(const id of order){
  const t=byId(state,id);if(!t)continue;
  let max=0,best=null;
  for(const d of state.dependencies.filter(d=>d.to===id)){const v=distance.get(d.from)||0;if(v>max){max=v;best=d.from}}
  distance.set(id,max+duration(t));previous.set(id,best);
 }
 let terminal=null,best=-Infinity;
 for(const [id,value] of distance)if(value>best){best=value;terminal=id}
 const path=[];while(terminal){path.unshift(terminal);terminal=previous.get(terminal)}
 return {ids:path,totalMs:best};
}
export function record(state,message){state.history.unshift({at:iso(Date.now()),message});state.history=state.history.slice(0,120);state.version=(state.version||0)+1}
export function addTask(state,name,parent=null,at=Date.now()){
 const next=clone(state),id="n"+Math.random().toString(36).slice(2,9),start=Math.round(at/SNAP)*SNAP;
 next.tasks.push({id,name,parent,start:iso(start),end:iso(start+HOUR),order:10000+next.tasks.length*100,status:"todo",priority:"normal",owner:"You",progress:0,description:"",mission:"",constraint:"",comments:[],evidence:[]});record(next,"Created · "+name);return next;
}
export function setFields(state,id,fields){const next=clone(state),t=byId(next,id);if(!t)throw Error("Task not found");Object.assign(t,fields);validate(t);record(next,"Updated · "+t.name);return next}
export function visibleTasks(state,collapsed=new Set(),search=""){
 const q=search.trim().toLowerCase(),out=[];
 function walk(parent,depth,seen=new Set()){
  for(const t of state.tasks.filter(x=>x.parent===parent).sort((a,b)=>a.order-b.order)){
   if(seen.has(t.id))continue;
   if(!q||t.name.toLowerCase().includes(q))out.push({task:t,depth});
   if(!collapsed.has(t.id))walk(t.id,depth+1,new Set([...seen,t.id]));
  }
 }
 walk(null,0);
 return out;
}
export function validateAll(state){
 topo(state);
 const issues=[];
 for(const d of state.dependencies){
  const t=byId(state,d.to),req=requiredStart(state,d.to);
  if(t&&req&&ms(t.start)<req.at-1000)issues.push(t.name+" violates a predecessor constraint");
 }
 return issues;
}
