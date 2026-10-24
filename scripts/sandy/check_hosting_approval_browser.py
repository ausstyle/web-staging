"""Controller visibility acceptance with synthetic Auth/API; never real approval."""
import json,os,threading,functools,time
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
record=json.loads((ROOT/'scripts/sandy/fixtures/hosting-account-approval-record.json').read_text())
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,**({'executable_path':os.environ['CHROMIUM_PATH']} if os.environ.get('CHROMIUM_PATH') else {}))
  for role,link_id in [('owner',record['id']),('owner','04fab547-3177-4eb4-ac23-23831152b420'),('operator',record['id'])]:
   context=browser.new_context(viewport={'width':390,'height':900});page=context.new_page();calls=[];events=[];state=dict(record);errors=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   def route(request):
    url=request.request.url
    if url.startswith('http://127.0.0.1:'):request.continue_();return
    if url.startswith('https://esm.sh/@supabase/supabase-js@'):
     request.fulfill(content_type='text/javascript',body=f"export function createClient(){{return {{auth:{{getSession:async()=>({{data:{{session:{{access_token:'synthetic-browser-fixture',expires_at:{int(time.time())+3600},user:{{id:'synthetic-owner'}}}}}}}}),getUser:async()=>({{data:{{user:{{id:'synthetic-owner'}}}}}}),onAuthStateChange:()=>({{}})}}}}}}");return
    if url.endswith('/sandy-controller-api'):
     body=request.request.post_data_json
     request.fulfill(json={'ok':True,'role':role,'generated_at':'2026-10-24T00:00:00Z','items':[],'missions':[],'metrics':{},'qa':[]});return
    if url.endswith('/sandy-engineering-control'):
     body=request.request.post_data_json;calls.append(body)
     if body.get('change_id')!=record['id']:request.fulfill(status=404,json={'error':'fixture has only target record'});return
     if body['action']=='get':request.fulfill(json={'change':state,'events':events});return
     if body['action']=='status':
      assert role=='owner';state['status']='approved';events.append({'change_id':record['id'],'actor':'synthetic-owner','event_type':'status_changed','detail':{'to':'approved','reason':body['reason']}});request.fulfill(json={'change':state});return
    request.abort()
   page.route('**/*',route)
   page.goto(f'http://127.0.0.1:{server.server_port}/sandy/controller/?change={link_id}#changes')
   if role=='owner':
    button=page.get_by_role('button',name='Approve logical hosting account release',exact=True)
    button.wait_for();page.wait_for_function("!document.querySelector('#hosting-account-release button').disabled")
    assert not [c for c in calls if c['action']!='get'],calls
    assert page.locator('#hosting-account-release').inner_text().find(record['id'])>=0
    assert page.get_by_text('PR #222 · one-off production release').count()==0
    button.click();page.get_by_role('status').filter(has_text='Matching Owner audit verified').wait_for()
    assert len([c for c in calls if c['action']=='status'])==1
    assert not [c for c in calls if c['action'] not in ['get','status']]
   else:
    page.get_by_text('Owner access is required.',exact=True).wait_for()
    assert page.get_by_role('button',name='Approve logical hosting account release',exact=True).count()==0
    assert not calls
   assert not errors,errors
   context.close()
  browser.close()
 print('PASS: exact-record Owner view, no-list lookup, explicit synthetic approval/audit, non-Owner exclusion; no live session')
finally:server.shutdown()
