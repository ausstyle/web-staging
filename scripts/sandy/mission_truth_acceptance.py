"""One bounded normal-customer mission through existing cron and durable receipts.

No private worker invocation, shared credential handoff, registry change, outbound
message or external tool is requested. Customer requests use normal Auth. Existing
one-minute workers perform the actual paid planning/internal draft work. Completion
means one verified internal draft pending review, not a completed customer mission.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import time
import uuid
from runtime_web_memory_acceptance import RuntimeMemoryAcceptance
from engineering_runtime import BASE


class MissionTruthAcceptance(RuntimeMemoryAcceptance):
    def __init__(self, output, timeout=240):
        super().__init__(output)
        self.timeout = timeout
        self.mission_id = None
        self.report.update(kind='normal_customer_durable_mission_truth_acceptance',
            acceptance_scope='one actual internal plan and draft pending customer review',
            model_request_budget=5, model_turn_budget=5,
            model_or_connected_provider_work_requested=True, external_actions_authorized=False,
            worker_invocation='existing_cron_only', mission_fully_completed=False)

    def read_state(self):
        q = self.r._quote; cid = q(self.fixtures[0]['customer']); mid = q(self.mission_id)
        mission = self.r._sql('SELECT id,customer_id,status,metadata FROM public.sandy_tasks WHERE id=' + mid + ' AND customer_id=' + cid, True)
        planning = self.r._sql('SELECT id,run_id,state,provider_response_id,response_sha256,review_state,review_provider_response_id,review_response_sha256 FROM public.sandy_mission_planning_audit WHERE mission_task_id=' + mid + ' AND customer_id=' + cid + ' ORDER BY created_at', True)
        products = self.r._sql('SELECT id,run_id,state,provider_response_id,response_sha256,draft_sha256,work_product_id,review_task_id FROM public.sandy_mission_work_product_audit WHERE mission_task_id=' + mid + ' AND customer_id=' + cid + ' ORDER BY created_at', True)
        runs = self.r._sql('SELECT id,stage,state,result,error FROM public.sandy_mission_runs WHERE mission_task_id=' + mid + ' AND customer_id=' + cid + ' ORDER BY created_at', True)
        return mission, planning, products, runs

    def exercise(self):
        fixture = self.fixtures[0]
        clocks = self.r._sql("SELECT jobname,schedule,active FROM cron.job WHERE jobname IN('sandy-mission-execute-every-minute','sandy-mission-plan-every-minute') ORDER BY jobname", True)
        self.check('existing_mission_cron_active', len(clocks) == 2 and all(c['active'] is True and c['schedule'] == '* * * * *' for c in clocks))
        status, body = self.workspace(fixture, 'mission_create', {
            'title': 'Synthetic internal draft acceptance ' + self.nonce[:10],
            'objective': 'Create an internal draft checklist using only these complete fictional facts: a fictional inventory list has three items labelled Alpha, Beta and Gamma; a reviewer needs an editable checklist to check each label and record any discrepancy. No real person, company, deadline, account or external system is involved. Plan three simple milestones: Sandy drafts the internal checklist without external action, the customer reviews the draft, then Sandy may incorporate the feedback after that review. Use [TO CONFIRM] for any genuinely missing detail. Do not browse, access files, contact anyone, install or deploy anything, or perform other external actions. Preparing the initial internal draft is requested now; sending or applying it is not authorized.',
            'success_criteria': 'One editable internal checklist pending customer review; no external actions or claim of completed customer work.',
        })
        self.check('normal_customer_mission_admitted', status == 200 and body.get('ok') is True and isinstance(body.get('task_id'), str))
        self.mission_id = str(uuid.UUID(body['task_id'])); self.report['mission_id'] = self.mission_id; self.save()
        deadline = time.monotonic() + self.timeout
        answers_submitted = approval_submitted = False
        latest = None
        while time.monotonic() < deadline:
            latest = self.read_state(); mission, plans, products, runs = latest
            self.report['progress'] = {'plan_states': [p['state'] for p in plans], 'product_states': [p['state'] for p in products], 'runs': [{'id': r['id'], 'stage': r['stage'], 'state': r['state']} for r in runs]}; self.save()
            estimated_requests = len(plans) + sum(p['review_state'] in ('started', 'reviewed', 'unavailable') for p in plans) + sum(p['state'] != 'waiting' for p in products)
            self.check('bounded_model_requests_' + str(len(self.report['checks'])), estimated_requests <= 5)
            if any(p['state'] == 'unknown' for p in plans + products):
                raise RuntimeError('mission_provider_outcome_requires_reconciliation_no_retry')
            if any(p['state'] == 'succeeded' for p in products):
                break
            state = mission[0]['metadata'].get('execution_state') if mission else None
            if state == 'awaiting_client_information' and not answers_submitted:
                s, questions = self.workspace(fixture, 'mission_questions', {'task_id': self.mission_id})
                self.check('normal_customer_questions_readable', s == 200 and questions.get('ok') is True)
                open_questions = [question for question in questions.get('questions', []) if question.get('status') == 'open']
                self.check('bounded_clarification_batch', 0 < len(open_questions) <= 8)
                for question in open_questions:
                    s, answer = self.workspace(fixture, 'mission_answer', {'question_id': question['id'], 'answer': 'This is a fictional fixture. Use only labels Alpha, Beta and Gamma and an editable check/discrepancy field. No real person, date, account, external resource or additional research is needed. Unknown details may remain [TO CONFIRM]. Only the internal draft is requested; no external action is authorized.'})
                    self.check('normal_customer_answer_recorded_' + question['id'], s == 200 and answer.get('ok') is True)
                answers_submitted = True
            if state == 'awaiting_client_plan_review' and not approval_submitted and not any(r['stage'] == 'execute' and r['state'] in ('queued', 'running', 'completed') for r in runs):
                s, review = self.workspace(fixture, 'mission_review', {'task_id': self.mission_id, 'decision': 'approve_plan'})
                self.check('normal_customer_internal_plan_review', s == 200 and review.get('ok') is True and review.get('external_actions_authorised') is False)
                approval_submitted = True
            time.sleep(5)
        self.check('actual_durable_internal_draft_received', latest is not None and any(p['state'] == 'succeeded' for p in latest[2]))
        mission, plans, products, runs = self.read_state()
        self.check('independent_planning_provider_receipt', any(p['state'] == 'succeeded' and p['provider_response_id'] and p['response_sha256'] for p in plans))
        receipt = next(p for p in products if p['state'] == 'succeeded')
        self.check('independent_draft_provider_receipt', bool(receipt['provider_response_id'] and receipt['response_sha256'] and receipt['draft_sha256'] and receipt['work_product_id'] and receipt['review_task_id']))
        q = self.r._quote
        rows = self.r._sql('SELECT id,state,content,content_type FROM public.sandy_mission_work_products WHERE id=' + q(receipt['work_product_id']) + ' AND customer_id=' + q(fixture['customer']) + ' AND mission_task_id=' + q(self.mission_id), True)
        self.check('stored_editable_draft_pending_review', len(rows) == 1 and rows[0]['state'] == 'pending_review' and len(rows[0]['content'].strip()) >= 150)
        reviews = self.r._sql('SELECT id,status,metadata FROM public.sandy_tasks WHERE id=' + q(receipt['review_task_id']) + ' AND customer_id=' + q(fixture['customer']) + ' AND parent_task_id=' + q(self.mission_id), True)
        self.check('real_customer_review_commitment', len(reviews) == 1 and reviews[0]['metadata'].get('assigned_to') == 'client' and reviews[0]['metadata'].get('work_product_id') == receipt['work_product_id'])
        s, view = self.workspace(fixture, 'mission_overview', {})
        self.check('normal_customer_can_retrieve_actual_draft', s == 200 and view.get('ok') is True and receipt['work_product_id'] in json.dumps(view))
        denied, _ = self.workspace(self.fixtures[1], 'mission_questions', {'task_id': self.mission_id})
        self.check('foreign_customer_mission_denied', denied == 404)
        self.check('no_false_mission_completion', mission[0]['status'] != 'completed' and all(r.get('result', {}).get('external_actions_performed', 0) == 0 for r in runs if isinstance(r.get('result'), dict)))
        self.report['independent_receipts'] = {'planning': plans, 'drafts': products, 'review_task_id': receipt['review_task_id'], 'work_product_id': receipt['work_product_id'], 'stored_content_sha256': hashlib.sha256(rows[0]['content'].encode()).hexdigest()}; self.save()

    def cleanup(self):
        q = self.r._quote
        if self.mission_id and self.fixtures and self.fixtures[0].get('token'):
            safe, _ = self.call(self.fixtures[0], 'tasks.update', {'id': self.mission_id, 'status': 'cancelled', 'idempotency_key': 'mission-fixture-retire:' + self.nonce})
            self.report['cleanup']['normal_customer_parent_cancellation'] = safe
        for fixture in self.fixtures:
            if fixture.get('token'):
                status, _ = self.r._http('POST', BASE + '/auth/v1/logout?scope=local', fixture['token'], {}, self.keys['anon'])
                self.report['cleanup'].setdefault('logout_statuses', []).append(status)
            if fixture.get('customer'):
                customer = q(fixture['customer'])
                owned = self.r._sql('SELECT display_name,google_drive_folder_status FROM public.email_customers WHERE id=' + customer, True)
                if owned != [{'display_name': 'Isolated Sandy API service acceptance', 'google_drive_folder_status': 'excluded'}]: raise RuntimeError('mission_fixture_cleanup_ownership_not_proved')
                if self.mission_id:
                    self.r._sql('BEGIN;UPDATE public.sandy_tasks SET status=\'cancelled\' WHERE customer_id=' + customer + ' AND (id=' + q(self.mission_id) + ' OR parent_task_id=' + q(self.mission_id) + ") AND status NOT IN('completed','cancelled');UPDATE public.sandy_mission_runs SET state='failed',error='isolated_fixture_retired' WHERE customer_id=" + customer + ' AND mission_task_id=' + q(self.mission_id) + " AND state='queued';COMMIT;")
                self.r._sql('BEGIN;UPDATE public.sandy_memory_settings SET enabled=false,learning_enabled=false,proactive_enabled=false,updated_at=clock_timestamp() WHERE customer_id=' + customer
                    + ';DELETE FROM public.sandy_task_pins WHERE customer_id=' + customer + ';DELETE FROM public.sandy_tasks WHERE customer_id=' + customer + ' AND id=' + q(fixture['task'])
                    + ';DELETE FROM public.sandy_calendar_events WHERE customer_id=' + customer + ' AND id=' + q(fixture['event'])
                    + ';DELETE FROM public.sandy_timezone_profiles WHERE customer_id=' + customer + ';DELETE FROM public.sandy_agenda_access WHERE customer_id=' + customer
                    + ';DELETE FROM public.sandy_customer_onboarding_receipts WHERE actor_id=' + q(fixture['user'])
                    + ';DELETE FROM public.sandy_memory_portal_accounts WHERE auth_user_id=' + q(fixture['user']) + ';COMMIT;')
            self.r._auth_admin('DELETE', 'users/' + fixture['user'])
        if self.fixtures:
            users = ','.join(q(f['user']) for f in self.fixtures)
            remaining = self.r._sql('SELECT (SELECT count(*) FROM auth.users WHERE id IN (' + users + ')) users,(SELECT count(*) FROM auth.sessions WHERE user_id IN (' + users + ')) sessions,(SELECT count(*) FROM public.sandy_memory_portal_accounts WHERE auth_user_id IN (' + users + ')) portal_accounts', True)[0]
            self.report['cleanup'].update(remaining=remaining, complete=all(v == 0 for v in remaining.values()), immutable_mission_receipts_preserved=True, retained_isolated_mission_id=self.mission_id)
        self.save()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--timeout-seconds', type=int, default=240)
    args = parser.parse_args()
    if not 60 <= args.timeout_seconds <= 360: parser.error('timeout must be between 60 and 360 seconds')
    raise SystemExit(0 if MissionTruthAcceptance(args.output, args.timeout_seconds).run() else 1)
