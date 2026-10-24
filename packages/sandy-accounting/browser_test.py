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
OUT = Path(os.environ.get('ACCOUNTING_BROWSER_EVIDENCE', '/tmp/sandy-accounting-browser-evidence'))
OUT.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='accounting-browser-') as books:
    env = {**os.environ, 'ACCOUNTING_FIXTURE_PORT': '4314', 'ACCOUNTING_FIXTURE_DIR': books}
    proc = subprocess.Popen(['node', str(ROOT/'server.ts')], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen('http://127.0.0.1:4314', timeout=1)
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
            page.goto('http://127.0.0.1:4314')
            def saved():
                expect(page.locator('#status')).to_have_text('Completed local request. No external action performed.')
            saved()
            page.locator('#opening').click();saved()
            expect(page.locator('#bank-total')).to_have_text('$1000.00')
            page.get_by_role('button',name='Sales & purchases',exact=True).click()
            page.get_by_role('button',name='Save draft',exact=True).click();saved()
            expect(page.locator('#documents')).to_contain_text('Draft')
            page.get_by_role('button',name='Approve DEMO-001',exact=True).click();saved()
            page.get_by_role('button',name='Record payment',exact=True).click();saved()
            expect(page.locator('#documents')).to_contain_text('remaining $0.00')
            page.get_by_role('button',name='Banking',exact=True).click()
            page.get_by_role('button',name='Import line',exact=True).click();saved()
            # Add independently visible opening line, then match both.
            page.locator('#source-key').fill('DEMO-OPENING')
            page.locator('#statement-amount').fill('1000.00')
            page.locator('#statement-date').fill('2026-10-01')
            page.locator('#reference').fill('Synthetic opening')
            page.get_by_role('button',name='Import line',exact=True).click();saved()
            page.get_by_role('button',name='Intelligence',exact=True).click()
            page.get_by_role('button',name='Find exact bank matches',exact=True).click();saved()
            expect(page.get_by_role('button',name='Approve match',exact=True)).to_have_count(2)
            for _ in range(2):
                page.get_by_role('button',name='Approve match',exact=True).first.click();saved()
            page.get_by_role('button',name='Reports',exact=True).click()
            page.locator('#report-type').select_option('bank_reconciliation')
            page.get_by_role('button',name='Run accrual report',exact=True).click();saved()
            report = json.loads(page.locator('#report-output pre').inner_text())
            assert report['rows']==[{'account_id':'bank','book':'1100.00','statement':'1100.00','difference':'0.00','unmatched_statement_ids':[]}]
            page.locator('#report-type').select_option('profit_and_loss')
            page.get_by_role('button',name='Run accrual report',exact=True).click();saved()
            assert json.loads(page.locator('#report-output pre').inner_text())['profit']=='100.00'
            page.locator('#report-output').get_by_role('button',name='View journal').first.click();saved()
            expect(page.locator('#detail-output')).to_contain_text('synthetic-worksheet')
            page.locator('#close-detail').click()
            page.get_by_role('button',name='Intelligence',exact=True).click()
            page.get_by_role('button',name='Calculate 13-week scenario',exact=True).click();saved()
            scenario=json.loads(page.locator('#forecast-output').inner_text())
            assert scenario['state']=='FORECAST' and len(scenario['buckets'])==13
            assert scenario['buckets'][-1]['closing']=='1100.00'
            assert scenario['ledger_mutated'] is False
            page.get_by_role('button',name='Overview',exact=True).click()
            page.screenshot(path=str(OUT/'workspace.png'),full_page=True)
            page.get_by_role('button',name='Controls & audit',exact=True).click()
            page.get_by_role('button',name='Verify audit chain',exact=True).click();saved()
            assert json.loads(page.locator('#audit-output').inner_text())['valid']
            assert not errors, errors
            browser.close()
            (OUT/'result.json').write_text(json.dumps({'status':'PASSED','class':'LOCAL_SYNTHETIC_BROWSER','expected_bank':'1100.00','expected_profit':'100.00','provider_verified':False,'independently_accepted':False,'page_errors':errors},indent=2)+'\n')
            print((OUT/'result.json').read_text())
    finally:
        proc.terminate()
        proc.wait(timeout=15)
