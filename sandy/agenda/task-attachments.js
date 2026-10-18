/* Sandy Tasks attachments — private per-task files. */
export function initTaskFiles({auth,notify,customerId}){
 const endpoint="https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-task-files";
 const counts={};
 const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
 const button=(text,cls,click)=>{const b=el("button",cls,text);b.type="button";b.addEventListener("click",click);return b};
 async function api(action,payload={}){
  const {data}=await auth.auth.getSession();
  const token=data?.session?.access_token;
  if(!token)throw Error("Sign in to access attachments");
  const r=await fetch(endpoint,{method:"POST",credentials:"omit",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({action,...payload})});
  const body=await r.json().catch(()=>({error:"Invalid attachment response"}));
  if(!r.ok)throw Error(body.error||"Attachment request failed");
  return body;
 }
 function setCount(id,n){
  counts[id]=n;
  document.querySelectorAll(".sandyAttachmentIndicator").forEach(b=>{if(b.dataset.taskFiles===id){b.hidden=!n;b.textContent="📎 "+n+" file"+(n===1?"":"s");b.title=n+" attached file"+(n===1?"":"s")+" · click to view";}});
  document.querySelectorAll(".sandyFileToggle").forEach(b=>{
   if(b.dataset.taskFiles===id)b.textContent="📎"+(n?" "+n:"");
  });
 }
 async function refreshCounts(tasks){
  try{
   const data=await api("counts");
   for(const t of tasks)if(!t.shared)setCount(t.id,data.counts[t.id]||0);
  }catch(e){console.warn("Task attachment counts:",e.message)}
 }
 function toggle(task,findPanel){
  const b=button("📎"+(counts[task.id]?" "+counts[task.id]:""),"sandyFileToggle",()=>{
   const panel=findPanel();
   if(!panel)return;
   const open=panel.classList.contains("hidden");
   panel.classList.toggle("hidden",!open);
   b.setAttribute("aria-expanded",String(open));
   if(open)panel.refresh();
  });
  b.dataset.taskFiles=task.id;
  b.title="Files and photos for "+task.title;b.setAttribute("aria-label",b.title);
  b.setAttribute("aria-expanded","false");
  return b;
 }
 function panel(task,{visible=false}={}){
  const wrap=el("section","sandyTaskFiles"+(visible?"":" hidden"));
  const head=el("div","sandyFilesHead");
  const title=el("strong","","Files & photos");
  const input=el("input","sandyFilesInput");
  input.type="file";input.multiple=true;
  input.accept=".jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,image/*";
  input.setAttribute("aria-label","Choose files for "+task.title);
  const add=button("＋ Add files","btn small",()=>input.click());
  head.append(title,add,input);wrap.append(head);
  wrap.append(el("div","sandyFilesHelp","Drop files here or select multiple · maximum 25 MB each"));
  const gallery=el("div","sandyFilesGallery");
  const status=el("div","sandyFilesStatus");status.setAttribute("role","status");
  wrap.append(gallery,status);
  let pending=false;
  async function refresh(){
   if(pending)return;
   pending=true;status.textContent="Loading files…";
   try{
    const result=await api("list",{task_id:task.id});
    gallery.replaceChildren();
    setCount(task.id,result.files.length);
    add.classList.toggle("hidden",!result.can_upload);
    for(const file of result.files){
     const item=el("div","sandyFilesItem");
     if(file.mime_type.startsWith("image/")){
      const img=el("img","sandyFileThumbnail");
      img.alt=file.original_filename;img.loading="lazy";item.append(img);
      api("download",{task_id:task.id,id:file.id}).then(d=>{if(img.isConnected)img.src=d.url}).catch(()=>{img.alt="Preview unavailable"});
     }else item.append(el("span","sandyFileGlyph",file.mime_type==="application/pdf"?"▤":"▧"));
     const open=button(file.original_filename,"sandyFileOpen",async()=>{
      try{const d=await api("download",{task_id:task.id,id:file.id});window.open(d.url,"_blank","noopener,noreferrer")}
      catch(e){notify("Could not open file: "+e.message,true)}
     });
     open.title=file.original_filename+" · "+Math.ceil(file.size_bytes/1024)+" KB";item.append(open);
     if(result.can_upload&&(result.can_delete_all||file.uploaded_by_customer_id===customerId())){
      const remove=button("×","sandyFileRemove",async()=>{
       if(!confirm("Remove “"+file.original_filename+"” from this task?"))return;
       remove.disabled=true;
       try{await api("remove",{task_id:task.id,id:file.id});notify("Attachment removed");await refresh()}
       catch(e){notify("Remove failed: "+e.message,true);remove.disabled=false}
      });
      remove.title="Remove "+file.original_filename;
      remove.setAttribute("aria-label",remove.title);item.append(remove);
     }
     gallery.append(item);
    }
    if(!result.files.length)gallery.append(el("span","sandyFilesHelp","No files attached yet."));
    status.textContent=result.files.length+" attachment"+(result.files.length===1?"":"s");
   }catch(e){status.textContent="Cannot load attachments: "+e.message}
   finally{pending=false}
  }
  async function upload(selected){
   if(!selected.length)return;
   add.disabled=true;let done=0;const errors=[];
   for(const file of selected){
    status.textContent="Uploading "+(done+errors.length+1)+" of "+selected.length+" · "+file.name;
    if(file.size<1||file.size>26214400){errors.push(file.name+" (size must be 1 byte to 25 MB)");continue}
    try{
     const spec=await api("prepare",{task_id:task.id,filename:file.name,size_bytes:file.size});
     const {error}=await auth.storage.from("sandy-task-attachments").uploadToSignedUrl(spec.path,spec.token,file,{contentType:spec.mime_type});
     if(error)throw Error(error.message||"Upload failed");
     await api("complete",{task_id:task.id,id:spec.id});
     done++;
    }catch(e){errors.push(file.name+" ("+e.message+")")}
   }
   add.disabled=false;await refresh();
   if(done)notify(done+" attachment"+(done===1?"":"s")+" saved");
   if(errors.length){status.textContent="Failed: "+errors.join("; ");notify(errors.length+" file(s) could not be attached",true)}
  }
  input.addEventListener("change",()=>{const files=[...input.files];input.value="";upload(files)});
  wrap.addEventListener("dragover",e=>{e.preventDefault();e.dataTransfer.dropEffect="copy"});
  wrap.addEventListener("drop",e=>{e.preventDefault();if(!add.disabled)upload([...e.dataTransfer.files])});
  wrap.refresh=refresh;
  wrap.upload=upload;
  return wrap;
 }
 function indicator(task){const b=button(counts[task.id]?"📎 "+counts[task.id]+" files":"","sandyAttachmentIndicator",()=>{const outer=document.getElementById("task-"+task.id);const p=outer?.querySelector(".sandyTaskFiles");if(!p)return;p.classList.toggle("hidden");if(!p.classList.contains("hidden"))p.refresh();});b.dataset.taskFiles=task.id;b.hidden=!counts[task.id];b.title="View task attachments";b.setAttribute("aria-label","View attached files for "+task.title);return b;}
 return {panel,toggle,indicator,refreshCounts};
}
