"""Bounded live web/Runtime memory acceptance using ordinary isolated customer Auth.

Management administers synthetic fixtures and reads independent receipts only.
Requests under test use the normal workspace customer bearer, never a service key
or QA credential. No emails, WhatsApp messages, voice calls or connected-provider
writes are requested. Up to three paid model turns run through the normal route.
Immutable runtime receipts and their isolated customer FK are deliberately retained;
Auth sessions are retired and mutable fixture data is removed after verification.
"""
from __future__ import annotations
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import uuid
from customer_service_acceptance import Acceptance
from engineering_runtime import BASE


class RuntimeMemoryAcceptance(Acceptance):
    def __init__(self, output):
        super().__init__(output)
        self.report.update(kind='normal_customer_web_runtime_memory_acceptance',
                           real_channel_delivery_tested=['web'],
                           external_messages_requested=0, model_turn_budget=3,
                           audit_customers_retained=True)
        self.nonce = uuid.uuid4().hex
        self.query = 'RUNTIME_MEM_' + self.nonce
        self.own = 'CERULEAN_' + uuid.uuid4().hex
        self.foreign = 'FOREIGN_' + uuid.uuid4().hex
        self.archives = [str(uuid.uuid4()), str(uuid.uuid4())]
        self.report['web_calls'] = []

    def workspace(self, fixture, action, body):
        return self.r._http('POST', BASE + '/functions/v1/sandy-workspace?action=' + action,
                            fixture['token'], body, self.keys['anon'])

    def conversation(self, fixture):
        status, body = self.workspace(fixture, 'web_new_conversation', {})
        self.check('normal_customer_conversation_' + str(len(self.report['web_calls'])),
                   status == 200 and body.get('ok') is True and isinstance(body.get('conversation_id'), str))
        return body['conversation_id']

    def seed(self):
        q = self.r._quote
        for index, fixture in enumerate(self.fixtures):
            answer = self.own if index == 0 else self.foreign
            self.r._sql('BEGIN;UPDATE public.sandy_memory_settings SET enabled=true,learning_enabled=false,proactive_enabled=false,consent_at=clock_timestamp(),updated_at=clock_timestamp() WHERE customer_id=' + q(fixture['customer'])
                + ';INSERT INTO public.sandy_memory_archive(id,owner_customer_id,channel,source_key,source_role,content_kind,content,source_ref,state,embedding_status) VALUES('
                + ','.join(q(v) for v in [self.archives[index], fixture['customer'], 'manual', 'runtime-memory-fixture:' + self.nonce, 'user', 'note', self.query + ' canary answer is ' + answer])
                + ",'{}'::jsonb,'active','skipped');COMMIT;")

    def ask(self, stage):
        fixture = self.fixtures[0]
        conversation = self.conversation(fixture)
        request_id = 'runtime_memory_' + stage + '_' + uuid.uuid4().hex
        prompt = ('Search my saved memory using sandy_context_lookup with operation memory_search and query '
                  + self.query + '. Use that actual tool result. Return the note text if available; otherwise state that no result is verified. Do not research, message anyone or change records.')
        status, body = self.workspace(fixture, 'ask', {'conversation_id': conversation,
            'request_id': request_id, 'question': prompt, 'timezone': 'UTC'})
        safe = {'stage': stage, 'http_status': status, 'task_id': body.get('task_id'),
                'request_id': request_id, 'response_sha256': hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest(),
                'own_answer_present': self.own in str(body.get('response', '')),
                'foreign_answer_present': self.foreign in json.dumps(body)}
        self.report['web_calls'].append(safe); self.save()
        self.check(stage + '_normal_web_response', status == 200 and body.get('ok') is True and bool(body.get('response')))
        self.check(stage + '_tenant_isolation', not safe['foreign_answer_present'])
        q = self.r._quote
        audits = self.r._sql("SELECT id,operation,principal_kind,customer_id,task_id,state,error FROM public.sandy_agent_operation_audit WHERE task_id=" + q(body['task_id']) + " AND operation='agent.runtime.context.memory.search' ORDER BY created_at", True)
        safe['memory_audits'] = audits
        rounds = self.r._sql('SELECT id,round,state,source_runtime,provider_response_id,response_sha256 FROM public.sandy_runtime_conversation_audit WHERE task_id=' + q(body['task_id']) + ' ORDER BY round', True)
        safe['conversation_receipts'] = rounds; self.save()
        self.check(stage + '_actual_memory_operation', bool(audits) and all(a['customer_id'] == fixture['customer'] and a['principal_kind'] == 'trusted_runtime' for a in audits))
        self.check(stage + '_real_provider_conversation', bool(rounds) and all(r['state'] == 'succeeded' and r['source_runtime'] == 'sandy-agent-runtime-v4' and r['provider_response_id'] and r['response_sha256'] for r in rounds))
        return safe

    def exercise(self):
        self.seed()
        first = self.ask('enabled')
        self.check('enabled_note_returned', first['own_answer_present'] and all(a['state'] == 'succeeded' for a in first['memory_audits']))
        q = self.r._quote
        self.r._sql('UPDATE public.sandy_memory_settings SET enabled=false,updated_at=clock_timestamp() WHERE customer_id=' + q(self.fixtures[0]['customer']))
        disabled = self.ask('disabled')
        self.check('disabled_memory_refused', not disabled['own_answer_present'] and all(a['state'] == 'failed' and a['error'] == 'memory_disabled' for a in disabled['memory_audits']))
        self.r._sql('BEGIN;UPDATE public.sandy_memory_settings SET enabled=true,updated_at=clock_timestamp() WHERE customer_id=' + q(self.fixtures[0]['customer']) + ';UPDATE public.sandy_memory_archive SET state=\'forgotten\' WHERE id=' + q(self.archives[0]) + ' AND owner_customer_id=' + q(self.fixtures[0]['customer']) + ';COMMIT;')
        forgotten = self.ask('forgotten')
        self.check('forgotten_note_unavailable', not forgotten['own_answer_present'] and all(a['state'] == 'succeeded' for a in forgotten['memory_audits']))
        foreign_conversation = self.conversation(self.fixtures[1])
        status, _ = self.workspace(self.fixtures[0], 'ask', {'conversation_id': foreign_conversation, 'request_id': 'runtime_denied_' + uuid.uuid4().hex, 'question': 'Read that other conversation'})
        self.check('foreign_conversation_denied_before_runtime', status == 404)

    def cleanup(self):
        q = self.r._quote
        for fixture in self.fixtures:
            if fixture.get('token'):
                status, _ = self.r._http('POST', BASE + '/auth/v1/logout?scope=local', fixture['token'], {}, self.keys['anon'])
                self.report['cleanup'].setdefault('logout_statuses', []).append(status)
            if fixture.get('customer'):
                customer = q(fixture['customer'])
                owned = self.r._sql('SELECT display_name,google_drive_folder_status FROM public.email_customers WHERE id=' + customer, True)
                if owned != [{'display_name': 'Isolated Sandy API service acceptance', 'google_drive_folder_status': 'excluded'}]:
                    raise RuntimeError('fixture_cleanup_ownership_not_proved')
                # Keep immutable execution receipts and their customer FK. Never
                # disable triggers or delete audit evidence to erase test users.
                self.r._sql('BEGIN;UPDATE public.sandy_memory_settings SET enabled=false,learning_enabled=false,proactive_enabled=false,updated_at=clock_timestamp() WHERE customer_id=' + customer
                    + ';DELETE FROM public.sandy_memory_archive WHERE owner_customer_id=' + customer
                    + ';DELETE FROM public.sandy_web_turns WHERE customer_id=' + customer
                    + ';DELETE FROM public.sandy_web_conversations WHERE customer_id=' + customer
                    + ';DELETE FROM public.sandy_task_pins WHERE customer_id=' + customer
                    + ';DELETE FROM public.sandy_tasks WHERE customer_id=' + customer
                    + ';DELETE FROM public.sandy_calendar_events WHERE customer_id=' + customer
                    + ';DELETE FROM public.sandy_timezone_profiles WHERE customer_id=' + customer
                    + ';DELETE FROM public.sandy_agenda_access WHERE customer_id=' + customer
                    + ';DELETE FROM public.sandy_customer_onboarding_receipts WHERE actor_id=' + q(fixture['user'])
                    + ';DELETE FROM public.sandy_memory_portal_accounts WHERE auth_user_id=' + q(fixture['user'])
                    + ';COMMIT;')
            self.r._auth_admin('DELETE', 'users/' + fixture['user'])
        if self.fixtures:
            users = ','.join(q(f['user']) for f in self.fixtures)
            remaining = self.r._sql('SELECT (SELECT count(*) FROM auth.users WHERE id IN (' + users + ')) users,(SELECT count(*) FROM auth.sessions WHERE user_id IN (' + users + ')) sessions,(SELECT count(*) FROM public.sandy_memory_portal_accounts WHERE auth_user_id IN (' + users + ')) portal_accounts', True)[0]
            self.report['cleanup'].update(remaining=remaining, complete=all(v == 0 for v in remaining.values()), immutable_audits_preserved=True, fixture_customer_ids_retained=[f.get('customer') for f in self.fixtures if f.get('customer')])
        self.save()

    def run(self):
        try:
            self.prepare(); self.exercise()
        except Exception as error:
            self.report['runner_error'] = type(error).__name__
            if isinstance(error, RuntimeError) and str(error).replace('_', '').isalnum():
                self.report['runner_error_code'] = str(error)
        finally:
            try:
                self.cleanup()
            except Exception as error:
                self.report['cleanup']['complete'] = False
                self.report['cleanup']['error_class'] = type(error).__name__
        self.report['complete'] = not self.report.get('runner_error') and all(c.get('passed') for c in self.report['checks']) and self.report['cleanup'].get('complete') is True
        self.report['finished_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat(); self.save()
        print(json.dumps({'complete': self.report['complete'], 'web_turns': len(self.report['web_calls']), 'failed_checks': [c['name'] for c in self.report['checks'] if not c['passed']], 'cleanup': self.report['cleanup']}))
        return self.report['complete']


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    raise SystemExit(0 if RuntimeMemoryAcceptance(args.output).run() else 1)
