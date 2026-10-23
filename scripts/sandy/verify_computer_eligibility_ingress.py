#!/usr/bin/env python3
"""Negative ingress only; never supplies a worker token or dispatches the queue."""
import json,urllib.request,urllib.error
from engineering_control_client import NoRedirect
url='https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-computer-worker'
opener=urllib.request.build_opener(NoRedirect());results=[]
for method,expected in [('GET',405),('POST',401)]:
 req=urllib.request.Request(url,method=method,data=b'{}' if method=='POST' else None,headers={'content-type':'application/json'})
 try:r=opener.open(req,timeout=30)
 except urllib.error.HTTPError as e:r=e
 with r:
  result=json.loads(r.read(4096));assert r.status==expected,(method,r.status)
  assert result.get('error') in ('method_not_allowed','unauthorized')
  results.append({'method':method,'status':r.status,'error':result['error']})
print('::notice title=Computer worker negative ingress::'+json.dumps({'verified':True,'worker_token_supplied':False,'queue_dispatched':False,'receipts':results}))
