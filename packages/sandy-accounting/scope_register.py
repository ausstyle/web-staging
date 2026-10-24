"""Generate exhaustive delivery bookkeeping from the canonical v1.1 scope.

No feature is upgraded to accepted because a supporting component test passes.
"""
from pathlib import Path
import hashlib
import json
import re
import sys
ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'docs/sandy-engineering/tasks/SANDY-ENG-0013-sandy-accounting.md'
OUT=ROOT/'docs/sandy-accounting/delivery-register.json'
text=SOURCE.read_text()
features=[]
for line in text.splitlines():
    match=re.match(r'\| (F\d{3}) · (.*?) \| (.*?) \| (.*?) \|$',line)
    if match:
        fid,label,outcome,module=match.groups()
        n=int(fid[1:])
        wp='WP1' if n<=23 or 174<=n<=189 or 234<=n<=280 else 'WP2' if n<=108 else 'WP3' if n<=173 else 'WP4' if n<=197 or 281<=n<=292 else 'WP6' if 198<=n<=221 or n>=343 else 'WP5'
        features.append({'id':fid,'source_feature':label,'required_outcome':outcome,'module':module,'work_package':wp,'status':'NOT_STARTED','delivery_paths':[],'test_paths':[],'remaining':'Full function acceptance pending.','deployed':False,'independently_accepted':False})
assert [f['id'] for f in features]==[f'F{i:03}' for i in range(1,353)]
partial={
 'F013':'Statement/book totals and unmatched line IDs; dashboard styling and full work queues pending.',
 'F036':'Basic invoice identity/dates; controlled sequence management pending.',
 'F038':'Exact net/tax lines; quantity, discounts, tracking and item pricing pending.',
 'F040':'Versioned source reference and exact totals; real file adapter/PDF pending.',
 'F042':'Draft/approve workflow; outbound sends remain unavailable.',
 'F045':'Dated invoice/bill void and payment-record reversal; partial credits/refunds pending.',
 'F046':'Partial receipt recording; reminders and verified provider payments pending.',
 'F051':'Applied customer credits against unpaid original lines, dated reversals and historical AR; standalone credits/refunds/reallocation pending.',
 'F120':'Contact/number uniqueness; fuzzy duplicate review pending.',
 'F124':'Applied supplier credits and reversal; recurring bills, standalone credits/refunds and PO integration pending.',
 'F126':'Basic supplier bill header; foreign-currency documents pending.',
 'F128':'Exact net/tax lines; item/tracking pending.',
 'F131':'Deterministic totals; independent tax review pending.',
 'F132':'Draft/approve workflow; full approvals integration pending.',
 'F136':'Partial payment recording; no money movement.',
 'F153':'Bank/statement comparison and reconciliation report; real feeds pending.',
 'F155':'Posted journal drilldown; broader linked transaction UI pending.',
 'F158':'Immutable separate statement store; full imports pending.',
 'F160':'Synthetic structured import; CSV/OFX/QIF and real sources pending.',
 'F164':'Exact match proposal/review; broad search workflow pending.',
 'F167':'Partial/multiple matches with no overmatching; intelligence acceptance pending.',
 'F175':'Posted journal list; full journal lifecycle tabs/filtering pending.',
 'F178':'Effective date/narration; tax treatment and auto-reversal schedule pending.',
 'F179':'Explicit manual-journal cash inclusion, preserved on reversal; autofill and full editor pending.',
 'F182':'Evidence-backed posting through service; full draft editor pending.',
 'F186':'Scoped ledger accounts and document coding; richer COA configuration pending.',
 'F187':'Five account classes and archived-state browsing; full filtering/exports pending.',
 'F188':'Create classified accounts through guarded service/UI; import/export/print/tax defaults pending.',
 'F189':'Protected/in-use account archival denied, classification/deletion immutable; full adviser-controlled lifecycle pending.',
 'F197':'Append-only command audit chain; shared audit integration pending.',
 'F207':'Seven basic deterministic reports; entire 87-report contract remains open.',
 'F208':'Exact journal-line contributors; live file ACL integration pending.',
 'F212':'Entity/period/basis/currency/revision; report formatting pending.',
 'F272':'Monotonic lock and posting/reconciliation denial; adviser/reopen flow pending.',
 'F274':'Explicit sourced FX on journals; rate catalogue and revaluation pending.',
}
for f in features:
    f['operations']=[]
    f['canonical_registry_state']='NOT_INSTALLED'
    if f['id'] in partial:
        f.update(status='CODE_PRESENT_UNVERIFIED',delivery_paths=['packages/sandy-accounting/service.ts','packages/sandy-accounting/schema.sql'],test_paths=['packages/sandy-accounting/core.test.ts'],remaining=partial[f['id']])
        if f['id'] in ['F045','F046','F136']:
            f['delivery_paths']+=['packages/sandy-accounting/workspace.html']
            f['test_paths']+=['packages/sandy-accounting/corrections.test.ts','packages/sandy-accounting/temporal.test.ts','packages/sandy-accounting/browser_test.py']
        if f['id'] in ['F186','F187','F188','F189']:
            f['delivery_paths']+=['packages/sandy-accounting/workspace.html']
            f['test_paths']+=['packages/sandy-accounting/accounts.test.ts','packages/sandy-accounting/browser_test.py']
        if f['id'] in ['F045','F046','F051','F124','F136','F179','F207','F208','F212']:
            f['test_paths']+=['packages/sandy-accounting/cash.test.ts','packages/sandy-accounting/credits.test.ts','packages/sandy-accounting/postgres.test.ts','packages/sandy-accounting/browser_test.py']
        n=int(f['id'][1:])
        f['operations']=['accounting.reporting.run','accounting.workspace.get'] if n in [13,153,175,207,212] else ['accounting.sales.invoice.draft'] if n in [36,38,40] else ['accounting.documents.approve'] if n in [42,132] else ['accounting.documents.void','accounting.documents.payment.reverse'] if n==45 else ['accounting.documents.payment.record'] if n in [46,136] else ['accounting.payables.bill.draft'] if n in [120,126,128,131] else ['accounting.reporting.drilldown'] if n in [155,208] else ['accounting.banking.statements.import'] if n in [158,160] else ['accounting.intelligence.matches.propose','accounting.banking.reconcile.apply','accounting.banking.reconcile.reverse'] if n in [164,167] else ['accounting.audit.verify'] if n==197 else ['accounting.organisations.period.lock'] if n==272 else ['accounting.ledger.journal.post','accounting.ledger.journal.reverse']
        if 186<=n<=189:f['operations']=['accounting.accounts.create','accounting.accounts.archive','accounting.workspace.get']
        if n in [51,124]:f['operations']=['accounting.documents.credit.record','accounting.documents.credit.reverse']
