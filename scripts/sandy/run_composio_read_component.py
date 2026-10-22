"""Run only the bounded Composio component under one unconditional ROLLBACK."""
import datetime,hashlib,json,os,pathlib,urllib.error,urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=pathlib.Path('/workspace/sandy-api-deliverables')
paths=[ROOT/'supabase/migrations/20261021010820_sandy_composio_read_boundary.sql',ROOT/'supabase/migrations/20261021010830_sandy_composio_read_contracts.sql',ROOT/'supabase/tests/sandy_composio_read_rollback.sql']
sql='BEGIN;\n'+'\n'.join('\n'.join(l for l in p.read_text().splitlines() if l.strip() not in ['BEGIN;','COMMIT;','ROLLBACK;']) for p in paths)+'\nROLLBACK;\n'
assert sql.startswith('BEGIN;\n') and sql.endswith('\nROLLBACK;\n') and '\nCOMMIT;' not in sql
OUT.mkdir(exist_ok=True);(OUT/'composio-read-component-rollback.sql').write_text(sql)
request=urllib.request.Request('https://api.supabase.com/v1/projects/zmqlyygzqoidkcwdysok/database/query',data=json.dumps({'query':sql,'read_only':False}).encode(),headers={'authorization':'Bearer '+os.environ['SANDY_SUPABASE_MANAGEMENT_TOKEN'],'content-type':'application/json'},method='POST')
try:
 with urllib.request.urlopen(request,timeout=60) as response:status=response.status;body=response.read().decode()
except urllib.error.HTTPError as error:status=error.code;body=error.read().decode()
(OUT/'composio-read-component-rollback-response.json').write_text(body)
report={'timestamp_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'http_status':status,'query_sha256':hashlib.sha256(sql.encode()).hexdigest(),'full_rollback':True,'actual_auth_session':False,'actual_provider_calls':0,'source_sha256':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}}
(OUT/'composio-read-component-rollback-evidence.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report));print(body[:1500] if status!=201 else json.dumps(json.loads(body)[0]['evidence']))
if status!=201:raise SystemExit(1)
