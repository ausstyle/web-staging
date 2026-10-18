#!/usr/bin/env python3
"""Produce auditable version-aware source. No deployment, credentials or route changes.
Baseline repo blob is checked; live r48/r2 module-catalog additions are preserved.
"""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import tempfile

SOURCE=Path('supabase/functions/sandy-agent-runtime/index.ts')
OUT=Path('sandy-version-awareness-release')
EXPECTED_BLOB='da7db37f6276cf5fa345d0c3dc5737d768ad2962'

def one(s,old,new):
    if s.count(old)!=1:
        raise RuntimeError('Source drift at audited anchor: '+old[:90])
    return s.replace(old,new,1)

def preserved_live_source(s):
    # These exact additive lines were inspected in deployed r48 and V2 r2.
    s=one(s,'const [caps,integrations]=await Promise.all([','const [caps,integrations,moduleRegistry]=await Promise.all([')
    s=one(s,'db.from("sandy_ai_integrations").select("integration_key,enabled,deployment_status,last_verified_at").limit(100)',
          'db.from("sandy_ai_integrations").select("integration_key,enabled,deployment_status,last_verified_at").limit(100),\n         db.from("sandy_module_status").select("module_key,module_group,deployed_version,deployment_state,operational_status,remaining_steps,evidence,last_tested_at,observed_at").limit(250)')
    anchor='         note:"A configured or deployed feature is not necessarily operational or authorised for the current customer."'
    extra='         module_status_source:"sandy_module_status",modules:moduleRegistry.error?[]:(moduleRegistry.data||[]).map((m:any)=>({...m,operational_status:!m.last_tested_at||Date.now()-Date.parse(m.last_tested_at)>=86400000?"unverified":m.operational_status,stale:!m.last_tested_at||Date.now()-Date.parse(m.last_tested_at)>=86400000})),\n'
    return one(s,anchor,extra+anchor)

