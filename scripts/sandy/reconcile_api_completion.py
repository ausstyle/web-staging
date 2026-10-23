#!/usr/bin/env python3
"""Reconcile the existing 161-family matrix with captured, read-only evidence.

Offline only: never authenticates, runs acceptance tests or mutates a provider.
Whole-family acceptance is explicit; flags, manifests and succeeded suboperations
cannot manufacture it. Outputs belong in a private directory outside Git.
"""
import argparse,csv,datetime,hashlib,json,subprocess
from collections import Counter
from pathlib import Path
from release_web_canary import original_sources
from build_requirement_coverage import execution_evidence
ROOT=Path(__file__).resolve().parents[2]
DOCS=ROOT/'docs/sandy-api'

def load(path):return json.loads(path.read_text())
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def capture(directory,name):
 value=load(directory/(name+'.json'))
 if value.get('http_status') not in (200,201):raise ValueError('unsuccessful_readback_'+name)
 return value['data']
def contracts(value,result):
 if isinstance(value,dict):
  if isinstance(value.get('operation'),str) and isinstance(value.get('contract_sha256'),str):result.setdefault(value['operation'],set()).add(value['contract_sha256'])
  for v in value.values():contracts(v,result)
 elif isinstance(value,list):
  for v in value:contracts(v,result)

def group(i):
 return 'Core orchestration' if i<=11 else 'Google Cloud' if i<=74 else 'Supabase' if i<=112 else 'GitHub' if i<=142 else 'Sandy customer services'

