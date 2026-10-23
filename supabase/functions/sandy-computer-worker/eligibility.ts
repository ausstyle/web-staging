/** A dispatch guard for the existing worker; it creates no execution authority. */
import {liveComputerSession} from '../_shared/sandy-agent-operations/worker_computer_identity.ts';
type Db={from:(table:string)=>any};
export function computerEligibilityFetch(db:Db,scope:{taskId:string;sessionId:string;sandboxId:string;attempt:number;agent:boolean},request:typeof fetch=fetch,now=Date.now):typeof fetch{
 return async(input,init)=>{
  const t=await db.from('sandy_computer_tasks').select('id,session_id,status,attempts,lease_until,requires_approval,approval_granted_at').eq('id',scope.taskId).single();
  const s=await db.from('sandy_computer_sessions').select('id,provider,provider_session_id,state,expires_at,control_mode').eq('id',scope.sessionId).single();
  const task=t.data,session=s.data,clock=now();
  if(t.error||s.error||!task||!session||task.id!==scope.taskId||task.session_id!==scope.sessionId||task.status!=='claimed'||task.attempts!==scope.attempt||
    typeof task.lease_until!=='string'||!Number.isFinite(Date.parse(task.lease_until))||Date.parse(task.lease_until)<=clock||
    !(task.requires_approval===false||(typeof task.approval_granted_at==='string'&&Number.isFinite(Date.parse(task.approval_granted_at))&&Date.parse(task.approval_granted_at)<=clock))||
    session.id!==scope.sessionId||session.provider!=='daytona'||session.provider_session_id!==scope.sandboxId||!liveComputerSession(session,clock)||(scope.agent&&session.control_mode!=='agent'))
   throw Error('computer_dispatch_eligibility_refused');
  // Original worker constructs all provider endpoints. Callers cannot supply an
  // endpoint through a new API/tool; the existing worker token remains required.
  return await request(input,init);
 };
}