def v2_gmail_fixes(s):
    a=s.index('if(c.name==="prepare_gmail_message"&&customerId)')
    b=s.index('if(c.name==="search_connected_gmail"&&customerId)',a)
    block=s[a:b]
    for old in [r'^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',r'^[^\\\\s@]+@[^\\\\s@]+\\\\.[^\\\\s@]+$']:
        if old in block:
            block=one(block,old,r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
            break
    else:
        raise RuntimeError('Expected Gmail fix anchor missing')
    block=one(block,'if(workspace){','if(workspace&&!["personal","private","personal (private)"].includes(workspace)){')
    return s[:a]+block+s[b:]

def add_awareness(s,component):
    imports='import {executingBuild,getVersionAwareness,needsVersionInspection,versionInstructions,versionFactsForModel} from "./version-awareness.js";\n'
    s=imports+s
    s=one(s,'"capabilities","connections","environment"','"capabilities","connections","environment","versions"')
    s=one(s,'Never guess database counts.','Never guess database counts. Use domain versions for product release, the executing build and deployed module revisions.')
    anchor=' const {data:existing,error:reserved}=await db.from("sandy_agent_tasks").insert('
    s=one(s,anchor,' const runtimeIdentity=executingBuild("'+component+'",Deno.env.get("DENO_DEPLOYMENT_ID")||"");\n'+anchor)
    s=one(s,'user_request:prompt,status:"queued"','user_request:prompt,status:"queued",plan:{runtime_identity:runtimeIdentity}')
    s=one(s,'plan:{strategy:complex?"reasoning":"fast",tools:["search_history"]}',
          'plan:{strategy:complex?"reasoning":"fast",tools:["search_history"],runtime_identity:runtimeIdentity}')
    s=one(s,' const confirmation=', ' const versionInfo=await getVersionAwareness(db,"'+component+'");\n const confirmation=')
    s=one(s,'const recentGmailRequest=customerId&&','const recentGmailRequest=customerId&&!needsVersionInspection(prompt)&&')
    s=one(s,'const v2DirectStatus=!!customerId&&','const v2DirectStatus=!!customerId&&!needsVersionInspection(prompt)&&')
    s=one(s,'const clockOnlyRequest=prompt.length<=220 &&','const clockOnlyRequest=!needsVersionInspection(prompt)&&prompt.length<=220 &&')
    s=one(s,'const instructions=capabilityContext+','const instructions=versionInstructions(versionInfo)+capabilityContext+')
    s=one(s,'     if(domain==="conversation_activity"){',
        '     if(domain==="versions"){\n       result=versionInfo.lookup_status==="available"?{ok:true,...versionFactsForModel(versionInfo)}:{error:"version_registry_unavailable",executing:versionInfo.executing};\n     }else if(domain==="conversation_activity"){')
    s=one(s,'max_output_tokens:1600});\n  for(let round=0;',
        '...(needsVersionInspection(prompt)?{tool_choice:{type:"function",name:"inspect_sandy_operational_state"}}:{}),max_output_tokens:1600});\n  for(let round=0;')
    return s

TESTS=r'''import assert from 'node:assert/strict';
import {executingBuild,needsVersionInspection,getVersionAwareness,versionFactsForModel,versionInstructions} from './version-awareness.js';
let passed=0;
const check=(fn)=>{fn();passed++};
const component='sandy-agent-runtime-v2';
const id='zmqlyygzqoidkcwdysok_aab7521f-a1c2-4149-bb7d-47bae124004f_3';
check(()=>assert.deepEqual([executingBuild(component,id).generation,executingBuild(component,id).revision],['v2',3]));
for(const invalid of ['',null,'anotherproject_aab7521f-a1c2-4149-bb7d-47bae124004f_3',id.replace('_3','_0'),id.replace('_3','_-1'),id.replace('_3','_3<script>'),id.replace('_3','_99999999999')])check(()=>assert.equal(executingBuild(component,invalid).verified,false));
check(()=>assert.equal(executingBuild('sandy-agent-runtime',id).verified,false));
check(()=>assert.equal(executingBuild('made-up-module',id).verified,false));
for(const q of ['What version are you?','List Sandy module revisions','Is your V2 release in production?','Which runtime build is answering?','What version is Examiner?'])check(()=>assert.equal(needsVersionInspection(q),true));
for(const q of ['Draft version two of this letter','What version of Python is best?','Show my latest five emails','What time is it?'])check(()=>assert.equal(needsVersionInspection(q),false));
const snap={schema_version:1,release:{active_version:'v1',state:'blocked'},components:[{component:'fresh',revision:3,version_fresh:true},{component:'old',revision:13,version_fresh:false}],specialist_modules:[{module:'Truth Engine',version:null}]};
check(()=>assert.equal(versionFactsForModel(snap).components[1].revision,null));
check(()=>assert.equal(versionFactsForModel(snap).components[1].last_known_revision,13));
check(()=>assert.equal(versionFactsForModel(snap).components[0].revision,3));
const calls=[];
globalThis.Deno={env:{get:k=>k==='DENO_DEPLOYMENT_ID'?id:undefined}};
const db={rpc:(name,args)=>({abortSignal:async()=>{calls.push({name,args});return {error:null,data:name==='sandy_note_runtime_build'?{observed:true}:snap}}})};
const got=await getVersionAwareness(db,component);
check(()=>assert.equal(got.executing.revision,3));
check(()=>assert.equal(got.release.active_version,'v1'));
check(()=>assert.equal(got.specialist_modules[0].version,null));
check(()=>assert.equal(calls[0].args.p_deployment_id,id));
check(()=>assert.match(versionInstructions(got),/candidate is not a customer cutover/));
const failed=await getVersionAwareness({rpc:()=>({abortSignal:async()=>({error:{code:'network'},data:null})})},component);
check(()=>assert.equal(failed.lookup_status,'unavailable'));
check(()=>assert.equal(failed.release.active_version,null));
check(()=>assert.equal(failed.executing.revision,3));
console.log(JSON.stringify({passed,total:30,scope:'version identity, stale data, release distinction and failure behavior; no provider sends'}));
assert.equal(passed,30);
'''

def main():
    raw=SOURCE.read_bytes()
    blob=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
    if blob!=EXPECTED_BLOB:
        raise RuntimeError('Baseline source changed; refusing to overwrite concurrent work')
    OUT.mkdir(exist_ok=True)
    helper=Path('scripts/sandy/version-awareness.js').read_bytes()
    (OUT/'version-awareness.js').write_bytes(helper)
    manifest={'base_repo_blob':blob,'source_commit':os.environ.get('GITHUB_SHA'),'release_routing_changed':False,'runtimes':{}}
    for tag in ['v1','v2']:
        base=preserved_live_source(raw.decode())
        if tag=='v2':base=v2_gmail_fixes(base)
        component='sandy-agent-runtime'+('-v2' if tag=='v2' else '')
        patched=add_awareness(base,component)
        (OUT/f'original-{tag}.ts').write_text(base)
        (OUT/f'runtime-{tag}.ts').write_text(patched)
        subprocess.run(['node','--experimental-strip-types','--check',str(OUT/f'runtime-{tag}.ts')],check=True)
        manifest['runtimes'][tag]={'component':component,'baseline_sha256':hashlib.sha256(base.encode()).hexdigest(),'patched_sha256':hashlib.sha256(patched.encode()).hexdigest()}
    (OUT/'version-tests.mjs').write_text(TESTS)
    test=subprocess.run(['node',str(OUT/'version-tests.mjs')],check=True,text=True,capture_output=True)
    (OUT/'version-test-results.json').write_text(test.stdout)
    print(test.stdout)
    # All existing contracts run unchanged against the corrected V2 candidate.
    with tempfile.TemporaryDirectory(prefix='sandy-version-contracts-') as d:
        target=Path(d)
        shutil.copytree(Path.cwd(),target,dirs_exist_ok=True,ignore=shutil.ignore_patterns('.git','node_modules','__pycache__','sandy-version-awareness-release','artifacts'))
        (target/SOURCE).write_bytes((OUT/'runtime-v2.ts').read_bytes())
        (target/SOURCE.parent/'version-awareness.js').write_bytes(helper)
        env=dict(os.environ,GITHUB_WORKSPACE=str(target),PYTHONDONTWRITEBYTECODE='1')
        test=subprocess.run(['python3','-m','unittest','discover','-s','scripts/sandy','-p','test_*.py','-v'],cwd=target,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        (OUT/'repository-contracts.log').write_text(test.stdout)
        if test.returncode:
            print(test.stdout[-12000:])
            raise RuntimeError('Existing repository contracts failed')
        print(test.stdout[-180:])
    if SOURCE.read_bytes()!=raw:raise RuntimeError('Default-branch runtime was changed')
    (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2))
    print(json.dumps(manifest,indent=2))

if __name__=='__main__':main()
