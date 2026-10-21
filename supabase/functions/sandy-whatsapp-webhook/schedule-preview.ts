import {PNG} from "npm:pngjs@7.0.0";
const FONT:Record<string,string[]>={
"A":["01110","10001","10001","11111","10001","10001","10001"],"B":["11110","10001","11110","10001","10001","10001","11110"],"C":["01111","10000","10000","10000","10000","10000","01111"],"D":["11110","10001","10001","10001","10001","10001","11110"],"E":["11111","10000","11110","10000","10000","10000","11111"],"F":["11111","10000","11110","10000","10000","10000","10000"],"G":["01111","10000","10000","10111","10001","10001","01111"],"H":["10001","10001","11111","10001","10001","10001","10001"],"I":["11111","00100","00100","00100","00100","00100","11111"],"J":["00111","00010","00010","00010","10010","10010","01100"],"K":["10001","10010","11100","10010","10010","10001","10001"],"L":["10000","10000","10000","10000","10000","10000","11111"],"M":["10001","11011","10101","10101","10001","10001","10001"],"N":["10001","11001","10101","10011","10001","10001","10001"],"O":["01110","10001","10001","10001","10001","10001","01110"],"P":["11110","10001","10001","11110","10000","10000","10000"],"Q":["01110","10001","10001","10001","10101","10010","01101"],"R":["11110","10001","10001","11110","10100","10010","10001"],"S":["01111","10000","10000","01110","00001","00001","11110"],"T":["11111","00100","00100","00100","00100","00100","00100"],"U":["10001","10001","10001","10001","10001","10001","01110"],"V":["10001","10001","10001","10001","10001","01010","00100"],"W":["10001","10001","10001","10101","10101","10101","01010"],"X":["10001","10001","01010","00100","01010","10001","10001"],"Y":["10001","10001","01010","00100","00100","00100","00100"],"Z":["11111","00001","00010","00100","01000","10000","11111"],
"0":["01110","10011","10101","10101","11001","10001","01110"],"1":["00100","01100","00100","00100","00100","00100","01110"],"2":["01110","10001","00001","00010","00100","01000","11111"],"3":["11110","00001","00001","01110","00001","00001","11110"],"4":["00010","00110","01010","10010","11111","00010","00010"],"5":["11111","10000","11110","00001","00001","10001","01110"],"6":["01110","10000","10000","11110","10001","10001","01110"],"7":["11111","00001","00010","00100","01000","01000","01000"],"8":["01110","10001","10001","01110","10001","10001","01110"],"9":["01110","10001","10001","01111","00001","00001","01110"],
" ":["00000","00000","00000","00000","00000","00000","00000"],":":["00000","00100","00100","00000","00100","00100","00000"],"-":["00000","00000","00000","11111","00000","00000","00000"],".":["00000","00000","00000","00000","00000","00100","00100"],"/":["00001","00001","00010","00100","01000","10000","10000"],"!":["00100","00100","00100","00100","00100","00000","00100"],"+":["00000","00100","00100","11111","00100","00100","00000"]
};
export function calendarPng(day:string,rows:{time:string,title:string,focus:boolean,conflict:boolean}[]){
 const w=880,h=160+Math.max(1,Math.min(rows.length,8))*75;const png=new PNG({width:w,height:h});const d=png.data;
 const fill=(x:number,y:number,ww:number,hh:number,c:number[])=>{for(let yy=Math.max(0,y);yy<Math.min(h,y+hh);yy++)for(let xx=Math.max(0,x);xx<Math.min(w,x+ww);xx++){const i=(yy*w+xx)*4;d[i]=c[0];d[i+1]=c[1];d[i+2]=c[2];d[i+3]=255}};
 const txt=(v:string,x:number,y:number,scale=3,color=[25,35,48])=>{const z=String(v).normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9 :./!+-]/g," ");let ix=x;for(const c of z){if(ix+scale*6>=w-20)break;const a=FONT[c]||FONT[" "];for(let yy=0;yy<7;yy++)for(let xx=0;xx<5;xx++)if(a[yy][xx]==="1")fill(ix+xx*scale,y+yy*scale,scale,scale,color);ix+=6*scale;}};
 fill(0,0,w,h,[251,249,246]);fill(0,0,w,12,[23,40,47]);txt("SANDY CALENDAR",35,32,4);txt(day,35,86,3,[90,100,107]);
 for(let i=0;i<Math.min(rows.length,8);i++){const r=rows[i],y=148+i*75;fill(26,y-8,828,65,r.focus?[220,238,231]:i%2===0?[244,244,241]:[251,249,246]);fill(26,y-8,7,65,r.conflict?[184,69,61]:r.focus?[36,118,90]:[177,187,185]);txt(r.time.slice(0,7),47,y+12,3,[70,77,80]);txt(r.title.slice(0,36),230,y+12,3);if(r.conflict)txt("CONFLICT",680,y+12,2,[160,48,42]);}
 return PNG.sync.write(png);
}
export async function scheduledPreview(db:any,customer:string,kind:"task"|"event",id:string,phone:string,to:string,token:string){
 const table=kind==="task"?"sandy_tasks":"sandy_calendar_events";
 const {data:item,error:e}=await db.from(table).select("*").eq("customer_id",customer).eq("id",id).maybeSingle();
 if(e||!item)throw Error("preview_entry_missing");
 const at=kind==="task"?(item.start_at||item.due_at):item.starts_at;
 if(!at)return {sent:false,reason:"no_date"};
 const start=new Date(at);if(!Number.isFinite(start.getTime()))return {sent:false,reason:"invalid_date"};
 const tz=kind==="event"&&item.timezone?String(item.timezone):"Europe/Rome";
 let zone=tz;try{new Intl.DateTimeFormat("en",{timeZone:zone})}catch{zone="UTC"}
 const dayfmt=new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"});
 const dateKey=(value:string)=>dayfmt.format(new Date(value));
 const day=dateKey(at),daytitle=new Intl.DateTimeFormat("en-GB",{timeZone:zone,weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(start);
 const clock=(v:string)=>new Intl.DateTimeFormat("en-GB",{timeZone:zone,hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(v));
 const [events,tasks]=await Promise.all([db.from("sandy_calendar_events").select("id,title,starts_at,ends_at,all_day,status").eq("customer_id",customer).gte("starts_at",new Date(start.getTime()-86400000).toISOString()).lte("starts_at",new Date(start.getTime()+86400000).toISOString()).limit(150),db.from("sandy_tasks").select("id,title,due_at,start_at,status").eq("customer_id",customer).is("archived_at",null).limit(500)]);
 if(events.error||tasks.error)throw Error("preview_schedule_read_failed");
 const same=(events.data||[]).filter((x:any)=>dateKey(x.starts_at)===day&&x.status!=="cancelled");
 const conflict=kind==="event"&&!!item.ends_at&&same.some((x:any)=>x.id!==id&&!x.all_day&&x.ends_at&&new Date(x.starts_at)<new Date(item.ends_at)&&new Date(x.ends_at)>start);
 const rows=[...same.map((x:any)=>({id:x.id,time:x.all_day?"ALL DAY":clock(x.starts_at),title:String(x.title),focus:kind==="event"&&x.id===id,conflict:conflict&&x.id===id})),...(tasks.data||[]).filter((x:any)=>x.status!=="cancelled"&&x.status!=="completed"&&x.due_at&&dateKey(x.due_at)===day).map((x:any)=>({id:x.id,time:clock(x.due_at),title:"DUE: "+x.title,focus:kind==="task"&&x.id===id,conflict:false}))].sort((a,b)=>a.time.localeCompare(b.time)).slice(0,8);
 if(!rows.some(x=>x.focus))rows.unshift({id,time:clock(at),title:String(item.title),focus:true,conflict});
 const png=calendarPng(daytitle,rows);
 const form=new FormData();form.set("messaging_product","whatsapp");form.set("type","image/png");form.set("file",new Blob([png],{type:"image/png"}),"calendar.png");
 const uploaded=await fetch("https://graph.facebook.com/v25.0/"+encodeURIComponent(phone)+"/media",{method:"POST",headers:{Authorization:"Bearer "+token},body:form,signal:AbortSignal.timeout(15000)});
 const up=await uploaded.json().catch(()=>({}));if(!uploaded.ok||!up.id)throw Error("preview_media_upload_"+uploaded.status);
 const link="https://ausstyle.github.io/web-staging/sandy/app/";
 const caption=(conflict?"I've entered it, but there is a scheduling conflict. Would you like to change the time?\n":"Saved to Sandy.\n")+String(item.title).slice(0,130)+"\n"+daytitle+" "+clock(at)+"\nOpen Sandy: "+link;
 const sent=await fetch("https://graph.facebook.com/v25.0/"+encodeURIComponent(phone)+"/messages",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to,type:"image",image:{id:up.id,caption:caption.slice(0,900)}}),signal:AbortSignal.timeout(15000)});
 const result=await sent.json().catch(()=>({}));if(!sent.ok||!result.messages?.[0]?.id)throw Error("preview_send_uncertain_"+sent.status);
 await db.from("sandy_whatsapp_messages").upsert({meta_message_id:String(result.messages[0].id),phone_number_id:phone,sender_wa_id:to,direction:"outbound",message_type:"image",body:caption,payload:{source:"schedule_preview",entry_kind:kind,entry_id:id,conflict},processing_status:"submitted"},{onConflict:"meta_message_id",ignoreDuplicates:true});
 return {sent:true,conflict};
}
