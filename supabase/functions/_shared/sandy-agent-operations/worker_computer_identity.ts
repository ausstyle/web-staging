// Actual Vault-backed worker-token authentication is a separate automation
// capability. It cannot become a customer/Controller/owner principal.
export type ComputerWorkerProof=Readonly<{kind:"trusted_internal_worker";worker:"sandy-computer-worker"}>;
export type ComputerTaskCapability=Readonly<{taskId:string;sessionId:string}>;
type Obj=Record<string,any>;
const proofs=new WeakSet<object>(),tasks=new WeakMap<object,{task:Obj;session:Obj}>();
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
export async function authenticateComputerWorker(request:Request,db:any):Promise<ComputerWorkerProof|null>{
 const token=request.headers.get("x-sandy-worker-token")||"";if(!token)return null;
 const result=await db.rpc("sandy_computer_worker_auth",{p_token:token});if(result.error||result.data!==true)return null;
 const proof=Object.freeze({kind:"trusted_internal_worker"as const,worker:"sandy-computer-worker"as const});proofs.add(proof);return proof;
}
export const isComputerWorkerProof=(value:unknown):value is ComputerWorkerProof=>!!value&&typeof value==="object"&&proofs.has(value);
/** Reject terminal, expired and unbounded sessions before any provider call.
 * Paused/stopped sessions remain eligible for the separately admitted resume
 * path; this predicate is not provider readiness or execution authorization. */
export function liveComputerSession(session:unknown,now=Date.now()):boolean{
 if(!session||typeof session!=="object"||Array.isArray(session)||!Number.isFinite(now))return false;
 const s=session as Obj;
 return ["starting","running","paused","stopped"].includes(s.state)&&typeof s.expires_at==="string"&&Number.isFinite(Date.parse(s.expires_at))&&Date.parse(s.expires_at)>now;
}
export async function bindComputerTask(proof:ComputerWorkerProof,db:any,taskId:string,now=Date.now()):Promise<ComputerTaskCapability|null>{
 if(!isComputerWorkerProof(proof)||!uuid(taskId))return null;
 const row=await db.from("sandy_computer_tasks").select("id,session_id,instruction,status,idempotency_key,requires_approval,approval_granted_at,claimed_at,task_type,task_payload,attempts,lease_until").eq("id",taskId).maybeSingle();
 const task=row.data;if(row.error||!task||task.id!==taskId||!uuid(task.session_id)||task.status!=="claimed"||task.attempts!==1||!["probe","download_url","browser_agent"].includes(task.task_type)||!Number.isFinite(new Date(task.lease_until).getTime())||new Date(task.lease_until).getTime()<=now||(task.requires_approval!==false&&(!task.approval_granted_at||!Number.isFinite(new Date(task.approval_granted_at).getTime())||new Date(task.approval_granted_at).getTime()>now)))return null;
 const record=await db.from("sandy_computer_sessions").select("id,provider,provider_session_id,owner_user_id,control_mode,state,expires_at").eq("id",task.session_id).maybeSingle();
 const session=record.data;if(record.error||!session||session.id!==task.session_id||session.provider!=="daytona"||!uuid(session.provider_session_id)||!liveComputerSession(session,now))return null;
 if(task.task_type==="browser_agent"&&(!["sandy_master_internal","sandy_internal"].includes(task.task_payload?.origin)||session.control_mode!=="agent"||!String(task.instruction||"").trim()))return null;
 const cap=Object.freeze({taskId,sessionId:task.session_id});tasks.set(cap,{task:structuredClone(task),session:structuredClone(session)});return cap;
}
export const computerTaskScope=(cap:unknown):{task:Obj;session:Obj}|null=>cap&&typeof cap==="object"&&tasks.has(cap)?structuredClone(tasks.get(cap)!):null;
