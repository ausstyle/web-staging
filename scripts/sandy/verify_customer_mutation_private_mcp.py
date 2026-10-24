#!/usr/bin/env python3
"""Finite source-attested real DB acceptance of ten EXISTING customer mutations.

Normal customer JWTs execute every tested operation through MCP and Sandy API.
Protected administration prepares only fresh isolated fixtures and quality custody.
No catalogue flags, standing grants, Owner identities or source deployments change.
Task creation uses the normal quoted-literal branch; nonliteral model enrichment
is explicitly outside accepted coverage. Triggers and workers remain enabled.
"""
from __future__ import annotations
import argparse,datetime,hashlib,io,json,os,re,subprocess,time,urllib.error,urllib.parse,urllib.request,uuid,zipfile
from pathlib import Path
from customer_service_acceptance import Acceptance,passing_read
from verify_memory_private_mcp import PrivateMemoryAcceptance
from release_gcp_admin_read import Installer
from release_web_canary import ROOT,original_sources
from engineering_runtime import BASE
SPEC=ROOT/'scripts/sandy/fixtures/customer_mutation_contracts_v1.json'
BUCKET='sandy-task-artifacts'
MIME='application/vnd.openxmlformats-officedocument.wordprocessingml.document'
def digest(raw):return hashlib.sha256(raw).hexdigest()
def fixture_docx():
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        z.writestr('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Isolated Sandy mutation fixture. No customer data.</w:t></w:r></w:p></w:body></w:document>')
    raw=output.getvalue()
    if len(raw)>2048:raise RuntimeError('bounded_synthetic_DOCX_required')
    return raw
def storage_object_absent(status,payload):
    try:error=json.loads(payload)
    except (ValueError,TypeError):return False
    return status in [400,404] and isinstance(error,dict) and str(error.get('statusCode'))=='404' and error.get('error')=='not_found'
def await_storage_absent(read, pause=time.sleep):
    # Deletes can complete before cached authenticated reads stop returning bytes.
    # Retry reads only; never repeat deletion or accept a 200 as retirement.
    for attempt in range(7):
        status,payload=read()
        if storage_object_absent(status,payload):return
        if status!=200:raise RuntimeError('storage_fixture_state_unknown')
        if attempt<6:pause(10)
    raise RuntimeError('storage_fixture_not_retired')

