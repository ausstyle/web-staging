"""Real Chromium test against the explicit loopback fixture server; no live data."""
import json, shutil, time, os
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
origin=os.environ.get('SANDY_FIXTURE_ORIGIN','http://127.0.0.1:8787')
for _ in range(100):
    try:
        urllib.request.urlopen(origin+'/fixtures',timeout=1).close()
        break
    except OSError:
        time.sleep(.1)
Path('/tmp/sandy-cloud-evidence').mkdir(exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=shutil.which('chromium') or shutil.which('google-chrome'),headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1280,'height':900})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(origin+'/')
    page.get_by_role('button',name='Upload synthetic file').click()
    page.get_by_label('Filename',exact=True).fill('browser-fixture.txt')
    page.get_by_label('Synthetic content',exact=True).fill('browser acceptance original bytes')
    page.get_by_role('button',name='Save',exact=True).click()
    page.wait_for_selector('dialog[open]',state='hidden')
    page.get_by_text('browser-fixture.txt',exact=True).wait_for()
    with page.expect_download() as download:
        page.get_by_role('button',name='Download',exact=True).click()
    assert Path(download.value.path()).read_bytes()==b'browser acceptance original bytes'
    page.get_by_role('button',name='Create recovery point',exact=True).click()
    page.get_by_role('button',name='Restore to new folder',exact=True).wait_for()
    page.get_by_role('button',name='Files',exact=True).click()
    page.get_by_role('button',name='Trash',exact=True).last.click()
    page.get_by_text('Nothing here yet.',exact=False).wait_for()
    page.get_by_role('button',name='Recovery points',exact=True).click()
    page.get_by_role('button',name='Restore to new folder',exact=True).click()
    page.get_by_label('New destination folder',exact=True).fill('Browser recovered')
    page.get_by_role('button',name='Save',exact=True).click()
    page.get_by_role('button',name='▸ Browser recovered',exact=True).click()
    with page.expect_download() as download:
        page.get_by_role('button',name='Download',exact=True).click()
    assert Path(download.value.path()).read_bytes()==b'browser acceptance original bytes'
    page.screenshot(path='/tmp/sandy-cloud-evidence/drive-restore.png',full_page=True)
    page.get_by_label('Synthetic test identity',exact=True).select_option('bob')
    page.get_by_text('Nothing here yet.',exact=False).wait_for()
    assert page.get_by_text('browser-fixture.txt',exact=True).count()==0
    page.get_by_label('Synthetic test identity',exact=True).select_option('reader')
    page.get_by_role('button',name='New folder',exact=True).click()
    page.get_by_label('Folder name',exact=True).fill('Denied')
    page.get_by_role('button',name='Save',exact=True).click()
    page.get_by_role('status').get_by_text('FORBIDDEN',exact=True).wait_for()
    assert not errors,errors
    browser.close()
    report={'passed':True,'environment':'loopback fixture / real Chromium','checks':['upload','exact downloaded bytes','snapshot','trash','restore into new folder','restored downloaded bytes','second tenant sees no files','reader write denied'],'provider_acceptance':False}
    Path('/tmp/sandy-cloud-evidence/browser.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report))