def build(directory):
 baseline=load(DOCS/'requirement-coverage-current.json');full={r['requirement_id']:r for r in load(DOCS/'requirement-coverage-161.json')['requirements']};disposition=load(DOCS/'scope-operation-disposition.json')
 rows=[]
 for part in baseline['parts']:
  path=DOCS/part['file']
  if sha(path)!=part['sha256']:raise ValueError('baseline_part_digest_mismatch')
  rows.extend(load(path))
 if sorted(r['id'] for r in rows)!=list(range(1,162)):raise ValueError('exact_161_unique_families_required')
 registry={x['operation']:x for x in capture(directory,'registry')};functions={x['slug']:x for x in capture(directory,'functions')};receipts=capture(directory,'success_receipts')
 current={r['operation']:r for r in receipts if r['operation'] in registry and r.get('state')=='succeeded' and r.get('contract_sha256') and r['contract_sha256']==registry[r['operation']].get('contract_sha256') and r.get('result_sha256') and isinstance(r.get('provider_http_status'),int) and 200<=r['provider_http_status']<300}
 installed={}
 new_proofs=load(directory/'new-read-verification.json')['new_operation_acceptance'] if (directory/'new-read-verification.json').exists() else []
 new_verified={p['operation']:p for p in new_proofs if p.get('passed') is True}
 for path in directory.glob('*.body'):
  try:modules=original_sources(path.read_bytes())
  except Exception:continue
  for name,value in modules.items():
   if name.endswith('.json'):
    try:contracts(json.loads(value),installed)
    except ValueError:pass
 matrix=[]
 for old in rows:
  i=old['id'];f=full[i];required=f['required_operation_ids'];reviewed=old['implementation']=='implemented_awaiting_real_family_acceptance'
  entries=[registry[o] for o in required if o in registry];active=[x['operation'] for x in entries if functions.get(x['handler'],{}).get('status')=='ACTIVE']
  installed_ops=[x['operation'] for x in entries if x.get('contract_sha256') and x['contract_sha256'] in installed.get(x['operation'],set())]
  positive=[o for o in required if o in current];historical=old['actual_required_MCP_success_operations'];external=[x for x in baseline['family_external_dependencies'] if i in x['families']]
  # The governing disposition has no whole-family acceptance records. Never
  # turn a new receipt, a green workflow or a source review into a family pass.
  accepted=disposition.get('family_acceptance',{}).get(str(i),{}).get('fully_accepted') is True
  if accepted and not old['fully_accepted']:raise ValueError('new_acceptance_requires_independent_family_review')
  deployment='reviewed_contracts_installed' if reviewed and required and set(required)<=set(installed_ops) else 'partially_manifest_attested' if installed_ops else 'active_handler_metadata_only' if active else 'not_demonstrated'
  verification='current_contract_success_receipts' if positive else 'historical_MCP_evidence_only' if historical else 'not_verified'
  remaining=old['remaining_capability']
  if reviewed:
   remaining='Complete authorised acceptance of the reviewed named constituents, including provider readback, permission/negative cases, pagination and recovery where applicable. Earlier remaining-work text is not treated as proof of absent code. '+remaining
  if i in [85,110]:remaining='Actual fixture log delivery is now verified with a retired normal engineering session. Broader authorised owner-source/parameter acceptance remains outstanding; retain the existing partial family status.'
  if i in [17,35,36,37]:remaining='The administrator route, one-use RPCs and worker binding are installed. Its Owner-authenticated execution remains unverified. Reuse the existing keyless worker to inspect IAP policy/etags, then only the already-authorised target/port repair if required. '+remaining
  if i==60:remaining='The existing Cloud Run candidate is source/identity verified and its normal-Auth MCP/log test passed; production traffic is still on the prior revision. Administrator impersonation, general Cloud Run lifecycle and guarded promotion/rollback acceptance remain incomplete.'
  if i==75:remaining='The scoped organisation-list adapter is implemented and deployed, but the current standing operation-class table has no supabase.orgs.list entry. No unauthorised call was attempted. Review/install the appropriate metadata classification through a legitimate administrator process, then verify project-bound organisation filtering; do not recreate the adapter or self-expand the grant.'
  if i in [36,37]:
   deployment='deployed_closed_transport'
   remaining='Native SSH/WinRM transport source is installed as sandy-vm-protocol-api v2 and all 24 captured source modules match main. The route remains closed pending applicable target-bound authority, host identity/credential binding and actual command/output/exit/recovery acceptance. Reuse this transport; no new agent installation/enrolment is authorised. '+remaining
  row={'id':i,'group':group(i),'requirement':old['requirement'],'code_status':'reviewed_implemented' if reviewed else 'partial_or_constituents_unreconciled','constituent_mapping':old['constituent_mapping'],
   'production_status':deployment,'provider_verification_status':verification,'accepted':accepted,'externally_blocked':bool(external),'external_dependency_status':'recorded_dependency_not_retested' if external else 'none_established','external_blockers':[{'id':x['id'],'type':x['type'],'basis':'documented_prior_denial_or_entitlement_not_retested','actual_error':x['actual_error'],'required_authority':x['required_authority'],'evidence_file':x['evidence_file']} for x in external],
   'required_or_candidate_operations':required,'registered_contracts':len(entries),'active_handler_operations':active,'installed_manifest_contracts':installed_ops,'current_contract_succeeded_receipts':[current[o] for o in positive],
   'historical_MCP_success_operations':historical,'historical_MCP_denials':old['actual_required_MCP_denials'],'missing_required_contracts':[o for o in required if o not in registry],
   'verified_MCP_success_operations_including_new_cases':sorted(set(historical)|{o for o in required if o in new_verified}),
   'new_independently_verified_cases':[new_verified[o] for o in required if o in new_verified],
   'deployed_handlers':{x['handler']:{'version':functions[x['handler']]['version'],'status':functions[x['handler']]['status']} for x in entries if x['handler'] in functions},'remaining_work':remaining}
  matrix.append(row)
 summary={'families':161,'accepted_families':sum(x['accepted'] for x in matrix),'reviewed_implemented_families':sum(x['code_status']=='reviewed_implemented' for x in matrix),'partial_or_unreconciled_families':sum(x['code_status']!='reviewed_implemented' for x in matrix),
  'historical_partial_required_MCP_families':sum(bool(x['historical_MCP_success_operations']) for x in matrix),'distinct_succeeded_receipt_operations':len(receipts),'current_contract_positive_receipt_operations':len(current),'families_with_current_contract_partial_receipts':sum(bool(x['current_contract_succeeded_receipts']) for x in matrix),
  'families_with_documented_external_dependencies':sum(x['externally_blocked'] for x in matrix),'registry_rows':len(registry),'api_flags':sum(bool(x['api_exposed']) for x in registry.values()),'ai_flags':sum(bool(x['ai_exposed']) for x in registry.values()),'verified_flags':sum(bool(x['verified']) for x in registry.values()),
  'production_classification_counts':dict(Counter(x['production_status'] for x in matrix)),'provider_verification_classification_counts':dict(Counter(x['provider_verification_status'] for x in matrix)),
  'missing_named_required_contracts':[x for x in ['supabase.projects.list','supabase.projects.create','supabase.functions.invoke'] if x not in registry]}
 documented_positive,_=execution_evidence()
 summary['documented_distinct_MCP_success_operations_including_new_cases']=len(set(documented_positive)|set(new_verified))
 summary['families_with_partial_MCP_evidence_including_new_cases']=sum(bool(x['verified_MCP_success_operations_including_new_cases']) for x in matrix)
 summary['new_independently_verified_read_cases']=len(new_verified)
 priorities=[
 {'order':1,'families':[17,35,36,37,60],'action':'Use legitimate administrator authentication or an administrator-established narrowly scoped grant to run the already installed keyless preflight. Verify actual runtime identity, 30-minute impersonation and both IAP policy reads; do not replace credentials or repeat successful MCP/log tests.','gate':'The GitHub release lacked an Owner session; the configured runner Auth check returned HTTP 403. No successful administrator-read admission exists.'},
 {'order':2,'families':[35,36,37,38,39,40,41,42,43,44,45,46],'action':'Inspect policy/etag, then apply only an authorised missing target/port IAP binding. Activate existing SSH/WinRM contracts with target-bound host identity/credentials. Execute the first authorised Linux and Windows identity canaries and compatible rollback. Complete graphical session/artifact/isolation lifecycle.','gate':'Both managed enrollments remain disabled at generation 0. Native closed transport code is installed; no successful OS command or graphical acceptance receipt is established. Do not install/enrol agents or expand IAM under this assessment.'},
 {'order':3,'families':[75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112],'action':'Close the three named Supabase contract gaps in existing adapters, reconcile wildcard constituents, and accept reversible governed migrations/functions/secrets/SQL/storage/auth lifecycles on authorised fixtures. Reuse the new nonempty log receipt.','gate':'The standing Supabase grant is metadata-read only; production/security writes need applicable legitimate delegated authority. Custom-domain entitlement remains a separate recorded exception.'},
 {'order':4,'families':list(range(113,143)),'action':'Reuse exact file/commit/ref readbacks. Complete owned draft-PR lifecycle, independently reviewed merge and cleanup, then missing run/artifact/deployment/release/binary-custody lifecycles.','gate':'Some immutable blob/tree receipts remain accepted rather than effect-settled. Repository secret metadata previously returned provider 403; do not infer additional permission from ordinary source access.'},
 {'order':5,'families':list(range(143,162))+list(range(1,12)),'action':'Reuse the 20-check onboarding and 64-check provisioning cohorts. Finish actual external provisioning, tenant lifecycle and durable Mission/plan/cancel/retry/compensation outcomes through shared APIs and the cross-channel runtime. Close independent ground-truth, multi-turn Mission and recovery gates.','gate':'Two passed Examiner metadata gates do not certify full autonomous orchestration. Customer-service wildcards and cross-channel acceptance remain open.'},
 {'order':6,'families':list(range(12,75)),'action':'In parallel, close the reviewed GCP read/lifecycle and wildcard sets under existing target/risk/budget policies; record whole-family acceptance only when each required constituent has valid source, deployment, permitted fixture, provider readback and recovery evidence.','gate':'Project/folder/key/IAM/spend/destructive mutations are outside routine blanket authority. No new project, key, purchase or permission expansion is authorised just to complete a count.'}
 ]
 provenance={p.name:{'sha256':sha(p),'bytes':p.stat().st_size} for p in directory.glob('*.json') if p.name not in ['completion-assessment.json']}
 return {'generated_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source_head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'baseline_generated_at_utc':baseline['generated_at_utc'],'summary':summary,'semantics':['A family can have both software work and an external dependency.','Sandy database/readiness receipts are not Google guest-command or provider-effect evidence.','A current registry contract digest match is operation receipt reconciliation, not proof of whole-family acceptance or universal execution eligibility.','Unreviewed wildcard candidates are not a definitive list of independent development tasks.','Private source parity and release receipts, not working-tree publication alone, establish installed code evidence.'],'new_verified_cases':list(new_verified.values()),'critical_path':priorities,'families':matrix,'evidence_snapshot_sha256':provenance}

def write(report,out):
 out.mkdir(parents=True,exist_ok=True,mode=0o700)
 def save(name,text):p=out/name;p.write_text(text);p.chmod(0o600)
 save('completion-assessment.json',json.dumps(report,indent=2)+'\n')
 fields=['id','group','requirement','code_status','production_status','provider_verification_status','accepted','externally_blocked','external_dependency_status','registered_contracts','installed_manifest_count','current_positive_receipts','historical_MCP_operations','new_independently_verified_count','external_dependency_ids','missing_required_contracts','remaining_work']
 with (out/'completion-assessment.csv').open('w',newline='') as f:
  writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader()
  for row in report['families']:
   writer.writerow({k:row.get(k) for k in fields if k in row}|{'installed_manifest_count':len(row['installed_manifest_contracts']),'current_positive_receipts':len(row['current_contract_succeeded_receipts']),'historical_MCP_operations':len(row['historical_MCP_success_operations']),'new_independently_verified_count':len(row['new_independently_verified_cases']),'external_dependency_ids':'; '.join(x['id'] for x in row['external_blockers']),'missing_required_contracts':'; '.join(row['missing_required_contracts'])})
 (out/'completion-assessment.csv').chmod(0o600)
 s=report['summary'];lines=['# Sandy API completion assessment',f"Observed {report['generated_at_utc']}; source `{report['source_head']}`.",'',f"**{s['accepted_families']}/161 whole families accepted; {s['reviewed_implemented_families']} reviewed implementations; {s['partial_or_unreconciled_families']} partial or requiring constituent reconciliation.**",'',f"Independent ledger readback: {s['distinct_succeeded_receipt_operations']} distinct operations have succeeded receipts; {s['current_contract_positive_receipt_operations']} match current contract digests, contain result digests and record successful HTTP status, covering parts of {s['families_with_current_contract_partial_receipts']} families. These are overlapping evidence sets, not additional accepted families.", '',f"Documented positive MCP coverage is now {s['documented_distinct_MCP_success_operations_including_new_cases']} distinct operations across parts of {s['families_with_partial_MCP_evidence_including_new_cases']} families. {s['new_independently_verified_read_cases']} missing read cases were completed here; completed provider/customer tests were reused.", '', '## New independently verified read cases', '']
 for case in report['new_verified_cases']:lines += [f"- `{case['operation']}`: provider HTTP 200, schema valid, matching canonical result digest, succeeded central receipt, valid audit hashes and independent provider readback. Admission `{case['admission_id']}`."]
 lines+=['','## Shortest critical path','']
 for step in report['critical_path']:lines += [f"{step['order']}. {step['action']}",f"   Gate: {step['gate']}",'']
 lines+=['## Per-family assessment','','`reviewed_implemented` applies to reviewed named constituents on authorised targets. Installed manifest contracts prove deployed contract source, not provider execution. `active_handler_metadata_only` needs further source/constituent attestation. Historical dependencies were reused, not retested.','','| # | Family | Code | Production | Current / historical positive operations | Accepted | External dependency | Remaining work |','|---:|---|---|---|---:|---|---|---|']
 for r in report['families']:
  values=[r['id'],r['requirement'],r['code_status'],r['production_status'],str(len(r['current_contract_succeeded_receipts']))+' / '+str(len(r['historical_MCP_success_operations'])),'Yes' if r['accepted'] else 'No',', '.join(x['id'] for x in r['external_blockers']) or 'None established',r['remaining_work']]
  lines.append('| '+' | '.join(str(v).replace('|','/').replace('\n',' ') for v in values)+' |')
 save('completion-assessment.md','\n'.join(lines)+'\n')
 html='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sandy API — private completion register</title>
<style>body{font:15px system-ui;max-width:1600px;margin:32px auto;padding:0 20px;background:#f7f8fa;color:#172235}h1{font-size:28px}input,select{padding:9px;border:1px solid #aab4c4;border-radius:5px;max-width:95%}label{display:inline-block;margin:6px 16px 6px 0}table{border-collapse:collapse;width:100%;background:white}td,th{border:1px solid #d8dee8;padding:10px;text-align:left;vertical-align:top}th{background:#e9eff7;position:sticky;top:0}small{color:#4e5c70}.counts{font-size:18px;font-weight:600}summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px ui-monospace}tr:nth-child(even){background:#f5f8fc}.note{max-width:1050px;line-height:1.5}</style>
<h1>Sandy API completion register</h1><p class="counts" id="counts"></p>
<p class="note">Private evidence assessment. A deployed handler, registry flag or successful suboperation does not establish whole-family acceptance. Historical external dependencies have not been retested. Each family can have both software work and an authority dependency. Expand a family for its constituent operations, receipts and remaining work.</p>
<label>Search <input id="search" type="search" placeholder="Family, operation or remaining work"></label>
<label>Group <select id="group"><option value="">All</option></select></label>
<label>Code <select id="code"><option value="">All</option><option value="reviewed_implemented">Reviewed implementations</option><option value="partial_or_constituents_unreconciled">Partial / unreconciled</option></select></label>
<label>Evidence <select id="evidence"><option value="">All</option><option value="current_contract_success_receipts">Current contract receipts</option><option value="historical_MCP_evidence_only">Historical MCP only</option><option value="not_verified">No positive required-operation evidence</option><option value="external">Recorded external dependency</option></select></label>
<p id="shown"></p><table><thead><tr><th>#</th><th>Family and details</th><th>Code</th><th>Production</th><th>Evidence</th><th>Accepted</th><th>External dependency</th></tr></thead><tbody id="rows"></tbody></table>
<script id="data" type="application/json">__REPORT__</script>
<script>
'use strict';const report=JSON.parse(document.getElementById('data').textContent),families=report.families;
const el=id=>document.getElementById(id),human=s=>s.replaceAll('_',' ');
el('counts').textContent=`${report.summary.accepted_families}/161 whole families accepted · ${report.summary.reviewed_implemented_families} reviewed implementations · ${report.summary.partial_or_unreconciled_families} partial or unreconciled`;
for(const group of new Set(families.map(r=>r.group))){const o=document.createElement('option');o.value=o.textContent=group;el('group').append(o)}
function cell(row,text){const td=document.createElement('td');td.textContent=text;row.append(td);return td}
function render(){el('rows').replaceChildren();const search=el('search').value.toLowerCase();let count=0;
for(const f of families){if(el('group').value&&f.group!==el('group').value)continue;if(el('code').value&&f.code_status!==el('code').value)continue;
const evidence=el('evidence').value;if(evidence==='external'&&!f.externally_blocked)continue;if(evidence&&evidence!=='external'&&f.provider_verification_status!==evidence)continue;
if(search&&!JSON.stringify(f).toLowerCase().includes(search))continue;count++;const tr=document.createElement('tr');cell(tr,f.id);
const td=cell(tr,'');const details=document.createElement('details'),summary=document.createElement('summary'),p=document.createElement('p'),pre=document.createElement('pre');summary.textContent=f.requirement;p.textContent=f.remaining_work;
pre.textContent=JSON.stringify({constituent_mapping:f.constituent_mapping,operations:f.required_or_candidate_operations,installed_manifest_contracts:f.installed_manifest_contracts,deployed_handlers:f.deployed_handlers,current_contract_receipts:f.current_contract_succeeded_receipts,historical_MCP_success_operations:f.historical_MCP_success_operations,new_verified_cases:f.new_independently_verified_cases,external_dependencies:f.external_blockers,missing_contracts:f.missing_required_contracts},null,2);
details.append(summary,p,pre);td.append(details);cell(tr,human(f.code_status));cell(tr,human(f.production_status));cell(tr,human(f.provider_verification_status)+` (${f.current_contract_succeeded_receipts.length} current / ${f.historical_MCP_success_operations.length} historical required operations)`);cell(tr,f.accepted?'Yes':'No');cell(tr,f.externally_blocked?f.external_blockers.map(x=>x.id).join(', ')+' — historical, not retested':'None established');el('rows').append(tr)}
el('shown').textContent=`Showing ${count} of 161 families · Snapshot ${report.generated_at_utc}`}
for(const id of ['search','group','code','evidence'])el(id).addEventListener('input',render);render();
</script></html>'''
 save('completion-assessment.html',html.replace('__REPORT__',json.dumps(report).replace('<','\\u003c')))

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--evidence-dir',type=Path,required=True);p.add_argument('--output-dir',type=Path,required=True);a=p.parse_args()
 if a.output_dir.resolve().is_relative_to(ROOT):raise SystemExit('Private completion reports must remain outside the public repository')
 report=build(a.evidence_dir);write(report,a.output_dir);print(json.dumps(report['summary']))
if __name__=='__main__':main()
