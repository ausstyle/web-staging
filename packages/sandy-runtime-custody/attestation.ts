/** Source-only scanner protocol. Keys come from the protected trust catalogue,
 * never from an attestation or a caller-supplied `clean` flag. No key provisioning. */
export interface ScanAttestation {
 version:1; receiptId:string; artifactId:string; fileId:string; admissionId:string;
 actorId:string; customerId:string; generation:string; size:number; sha256:string;
 bindingSha256:string; issuer:string; release:string; trustRevision:number;
 verdict:'CLEAN'|'REJECTED'; issuedAt:number; expiresAt:number;
}
const uuid=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s);
const ref=(s:unknown)=>typeof s==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(s);
const hash=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
export function scanBytes(a:ScanAttestation):Uint8Array {
 const fields=['version','receiptId','artifactId','fileId','admissionId','actorId','customerId','generation','size','sha256','bindingSha256','issuer','release','trustRevision','verdict','issuedAt','expiresAt'];
 if(Object.keys(a).length!==fields.length||Object.keys(a).some(k=>!fields.includes(k)))throw Error('INVALID_SCAN_ATTESTATION');
 if(a.version!==1||![a.receiptId,a.artifactId,a.fileId,a.admissionId,a.actorId,a.customerId].every(uuid)||
 ![a.generation,a.issuer,a.release].every(ref)||![a.sha256,a.bindingSha256].every(hash)||
 !Number.isSafeInteger(a.size)||a.size<0||!Number.isSafeInteger(a.trustRevision)||a.trustRevision<1||
 !['CLEAN','REJECTED'].includes(a.verdict)||!Number.isSafeInteger(a.issuedAt)||!Number.isSafeInteger(a.expiresAt)||
 a.expiresAt<=a.issuedAt||a.expiresAt-a.issuedAt>15*60*1000)throw Error('INVALID_SCAN_ATTESTATION');
 return new TextEncoder().encode(JSON.stringify(['sandy.artifact.scan.v1',a.receiptId,a.artifactId,a.fileId,a.admissionId,
 a.actorId,a.customerId,a.generation,a.size,a.sha256,a.bindingSha256,a.issuer,a.release,a.trustRevision,a.verdict,a.issuedAt,a.expiresAt]));
}
const bytes=(hex:string)=>Uint8Array.from(hex.match(/../g)!,v=>parseInt(v,16));
export async function verifyScanSignature(a:ScanAttestation,signatureHex:string,publicKeyHex:string,now:number):Promise<void>{
 const data=scanBytes(a);
 if(!/^[a-f0-9]{128}$/.test(signatureHex)||!/^[a-f0-9]{64}$/.test(publicKeyHex)||a.issuedAt>now||a.expiresAt<=now)throw Error('INVALID_SCAN_ATTESTATION');
 const key=await crypto.subtle.importKey('raw',bytes(publicKeyHex),{name:'Ed25519'},false,['verify']);
 if(!await crypto.subtle.verify('Ed25519',key,bytes(signatureHex),new Uint8Array(data)))throw Error('INVALID_SCAN_SIGNATURE');
}
