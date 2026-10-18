#!/usr/bin/env python3
"""Build a narrowly patched candidate; preserve the live/V1 source byte-for-byte.

This script cannot deploy, send mail, change credentials or mark acceptance gates.
It refuses source drift and writes a manifest and rollback source for the release.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

SOURCE = Path('supabase/functions/sandy-agent-runtime/index.ts')
TARGET = Path('supabase/functions/sandy-agent-runtime-v2/index.ts')
EXPECTED_BLOB = 'da7db37f6276cf5fa345d0c3dc5737d768ad2962'
OLD_WORKSPACE = 'if(workspace){const {data:cos}=await db.from("sandy_agenda_companies").select("id,name").eq("customer_id",customerId);const co=(cos||[]).find((x:any)=>x.name.toLowerCase()===workspace);candidates=co?candidates.filter((x:any)=>x.company_id===co.id):[]}'
NEW_WORKSPACE = 'if(workspace&&!["personal","private","personal (private)"].includes(workspace)){const {data:cos}=await db.from("sandy_agenda_companies").select("id,name").eq("customer_id",customerId);const co=(cos||[]).find((x:any)=>x.name.toLowerCase()===workspace);candidates=co?candidates.filter((x:any)=>x.company_id===co.id):[]}'
OLD_EMAILS = [r'^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$', r'^[^\\\\s@]+@[^\\\\s@]+\\\\.[^\\\\s@]+$']
NEW_EMAIL = r'^[^\s@]+@[^\s@]+\.[^\s@]+$'

def main() -> None:
    original_bytes = SOURCE.read_bytes()
    blob = hashlib.sha1(b'blob ' + str(len(original_bytes)).encode() + b'\0' + original_bytes).hexdigest()
    if blob != EXPECTED_BLOB:
        raise RuntimeError('Baseline changed; re-inspect before building. No source overwritten.')
    original = original_bytes.decode('utf-8')
    start = original.find('if(c.name==="prepare_gmail_message"&&customerId)')
    end = original.find('if(c.name==="search_connected_gmail"&&customerId)', start)
    if start < 0 or end <= start:
        raise RuntimeError('Audited handler boundaries not found.')
    block = original[start:end]
    matches = [x for x in OLD_EMAILS if block.count(x) == 1]
    if len(matches) != 1 or block.count(OLD_WORKSPACE) != 1:
        raise RuntimeError('Audited correction is ambiguous; no candidate built.')
    fixed_block = block.replace(matches[0], NEW_EMAIL, 1).replace(OLD_WORKSPACE, NEW_WORKSPACE, 1)
    candidate = original[:start] + fixed_block + original[end:]
    if SOURCE.read_bytes() != original_bytes:
        raise RuntimeError('Source changed during build.')
    if TARGET.exists():
        raise RuntimeError('Candidate source already exists; refusing to overwrite another release.')
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(candidate, encoding='utf-8')
    out = Path('artifacts/sandy-v2-core')
    out.mkdir(parents=True, exist_ok=True)
    (out / 'v1-runtime.ts').write_bytes(original_bytes)
    (out / 'v2-runtime.ts').write_text(candidate, encoding='utf-8')
    # Test expressions are extracted from the actual built handler, not replicas.
    email_start = fixed_block.index('if(!/') + len('if(!')
    email_end = fixed_block.index('.test(to)', email_start)
    actual_regex = fixed_block[email_start:email_end]
    workspace_start = fixed_block.index('if(workspace')
    workspace_end = fixed_block.index('      if(candidates.length', workspace_start)
    actual_workspace = fixed_block[workspace_start:workspace_end].replace('(x:any)', '(x)')
    tests = '''import assert from 'node:assert/strict';
const validEmail = to => EMAIL_REGEX.test(to);
const run = async workspace => {
 workspace = String(workspace ?? '').trim().toLowerCase();
 const customerId = 'tenant-one';
 const customers = [{id:'company-one',name:'Fixture Company'}];
 let candidates=[{connected_account_id:'personal',company_id:null},{connected_account_id:'company',company_id:'company-one'}];
 const dbCalls=[];
 const db={from:table=>({select:fields=>({eq:async(key,value)=>{dbCalls.push({table,key,value});return {data:customers};}})})};
 WORKSPACE_CODE
 assert.ok(dbCalls.every(c=>c.key==='customer_id' && c.value===customerId));
 return candidates.map(c=>c.connected_account_id);
};
let passed=0;
for(const address of ['sandyemail.ai@gmail.com','qa+release@example.org','nick@email.com.au']){assert.equal(validEmail(address),true);passed++;}
for(const address of ['','not-an-email','a b@example.org','a@bad domain.org','a\\r\\nb@example.org','a@example.org\\nBcc:other@example.org']){assert.equal(validEmail(address),false);passed++;}
for(const label of ['','Personal',' personal ','private','Personal (private)']){assert.deepEqual(await run(label),['personal']);passed++;}
assert.deepEqual(await run('Fixture Company'),['company']);passed++;
assert.deepEqual(await run('Unknown Company'),[]);passed++;
console.log(JSON.stringify({scope:'actual candidate handler deterministic regression; not provider acceptance',passed,total:16}));
'''.replace('EMAIL_REGEX', actual_regex).replace('WORKSPACE_CODE', actual_workspace)
    (out / 'gmail-draft-regression.mjs').write_text(tests, encoding='utf-8')
    manifest = {'source_blob':blob,'baseline_sha256':hashlib.sha256(original_bytes).hexdigest(),'candidate_sha256':hashlib.sha256(candidate.encode()).hexdigest(),'changes':['Gmail address regex escaping','Personal workspace aliases'],'production_traffic_changed':False,'acceptance_status':'not_evaluated','rollback':'Existing sandy-agent-runtime remains unchanged; V1 source is archived alongside candidate.'}
    (out / 'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print(json.dumps(manifest,indent=2))

if __name__ == '__main__':
    main()