class CustomerMutationAcceptance(PrivateMemoryAcceptance):
    def __init__(self,output,manifest):
        super().__init__(output);self.manifest=manifest.resolve();self.spec=json.loads(SPEC.read_text());self.prefix='customer_mutation_cert_'+self.nonce+':'
        self.report.update(kind='private_normal_customer_MCP_existing_ten_mutations',model_or_connected_provider_work_requested=True,expected_task_analysis_side_effect='normal_queue_literal_title_only_no_model',nonliteral_model_enrichment_verified=False,operation_field_evidence=[],verified_mutation_receipts=[],storage_fixture_administration=True,model_turns=0,
            exact_capability_scope={'tasks':'Sandy local task records and quoted-literal queue branch only','calendar':'Sandy local calendar records; no Google Calendar writes','files':'Universal-file metadata only; no MCP byte copy or upload','storage_fixture':'Protected synthetic DOCX setup/readback/retirement, separate from customer MCP execution'})
    def source(self):
        if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main':raise RuntimeError('protected_main_project_release_required')
        sha=os.environ.get('GITHUB_SHA','')
        if not re.fullmatch('[a-f0-9]{40}',sha) or subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()!=sha:raise RuntimeError('committed_project_release_source_required')
        for p in [self.manifest,SPEC,Path(__file__).resolve()]:
            if subprocess.check_output(['git','show',sha+':'+str(p.relative_to(ROOT))],cwd=ROOT)!=p.read_bytes():raise RuntimeError('committed_source_required')
        from release_customer_mutation_certification import MANIFEST,load,functions,schema
        if self.manifest!=MANIFEST.resolve():raise RuntimeError('fixed_reviewed_customer_manifest_required')
        from release_customer_task_guard import state as task_guard_state
        manifest,_=load();admin=Installer(self.output.parent/'ten-write-source-readback');observed=functions(admin,manifest,True);schema(admin,manifest,True);task_guard_state(admin,True);source={}
        for slug,(meta,body,files) in observed.items():
            self.check(slug+'_actual_reviewed_source',True)
            source[slug]={'version':meta['version'],'deployment_id':'zmqlyygzqoidkcwdysok_'+meta['id']+'_'+str(meta['version']),'bundle_sha256':digest(body)}
        self.report.update(source_commit=sha,installed_source=source);self.save();return source
    def storage(self,fixture,action,data=None):
        # Provider fixture administration only. These credentials NEVER enter an
        # MCP/customer request or the report. All paths are generated UUID/nonce.
        path=fixture['blob_path']
        if path!='customer_mutation_fixtures/'+str(uuid.UUID(fixture['customer']))+'/'+self.nonce+'.docx' or not re.fullmatch('[a-f0-9]{32}',self.nonce):raise RuntimeError('exact_owned_storage_fixture_required')
        if action=='upload':method='POST';url=BASE+'/storage/v1/object/'+BUCKET+'/'+path;raw=data
        elif action=='read':method='GET';url=BASE+'/storage/v1/object/authenticated/'+BUCKET+'/'+path;raw=None
        elif action=='delete':method='DELETE';url=BASE+'/storage/v1/object/'+BUCKET;raw=json.dumps({'prefixes':[path]}).encode()
        else:raise RuntimeError('storage_fixture_action_denied')
        headers={'authorization':'Bearer '+self.keys['service_role'],'apikey':self.keys['service_role'],'content-type':MIME if action=='upload' else 'application/json'}
        if action=='read':headers['cache-control']='no-cache'
        request=urllib.request.Request(url,method=method,headers=headers,data=raw)
        try:response=self.r._opener.open(request,timeout=60)
        except urllib.error.HTTPError as error:response=error
        with response:status,payload=response.status,response.read(4097)
        if len(payload)>4096:raise RuntimeError('storage_fixture_response_limit')
        self.report.setdefault('storage_fixture_calls',[]).append({'fixture_index':self.fixtures.index(fixture),'action':action,'http_status':status,'response_sha256':digest(payload),'provider_fixture_administration_only':True});self.save()
        return status,payload
    def verify_contract_metadata(self):
        # Management read-only sessions intentionally cannot EXECUTE this private
        # helper. The source/schema preflight already binds all ten compiled
        # registry descriptors to the committed spec; inspect catalog metadata.
        manifest=json.loads(self.manifest.read_text())
        expected=[x for x in manifest['private_schema_sources'] if x['proname']=='sandy_customer_mutation_contracts_v1']
        actual=self.r._sql("SELECT proname,encode(sha256(convert_to(prosrc,'UTF8')),'hex') sha,prosecdef,proconfig,pg_get_userbyid(proowner) owner FROM pg_proc WHERE oid='public.sandy_customer_mutation_contracts_v1()'::regprocedure",True)
        self.check('reviewed_existing_ten_compiled_contracts',len(expected)==1 and actual==expected)
    def prepare(self):
        source=self.source();q=self.r._quote
        self.verify_contract_metadata()
        bucket=self.r._sql("SELECT public,file_size_limit,allowed_mime_types FROM storage.buckets WHERE id='sandy-task-artifacts'",True)
        self.check('existing_private_DOCX_fixture_bucket',len(bucket)==1 and bucket[0]['public'] is False and MIME in bucket[0]['allowed_mime_types'] and bucket[0]['file_size_limit']>=2048)
        Acceptance.prepare(self)
        docx=fixture_docx();self.report['storage_fixture_content_sha256']=digest(docx)
        for f in self.fixtures:
            f.update(parent=str(uuid.uuid4()),file=str(uuid.uuid4()),company=str(uuid.uuid4()),category=str(uuid.uuid4()),blob_path='customer_mutation_fixtures/'+f['customer']+'/'+self.nonce+'.docx')
            status,_=self.storage(f,'upload',docx);self.check('actual_private_storage_fixture_upload_'+str(self.fixtures.index(f)),status in [200,201])
            status,raw=self.storage(f,'read');self.check('actual_private_storage_fixture_readback_'+str(self.fixtures.index(f)),status==200 and digest(raw)==digest(docx))
            self.r._sql('BEGIN;INSERT INTO public.sandy_tasks(id,customer_id,title,source_kind) VALUES('+','.join(q(v) for v in [f['parent'],f['customer'],'Isolated Sandy API service task','sandy_api_fixture'])+');INSERT INTO public.sandy_agenda_companies(id,customer_id,name) VALUES('+','.join(q(v) for v in [f['company'],f['customer'],'Isolated mutation fixture company '+self.nonce])+');INSERT INTO public.sandy_agenda_categories(id,customer_id,company_id,name) VALUES('+','.join(q(v) for v in [f['category'],f['customer'],f['company'],'Isolated mutation fixture category '+self.nonce])+');INSERT INTO public.sandy_universal_files(id,owner_customer_id,display_name,mime_type,byte_size,storage_bucket,storage_path,metadata,analysis_status) VALUES('+','.join(q(v) for v in [f['file'],f['customer'],'Isolated metadata DOCX',MIME])+','+str(len(docx))+','+q(BUCKET)+','+q(f['blob_path'])+','+q(json.dumps({'customer_mutation_fixture':self.nonce}))+"::jsonb,'skipped');COMMIT;")
        f=self.fixtures[0];self.readiness=str(uuid.uuid4());expires=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=15)).isoformat()
        metadata={'kind':'runtime_customer_mutation_certification','schema_version':1,'operation':'customer.mutations','fixture_user_id':f['user'],'fixture_customer_id':f['customer'],'fixture_nonce':self.nonce,'release_commit':self.report['source_commit'],'api_bundle_sha256':source['sandy-operation-api']['bundle_sha256'],'api_deployment_id':source['sandy-operation-api']['deployment_id'],'contract_sha256':self.spec['bundle_sha256'],'contracts':self.spec['contracts'],'idempotency_prefix':self.prefix,'task_ids':[f['task'],f['parent']],'calendar_ids':[f['event']],'file_ids':[f['file']],'company_ids':[f['company']],'category_ids':[f['category']],'max_mutations':26,'budget_units':0,'analysis_mode':self.spec['analysis_mode'],'expires_at':expires}
        rows=self.r._sql("INSERT INTO public.sandy_engineering_changes(title,problem,expected_behavior,change_purpose,feature_improvement,scope,regression_rules,acceptance_criteria,risk,requested_by,idempotency_key,status) SELECT 'Certify ten existing customer mutations','Real provider proof is missing','Finite isolated writes with original triggers and customer authority','SANDY Runtime protected certification','Reusable real DB contract coverage','[\"sandy-operation-api\",\"sandy-api-mcp\"]','[\"No flags, grants or Owner changes\",\"No paid model calls\"]','[\"Actual MCP receipts, fields, tenancy, replay, error and retirement\"]','normal',i.user_id,'customer-mutation-private-'||gen_random_uuid()::text,'proposed' FROM public.sandy_engineering_test_identities i JOIN auth.users u ON u.id=i.user_id WHERE u.email='sandy-engineering-test@sandy-ai.internal' AND i.enabled AND i.revoked_at IS NULL RETURNING id")
        if len(rows)!=1:raise RuntimeError('source_tracking_identity_unavailable')
        self.change=str(uuid.UUID(rows[0]['id']))
        self.r._sql('BEGIN;INSERT INTO public.sandy_engineering_artifacts(id,change_id,artifact_type,target,rollback_strategy,metadata) VALUES('+','.join(q(v) for v in [self.readiness,self.change,'configuration','customer.mutations','manual_review'])+','+q(json.dumps(metadata))+"::jsonb);INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) SELECT change_id,'customer_mutation_private_readiness_installed',NULL,jsonb_build_object('artifact_id',id,'artifact_sha256',encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex'),'release_commit',metadata->>'release_commit','api_bundle_sha256',metadata->>'api_bundle_sha256','api_deployment_id',metadata->>'api_deployment_id','contract_sha256',metadata->>'contract_sha256') FROM public.sandy_engineering_artifacts a WHERE id="+q(self.readiness)+';COMMIT;')
        self.report.update(readiness_id=self.readiness,readiness_expires_at=expires);self.save()
    def rpc(self,fixture,method,params):
        if not(self.readiness and method=='tools/call' and params.get('name') in self.spec['contracts']):return Acceptance.rpc(self,fixture,method,params)
        request=urllib.request.Request(BASE+'/functions/v1/sandy-api-mcp',method='POST',headers={'authorization':'Bearer '+fixture['token'],'apikey':self.keys['anon'],'content-type':'application/json','x-sandy-certification-id':self.readiness},data=json.dumps({'jsonrpc':'2.0','id':str(uuid.uuid4()),'method':method,'params':params}).encode())
        try:response=self.r._opener.open(request,timeout=120)
        except urllib.error.HTTPError as error:response=error
        with response:status,raw=response.status,response.read(2500001)
        if len(raw)>2500000:raise RuntimeError('private_MCP_response_limit')
        return status,json.loads(raw)
    def retire(self):
        if not self.readiness or not self.change or self.retired:return
        q=self.r._quote
        installed=self.r._sql("SELECT id FROM public.sandy_engineering_change_events WHERE event_type='customer_mutation_private_readiness_installed' AND detail->>'artifact_id'="+q(self.readiness),True)
        if installed:self.r._sql("INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES("+q(self.change)+",'customer_mutation_private_readiness_revoked',NULL,jsonb_build_object('artifact_id',"+q(self.readiness)+",'reason','Finite fixture verification retired'))")
        self.retired=True;self.report['readiness_retired']=True;self.save()
    def mutate(self,op,fields,key):return self.call(self.fixtures[0],op,{**fields,'idempotency_key':self.prefix+key})
    def positive(self,op,fields,key):
        result,payload=self.mutate(op,fields,key);self.check(key+'_actual_MCP_receipt',passing_read(result,payload))
        rows=self.receipt(payload['mutation_id']);self.check(key+'_independent_atomic_receipt',len(rows)==1 and rows[0]['operation']==op and rows[0]['result']==payload)
        area=op.split('.')[0];table={'tasks':'sandy_tasks','calendar':'sandy_calendar_events','files':'sandy_universal_files'}[area];owner='owner_customer_id' if area=='files' else 'customer_id';q=self.r._quote
        base=self.r._sql('SELECT to_jsonb(t) item FROM public.'+table+' t WHERE id='+q(payload['item']['id'])+' AND '+owner+'='+q(self.fixtures[0]['customer']),True)
        keys=set(fields)-{'id','name'}
        if op=='files.rename':keys={'display_name'}
        if op=='files.set_description':keys={'description'}
        if op=='files.archive':keys={'library_state','library_state_changed_at'}
        if op=='tasks.complete':keys={'status','completed_at'}
        if op=='tasks.archive':keys={'archived_at'}
        if op=='calendar.cancel':keys={'status'}
        self.check(key+'_independent_base_row_readback',len(base)==1 and all(base[0]['item'].get(k)==payload['item'].get(k) for k in keys))
        self.report['verified_mutation_receipts'].append({k:v for k,v in rows[0].items() if k!='result'});self.report['operation_field_evidence'].append({'operation':op,'fields':sorted(fields),'verified_base_fields':sorted(keys),'base_readback_sha256':digest(json.dumps(base,sort_keys=True).encode()),'mutation_id':payload['mutation_id'],'reused':False});self.save()
        replay,replayed=self.mutate(op,fields,key);self.check(key+'_same_key_replay',passing_read(replay,replayed) and replayed.get('mutation_id')==payload['mutation_id'] and replayed.get('reused') is True)
        return payload
    def exercise(self):
        f=self.fixtures[0];foreign=self.fixtures[1];q=self.r._quote
        for op in self.spec['contracts']:
            if op.endswith('.create'):fields={'title':'"Isolated literal task"'} if op=='tasks.create' else {'title':'Isolated event','starts_at':'2099-10-24T10:00:00Z','ends_at':'2099-10-24T11:00:00Z'}
            else:fields={'id':foreign['file'] if op.startswith('files.') else foreign['event'] if op.startswith('calendar.') else foreign['task']}
            if op=='tasks.update':fields['status']='waiting'
            if op=='calendar.update':fields['location']='Foreign fixture'
            if op=='files.rename':fields['name']='Foreign fixture'
            denied,_=self.call(foreign,op,{**fields,'idempotency_key':self.prefix+'foreign_'+op.replace('.','_')});self.check(op+'_foreign_profile_denied',denied.get('api_status')==403 and denied.get('is_error') is True)
        confirmed=self.r._sql('SELECT email_confirmed_at FROM auth.users WHERE id='+q(f['user']),True)[0]['email_confirmed_at']
        try:
            self.r._sql('UPDATE auth.users SET email_confirmed_at=NULL WHERE id='+q(f['user']))
            denied,_=self.mutate('tasks.update',{'id':f['task'],'priority':'normal'},'unconfirmed')
            self.check('genuine_session_without_current_email_confirmation_denied',denied.get('api_status')==403 and denied.get('executed') is False)
        finally:self.r._sql('UPDATE auth.users SET email_confirmed_at='+q(confirmed)+'::timestamptz WHERE id='+q(f['user']))
        created=self.positive('tasks.create',{'title':'"Isolated literal checklist"','details':'Synthetic internal fixture only','status':'todo','priority':'low','parent_task_id':f['parent'],'company_id':f['company'],'category_id':f['category'],'position':2},'task_create');f['created_task']=created['item']['id']
        common={'id':f['task'],'title':'Isolated updated fixture','details':'Synthetic content','due_at':'2099-10-24T12:00:00Z','start_at':'2099-10-24T11:00:00Z','next_review_at':'2099-10-24T13:00:00Z','parent_task_id':f['parent'],'company_id':f['company'],'category_id':f['category'],'position':4}
        self.positive('tasks.update',{**common,'status':'todo','priority':'low'},'task_fields')
        for i,state in enumerate(['in_progress','waiting','blocked','completed','cancelled','todo']):self.positive('tasks.update',{'id':f['task'],'status':state,'priority':['normal','high','urgent'][i%3]},'task_state_'+str(i))
        self.positive('tasks.update',{'id':f['task'],'parent_task_id':None,'company_id':None,'category_id':None,'due_at':None,'start_at':None,'next_review_at':None},'task_nulls')
        self.positive('tasks.complete',{'id':f['task']},'task_complete');self.positive('tasks.archive',{'id':f['task']},'task_archive')
        self.positive('calendar.create',{'title':'Isolated create event','starts_at':'2099-10-24T10:00:00Z','ends_at':'2099-10-24T11:00:00Z','description':'Synthetic event','timezone':'UTC','all_day':False,'location':'Fixture','status':'tentative','company_id':f['company']},'calendar_create')
        self.positive('calendar.update',{'id':f['event'],'title':'Updated local fixture','description':'Updated synthetic event','starts_at':'2099-10-24T11:00:00Z','ends_at':'2099-10-24T12:00:00Z','timezone':'Australia/Sydney','all_day':True,'location':'Updated fixture','status':'confirmed','company_id':f['company']},'calendar_fields')
        self.positive('calendar.update',{'id':f['event'],'description':None,'ends_at':None,'location':None,'company_id':None,'status':'cancelled'},'calendar_nulls')
        self.positive('calendar.update',{'id':f['event'],'status':'tentative'},'calendar_tentative');self.positive('calendar.cancel',{'id':f['event']},'calendar_cancel')
        for i,name in enumerate(['  Isolated Unicode ☁ file  ','X'*248+'😀Z']):self.positive('files.rename',{'id':f['file'],'name':name},'file_rename_'+str(i))
        for i,description in enumerate(['Synthetic fixture description',None]):self.positive('files.set_description',{'id':f['file'],'description':description},'file_description_'+str(i))
        self.positive('files.set_description',{'id':f['file']},'file_description_omitted')
        for op,fields,key,expected in [('calendar.update',{'id':f['event'],'starts_at':'2099-10-24T12:00:00Z','ends_at':'2099-10-24T11:00:00Z'},'invalid_interval',400),('files.rename',{'id':f['file'],'name':'   '},'empty_name',400),('tasks.create',{'title':'Unbounded nonliteral model work'},'nonliteral_create',403),('tasks.update',{'id':f['task'],'status':'done'},'invalid_enum',400)]:
            denied,_=self.mutate(op,fields,key);self.check(key+'_precise_error_propagated',denied.get('api_status')==expected and denied.get('is_error') is True and denied.get('executed') is False)
        conflict,_=self.mutate('files.rename',{'id':f['file'],'name':'Changed argument'},'file_rename_0');self.check('same_key_changed_arguments_denied',conflict.get('api_status')==409 and conflict.get('is_error') is True)
        self.positive('files.rename',{'id':f['file'],'name':'Isolated final metadata filename'},'file_rename_final')
        denied,_=self.mutate('files.rename',{'id':f['file'],'name':'One beyond the reviewed bound'},'file_rename_budget')
        self.check('operation_class_budget_denied_without_effect',denied.get('api_status')==429 and denied.get('is_error') is True and denied.get('executed') is False)
        self.positive('files.archive',{'id':f['file']},'file_archive')
        deadline=time.monotonic()+120;analysis=[]
        while time.monotonic()<deadline:
            analysis=self.r._sql('SELECT task_id,state,attempts,processed_at FROM public.sandy_task_analysis_queue WHERE task_id='+q(f['created_task'])+' AND customer_id='+q(f['customer']),True)
            if analysis and analysis[0]['state'] in ['complete','failed','skipped']:break
            time.sleep(2)
        audit_available=self.r._sql("SELECT to_regclass('public.sandy_openai_request_audit') IS NOT NULL available",True)[0]['available']
        self.report['literal_governed_model_audit_available']=audit_available
        if audit_available:
            governed=self.r._sql("SELECT count(*)::int reservations FROM public.sandy_openai_request_audit WHERE capability='task.configuration.extract' AND source_reference="+q(f['created_task']),True)
            self.report['literal_governed_model_audit']=governed;self.check('literal_task_has_no_governed_model_reservation',governed==[{'reservations':0}])
        self.report['literal_task_analysis_queue']=analysis;self.check('normal_literal_task_queue_processed',len(analysis)==1 and analysis[0]['state']=='complete' and bool(analysis[0]['processed_at']))
        effects=self.r._sql('SELECT (SELECT count(*) FROM public.sandy_customer_mutation_receipts WHERE customer_id='+q(f['customer'])+' AND left(idempotency_key,length('+q(self.prefix)+'))='+q(self.prefix)+') receipts,(SELECT count(*) FROM public.sandy_calendar_outbox WHERE customer_id='+q(f['customer'])+') calendar_outbox,(SELECT count(*) FROM public.sandy_mission_runs WHERE customer_id='+q(f['customer'])+') mission_runs',True)[0]
        self.check('finite_effect_budget_no_external_calendar_or_missions',effects['receipts']<=26 and effects['calendar_outbox']==0 and effects['mission_runs']==0)
        status,blob=self.storage(f,'read');self.check('metadata_operations_preserve_real_fixture_object',status==200 and digest(blob)==self.report['storage_fixture_content_sha256'])
        flags=self.r._sql("SELECT count(*)::int verified FROM public.sandy_operation_registry WHERE operation=ANY(ARRAY["+','.join(q(op) for op in self.spec['contracts'])+"]) AND verified",True)
        self.check('no_broad_operation_publication_or_verification',flags==[{'verified':0}])
        self.report['independent_effect_counts']=effects;self.retire();denied,_=self.mutate('files.rename',{'id':f['file'],'name':'After retirement'},'file_rename_0');self.check('revocation_blocks_replay',denied.get('api_status')==403 and denied.get('is_error') is True)
    def cleanup(self):
        self.retire();failures=[];owned_customers=set();storage_fixtures=[];q=self.r._quote
        for f in self.fixtures:
            if not f.get('customer'):continue
            owned=self.r._sql('SELECT display_name,google_drive_folder_status FROM public.email_customers WHERE id='+q(f['customer']),True)
            if owned!=[{'display_name':'Isolated Sandy API service acceptance','google_drive_folder_status':'excluded'}]:failures.append('fixture_cleanup_ownership_not_proved');continue
            owned_customers.add(f['customer'])
            if f.get('file'):
                self.r._sql('BEGIN;DELETE FROM public.sandy_universal_files WHERE id='+q(f['file'])+' AND owner_customer_id='+q(f['customer'])+' AND metadata->>\'customer_mutation_fixture\'='+q(self.nonce)+';DELETE FROM public.sandy_task_analysis_queue WHERE customer_id='+q(f['customer'])+" AND state IN('complete','failed','skipped','pending');COMMIT;")
            if f.get('blob_path'):storage_fixtures.append(f)
        try:PrivateMemoryAcceptance.cleanup(self)
        finally:
            for f in storage_fixtures:
                try:
                    status,payload=self.storage(f,'read')
                    if status==200:
                        status,_=self.storage(f,'delete')
                        if status!=200:raise RuntimeError('storage_fixture_delete_failed')
                    elif not storage_object_absent(status,payload):raise RuntimeError('storage_fixture_state_unknown')
                    await_storage_absent(lambda:self.storage(f,'read'))
                except Exception as error:
                    code=str(error) if isinstance(error,RuntimeError) and re.fullmatch('[A-Za-z0-9_]{1,120}',str(error)) else type(error).__name__
                    failures.append({'fixture_index':self.fixtures.index(f),'code':code})
            for f in self.fixtures:
                if f.get('customer') in owned_customers:
                    self.r._sql('BEGIN;DELETE FROM public.sandy_agenda_categories WHERE customer_id='+q(f['customer'])+' AND name LIKE \'Isolated mutation fixture %\';DELETE FROM public.sandy_agenda_companies WHERE customer_id='+q(f['customer'])+' AND name LIKE \'Isolated mutation fixture %\';COMMIT;')
            self.report['cleanup']['storage_and_fixture_retirement_complete']=not failures
            self.report['cleanup']['retirement_failures']=failures;self.save()
        if failures:raise RuntimeError('storage_or_fixture_retirement_incomplete')
    def run(self):
        try:self.prepare();self.exercise()
        except Exception as error:
            self.report['runner_error']=type(error).__name__
            if isinstance(error,RuntimeError) and re.fullmatch('[A-Za-z0-9_]{1,120}',str(error)):self.report['runner_error_code']=str(error)
        finally:
            try:self.cleanup()
            except Exception as error:self.report['cleanup'].update(complete=False,error_class=type(error).__name__)
        self.report['complete']=not self.report.get('runner_error') and all(x['passed'] for x in self.report['checks']) and self.report['cleanup'].get('complete') is True and self.report['cleanup'].get('storage_and_fixture_retirement_complete') is True
        self.save();report_sha=digest(self.output.read_bytes());proof_event=None
        installed=[]
        if self.readiness and self.change:installed=self.r._sql("SELECT id FROM public.sandy_engineering_change_events WHERE event_type='customer_mutation_private_readiness_installed' AND detail->>'artifact_id'="+self.r._quote(self.readiness),True)
        if installed and self.retired:
            proof={'state':'accepted' if self.report['complete'] else 'partial','failed_checks':[x['name'] for x in self.report['checks'] if not x['passed']],'runner_error':self.report.get('runner_error_code',self.report.get('runner_error')),'source_commit':self.report['source_commit'],'report_sha256':report_sha,'installed_source':self.report['installed_source'],'mutation_receipt_ids':[x['mutation_id'] for x in self.report['verified_mutation_receipts']],'operation_field_evidence':self.report['operation_field_evidence'],'literal_task_analysis_queue':self.report.get('literal_task_analysis_queue'),'cleanup':self.report['cleanup'],'normal_customer_MCP':True,'nonliteral_model_enrichment_verified':False,'global_flags_changed':False}
            rows=self.r._sql("INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES("+self.r._quote(self.change)+",'customer_mutation_private_readiness_revoked',NULL,"+self.r._quote(json.dumps({'artifact_id':self.readiness,'customer_mutation_MCP_proof':proof}))+"::jsonb) RETURNING id")
            if len(rows)!=1:raise RuntimeError('immutable_execution_proof_record_required')
            proof_event=rows[0]['id']
        notice={'complete':self.report['complete'],'error_class':self.report.get('runner_error'),'runner_error_code':self.report.get('runner_error_code'),'report_sha256':report_sha,'proof_event_id':proof_event,'readiness_id':self.readiness,'receipt_ids':[x['mutation_id'] for x in self.report['verified_mutation_receipts']],'checks_passed':sum(x['passed'] for x in self.report['checks']),'failed_checks':[x['name'] for x in self.report['checks'] if not x['passed']],'cleanup':self.report['cleanup'],'scope':self.report['exact_capability_scope'],'nonliteral_model_enrichment_verified':False,'public_flags_changed':False}
        raw=json.dumps(notice)
        if len(raw)>3900:raise RuntimeError('bounded_safe_annotation_required')
        print('::notice title=Finite normal-customer mutation acceptance::'+raw)
        return self.report['complete']
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',required=True,type=Path);parser.add_argument('--manifest',required=True,type=Path);args=parser.parse_args();raise SystemExit(0 if CustomerMutationAcceptance(args.output,args.manifest).run() else 1)
