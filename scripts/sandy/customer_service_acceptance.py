"""Live read acceptance for existing Sandy service contracts, with isolated users.

Management credentials administer fixtures and independent readback only. Every
operation under test uses normal Auth through MCP and the canonical Sandy API.
No verification/exposure flags, production deployments or external accounts are
changed. Fixture content, credentials and raw customer responses are not saved.
"""
from __future__ import annotations
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import secrets
import uuid
from engineering_runtime import EngineeringRuntime, BASE
from test_engineering_customer_boundary import REVIEWED_TRIGGERS


def unpack(status, body):
    if not isinstance(body, dict) or not isinstance(body.get('result'), dict):
        raise ValueError('invalid_mcp_response')
    result = body['result']
    envelope = result.get('_meta', {}).get('sandy_api')
    if not isinstance(envelope, dict):
        envelope = json.loads(result.get('content', [{}])[0].get('text', '{}'))
    api = envelope.get('result', {})
    return {'http_status': status, 'api_status': envelope.get('status'),
            'is_error': result.get('isError'), 'executed': api.get('executed'),
            'error': api.get('error'), 'admission_id': api.get('admission_id'), 'request_id': api.get('request_id')}, result.get('structuredContent', {})


def passing_read(result, payload):
    return (result.get('http_status') == 200 and result.get('api_status') == 200
            and result.get('is_error') is False and result.get('executed') is True
            and payload.get('ok') is True)


def fixture_contains(payload, own_id, foreign_ids):
    serialized = json.dumps(payload)
    return own_id in serialized and not any(value in serialized for value in foreign_ids)


