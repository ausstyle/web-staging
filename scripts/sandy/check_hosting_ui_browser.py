"""Synthetic browser acceptance; intercepts all remote traffic, no real sessions."""
import json, os, threading, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
ID='10000000-0000-4000-8000-000000000001'
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p:
  executable=os.environ.get('CHROMIUM_PATH')
  browser=p.chromium.launch(headless=True,**({'executable_path':executable} if executable else {}))
  for width in [390,1280]:
   context=browser.new_context(viewport={'width':width,'height':900});page=context.new_page();calls=[];errors=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   def route(request):
    url=request.request.url
    if url.startswith('http://127.0.0.1:'):request.continue_();return
    if url.startswith('https://esm.sh/@supabase/supabase-js@'):
     request.fulfill(content_type='text/javascript',body=f"export function createClient(){{return {{auth:{{getSession:async()=>({{data:{{session:{{access_token:'synthetic',user:{{id:'{ID}'}}}}}}}}),onAuthStateChange:f=>{{window.fixtureSignOut=()=>f('SIGNED_OUT')}}}}}}}}");return
    if url.endswith('/sandy-operation-api'):
     body=request.request.post_data_json;calls.append(body)
     if len(calls)==1:request.fulfill(status=403,json={'error':'operation_not_exposed'});return
     account={'account_id':ID,'requested_plan':'starter','state':'logical_only','version':1,'billing_activated':False,'provider_resources_created':False}
     request.fulfill(json={'ok':True,'executed':True,'operation':'hosting.accounts.get','result':{'ok':True,'executed':True,'operation':'hosting.accounts.get','contract_version':'1.0.0','request_state':'succeeded','reconciliation_required':False,'request_id':ID,'result':account}});return
    request.abort()
   page.route('**/*',route)
   page.goto(f'http://127.0.0.1:{server.server_port}/sandy/hosting/')
   page.get_by_label('Hosting account ID').fill(ID);page.get_by_role('button',name='Load account',exact=True).click()
   page.get_by_role('status').filter(has_text='not available for this workspace yet').wait_for()
   assert page.get_by_text('Not loaded',exact=True).is_visible()
   page.get_by_role('button',name='Load account',exact=True).click();page.get_by_text('Registered',exact=True).wait_for()
   assert page.get_by_text('Not verified',exact=True).count()==3
   page.get_by_role('button',name='Usage & costs',exact=True).click();assert page.get_by_text('Not available',exact=True).is_visible()
   assert '$0' not in page.inner_text('main')
   page.get_by_role('button',name='Recovery',exact=True).click();assert page.get_by_text('No backup or successful restore has been verified here.').is_visible()
   page.get_by_role('button',name='Overview',exact=True).click()
   assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
   output=os.environ.get('HOSTING_SCREENSHOT_DIR')
   if output:
    Path(output).mkdir(parents=True,exist_ok=True);page.screenshot(path=str(Path(output)/f'hosting-{width}.png'),full_page=True)
   page.evaluate('window.fixtureSignOut()');assert page.get_by_label('Hosting account ID').input_value()==''
   assert page.get_by_text('Account details',exact=True).count()==0
   assert not errors,errors
   assert len(calls)==2 and all(c['operation']=='hosting.accounts.get' and c['arguments']=={'account_id':ID} for c in calls)
   context.close()
  browser.close()
 print('PASS: mobile/desktop unavailable, account, usage, recovery, session-clear and fixed read-only gateway cases; synthetic only')
finally:server.shutdown()
