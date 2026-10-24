"""Real Chromium workflow against a temporary synthetic PostgreSQL fixture."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.request
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent
OUT = Path(os.environ.get('ACCOUNTING_BROWSER_EVIDENCE', '/tmp/sandy-accounting-csv-browser-evidence'))
OUT.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='accounting-browser-') as books:
    env = {**os.environ, 'ACCOUNTING_FIXTURE_PORT': '4315', 'ACCOUNTING_FIXTURE_DIR': books}
    proc = subprocess.Popen(['node', str(ROOT/'server.ts')], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen('http://127.0.0.1:4315', timeout=1)
                break
            except OSError:
                if proc.poll() is not None:
                    raise RuntimeError(proc.stderr.read().decode())
                time.sleep(.1)
        with sync_playwright() as p:
            executable = os.environ.get('ACCOUNTING_CHROMIUM') or shutil.which('chromium')
            browser = p.chromium.launch(headless=True, **({'executable_path':executable} if executable else {}))
            page = browser.new_page(viewport={'width':1360,'height':1000})
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto('http://127.0.0.1:4315')
            def saved():
                expect(page.locator('#status')).to_have_text('Completed local request. No external action performed.')
            saved()
            page.locator('#opening').click();saved()
            expect(page.locator('#bank-total')).to_have_text('$1000.00')
            page.get_by_role('button',name='Sales & purchases',exact=True).click()
            page.get_by_role('button',name='Save draft',exact=True).click();saved()
            page.get_by_role('button',name='Approve DEMO-001',exact=True).click();saved()
            page.get_by_role('button',name='Record payment',exact=True).click();saved()
            page.get_by_role('button',name='Banking',exact=True).click()
            page.get_by_role('button',name='Preview CSV',exact=True).click();saved()
            expect(page.locator('#csv-preview')).to_contain_text('NEW')
            page.get_by_role('button',name='Import reviewed CSV',exact=True).click();saved()
            receipt=json.loads(page.locator('#csv-receipt').inner_text())
            assert receipt['inserted']==3 and receipt['ledger_mutated'] is False and receipt['reconciled'] is False
            payment_statement=next(r['statement_id'] for r in receipt['rows'] if r['source_key']=='CSV-RECEIPT')
            page.get_by_role('button',name='Preview CSV',exact=True).click();saved()
            expect(page.locator('#csv-preview')).to_contain_text('DUPLICATE')
            page.get_by_role('button',name='Import reviewed CSV',exact=True).click();saved()
            duplicate=json.loads(page.locator('#csv-receipt').inner_text())
            assert duplicate['inserted']==0 and duplicate['duplicates']==3
            expect(page.locator('#statements tbody tr')).to_have_count(3)
            page.locator('#csv-fixture').select_option('1')
            page.get_by_role('button',name='Preview CSV',exact=True).click();saved()
            expect(page.locator('#csv-preview')).to_contain_text('SOURCE_CONFLICT')
            expect(page.locator('#csv-import')).to_be_hidden()
            page.locator('#csv-fixture').select_option('2')
            page.get_by_role('button',name='Preview CSV',exact=True).click();saved()
            expect(page.locator('#csv-preview')).to_contain_text('POSSIBLE_DUPLICATE')
            expect(page.locator('#csv-import')).to_be_hidden()
            page.locator('[data-csv-record="2"] input[name="reason"]').fill('Synthetic overlap checked against original statement')
            page.get_by_role('button',name='Skip duplicate row',exact=True).click();saved()
            expect(page.locator('#csv-preview')).to_contain_text('SKIPPED')
            page.get_by_role('button',name='Import reviewed CSV',exact=True).click();saved()
            assert json.loads(page.locator('#csv-receipt').inner_text())['skipped']==1
            page.get_by_role('button',name='View import history',exact=True).click();saved()
            history=json.loads(page.locator('#detail-output').inner_text())
            assert len(history['imports'])==3
            assert any(r.get('review',{}).get('reason')=='Synthetic overlap checked against original statement' for i in history['imports'] for r in i['rows'])
            page.locator('#close-detail').click()
            # The local adapter rejects any file outside the fixed synthetic corpus.
            page.locator('#csv-upload').set_input_files({'name':'unknown.csv','mimeType':'text/csv','buffer':b'source_key,date,amount,reference\nREAL,2026-10-01,9,unknown\n'})
            expect(page.locator('#status')).to_contain_text('Only copies of the provided synthetic CSV')
            page.get_by_role('button',name='Review unmatched lines',exact=True).click();saved()
            expect(page.locator('#bank-review').get_by_role('button',name='Approve match',exact=True)).to_have_count(2)
            for _ in range(2):
                page.locator('#bank-review').get_by_role('button',name='Approve match',exact=True).first.click();saved()
            expect(page.locator('#bank-review')).to_contain_text('Synthetic unexplained fee')
            expect(page.locator('#bank-review')).to_contain_text('NO_EXACT_MATCH')
            expect(page.locator('#bank-review').get_by_role('button',name='Approve match',exact=True)).to_have_count(0)
            page.locator('#matches p').filter(has_text=payment_statement).get_by_role('button',name='Undo match',exact=True).click();saved()
            page.get_by_role('button',name='Review unmatched lines',exact=True).click();saved()
            expect(page.locator('[data-statement-source="CSV-RECEIPT"]')).to_contain_text('remaining $100.00')
            expect(page.locator('#statements tbody tr')).to_have_count(3)
            page.screenshot(path=str(OUT/'csv-review.png'),full_page=True)
            page.get_by_role('button',name='Reports',exact=True).click()
            page.locator('#report-type').select_option('bank_reconciliation')
            page.get_by_role('button',name='Run report',exact=True).click();saved()
            report=json.loads(page.locator('#report-output pre').inner_text())['rows'][0]
            assert report['book']=='1100.00' and report['statement']=='1097.50' and report['difference']=='-2.50'
            assert len(report['unmatched_statement_ids'])==2
            page.get_by_role('button',name='Controls & audit',exact=True).click()
            page.get_by_role('button',name='Verify audit chain',exact=True).click();saved()
            assert json.loads(page.locator('#audit-output').inner_text())['valid']
            assert not errors, errors
            browser.close()
            result={'status':'PASSED','class':'LOCAL_SYNTHETIC_BROWSER','inserted':3,'duplicate_rows':3,'reviewed_skips':1,'changed_source_conflict_blocked':True,'unknown_file_rejected':True,'undo_preserves_statements':True,'bank_book':'1100.00','bank_statement':'1097.50','unresolved_difference':'-2.50','provider_verified':False,'independently_accepted':False,'page_errors':errors}
            (OUT/'result.json').write_text(json.dumps(result,indent=2)+'\n')
            print(json.dumps(result,indent=2))
    finally:
        proc.terminate()
        proc.wait(timeout=15)
