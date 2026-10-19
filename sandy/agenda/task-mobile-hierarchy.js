/* Sandy mobile task interaction enhancement: loaded by agenda page */
(function(){
const css=document.createElement('style');css.textContent=`
.sandy-parent-backdrop{position:fixed;inset:0;background:#0006;z-index:99999;display:flex;align-items:flex-end;justify-content:center}
.sandy-parent-sheet{background:#fff;color:#222;width:min(520px,100%);max-height:80dvh;border-radius:18px 18px 0 0;padding:18px;display:flex;flex-direction:column;gap:12px}
.sandy-parent-sheet input{width:100%;padding:12px;font-size:16px;border:1px solid #ddd;border-radius:10px}
.sandy-parent-results{overflow:auto}.sandy-parent-results button{width:100%;display:flex;flex-direction:column;align-items:flex-start;text-align:left;border:0;border-bottom:1px solid #eee;background:#fff;padding:12px;gap:3px}.sandy-parent-results small{color:#777}
.taskrow.sandy-swipe-preview{transform:translateX(var(--sandy-swipe-x,0px));transition:background .1s;background:#eaf4eb!important}
.sandy-swipe-caption{position:absolute;right:8px;top:2px;background:#263f33;color:#fff;border-radius:7px;font-size:10px;font-weight:700;padding:3px 7px;pointer-events:none;z-index:5}
@media(min-width:700px){.sandy-parent-backdrop{align-items:center}.sandy-parent-sheet{border-radius:18px}}
`;document.head.append(css);
window.sandyChooseParentTask=function(task,suggested){
 const overlay=document.createElement('div');overlay.className='sandy-parent-backdrop';
 const sheet=document.createElement('section');sheet.className='sandy-parent-sheet';sheet.setAttribute('role','dialog');sheet.setAttribute('aria-modal','true');
 const header=document.createElement('div');header.style.cssText='display:flex;justify-content:space-between;align-items:center';
 const title=document.createElement('strong');title.textContent='Move under another task';
 const close=document.createElement('button');close.textContent='✕';close.onclick=()=>overlay.remove();header.append(title,close);
 const search=document.createElement('input');search.type='search';search.placeholder='Search open tasks…';
 const results=document.createElement('div');results.className='sandy-parent-results';
 const excluded=new Set([task.id]);let frontier=[task.id];while(frontier.length){const next=[];for(const x of state.tasks){if(frontier.includes(x.parent_task_id)&&!excluded.has(x.id)){excluded.add(x.id);next.push(x.id)}}frontier=next}
 const candidates=state.tasks.filter(x=>!excluded.has(x.id)&&!x.shared&&!['completed','cancelled'].includes(x.status));
 function render(){results.replaceChildren();const q=search.value.trim().toLowerCase();const matches=candidates.filter(x=>[x.title,x.company_id,x.category_id].some(v=>String(v||'').toLowerCase().includes(q))).sort((a,b)=>Number(b.id===suggested?.id)-Number(a.id===suggested?.id)||a.title.localeCompare(b.title)).slice(0,100);
 for(const parent of matches){const button=document.createElement('button');const name=document.createElement('span');name.textContent=parent.title;const meta=document.createElement('small');meta.textContent=[parent.id===suggested?.id?'Suggested · task above':null,parent.company_id||'Personal'].filter(Boolean).join(' · ');button.append(name,meta);button.onclick=()=>{overlay.remove();moveOutlineTask(task.id,parent.id,'inside')};results.append(button)}
 if(!matches.length)results.textContent='No eligible open tasks found';
 }search.oninput=render;sheet.append(header,search,results);overlay.append(sheet);overlay.onclick=e=>{if(e.target===overlay)overlay.remove()};overlay.onkeydown=e=>{if(e.key==='Escape')overlay.remove()};document.body.append(overlay);render();search.focus();
};
window.sandySwipeFeedback=function(row,dx,dy){
 const active=Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)*1.6;row.classList.toggle('sandy-swipe-preview',active);row.style.setProperty('--sandy-swipe-x',active?Math.max(-42,Math.min(42,dx*.4))+'px':'0px');
 let caption=row.querySelector('.sandy-swipe-caption');if(!active){caption?.remove();return}
 if(!caption){caption=document.createElement('span');caption.className='sandy-swipe-caption';row.append(caption)}
 caption.textContent=(Math.abs(dx)>=65?'Release to ':'Swipe to ')+(dx>0?'indent ↳':'outdent ↰');
};
window.sandyClearSwipeFeedback=function(row){row.classList.remove('sandy-swipe-preview');row.style.removeProperty('--sandy-swipe-x');row.querySelector('.sandy-swipe-caption')?.remove()};
})();