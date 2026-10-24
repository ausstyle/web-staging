/** Domain-proof primitives only. No provider I/O, storage, authorization or writes.
 * Call only with server-loaded claim and independently collected DNS observations.
 * A positive match is evidence for policy review, never permission to bind a domain.
 */
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
function domain(s){
 if(typeof s!=='string'||s.length>253||s!==s.toLowerCase()||s.endsWith('.')||s.split('.').length<2||s.split('.').some(l=>!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l)))throw Error('canonical_domain_required');
 return s;
}
function milliseconds(s){if(typeof s!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(Date.parse(s)).toISOString()!==s)throw Error('canonical_timestamp_required');return Date.parse(s);}
function binding(c){return JSON.stringify([c.claim_id,c.tenant_id,c.domain,c.version,c.token_sha256,c.created_at,c.expires_at]);}
/** Persist atomically behind the existing identity/idempotency boundary BEFORE publishing.
 * Unique active domain claim, public-suffix rules and takeover policy belong there.
 * Replaying creation must retrieve the persisted result, never mint another challenge.
 */
export function issueDomainChallenge({claim_id,tenant_id,domain:host,version,now,lifetime_seconds}){
 if(!uuid(claim_id)||!uuid(tenant_id)||!Number.isSafeInteger(version)||version<1||!Number.isInteger(lifetime_seconds)||lifetime_seconds<300||lifetime_seconds>86400)throw Error('invalid_claim');
 domain(host);const created=milliseconds(now);const token=randomBytes(32).toString('base64url');
 const record_name='_sandy-hosting-verify.'+host+'.';if(record_name.length>254)throw Error('challenge_name_too_long');
 const value='sandy-hosting-v1='+claim_id+'.'+token;
 const claim={claim_id,tenant_id,domain:host,version,token_sha256:hash(value),created_at:now,expires_at:new Date(created+lifetime_seconds*1000).toISOString()};
 return {claim,claim_sha256:hash(binding(claim)),record:{name:record_name,type:'TXT',rrdatas:['"'+value+'"']},grants_domain_authority:false};
}
function txtValue(s){
 if(typeof s!=='string'||s.length>1024||!/^"[a-zA-Z0-9=_-]+(?:\.[a-zA-Z0-9_-]+)*"$/.test(s))return null;
 return s.slice(1,-1);
}
/** expected is loaded from authenticated server state; never copy it from request arguments.
 * Observations are adapter-normalized, receipt-linked direct queries to every current
 * authoritative server; resolver cache answers are not accepted as authoritative proof.
 */
export function evaluateDomainChallenge({claim,expected,authority_snapshot,observations,now}){
 const at=milliseconds(now);const reject=reason=>({challenge_matches:false,reason,grants_domain_authority:false});
 if(!claim||!expected||!uuid(claim.claim_id)||!uuid(claim.tenant_id)||!Number.isSafeInteger(claim.version)||claim.version<1||!/^[a-f0-9]{64}$/.test(claim.token_sha256||''))return reject('invalid_claim');
 domain(claim.domain);
 if(expected.tenant_id!==claim.tenant_id||expected.claim_id!==claim.claim_id||expected.domain!==claim.domain||expected.version!==claim.version||expected.claim_sha256!==hash(binding(claim)))return reject('claim_binding_changed');
 const created=milliseconds(claim.created_at),expires=milliseconds(claim.expires_at);
 if(at<created||at>=expires||expires-created>86400000||expires<=created)return reject('challenge_expired_or_invalid');
 if(!authority_snapshot||authority_snapshot.domain!==claim.domain||!uuid(authority_snapshot.receipt_id)||!Array.isArray(authority_snapshot.nameservers)||authority_snapshot.nameservers.length<2||authority_snapshot.nameservers.length>13)return reject('authoritative_snapshot_required');
 const ns=authority_snapshot.nameservers;
 if(new Set(ns).size!==ns.length||ns.some(n=>typeof n!=='string'||!n.endsWith('.')||n!==n.toLowerCase()))return reject('invalid_authority_set');
 if(ns.some(n=>{try{domain(n.slice(0,-1));return false}catch{return true}}))return reject('invalid_authority_set');
 const authorityTime=milliseconds(authority_snapshot.observed_at);
 if(authorityTime<created||authorityTime>at||at-authorityTime>300000)return reject('stale_authority_snapshot');
 if(!Array.isArray(observations)||observations.length!==ns.length)return reject('all_authoritative_answers_required');
 const seen=new Set(),receipts=new Set();const wanted='_sandy-hosting-verify.'+claim.domain+'.';
 for(const o of observations){
  if(!o||!ns.includes(o.nameserver)||seen.has(o.nameserver)||!uuid(o.receipt_id)||receipts.has(o.receipt_id))return reject('duplicate_or_unbound_observation');
  seen.add(o.nameserver);receipts.add(o.receipt_id);
  const time=milliseconds(o.observed_at);
  if(time<authorityTime||time>at||at-time>300000)return reject('stale_observation');
  if(o.authoritative!==true||o.rcode!=='NOERROR'||o.name!==wanted||o.type!=='TXT'||o.cname_followed!==false)return reject('non_authoritative_or_redirected_answer');
  if(!Array.isArray(o.rrdatas)||o.rrdatas.length>100||o.rrdatas.some(v=>typeof v!=='string'||v.length>4096))return reject('bounded_txt_answers_required');
  if(o.rrdatas.some(v=>v.includes('sandy-hosting-v1=')&&txtValue(v)===null))return reject('unsupported_challenge_encoding');
  const challenges=o.rrdatas.map(txtValue).filter(v=>v?.startsWith('sandy-hosting-v1='));
  if(challenges.length!==1)return reject('missing_or_conflicting_challenge');
  const actual=Buffer.from(hash(challenges[0]),'hex'),wantedHash=Buffer.from(claim.token_sha256,'hex');
  if(!timingSafeEqual(actual,wantedHash))return reject('challenge_mismatch');
 }
 return {challenge_matches:true,claim_id:claim.claim_id,claim_version:claim.version,claim_sha256:expected.claim_sha256,observed_at:now,authority_receipt_id:authority_snapshot.receipt_id,observation_receipt_ids:[...receipts].sort(),grants_domain_authority:false,requires_atomic_claim_consumption:true};
}