reports=[]
b=text.split('# Appendix B —',1)[1].split('# Appendix C —',1)[0]
category=''
implemented={'Balance Sheet':'balance_sheet','Profit and Loss':'profit_and_loss','Aged Payables Detail':'aged_payables','Aged Receivables Detail':'aged_receivables','Bank Reconciliation':'bank_reconciliation','General Ledger Detail':'general_ledger','Trial Balance':'trial_balance'}
for line in b.splitlines():
    if line.startswith('## B. '):category=line[6:]
    if line.startswith('| ') and not line.startswith('| Required') and not line.startswith('| ---'):
        name,outcome=[v.strip() for v in line.split('|')[1:3]]
        reports.append({'id':f'RPT-{len(reports)+1:03}','name':name,'category':category,'required_outcome':outcome,'status':'CODE_PRESENT_UNVERIFIED' if name in implemented else 'NOT_STARTED','operation':'accounting.reporting.run' if name in implemented else None,'report_selector':implemented.get(name),'test_paths':['packages/sandy-accounting/core.test.ts','packages/sandy-accounting/cash.test.ts','packages/sandy-accounting/credits.test.ts'] if name in implemented else [],'remaining':'Cash/accrual views exist for TB, P&L, balance sheet and GL only; full filters, layouts/exports, source contract and accountant acceptance pending.','deployed':False,'independently_accepted':False})
assert len(reports)==87
gates=[]
for line in text.splitlines():
    m=re.match(r'\| (?:\*\*)?((?:IA|AC)\d{2}) (.*?) \| (.*?) \|$',line)
    if m:
        gid,title,scenario=m.groups();gates.append({'id':gid,'title':title.replace('**',''),'scenario':scenario,'status':'NOT_STARTED','independently_accepted':False})
assert len(gates)==31 and len(set(x['id'] for x in gates))==31
capabilities=[]
for line in text.splitlines():
    m=re.match(r'\| \*\*(SAI-\d{3}) (.*?)\*\* \| (.*?) \| (.*?) \| (.*?) \|$',line)
    if m:
        sid,title,required,boundary,prior=m.groups();capabilities.append({'id':sid,'title':title,'required_outcome':required,'boundary':boundary,'status':'NOT_STARTED','independently_accepted':False})
assert len(capabilities)==15
for capability in capabilities:
    if capability['id'] in ['SAI-001','SAI-002','SAI-003']:
        capability.update(status='CODE_PRESENT_UNVERIFIED',remaining='Partial deterministic local foundation only; full Section 6 capability/IA acceptance remains pending.',test_paths=['packages/sandy-accounting/core.test.ts','packages/sandy-accounting/corrections.test.ts'])
register={'scope_id':'SANDY-ENG-0013','version':'1.1','source_path':str(SOURCE.relative_to(ROOT)),'source_sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),'pr286_head':'2cf5f04650d9623a78daf0894dc6b670936aa9ed','scope_status':'OPEN','source_inventory':'Canonical Appendix A/B transcription of U1 v4; original private DOCX not present in workspace','features':features,'reports':reports,'intelligence':capabilities,'acceptance_gates':gates}
output=json.dumps(register,indent=2,ensure_ascii=False)+'\n'
if '--check' in sys.argv:
    assert OUT.read_text()==output,'Delivery register drift; regenerate and review.'
else:OUT.write_text(output)
print('Scope intact: 352 functions, 87 reports, 15 intelligence capabilities, 31 acceptance gates; none independently accepted.')