class Acceptance:
    def __init__(self, output, only=None, require_read_receipts=False):
        self.r = EngineeringRuntime()
        self.output = output
        self.only = set(only or [])
        self.require_read_receipts = require_read_receipts
        self.keys = self.r._api_keys()
        self.fixtures = []
        self.report = {'observed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                       'complete': False, 'calls': [], 'checks': [], 'cleanup': {},
                       'credentials_recorded': False, 'service_key_as_customer': False,
                       'Controller_memberships_added': False, 'registry_flags_changed': False,
                       'model_or_connected_provider_work_requested': False}

    def save(self):
        self.output.parent.mkdir(parents=True, exist_ok=True)
        self.output.write_text(json.dumps(self.report, indent=2) + '\n')

    def check(self, name, passed):
        self.report['checks'].append({'name': name, 'passed': bool(passed)})
        self.save()
        if not passed:
            raise RuntimeError(name)

    def rpc(self, fixture, method, params):
        return self.r._http('POST', BASE + '/functions/v1/sandy-api-mcp', fixture['token'],
                            {'jsonrpc': '2.0', 'id': str(uuid.uuid4()), 'method': method, 'params': params},
                            self.keys['anon'])

    def call(self, fixture, operation, args, setup=False, request_id=None):
        if request_id:
            args = {'__sandy_execution': {'request_id': request_id}, 'arguments': args}
        status, raw = self.rpc(fixture, 'tools/call', {'name': operation, 'arguments': args})
        result, payload = unpack(status, raw)
        if not setup:
            self.report['calls'].append({'operation': operation, 'fixture_index': self.fixtures.index(fixture),
                                         **result, 'response_sha256': hashlib.sha256(json.dumps(raw, sort_keys=True).encode()).hexdigest()})
            self.save()
        return result, payload

    def prepare(self):
        rows = self.r._sql("SELECT n.nspname schema_name,c.relname table_name,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) definition,pg_get_functiondef(t.tgfoid) function_source FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND (n.nspname='auth' AND c.relname='users' OR n.nspname='public' AND c.relname IN('email_customers','email_customer_addresses','sandy_memory_settings','sandy_memory_portal_accounts')) ORDER BY n.nspname,c.relname,t.tgname", True)
        fields = ['schema_name','table_name','tgname','tgenabled','definition','function_source']
        digest = hashlib.sha256(json.dumps(sorted(tuple(x[k] for k in fields) for x in rows), separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
        self.check('reviewed_fixture_triggers_unchanged', digest == REVIEWED_TRIGGERS)
        for _ in range(2):
            email = 'sandy-service-acceptance-' + str(uuid.uuid4()) + '@example.invalid'
            password = secrets.token_urlsafe(42)
            user = self.r._auth_admin('POST', 'users', {'email': email, 'password': password, 'email_confirm': True,
                                                       'user_metadata': {'sandy_api_isolated_session_test': True}})
            fixture = {'user': user['id'], 'email': email, 'task': str(uuid.uuid4()), 'event': str(uuid.uuid4())}
            self.fixtures.append(fixture)
            self.report.setdefault('fixture_user_ids', []).append(user['id']); self.save()
            status, session = self.r._http('POST', BASE + '/auth/v1/token?grant_type=password', self.keys['anon'],
                                            {'email': email, 'password': password}, self.keys['anon'])
            password = None
            self.check('normal_customer_login_' + str(len(self.fixtures)), status == 200 and session.get('user', {}).get('role') == 'authenticated')
            fixture['token'] = session['access_token']
            result, payload = self.call(fixture, 'customer.onboarding.ensure', {'display_name': 'Isolated Sandy API service acceptance'}, setup=True)
            self.check('fixture_onboarding_' + str(len(self.fixtures)), result['api_status'] == 200 and payload.get('created') is True)
            fixture['customer'] = payload['customer_id']
            self.report.setdefault('fixture_customer_ids', []).append(payload['customer_id']); self.save()
            q = self.r._quote
            # Existing triggers stay enabled. A fixture source avoids the task
            # analysis dispatcher; local calendar events have no sync outbox.
            self.r._sql('BEGIN;INSERT INTO public.sandy_agenda_access(email,customer_id,enabled) VALUES(' + q(email) + ',' + q(fixture['customer']) + ',true);'
                        + 'UPDATE public.sandy_memory_settings SET enabled=false,learning_enabled=false,proactive_enabled=false WHERE customer_id=' + q(fixture['customer']) + ';'
                        + 'INSERT INTO public.sandy_tasks(id,customer_id,title,source_kind) VALUES(' + q(fixture['task']) + ',' + q(fixture['customer']) + ",'Isolated Sandy API service task','sandy_api_fixture');"
                        + 'INSERT INTO public.sandy_calendar_events(id,customer_id,title,starts_at,ends_at,sync_state) VALUES(' + q(fixture['event']) + ',' + q(fixture['customer']) + ",'Isolated Sandy API service event','2026-10-22T10:00:00Z','2026-10-22T10:30:00Z','local');COMMIT;")
            self.r._sql('BEGIN;INSERT INTO public.sandy_task_pins(customer_id,task_id,position) VALUES(' + q(fixture['customer']) + ',' + q(fixture['task']) + ',0);'
                        + 'INSERT INTO public.sandy_timezone_profiles(customer_id,home_timezone) VALUES(' + q(fixture['customer']) + ',' + q('Europe/Rome' if len(self.fixtures) == 1 else 'Australia/Sydney') + ');COMMIT;')
        users = ','.join(self.r._quote(f['user']) for f in self.fixtures)
        self.check('no_Controller_memberships', self.r._sql('SELECT count(*) n FROM public.sandy_controller_admins WHERE auth_user_id IN (' + users + ')', True) == [{'n': 0}])

    def independent_fixture_state(self):
        ids = ','.join(self.r._quote(f['customer']) for f in self.fixtures)
        rows = self.r._sql('SELECT (SELECT count(*) FROM public.sandy_tasks WHERE customer_id IN (' + ids + ')) tasks,'
                          + '(SELECT count(*) FROM public.sandy_calendar_events WHERE customer_id IN (' + ids + ")) calendar_events,"
                          + '(SELECT count(*) FROM public.sandy_task_analysis_queue WHERE customer_id IN (' + ids + ')) analysis_queue,'
                          + '(SELECT count(*) FROM public.sandy_calendar_outbox WHERE customer_id IN (' + ids + ')) calendar_outbox,'
                          + '(SELECT count(*) FROM public.sandy_mission_runs WHERE customer_id IN (' + ids + ')) mission_runs', True)[0]
        self.report['independent_fixture_state'] = rows
        self.check('only_seeded_records_and_no_external_work_queued', rows == {'tasks': 2, 'calendar_events': 2, 'analysis_queue': 0, 'calendar_outbox': 0, 'mission_runs': 0})

    def exercise(self):
        for fixture in self.fixtures:
            own, foreign = fixture['task'], self.fixtures[1 - self.fixtures.index(fixture)]
            names, cursor, seen = set(), None, set()
            for _ in range(100):
                status, body = self.rpc(fixture, 'tools/list', {'cursor': cursor} if cursor else {})
                result = body.get('result', {})
                self.check('discovery_page_' + str(len(self.report['checks'])), status == 200 and isinstance(result.get('tools'), list))
                page = [t['name'] for t in result['tools']]
                self.check('discovery_no_duplicates_' + str(len(self.report['checks'])), not names.intersection(page) and len(page) == len(set(page)))
                names.update(page)
                cursor = result.get('nextCursor')
                if not cursor:
                    break
                self.check('discovery_cursor_advances_' + str(len(self.report['checks'])), cursor not in seen)
                seen.add(cursor)
            self.check('discovery_completed_' + str(len(names)), not cursor)
            operations = {'tasks.list': {}, 'tasks.get': {'id': own}, 'calendar.list': {'from': '2026-10-21T00:00:00Z', 'to': '2026-10-24T00:00:00Z'},
                          'calendar.get': {'id': fixture['event']}, 'files.list': {}, 'files.search': {'query': 'isolated'},
                          'social.people.list': {}, 'agenda.overview': {}, 'agenda.pins.list': {}, 'calendar.client.overview': {},
                          'calendar.client.timezone.get': {}, 'files.library.list': {}, 'task_files.counts': {},
                          'workspace.overview': {}, 'workspace.history': {}, 'workspace.missions.list': {}, 'workspace.command_centre': {}}
            if self.only:
                operations = {op: args for op, args in operations.items() if op in self.only}
            for operation, args in operations.items():
                result, payload = self.call(fixture, operation, args)
                good = passing_read(result, payload)
                observed = payload.get('result', payload)
                nonempty = True
                expected = fixture['task'] if operation in ('tasks.list', 'tasks.get', 'agenda.overview', 'agenda.pins.list') else fixture['event'] if operation in ('calendar.list', 'calendar.get', 'calendar.client.overview') else None
                if expected:
                    nonempty = fixture_contains(observed, expected, [foreign['customer'], foreign['task'], foreign['event']])
                if operation == 'calendar.client.timezone.get':
                    nonempty = observed.get('profile', {}).get('home_timezone') == ('Europe/Rome' if fixture is self.fixtures[0] else 'Australia/Sydney')
                isolated = not any(value in json.dumps(payload) for value in [foreign['customer'], foreign['task'], foreign['event']])
                self.report['calls'][-1].update({'discovered': operation in names, 'fixture_state_observed': nonempty if expected or operation == 'calendar.client.timezone.get' else None,
                                               'foreign_fixture_absent': isolated, 'passed': good and nonempty and isolated and operation in names})
                self.save()
            for operation, args, expected in [('tasks.get', {'id': foreign['task']}, 404), ('calendar.get', {'id': foreign['event']}, 404),
                                                ('tasks.list', {'customer_id': foreign['customer']}, 400)]:
                result, _ = self.call(fixture, operation, args)
                self.report['calls'][-1].update({'negative': True, 'passed': result['is_error'] is True and result['api_status'] == expected
                    and (bool(result['admission_id']) if self.require_read_receipts and expected == 404 else not result['admission_id'])})
                self.save()
            if self.require_read_receipts:
                request_id = str(uuid.uuid4())
                result, payload = self.call(fixture, 'tasks.list', {}, request_id=request_id)
                self.report['calls'][-1]['passed'] = passing_read(result, payload) and bool(result['admission_id']) and result['request_id'] == request_id
                for operation in ['tasks.list', 'calendar.list']:
                    result, _ = self.call(fixture, operation, {}, request_id=request_id)
                    self.report['calls'][-1].update({'negative': True, 'request_replay': True,
                        'passed': result['is_error'] is True and result['api_status'] == 409 and result['executed'] is False})
                self.save()

    def verify_read_receipts(self):
        operations = {'tasks.list', 'tasks.get', 'calendar.list', 'calendar.get', 'agenda.overview',
                      'calendar.client.overview', 'agenda.pins.list', 'calendar.client.timezone.get'}
        expected = [c for c in self.report['calls'] if c['operation'] in operations and not c.get('request_replay')
                    and c['api_status'] in (200, 404)]
        self.check('all_selected_reads_have_durable_admission', bool(expected) and all(c.get('admission_id') for c in expected))
        ids = sorted({c['admission_id'] for c in expected})
        rows = self.r._sql("SELECT a.id,a.actor_id,a.tenant_id,a.operation,a.state,a.provider_http_status,a.result_sha256,"
            "(SELECT count(*) FROM public.sandy_api_audit_events e WHERE e.admission_id=a.id) audit_events "
            "FROM public.sandy_api_execution_admissions a WHERE a.id IN (" + ','.join(self.r._quote(x) for x in ids) + ")", True)
        by_id = {row['id']: row for row in rows}
        self.report['independent_read_receipts'] = rows
        self.check('real_shared_ledger_and_audit_settlement', len(rows) == len(ids) and all(
            (r := by_id.get(c['admission_id'], {})).get('state') == ('failed' if c.get('negative') else 'succeeded')
            and r.get('actor_id') == self.fixtures[c['fixture_index']]['user']
            and r.get('tenant_id') == self.fixtures[c['fixture_index']]['customer']
            and r.get('operation') == c['operation'] and r.get('audit_events') == 3 and bool(r.get('result_sha256'))
            for c in expected))

    def cleanup(self):
        q = self.r._quote
        for fixture in self.fixtures:
            if fixture.get('token'):
                status, _ = self.r._http('POST', BASE + '/auth/v1/logout?scope=local', fixture['token'], {}, self.keys['anon'])
                self.report['cleanup'].setdefault('logout_statuses', []).append(status)
            # Recover ownership from the database even if enrollment's response
            # was lost. Never delete a pre-existing customer or non-fixture user.
            rows = self.r._sql('SELECT customer_id FROM public.sandy_memory_portal_accounts WHERE auth_user_id=' + q(fixture['user']), True)
            for row in rows:
                owned = self.r._sql('SELECT display_name,google_drive_folder_status FROM public.email_customers WHERE id=' + q(row['customer_id']), True)
                if owned != [{'display_name': 'Isolated Sandy API service acceptance', 'google_drive_folder_status': 'excluded'}]:
                    raise RuntimeError('fixture_cleanup_ownership_not_proved')
                customer = q(row['customer_id'])
                self.r._sql('BEGIN;DELETE FROM public.sandy_task_pins WHERE customer_id=' + customer + ';DELETE FROM public.sandy_timezone_profiles WHERE customer_id=' + customer + ';DELETE FROM public.sandy_tasks WHERE customer_id=' + customer + ';DELETE FROM public.sandy_calendar_events WHERE customer_id=' + customer
                            + ';DELETE FROM public.sandy_temporal_fact_links WHERE customer_id=' + customer
                            + ';DELETE FROM public.sandy_temporal_facts WHERE customer_id=' + customer
                            + ';DELETE FROM public.sandy_agenda_access WHERE customer_id=' + customer
                            + ';DELETE FROM public.sandy_customer_onboarding_receipts WHERE actor_id=' + q(fixture['user'])
                            + ';DELETE FROM public.sandy_memory_portal_accounts WHERE auth_user_id=' + q(fixture['user'])
                            + ';DELETE FROM public.sandy_memory_settings WHERE customer_id=' + customer
                            + ';DELETE FROM public.email_customer_addresses WHERE customer_id=' + customer
                            + ';DELETE FROM public.email_customers WHERE id=' + customer + ";COMMIT;")
            self.r._auth_admin('DELETE', 'users/' + fixture['user'])
        if self.fixtures:
            users = ','.join(q(f['user']) for f in self.fixtures)
            rows = self.r._sql('SELECT (SELECT count(*) FROM auth.users WHERE id IN (' + users + ')) users,(SELECT count(*) FROM auth.sessions WHERE user_id IN (' + users + ')) sessions,(SELECT count(*) FROM public.sandy_memory_portal_accounts WHERE auth_user_id IN (' + users + ')) portal_accounts', True)
            self.report['cleanup']['remaining'] = rows[0]
            self.report['cleanup']['complete'] = all(v == 0 for v in rows[0].values())
            if all(f.get('customer') for f in self.fixtures):
                customers = ','.join(q(f['customer']) for f in self.fixtures)
                temporal = self.r._sql('SELECT (SELECT count(*) FROM public.sandy_temporal_facts WHERE customer_id IN (' + customers
                    + ')) facts,(SELECT count(*) FROM public.sandy_temporal_fact_links WHERE customer_id IN (' + customers + ')) links', True)[0]
                self.report['cleanup']['independent_temporal_fixture_counts'] = temporal
                self.report['cleanup']['complete'] = self.report['cleanup']['complete'] and all(v == 0 for v in temporal.values())
        self.save()

    def run(self):
        try:
            self.prepare()
            self.independent_fixture_state()
            self.exercise()
            if self.require_read_receipts:
                self.verify_read_receipts()
        except Exception as error:
            self.report['runner_error'] = type(error).__name__
            if isinstance(error, RuntimeError) and str(error).replace('_', '').isalnum():
                self.report['runner_error_code'] = str(error)
        finally:
            self.cleanup()
        self.report['complete'] = not self.report.get('runner_error') and all(c.get('passed') for c in self.report['calls']) and self.report['cleanup'].get('complete') is True
        self.save()
        print(json.dumps({'complete': self.report['complete'], 'calls': len(self.report['calls']),
                          'failed_calls': [c['operation'] for c in self.report['calls'] if not c.get('passed')], 'cleanup': self.report['cleanup']}))
        return self.report['complete']


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--only', nargs='+', help='Rerun only changed or failed operation contracts')
    parser.add_argument('--require-read-receipts', action='store_true', help='Require shared ledger settlement and exercise request replay refusal')
    args = parser.parse_args()
    raise SystemExit(0 if Acceptance(args.output, args.only, args.require_read_receipts).run() else 1)
