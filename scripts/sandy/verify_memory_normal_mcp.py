#!/usr/bin/env python3
"""Ordinary discoverable customer MCP correction, with no certification header."""
import json
import os
import re
import subprocess
from customer_service_acceptance import Acceptance,passing_read
from verify_memory_private_mcp import PrivateMemoryAcceptance,MANIFEST
from release_web_canary import ROOT

class NormalMemoryAcceptance(PrivateMemoryAcceptance):
    def __init__(self,output):
        super().__init__(output)
        self.prefix='memory_public_'+self.nonce+':'
        self.report.update(kind='ordinary_normal_customer_memory_MCP',private_certification_header_used=False)

    def prepare(self):
        if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main':raise RuntimeError('protected_main_project_release_required')
        source=os.environ.get('GITHUB_SHA','')
        if not re.fullmatch('[a-f0-9]{40}',source) or subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()!=source:raise RuntimeError('committed_project_release_source_required')
        # Parent publication verifies deployed source and exact typed registry row
        # before creating any fixture or changing publication state.
        self.report['source_commit']=source
        Acceptance.prepare(self);q=self.r._quote;fixture=self.fixtures[0]
        for i,fact in enumerate(self.facts):
            self.r._sql('INSERT INTO public.email_ai_profile_facts(id,customer_id,category,fact_key,fact_value,confidence,status,last_observed_at) VALUES('+','.join(q(v) for v in [fact,fixture['customer'],'other','normal_MCP_acceptance:'+self.nonce+':'+str(i),'old fixture '+str(i),'explicit','active'])+',clock_timestamp())')

    def exercise(self):
        fixture=self.fixtures[0];cursor=None;found=[];seen=set()
        for _ in range(100):
            status,body=self.rpc(fixture,'tools/list',{'cursor':cursor} if cursor else {})
            result=body.get('result',{});tools=result.get('tools')
            self.check('ordinary_tools_list_page_'+str(len(seen)),status==200 and isinstance(tools,list))
            found += [t for t in tools if t.get('name')=='memory.fact_correct']
            cursor=result.get('nextCursor')
            if not cursor:break
            if cursor in seen:raise RuntimeError('MCP_discovery_cursor_cycle')
            seen.add(cursor)
        else:raise RuntimeError('MCP_discovery_page_limit')
        self.check('memory_correction_discoverable_once',len(found)==1)
        contract=found[0].get('inputSchema',{});contract=contract.get('$defs',{}).get('sandy_api_arguments',contract);self.check('ordinary_discovery_has_typed_confirmed_idempotent_contract',contract.get('additionalProperties') is False and {'id','new_value','confirm','idempotency_key'}<=set(contract.get('required',[])) and contract.get('properties',{}).get('confirm',{}).get('const') is True)
        first,payload=self.mutation(0,'normal MCP corrected fixture','correct')
        self.check('ordinary_MCP_correction_receipt',passing_read(first,payload) and payload.get('item',{}).get('original_status')=='superseded')
        mutation=payload['mutation_id'];rows=self.receipt(mutation)
        self.check('ordinary_independent_atomic_receipt',len(rows)==1 and rows[0]['result']==payload)
        self.report['verified_mutation_receipts']=[{k:v for k,v in rows[0].items() if k!='result'}]
        q=self.r._quote
        readback=self.r._sql('SELECT f.status original_status,n.status corrected_status,n.supersedes_fact_id,r.corrected_value FROM public.email_ai_profile_facts f JOIN public.email_ai_profile_facts n ON n.supersedes_fact_id=f.id JOIN public.sandy_memory_rejected_facts r ON r.original_fact_id=f.id WHERE f.id='+q(self.facts[0])+' AND f.customer_id='+q(fixture['customer']),True)
        self.check('ordinary_provider_base_rows_independently_verified',len(readback)==1 and readback[0]['original_status']=='superseded' and readback[0]['corrected_status']=='active' and readback[0]['corrected_value']=='normal MCP corrected fixture')
        replay,replayed=self.mutation(0,'normal MCP corrected fixture','correct');self.check('ordinary_idempotent_replay',passing_read(replay,replayed) and replayed.get('mutation_id')==mutation and replayed.get('reused') is True)
        conflict,_=self.mutation(0,'changed fixture value','correct');self.check('ordinary_conflicting_key_denied',conflict.get('api_status')==409 and conflict.get('is_error') is True)
        foreign,_=self.call(self.fixtures[1],'memory.fact_correct',{'id':self.facts[1],'confirm':True,'new_value':'foreign denied','idempotency_key':self.prefix+'foreign'});self.check('ordinary_foreign_customer_denied_without_record_disclosure',foreign.get('api_status')==404 and foreign.get('is_error') is True)
        invalid,_=self.call(fixture,'memory.fact_correct',{'id':self.facts[1],'confirm':False,'new_value':None,'idempotency_key':self.prefix+'unconfirmed'});self.check('ordinary_unconfirmed_mutation_denied',invalid.get('api_status')==400 and invalid.get('is_error') is True)
        for index,value,key,status in [(1,None,'reject','rejected'),(2,'old fixture 2','unchanged','active')]:
            result,body=self.mutation(index,value,key);self.check('ordinary_MCP_'+key,passing_read(result,body) and body.get('item',{}).get('status')==status)
            rows=self.receipt(body['mutation_id']);self.check('ordinary_independent_'+key+'_receipt',len(rows)==1 and rows[0]['result']==body);self.report['verified_mutation_receipts'].append({k:v for k,v in rows[0].items() if k!='result'})
        self.check('normal_calls_never_use_private_readiness',self.readiness is None)
