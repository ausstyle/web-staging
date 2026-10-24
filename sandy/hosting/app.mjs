import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.105.0';
import {installSandyIdleLock} from '../security-lock.js';
import {createHostingClient} from './create-client.mjs';
import {mountHosting} from './view.mjs';
const publicKey='sb_publishable_OVP7LUMDhtcymPRzZuCK3Q_8JkLC3ts';
const sb=createClient('https://zmqlyygzqoidkcwdysok.supabase.co',publicKey,{auth:{detectSessionInUrl:false,persistSession:true,storage:localStorage,autoRefreshToken:true}});
const idle=installSandyIdleLock(sb.auth);
if(!await idle.check()){
 const view=mountHosting(document.getElementById('hosting'),createHostingClient(sb.auth,{publicKey}));
 sb.auth.onAuthStateChange((event)=>{if(event==='SIGNED_OUT'||event==='SIGNED_IN'||event==='USER_UPDATED')view.clear()});
}
