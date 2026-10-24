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
OUT = Path(os.environ.get('ACCOUNTING_BROWSER_EVIDENCE', '/tmp/sandy-accounting-recovery-browser-evidence'))
OUT.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='accounting-browser-') as books:
    env = {**os.environ, 'ACCOUNTING_FIXTURE_PORT': '4316', 'ACCOUNTING_FIXTURE_DIR': books}
    proc = subprocess.Popen(['node', str(ROOT/'server.ts')], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen('http://127.0.0.1:4316', timeout=1)
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
            page.goto('http://127.0.0.1:4316')
            def saved():
                expect(page.locator('#status')).to_have_text('Completed local request. No external action performed.')
            saved()
            page.get_by_role('button',name='Sales & purchases',exact=True).click()
            outcomes=[]
            seen=[]
            def observe(request):
                if request.url.endswith('/api/run') and request.method=='POST': seen.append(request.post_data_json)
            page.on('request',observe)
            def lose_response(operation, fault):
                captured=[]
                def intercept(route):
                    req=route.request.post_data_json
                    if req['operation']!=operation:
                        route.continue_();return
                    response=route.fetch()
                    assert response.status==200,response.text()
                    captured.extend([req,response.json()['result']])
                    if fault=='truncated_body': route.fulfill(response=response,body='{"result":')
                    elif fault=='commit_unknown': route.fulfill(status=400,content_type='application/json',body=json.dumps({'error':'commit_outcome_unknown_retry_same_key'}))
                    elif fault=='gateway_error': route.fulfill(status=502,content_type='application/json',body=json.dumps({'error':'synthetic_gateway_error'}))
                    else: route.fulfill(response=response,body='{}')
                    page.unroute('**/api/run',intercept)
                page.route('**/api/run',intercept)
                return captured
            def recover(captured):
                expect(page.locator('#status')).to_contain_text('unknown')
                expect(page.locator('#retry')).to_be_visible()
                page.locator('#retry').click();saved()
                expect(page.locator('#detail-title')).to_have_text('Recovered request result')
                recovered=json.loads(page.locator('#detail-output').inner_text())
                assert recovered==captured[1]
                requests=[req for req in seen if req['idempotency_key']==captured[0]['idempotency_key']]
                assert len(requests)>=2 and all(req==captured[0] for req in requests)
                page.locator('#close-detail').click()
                expect(page.locator('#retry')).to_be_hidden()
                return recovered
            for index,fault in enumerate(['truncated_body','commit_unknown','missing_result','gateway_error']):
                number='RECOVERY-'+fault
                page.locator('#number').fill(number)
                captured=lose_response('accounting.sales.invoice.draft',fault)
                page.get_by_role('button',name='Save draft',exact=True).click()
                expect(page.locator('#status')).to_contain_text('outcome unknown')
                before=len(seen)
                page.locator('#number').fill('UNSENT-'+fault)
                page.get_by_role('button',name='Save draft',exact=True).click()
                expect(page.locator('#status')).to_contain_text('earlier request has an unknown outcome')
                assert len(seen)==before,'A new request escaped while the earlier outcome was unknown'
                if fault=='commit_unknown':
                    def deny_retry(route):
                        route.fulfill(status=403,content_type='application/json',body=json.dumps({'error':'synthetic_authority_revoked'}))
                        page.unroute('**/api/run',deny_retry)
                    page.route('**/api/run',deny_retry)
                    page.locator('#retry').click()
                    expect(page.locator('#status')).to_have_text('synthetic_authority_revoked')
                    expect(page.locator('#retry')).to_be_visible()
                    # The denied readback did not prove the original command failed.
                    page.get_by_role('button',name='Save draft',exact=True).click()
                    expect(page.locator('#status')).to_contain_text('earlier request has an unknown outcome')
                result=recover(captured)
                expect(page.locator('#documents [data-document-number]')).to_have_count(index+1)
                expect(page.locator(f'[data-document-number="{number}"]')).to_contain_text('Draft')
                outcomes.append({'fault':fault,'same_key_recovered':True,'committed_document_id':result['document_id'],'new_request_blocked':True})
            # Recovery also clears the draft editor's stale expected version.
            page.get_by_role('button',name='Edit RECOVERY-truncated_body',exact=True).click();saved()
            page.locator('#net').fill('125.00')
            edited=lose_response('accounting.documents.draft.update','truncated_body')
            page.get_by_role('button',name='Save changes',exact=True).click()
            recover(edited)
            expect(page.get_by_role('button',name='Save draft',exact=True)).to_be_visible()
            expect(page.locator('#kind')).to_be_enabled()
            expect(page.locator('[data-document-number="RECOVERY-truncated_body"]')).to_contain_text('total $125.00')
            # A lost CSV receipt is recovered, with no second import receipt.
            page.get_by_role('button',name='Banking',exact=True).click()
            page.get_by_role('button',name='Preview CSV',exact=True).click();saved()
            imported=lose_response('accounting.banking.statements.csv.import','commit_unknown')
            page.get_by_role('button',name='Import reviewed CSV',exact=True).click()
            recover(imported)
            expect(page.locator('#csv-import')).to_be_hidden()
            assert json.loads(page.locator('#csv-receipt').inner_text())['import_id']==imported[1]['import_id']
            page.get_by_role('button',name='View import history',exact=True).click();saved()
            assert len(json.loads(page.locator('#detail-output').inner_text())['imports'])==1
            page.locator('#close-detail').click()
            expect(page.locator('#statements tbody tr')).to_have_count(3)
            page.get_by_role('button',name='Controls & audit',exact=True).click()
            page.get_by_role('button',name='Verify audit chain',exact=True).click();saved()
            audit=json.loads(page.locator('#audit-output').inner_text())
            assert audit['valid'] and audit['events']==6
            expect(page.locator('#journals').get_by_role('button',name='View journal')).to_have_count(0)
            assert not errors,errors
            page.screenshot(path=str(OUT/'recovered-workspace.png'),full_page=True)
            browser.close()
            result={'status':'PASSED','class':'LOCAL_SYNTHETIC_BROWSER','faults':outcomes,'revoked_retry_stays_unknown':True,'draft_edit_recovery':True,'csv_import_recovery':True,'audit_events':6,'duplicate_financial_effects':0,'provider_verified':False,'independently_accepted':False,'page_errors':errors}
            (OUT/'result.json').write_text(json.dumps(result,indent=2)+'\n')
            print(json.dumps(result,indent=2))
    finally:
        proc.terminate()
        proc.wait(timeout=15)
