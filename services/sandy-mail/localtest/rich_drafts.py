"""Real local PostgreSQL/MIME browser flow. Uses only authored .invalid fixtures."""
import asyncio, hashlib, json, os, re, subprocess, uuid
from pathlib import Path
from playwright.async_api import async_playwright, expect

async def main():
    output=Path(os.environ['MAIL_BROWSER_EVIDENCE_DIR']);output.mkdir(parents=True,exist_ok=True)
    process=subprocess.Popen([os.environ['MAIL_LOCAL_BINARY'],'-port','0'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=os.environ)
    line=process.stdout.readline();match=re.search(r'http://127\.0\.0\.1:\d+/#session=[a-f0-9]{64}',line)
    if not match:raise RuntimeError('local server failed to start')
    url=match.group(0);origin=url.split('/#')[0];token=url.split('session=')[1]
    suffix=uuid.uuid4().hex[:10]
    raw=(Path(__file__).parent.parent/'testdata/rich-draft.eml').read_bytes().replace(b'Synthetic_caf=C3=A9_draft',('Synthetic_caf=C3=A9_draft_'+suffix).encode())
    checks=[];remote=[];errors=[];writes=[];receipt=None
    try:
      async with async_playwright() as p:
       browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
       page=await browser.new_page(viewport={'width':1365,'height':900},accept_downloads=True)
       page.on('request',lambda r:remote.append(r.url.split('?')[0]) if not r.url.startswith(origin+'/') and not r.url.startswith('blob:'+origin) else None)
       page.on('pageerror',lambda e:errors.append(str(e)))
       await page.goto(url);await expect(page.locator('.message')).to_have_count(4)
       dropped=False
       async def lose_ack(route):
        nonlocal dropped,receipt
        body=route.request.post_data_json
        if body.get('operation')=='mail.drafts.mime.import':
         writes.append(body)
         response=await route.fetch();result=await response.json()
         if response.status==200 and not dropped:
          dropped=True;receipt=result['result'];await route.abort('failed');return
         await route.fulfill(response=response);return
        await route.continue_()
       await page.route('**/api/operations',lose_ack)
       await page.locator('#import-draft-file').set_input_files({'name':'synthetic-draft.eml','mimeType':'message/rfc822','buffer':raw})
       await expect(page.locator('#status')).to_contain_text('Save is unconfirmed')
       await page.locator('#drafts-nav').click();await expect(page.locator('#status')).to_contain_text('unresolved')
       await page.locator('#retry').click();await expect(page.locator('#reader h2')).to_contain_text(suffix)
       assert len(writes)==2 and writes[0]['idempotency_key']==writes[1]['idempotency_key'] and writes[0]['arguments']==writes[1]['arguments']
       assert receipt and receipt['version']==1
       checks.append('lost_real_commit_acknowledgement_retried_same_identity_once')
       await page.unroute('**/api/operations',lose_ack)
       await expect(page.locator('#reader')).to_contain_text('Bcc: Synthetic Bcc <bcc@example.invalid>')
       await expect(page.locator('#reader .attachment')).to_contain_text('14 bytes')
       assert await page.locator('#reader img, #reader script, #reader iframe').count()==0
       assert await page.evaluate('window.mailUnsafeExecuted === undefined')
       checks.append('recipient_fields_and_attachment_metadata_without_active_content')
       async def download(expected,name):
        async with page.expect_download() as info:await page.locator('#mime-export').click()
        d=await info.value;path=output/name;await d.save_as(path);assert path.read_bytes()==expected
        assert d.suggested_filename=='draft-'+receipt['resource_id']+'.eml'
       await download(raw,'rich-original.eml');checks.append('downloaded_original_byte_exact_with_browser_sha256_check')
       await page.locator('#drafts-nav').click();await page.get_by_role('button',name=re.compile(suffix)).click()
       await expect(page.locator('#reader h2')).to_contain_text(suffix)
       checks.append('reopened_mime_draft_from_actual_database')
       # A genuine concurrent API edit makes the displayed revision stale.
       changed=raw.replace(b'X-Repeated: first',b'X-Repeated: concurrent-edit')
       import base64
       response=await page.request.post(origin+'/api/operations',headers={'Authorization':'Bearer '+token,'Origin':origin,'Content-Type':'application/json'},data=json.dumps({'operation':'mail.drafts.mime.import','version':1,'request_id':str(uuid.uuid4()),'idempotency_key':str(uuid.uuid4()),'arguments':{'draft_id':receipt['resource_id'],'expected_version':1,'mime_base64':base64.b64encode(changed).decode()}}))
       assert response.status==200
       replacement=raw.replace(b'X-Repeated: first',b'X-Repeated: selected-replacement')
       await page.locator('#mime-replace-file').set_input_files({'name':'synthetic-replacement.eml','mimeType':'message/rfc822','buffer':replacement})
       await expect(page.locator('#status')).to_contain_text('resource_version_conflict')
       await page.locator('#mime-reload').click();await expect(page.locator('#reader .security')).to_contain_text('version 2')
       await download(changed,'rich-concurrent.eml')
       checks.append('stale_replacement_refused_and_concurrent_original_retained')
       await page.locator('#mime-replace-file').set_input_files({'name':'synthetic-replacement.eml','mimeType':'message/rfc822','buffer':replacement})
       await expect(page.locator('#reader .security')).to_contain_text('version 3')
       await download(replacement,'rich-replacement.eml')
       checks.append('full_mime_replacement_and_export_preserve_attachment_bytes')
       await page.screenshot(path=str(output/'rich-draft-desktop.png'),full_page=True)
       await page.set_viewport_size({'width':390,'height':844});assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
       checks.append('mobile_layout_without_horizontal_overflow')
       # HTML-only synthetic MIME remains source text, never an iframe/DOM HTML.
       html=(f'From: synthetic@example.invalid\r\nTo: reader@example.invalid\r\nSubject: Synthetic HTML-only {suffix}\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<script>window.mailUnsafeExecuted=true</script><img src="https://example.invalid/never-request"><b>synthetic</b>').encode()
       await page.locator('#import-draft-file').set_input_files({'name':'synthetic-html.eml','mimeType':'message/rfc822','buffer':html})
       await expect(page.locator('#reader h2')).to_contain_text('HTML-only')
       await expect(page.locator('#reader pre.body').first).to_contain_text('<script>')
       assert await page.evaluate('window.mailUnsafeExecuted === undefined')
       assert await page.locator('#reader img, #reader script, #reader iframe').count()==0
       checks.append('html_only_mime_shown_as_text_without_remote_request')
       assert not remote and not errors,(remote,errors)
       result={'source_revision':os.environ.get('MAIL_TEST_SOURCE_REV','working-tree'),'local_only':True,'cloud_deployed':False,'independent_acceptance':False,'checks':checks,'draft_id':receipt['resource_id'],'initial_receipt_id':receipt['receipt_id'],'original_sha256':hashlib.sha256(raw).hexdigest(),'replacement_sha256':hashlib.sha256(replacement).hexdigest(),'real_http_writes':True,'successful_mock_responses':0,'external_requests':remote,'page_errors':errors}
       (output/'rich-draft-browser.json').write_text(json.dumps(result,indent=2)+'\n')
       await browser.close()
    finally:
      process.terminate();process.wait(timeout=10)

asyncio.run(main())
