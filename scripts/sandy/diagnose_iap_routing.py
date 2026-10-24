#!/usr/bin/env python3
"""Fixed existing-service metadata and prior artifact diagnostics, no requests."""
import argparse,json,re
from pathlib import Path
from urllib.parse import urlsplit
from reconcile_existing_iap_candidate import cloud,notice,PROJECT,REVISION,SOURCE,IMAGE
from release_web_canary import private_write,Blocked

def route_url(value):
 if not isinstance(value,str) or len(value)>300:return None
 try:p=urlsplit(value)
 except ValueError:return None
 if p.scheme!='https' or not p.hostname or not re.fullmatch('[a-z0-9.-]+[.]run[.]app',p.hostname) or p.username or p.password or p.query or p.fragment or p.path not in ['', '/']:return None
 return value

def routing(value):
 annotations=value.get('metadata',{}).get('annotations',{});status=value.get('status',{})
 selected={}
 enums={'run.googleapis.com/ingress':['all','internal','internal-and-cloud-load-balancing'],
  'run.googleapis.com/ingress-status':['all','internal','internal-and-cloud-load-balancing'],
  'run.googleapis.com/default-url-disabled':['true','false'],
  'run.googleapis.com/invoker-iam-disabled':['true','false']}
 for key,allowed in enums.items():
  v=annotations.get(key);selected[key]='absent' if v is None else v if v in allowed else 'unrecognized'
 urls=annotations.get('run.googleapis.com/urls','[]')
 try:urls=json.loads(urls)
 except (TypeError,ValueError):urls=[]
 urls=[x for x in urls[:16] if route_url(x)] if isinstance(urls,list) else []
 tags=[]
 for row in status.get('traffic',[])[:16]:
  if row.get('revisionName')==REVISION or row.get('tag') in ['sandy-api-review','sandy-iap-repair-review']:
   tag=row.get('tag');name=row.get('revisionName')
   if tag not in ['sandy-api-review','sandy-iap-repair-review'] or not isinstance(name,str) or not re.fullmatch('sandy-engineering-mcp-[a-z0-9-]{1,120}',name):raise Blocked('fixed_candidate_routing_metadata_required')
   tags.append({'tag':tag,'revision':name,'provider_url':route_url(row.get('url')),'percent':row.get('percent',0)})
 conditions=[{'type':c['type'],'status':c.get('status') if c.get('status') in ['True','False','Unknown'] else 'unrecognized'} for c in status.get('conditions',[]) if c.get('type') in ['Ready','RoutesReady','ConfigurationsReady']]
 return {'annotations':selected,'provider_service_url':route_url(status.get('url')),'provider_default_urls':urls,'candidate_routes':tags,'provider_conditions':conditions,'requests_sent':0,'configuration_changed':False}

def prior_artifact(directory):
 report={'run_id':'40049214245','raw_artifact_payload_recorded':False}
 health=directory/'iap-closed-acceptance.json'
 if health.exists():
  data=json.loads(health.read_text());h=data.get('health',{})
  report['prior_health']={'http_status':h.get('http_status') if isinstance(h.get('http_status'),int) and 100<=h['http_status']<=599 else None,
   'classification':h.get('classification') if h.get('classification') in ['application_health_ok','http_unauthenticated','http_forbidden','http_not_found','http_upstream_failure','invalid_application_health','unexpected_http_status','health_transport_unavailable'] else 'unrecognized',
   'content_type':h.get('content_type') if h.get('content_type') in ['application/json','text/html','text/plain','other'] else 'unrecognized',
   'body_format':h.get('body_format') if h.get('body_format') in ['json','non_json'] else 'unrecognized',
   'response_body_recorded':h.get('response_body_recorded') is True}
 proof=directory/'iap-final-provider-readback.json'
 if proof.exists():
  p=json.loads(proof.read_text())
  if p.get('revision')!=REVISION or p.get('source_commit')!=SOURCE or not p.get('image_digest','').endswith('@sha256:'+IMAGE) or p.get('passed') is not True:raise Blocked('prior_fixed_candidate_proof_mismatch')
  report['prior_final_provider_proof_persisted']=True
  report['prior_production_traffic_unchanged']=p.get('production_traffic_unchanged') is True
  report['prior_original_candidate_tag_preserved']=p.get('original_candidate_tag_preserved') is True
 report['prior_shared_health_filename_present']=(directory/'health-request-logs.json').exists()
 report['prior_final_failure_artifact_present']=(directory/'final-readback-failure.json').exists()
 return report

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--prior-dir',required=True,type=Path);p.add_argument('--output-dir',required=True,type=Path);a=p.parse_args();a.output_dir.mkdir(parents=True,exist_ok=True)
 try:
  value=routing(cloud('run','services','describe','sandy-engineering-mcp','--region','europe-west1'))
  prior=prior_artifact(a.prior_dir)
  private_write(a.output_dir,'provider-routing-diagnostics.json',json.dumps(value,indent=2).encode());notice('Existing Cloud Run routing configuration',value)
  private_write(a.output_dir,'prior-final-readback-recovery.json',json.dumps(prior,indent=2).encode());notice('Prior acceptance and final proof recovery',prior)
 except Exception as e:
  kind=type(e).__name__;kind=kind if kind in ['FileExistsError','FileNotFoundError','JSONDecodeError','TypeError','ValueError','KeyError'] else 'UnexpectedError'
  report={'passed':False,'error':str(e) if isinstance(e,Blocked) else 'routing_diagnostic_failed','exception_class':'Blocked' if isinstance(e,Blocked) else kind,'configuration_changed':False}
  private_write(a.output_dir,'routing-diagnostic-failure.json',json.dumps(report).encode());notice('Read-only routing diagnostic failure',report);raise SystemExit(1)
