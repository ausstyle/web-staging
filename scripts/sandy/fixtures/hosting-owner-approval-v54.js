if(action==="status"){
   const next=string(b.status,40);
   const allowed:Record<string,string[]>={proposed:["approved","cancelled"],approved:["implementing","cancelled"],implementing:["committed","failed"],committed:["deployed","failed"],deployed:["verified","failed"],verified:["rolled_back"],failed:["implementing","rolled_back"],rolled_back:[],cancelled:[]};
   if(!allowed[change.status]?.includes(next))return respond({error:"Invalid status transition",from:change.status,to:next},409);
   if(next==="approved"&&admin.role!=="owner")return respond({error:"Owner approval required"},403);
   if(next==="verified"){
    const {data:tests,error}=await db.from("sandy_engineering_tests").select("outcome").eq("change_id",id);
    if(error)throw error;if(!tests?.length||tests.some(t=>t.outcome!=="passed"))return respond({error:"All acceptance tests require passing evidence"},409);
   }
   const {data,error}=await db.from("sandy_engineering_changes").update({status:next,updated_at:new Date().toISOString(),...(next==="verified"?{verified_at:new Date().toISOString()}:{})}).eq("id",id).eq("status",change.status).select("*").maybeSingle();
   if(error)throw error;if(!data)return respond({error:"Concurrent change; reload"},409);
   await db.from("sandy_engineering_change_events").insert({change_id:id,event_type:"status_changed",actor:user.id,detail:{from:change.status,to:next,reason:string(b.reason,1000)}});
   return respond({change:data});
  }
  