"""One real isolated-customer memory correction, with explicit execution surface.

Default MCP mode fails if the canonical operation is unavailable. Portal mode is
an explicit test of the original authenticated Memory API, never a fallback or
claim that MCP exposure works. No model, messages, provider writes, Owner session
or permission/exposure changes are requested. Synthetic facts and immutable
receipts retain their isolated customer FK; login sessions are retired.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import uuid
from runtime_web_memory_acceptance import RuntimeMemoryAcceptance
from engineering_runtime import BASE


class MemoryCorrectionAcceptance(RuntimeMemoryAcceptance):
    def __init__(self, output, surface='mcp'):
        super().__init__(output)
        self.surface = surface
        self.fact_id = str(uuid.uuid4())
        self.fact_key = 'runtime_fixture_' + self.nonce
        self.old = 'OLDASSERT_' + uuid.uuid4().hex
        self.new = 'NEWASSERT_' + uuid.uuid4().hex
        self.report.update(kind='normal_customer_memory_correction_acceptance',
            execution_surface=surface, model_turn_budget=0, real_channel_delivery_tested=[],
            sandy_mcp_execution_verified=False, synthetic_fact_receipts_retained=True)

    def correct(self, fixture, args):
        if self.surface == 'mcp':
            safe, payload = self.call(fixture, 'memory.fact_correct', args)
            return safe.get('api_status'), payload, safe
        status, payload = self.r._http('POST', BASE + '/functions/v1/sandy-memory-centre?op=fact_correct', fixture['token'], args, self.keys['anon'])
        return status, payload, {'http_status': status, 'executed_via_mcp': False,
            'response_sha256': hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()}

    def exercise(self):
        fixture = self.fixtures[0]
        q = self.r._quote
        self.r._sql('INSERT INTO public.email_ai_profile_facts(id,customer_id,category,fact_key,fact_value,confidence,status) VALUES('
            + ','.join(q(v) for v in [self.fact_id, fixture['customer'], 'other', self.fact_key, self.old, 'explicit', 'active']) + ')')
        status, payload, safe = self.correct(fixture, {'id': self.fact_id, 'confirm': True, 'new_value': self.new})
        self.report['correction'] = safe; self.save()
        self.check('normal_customer_correction_succeeded_on_declared_surface', status == 200 and payload.get('ok') is True)
        rows = self.r._sql('SELECT id,customer_id,status,confidence,supersedes_fact_id,fact_value FROM public.email_ai_profile_facts WHERE customer_id=' + q(fixture['customer']) + ' AND fact_key=' + q(self.fact_key), True)
        old = [r for r in rows if r['id'] == self.fact_id]
        changed = [r for r in rows if r.get('supersedes_fact_id') == self.fact_id]
        self.check('independent_original_is_superseded', len(old) == 1 and old[0]['status'] == 'superseded' and old[0]['fact_value'] == self.old)
        self.check('independent_correction_is_active_and_explicit', len(changed) == 1 and changed[0]['status'] == 'active' and changed[0]['confidence'] == 'explicit' and changed[0]['fact_value'] == self.new)
        self.report['independent_fact_readback'] = [{k: v for k, v in row.items() if k != 'fact_value'} for row in rows]
        self.report['independent_fact_readback_sha256'] = hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()
        before_foreign = self.r._sql('SELECT id,status,confidence,fact_value FROM public.email_ai_profile_facts WHERE id=' + q(changed[0]['id']), True)
        denied_status, _, denied = self.correct(self.fixtures[1], {'id': changed[0]['id'], 'confirm': True, 'new_value': 'FORBIDDEN_OTHER_CUSTOMER'})
        after_foreign = self.r._sql('SELECT id,status,confidence,fact_value FROM public.email_ai_profile_facts WHERE id=' + q(changed[0]['id']), True)
        self.report['foreign_denial'] = denied
        self.check('foreign_customer_cannot_correct_owned_fact', denied_status != 200 and after_foreign == before_foreign)
        self.report['sandy_mcp_execution_verified'] = self.surface == 'mcp'
        self.save()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--surface', choices=['mcp', 'portal'], default='mcp')
    args = parser.parse_args()
    raise SystemExit(0 if MemoryCorrectionAcceptance(args.output, args.surface).run() else 1)
