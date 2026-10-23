"""Stage/verify one private email-shadow fixture without sending an email.

Prepare reviews enabled database triggers, uses existing isolated normal Auth
onboarding, stages an explicitly synthetic unsent baseline and retires sessions.
The existing protected OIDC workflow performs the private invocation; no key or
customer token is handed off. Verification reads actual Runtime/provider receipts.
This proves shadow orchestration only, not SMTP delivery or live voice execution.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import uuid
from runtime_web_memory_acceptance import RuntimeMemoryAcceptance
from engineering_runtime import BASE

SUBJECT = '[SANDY QA] Runtime channel continuity acceptance'
BODY = 'Reply exactly EMAIL_SHADOW_ACCEPTANCE. This is a synthetic comparison only. Do not send messages or change records.'
SENDER = 'sandy-runtime-fixture'
BASELINE = 'SYNTHETIC UNSENT COMPARISON BASELINE'
TRIGGER_SHA = 'f007835a8878370dd5260110a722d5689be77a454d564a9b4d4617034402d969'
DEPENDENCY_SHA = 'e33520d28f4d2dc671817f23ded5b58629c98ec3a30085f1a1e2ceb5c9b18a41'


def fingerprint(rows, fields):
    return hashlib.sha256(json.dumps(sorted(tuple(row[key] for key in fields) for row in rows), separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


class EmailShadowAcceptance(RuntimeMemoryAcceptance):
    def __init__(self, output):
        super().__init__(output)
        self.source_id = str(uuid.uuid4())
        self.draft_id = str(uuid.uuid4())
        self.thread_id = str(uuid.uuid4())
        self.report.update(kind='private_email_shadow_runtime_acceptance', real_channel_delivery_tested=[],
            smtp_delivery_verified=False, source_is_synthetic=True, baseline_provider_execution_verified=False,
            shadow_receipts={}, staged_fixture_ids={}, complete=False)

    def review_triggers(self):
        rows = self.r._sql("SELECT c.relname table_name,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) definition,pg_get_functiondef(t.tgfoid) source FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND t.tgrelid IN ('public.email_messages'::regclass,'public.email_ai_generations'::regclass) ORDER BY c.relname,t.tgname", True)
        self.check('email_fixture_triggers_unchanged_and_enabled', all(r['tgenabled'] == 'O' for r in rows) and fingerprint(rows, ['table_name', 'tgname', 'definition', 'source']) == TRIGGER_SHA)
        deps = self.r._sql("SELECT proname,pg_get_functiondef(oid) source FROM pg_proc WHERE proname IN('sandy_customer_contact_observe','can_capture') ORDER BY proname", True)
        self.check('email_fixture_dependencies_unchanged', fingerprint(deps, ['proname', 'source']) == DEPENDENCY_SHA)

    def stage(self):
        try:
            self.review_triggers(); self.prepare()
            q = self.r._quote
            customer = q(self.fixtures[0]['customer'])
            self.check('existing_provider_reference_no_new_configuration', self.r._sql("SELECT provider_key FROM public.email_ai_provider_config WHERE provider_key='openai'", True) == [{'provider_key': 'openai'}])
            # Empty INSERT avoids automatic temporal enqueue. All triggers remain
            # enabled; the later UPDATE is intentionally fixture administration.
            self.r._sql('BEGIN;INSERT INTO public.email_conversations(id,customer_id) VALUES(' + q(self.thread_id) + ',' + customer + ');'
                + 'INSERT INTO public.email_messages(id,customer_id,conversation_id,sender_address,direction,subject,body_text) VALUES('
                + ','.join([q(self.source_id), customer, q(self.thread_id), q(SENDER), "'incoming'", q(SUBJECT), "''"]) + ');'
                + 'UPDATE public.email_messages SET body_text=' + q(BODY) + ' WHERE id=' + q(self.source_id) + ' AND customer_id=' + customer + ';'
                + 'INSERT INTO public.email_messages(id,customer_id,conversation_id,sender_address,direction,subject,body_text,delivery_status) VALUES('
                + ','.join([q(self.draft_id), customer, q(self.thread_id), q(SENDER), "'outgoing'", q(SUBJECT), q(BASELINE), "'draft'"]) + ');'
                + 'INSERT INTO public.email_ai_generations(customer_id,source_message_id,draft_message_id,provider_key,model_name,status,provider_response_id) VALUES('
                + ','.join([customer, q(self.source_id), q(self.draft_id), "'openai'", "'sandy-synthetic-baseline'", "'generated'", 'NULL']) + ');'
                + 'INSERT INTO public.sandy_email_runtime_canary_allowlist(customer_id,enabled) VALUES(' + customer + ',true);'
                + 'DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.sandy_temporal_ingestion_jobs WHERE customer_id=' + customer + ") OR EXISTS(SELECT 1 FROM public.email_messages WHERE customer_id=" + customer + " AND direction='outgoing' AND delivery_status IN('queued','sent')) THEN RAISE EXCEPTION 'synthetic_fixture_background_work_unexpected';END IF;END $$;COMMIT;")
            self.report['staged_fixture_ids'] = {'source_id': self.source_id, 'draft_id': self.draft_id, 'thread_id': self.thread_id}
            self.report['staged_fixtures'] = [{k: v for k, v in f.items() if k != 'token'} for f in self.fixtures]
            for fixture in self.fixtures:
                status, _ = self.r._http('POST', BASE + '/auth/v1/logout?scope=local', fixture.pop('token'), {}, self.keys['anon'])
                self.check('staging_session_retired_' + fixture['user'], status in (200, 204))
            users = ','.join(q(f['user']) for f in self.fixtures)
            self.check('no_live_fixture_sessions_during_handoff', self.r._sql('SELECT count(*) n FROM auth.sessions WHERE user_id IN (' + users + ')', True) == [{'n': 0}])
            self.report['stage'] = 'ready_for_existing_oidc_workflow'; self.save()
            return True
        except Exception as error:
            self.report['runner_error'] = type(error).__name__
            self.report['stage'] = 'staging_failed'
            if isinstance(error, RuntimeError) and str(error).replace('_', '').isalnum(): self.report['runner_error_code'] = str(error)
            self.cleanup(); self.save(); return False

    @classmethod
    def restore(cls, output):
        saved = json.loads(output.read_text())
        if saved.get('kind') != 'private_email_shadow_runtime_acceptance' or saved.get('stage') != 'ready_for_existing_oidc_workflow':
            raise RuntimeError('staged_email_fixture_required')
        runner = cls(output)
        runner.report = saved; runner.fixtures = saved['staged_fixtures']
        for fixture in runner.fixtures:
            uuid.UUID(fixture['user']); uuid.UUID(fixture['customer'])
            if 'token' in fixture: raise RuntimeError('credential_in_staged_fixture_forbidden')
        ids = saved['staged_fixture_ids']
        runner.source_id, runner.draft_id, runner.thread_id = (str(uuid.UUID(ids[key])) for key in ['source_id', 'draft_id', 'thread_id'])
        return runner

    def verify(self):
        q = self.r._quote
        try:
            fixture = self.fixtures[0]
            rows = self.r._sql('SELECT source_message_id,customer_id,baseline_draft_id,agent_task_id,status,candidate_excerpt,comparison,error FROM public.sandy_email_runtime_canary WHERE source_message_id=' + q(self.source_id), True)
            self.check('email_shadow_actual_candidate_ready', len(rows) == 1 and rows[0]['customer_id'] == fixture['customer'] and rows[0]['status'] == 'candidate_ready' and rows[0]['comparison'].get('candidate_ready') is True and rows[0]['comparison'].get('live_send') is False and 'EMAIL_SHADOW_ACCEPTANCE' in rows[0]['candidate_excerpt'])
            row = rows[0]
            task = self.r._sql('SELECT id,customer_id,channel,status,plan FROM public.sandy_agent_tasks WHERE id=' + q(row['agent_task_id']), True)
            self.check('email_shadow_readonly_real_runtime', len(task) == 1 and task[0]['customer_id'] == fixture['customer'] and task[0]['channel'] == 'email' and task[0]['status'] == 'completed' and task[0]['plan'].get('execution_mode') == 'read_only_assessment')
            receipts = self.r._sql('SELECT id,round,state,source_runtime,provider_response_id,response_sha256 FROM public.sandy_runtime_conversation_audit WHERE task_id=' + q(row['agent_task_id']) + ' ORDER BY round', True)
            self.check('email_shadow_real_provider_receipt', bool(receipts) and all(r['state'] == 'succeeded' and r['source_runtime'] == 'sandy-agent-runtime-v4' and r['provider_response_id'] and r['response_sha256'] for r in receipts))
            self.report['shadow_receipts'] = {'source_message_id': self.source_id, 'task_id': row['agent_task_id'], 'canary_status': row['status'], 'candidate_sha256': hashlib.sha256(row['candidate_excerpt'].encode()).hexdigest(), 'provider_receipts': receipts}
            counts = self.r._sql('SELECT (SELECT count(*) FROM public.sandy_temporal_ingestion_jobs WHERE customer_id=' + q(fixture['customer']) + ') temporal_jobs,(SELECT count(*) FROM public.email_messages WHERE customer_id=' + q(fixture['customer']) + " AND direction='outgoing' AND delivery_status IN('queued','sent')) sent_or_queued_messages", True)
            self.check('no_email_delivery_or_ingestion_job', counts == [{'temporal_jobs': 0, 'sent_or_queued_messages': 0}])
        except Exception as error:
            self.report['runner_error'] = type(error).__name__
            if isinstance(error, RuntimeError) and str(error).replace('_', '').isalnum(): self.report['runner_error_code'] = str(error)
        finally:
            self.cleanup()
        self.report['complete'] = not self.report.get('runner_error') and all(c['passed'] for c in self.report['checks']) and self.report['cleanup'].get('complete') is True
        self.report['stage'] = 'verified_and_retired' if self.report['complete'] else 'failed_and_retired'; self.save()
        return self.report['complete']

    def cleanup(self):
        q = self.r._quote
        if self.fixtures and self.fixtures[0].get('customer'):
            customer = q(self.fixtures[0]['customer'])
            owned = self.r._sql('SELECT display_name,google_drive_folder_status FROM public.email_customers WHERE id=' + customer, True)
            if owned != [{'display_name': 'Isolated Sandy API service acceptance', 'google_drive_folder_status': 'excluded'}]:
                raise RuntimeError('email_fixture_cleanup_ownership_not_proved')
            source = self.r._sql('SELECT subject,sender_address,direction,body_text FROM public.email_messages WHERE id=' + q(self.source_id) + ' AND customer_id=' + customer, True)
            if source and source != [{'subject': SUBJECT, 'sender_address': SENDER, 'direction': 'incoming', 'body_text': BODY}]:
                raise RuntimeError('email_fixture_cleanup_source_not_proved')
            # Restrict removal to IDs generated for this isolated fixture; no
            # provider retry, historical audit deletion or trigger disabling.
            self.r._sql('BEGIN;DELETE FROM public.sandy_email_runtime_canary WHERE source_message_id=' + q(self.source_id) + ' AND customer_id=' + customer
                + ';DELETE FROM public.email_ai_generations WHERE source_message_id=' + q(self.source_id) + ' AND customer_id=' + customer
                + ';DELETE FROM public.email_messages WHERE id IN (' + q(self.source_id) + ',' + q(self.draft_id) + ') AND customer_id=' + customer
                + ';DELETE FROM public.email_conversations WHERE id=' + q(self.thread_id) + ' AND customer_id=' + customer
                + ';DELETE FROM public.sandy_email_runtime_canary_allowlist WHERE customer_id=' + customer + ';COMMIT;')
        super().cleanup()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=['prepare', 'verify-cleanup'])
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    runner = EmailShadowAcceptance(args.output) if args.stage == 'prepare' else EmailShadowAcceptance.restore(args.output)
    passed = runner.stage() if args.stage == 'prepare' else runner.verify()
    print(json.dumps({'ok': passed, 'stage': runner.report['stage'], 'source_message_id': runner.source_id, 'credentials_recorded': False, 'smtp_delivery_verified': False, 'cleanup': runner.report['cleanup']}))
    raise SystemExit(0 if passed else 1)
