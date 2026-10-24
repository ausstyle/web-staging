"""Optional real-Chromium acceptance against mail-local and the real local DB.
Requires playwright and an installed Chromium; never uses a mocked successful API.
MAIL_LOCAL_BINARY, MAIL_LOCAL_DSN, MAIL_LOCAL_OBJECT_DIR, MAIL_BROWSER_EVIDENCE_DIR.
"""
import asyncio
import json
import os
from pathlib import Path
import re
import subprocess
import uuid
from urllib.parse import urlsplit
from playwright.async_api import async_playwright, expect

async def main():
    output=Path(os.environ['MAIL_BROWSER_EVIDENCE_DIR'])
    output.mkdir(parents=True, exist_ok=True)
    binary=os.environ['MAIL_LOCAL_BINARY']
    process=None
    def start(port=0):
        nonlocal process
        process=subprocess.Popen([binary,'-port',str(port)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=os.environ)
        line=process.stdout.readline()
        match=re.search(r'http://127\.0\.0\.1:\d+/#session=[a-f0-9]{64}',line)
        if not match: raise RuntimeError('local server did not start')
        return match.group(0)
    url=start()
    origin=url.split('/#')[0]
    port=urlsplit(url).port
    checks=[];remote=[];errors=[]
    try:
        async with async_playwright() as p:
            browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
            page=await browser.new_page(viewport={'width':1365,'height':900})
            page.on('request',lambda r:remote.append(r.url.split('?')[0]) if not r.url.startswith(origin+'/') else None)
            page.on('pageerror',lambda e:errors.append(str(e)))
            await page.goto(url)
            await expect(page.locator('.message')).to_have_count(4)
            assert await page.evaluate('location.hash')==''
            checks.append('real_backend_four_persisted_messages_and_session_fragment_removed')
            await page.get_by_role('button',name=re.compile('HTML safety fixture')).click()
            await expect(page.locator('#reader h2')).to_have_text('HTML safety fixture')
            await expect(page.locator('#reader pre')).to_contain_text('<script>window.mailUnsafeExecuted=true</script>')
            assert await page.evaluate('window.mailUnsafeExecuted === undefined')
            assert await page.locator('#reader img, #reader script, #reader iframe, #reader a').count()==0
            await expect(page.locator('.attachment')).to_contain_text('pending — download unavailable')
            checks.append('hostile_html_is_text_no_remote_images_no_attachment_download')
            await page.locator('#query').fill('meeting')
            await page.get_by_role('button',name='Search',exact=True).click()
            await expect(page.locator('.message')).to_have_count(1)
            await expect(page.locator('.message')).to_contain_text('Synthetic meeting agenda')
            await page.locator('.message').click()
            await expect(page.locator('#reader pre')).to_contain_text('fictional meeting agenda')
            checks.append('real_keyword_search_and_message_read')
            # Delay an actual old response, then issue a newer search. Successes
            # still come from PostgreSQL; only timing/failure is injected here.
            delayed=asyncio.Event()
            async def delay_old(route):
                payload=route.request.post_data_json
                if payload['operation']=='mail.messages.list' and payload['arguments']['query']=='receipt':
                    response=await route.fetch()
                    delayed.set()
                    await asyncio.sleep(.5)
                    try: await route.fulfill(response=response)
                    except Exception: pass # client intentionally aborted old request
                else: await route.continue_()
            await page.route('**/api/operations',delay_old)
            await page.locator('#query').fill('receipt')
            await page.get_by_role('button',name='Search',exact=True).click()
            await asyncio.wait_for(delayed.wait(),5)
            await page.locator('#query').fill('meeting')
            await page.get_by_role('button',name='Search',exact=True).click()
            await expect(page.locator('.message')).to_have_count(1)
            await asyncio.sleep(.7)
            await expect(page.locator('.message')).to_contain_text('Synthetic meeting agenda')
            await page.unroute('**/api/operations',delay_old)
            checks.append('interrupted_search_old_response_does_not_overwrite_new_results')
            async def outage(route): await route.abort('failed')
            await page.route('**/api/operations',outage)
            await page.get_by_role('button',name='Refresh inbox').click()
            await expect(page.locator('#retry')).to_be_visible()
            await expect(page.locator('#list-status')).to_contain_text('could not be loaded')
            assert await page.locator('#reader h2').count()==0
            await page.unroute('**/api/operations',outage)
            await page.locator('#retry').click()
            await expect(page.locator('.message')).to_have_count(1)
            checks.append('network_interruption_is_error_retry_reads_persisted_backend')
            await page.locator('#query').fill('')
            await page.get_by_role('button',name='Search',exact=True).click()
            await expect(page.locator('.message')).to_have_count(4)
            await page.get_by_role('button',name=re.compile('Sandy Mail synthetic first ingest')).click()
            await expect(page.locator('#reader h2')).to_contain_text('synthetic first ingest')
            await page.locator('summary').click()
            receipt_before=await page.locator('details').text_content()
            await page.screenshot(path=str(output/'local-inbox-desktop.png'),full_page=True)
            await page.set_viewport_size({'width':390,'height':844})
            assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            await page.screenshot(path=str(output/'local-inbox-mobile.png'),full_page=True)
            checks.append('desktop_mobile_reader_and_receipt_visible_without_horizontal_overflow')
            # Actual local writes, with a lost response after PostgreSQL commits.
            suffix=uuid.uuid4().hex[:10]
            draft_subject='Synthetic browser draft '+suffix
            await page.set_viewport_size({'width':1365,'height':900})
            await page.get_by_role('button',name='New draft',exact=True).click()
            await page.locator('#draft-to').fill('recipient@example.invalid')
            await page.locator('#draft-subject').fill(draft_subject)
            await page.locator('#draft-body').fill('Synthetic draft body. <script>window.mailUnsafeExecuted=true</script>')
            writes=[];committed=[];dropped=False
            async def lose_save_response(route):
                nonlocal dropped
                payload=route.request.post_data_json
                if payload['operation']=='mail.drafts.save':
                    writes.append(payload)
                    if not dropped:
                        dropped=True
                        response=await route.fetch()
                        assert response.status==200
                        committed.append((await response.json())['result'])
                        await route.abort('failed')
                        return
                await route.continue_()
            await page.route('**/api/operations',lose_save_response)
            await page.get_by_role('button',name='Save draft',exact=True).click()
            await expect(page.locator('#retry')).to_be_visible()
            await expect(page.locator('#draft-body')).to_be_disabled()
            assert 'Synthetic draft body' in await page.locator('#draft-body').input_value()
            await page.locator('#retry').click()
            await expect(page.locator('#draft-state')).to_contain_text('Saved locally · version 1')
            await expect(page.locator('#draft-state')).to_contain_text(committed[0]['receipt_id'])
            assert len(writes)==2 and writes[0]['idempotency_key']==writes[1]['idempotency_key'] and writes[0]['arguments']==writes[1]['arguments']
            await page.unroute('**/api/operations',lose_save_response)
            draft_id=writes[0]['arguments']['draft_id']
            checks.append('lost_save_response_replays_identical_key_and_receipt_without_duplicate_draft')
            await page.locator('#draft-body').fill('Synthetic saved revision two')
            await page.get_by_role('button',name='Save draft',exact=True).click()
            await expect(page.locator('#draft-state')).to_contain_text('version 2')
            # A second real client edits the same version; stale first client must
            # keep its text instead of overwriting the newer database record.
            second=await browser.new_page(viewport={'width':1100,'height':850})
            second.on('request',lambda r:remote.append(r.url.split('?')[0]) if not r.url.startswith(origin+'/') else None)
            second.on('pageerror',lambda e:errors.append(str(e)))
            await second.goto(url)
            await second.get_by_role('button',name='Drafts',exact=True).click()
            await second.get_by_role('button',name=re.compile(draft_subject)).click()
            await expect(second.locator('#draft-state')).to_contain_text('version 2')
            await second.locator('#draft-body').fill('Synthetic revision from second editor')
            await second.get_by_role('button',name='Save draft',exact=True).click()
            await expect(second.locator('#draft-state')).to_contain_text('version 3')
            await page.locator('#draft-body').fill('Unsaved stale text must remain visible')
            await page.get_by_role('button',name='Save draft',exact=True).click()
            await expect(page.locator('#status')).to_contain_text('resource_version_conflict')
            assert await page.locator('#draft-body').input_value()=='Unsaved stale text must remain visible'
            page.once('dialog',lambda dialog:dialog.accept())
            await page.get_by_role('button',name='Reload saved draft',exact=True).click()
            await expect(page.locator('#draft-body')).to_have_value('Synthetic revision from second editor')
            await expect(page.locator('#draft-state')).to_contain_text('version 3')
            await second.close()
            checks.append('two_real_editors_reject_stale_save_retain_text_and_explicitly_reload_latest')
            await page.screenshot(path=str(output/'local-drafts-desktop.png'),full_page=True)
            folder_name='Synthetic project '+suffix
            label_name='Synthetic label <script> '+suffix
            for kind,name in [('folder',folder_name),('label',label_name)]:
                await page.locator('#collection-kind').select_option(kind)
                await page.locator('#collection-name').fill(name)
                await page.get_by_role('button',name='Create',exact=True).click()
                await expect(page.locator('#'+('folders' if kind=='folder' else 'labels')).get_by_role('button',name=name,exact=True)).to_be_visible()
            await page.get_by_role('button',name='Inbox',exact=True).click()
            await expect(page.locator('.message')).to_have_count(4)
            await page.get_by_role('button',name=re.compile('Welcome to your synthetic inbox')).click()
            await expect(page.locator('#reader h2')).to_have_text('Welcome to your synthetic inbox')
            await page.locator('#folder-choice').select_option(label=folder_name)
            await page.locator('#organization-fields').get_by_role('checkbox',name=label_name,exact=True).check()
            await page.get_by_role('button',name='Save organization',exact=True).click()
            await expect(page.locator('.message')).to_have_count(3)
            await page.locator('#folders').get_by_role('button',name=folder_name,exact=True).click()
            await expect(page.locator('.message')).to_have_count(1)
            await page.locator('.message').click()
            await expect(page.locator('#organization-fields').get_by_role('checkbox',name=label_name,exact=True)).to_be_checked()
            await page.screenshot(path=str(output/'local-organization-desktop.png'),full_page=True)
            await page.locator('#labels').get_by_role('button',name=label_name,exact=True).click()
            await expect(page.locator('.message')).to_have_count(1)
            await page.locator('.message').click()
            await page.locator('#organization-fields').get_by_role('checkbox',name=label_name,exact=True).uncheck()
            await page.get_by_role('button',name='Save organization',exact=True).click()
            await expect(page.locator('.message')).to_have_count(0)
            await page.locator('#folders').get_by_role('button',name=folder_name,exact=True).click()
            await page.locator('.message').click()
            await page.locator('#folder-choice').select_option('')
            await page.get_by_role('button',name='Save organization',exact=True).click()
            await page.get_by_role('button',name='Inbox',exact=True).click()
            await expect(page.locator('.message')).to_have_count(4)
            assert await page.locator('#labels script').count()==0
            checks.append('real_folder_move_label_filter_remove_and_inbox_restore_preserve_original')
            await page.reload()
            await expect(page.locator('#connect-panel')).to_be_visible()
            assert await page.evaluate('localStorage.length === 0 && sessionStorage.length === 0')
            # Real process restart revokes old token, preserves DB and objects.
            process.terminate();process.wait(timeout=10)
            new_url=start(port)
            await page.goto(url)
            await expect(page.locator('#retry')).to_be_visible()
            assert await page.locator('.message').count()==0
            await page.goto(new_url)
            await expect(page.locator('.message')).to_have_count(4)
            await page.get_by_role('button',name=re.compile('Sandy Mail synthetic first ingest')).click()
            await expect(page.locator('#reader h2')).to_contain_text('synthetic first ingest')
            assert await page.locator('details').text_content()==receipt_before
            checks.append('server_restart_revokes_session_preserves_exact_receipt_and_messages')
            await page.get_by_role('button',name='Drafts',exact=True).click()
            await page.get_by_role('button',name=re.compile(draft_subject)).click()
            await expect(page.locator('#draft-body')).to_have_value('Synthetic revision from second editor')
            await expect(page.locator('#draft-state')).to_contain_text('version 3')
            await expect(page.locator('#folders').get_by_role('button',name=folder_name,exact=True)).to_be_visible()
            await page.set_viewport_size({'width':390,'height':844})
            assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            await page.screenshot(path=str(output/'local-drafts-mobile.png'),full_page=True)
            checks.append('draft_revision_and_collections_survive_process_restart_and_mobile_editing')
            assert await page.evaluate('window.mailUnsafeExecuted === undefined')
            assert not remote,remote
            assert not errors,errors
            checks.append('no_external_browser_requests_or_uncaught_script_errors')
            await browser.close()
    finally:
        if process and process.poll() is None:
            process.terminate();process.wait(timeout=10)
    result={'environment':'real-local-postgresql-filesystem-chromium','checks':checks,'passed':len(checks),'draft_id':draft_id,'draft_version':3,'lost_response_receipt_id':committed[0]['receipt_id'],'cloud_deployed':False,'external_messages_sent':0,'independent_acceptance':False,'source_revision':os.environ.get('MAIL_TEST_SOURCE_REV','working-tree')}
    (output/'local-inbox-browser.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))

asyncio.run(main())
