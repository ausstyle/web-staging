"""Production canary for the existing dedicated engineering identity.

Uses its established administrative issuer, then normal Supabase Auth sessions
for every MCP call. Only newly issued test sessions are expired and retired.
No provider mutation, authority change or VM execution is performed. Never
prints or persists an access token, refresh token, OTP or service credential.
"""
from pathlib import Path
import argparse, base64, datetime, hashlib, json, uuid
from engineering_runtime import EngineeringRuntime, BASE, EMAIL, MANAGEMENT

def main():
    parser = argparse.ArgumentParser(description='Verify isolated normal Auth session expiry and renewal through production Sandy MCP; no VM commands.')
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    r = EngineeringRuntime()
    q = r._quote
    path = args.output
    assert not path.exists(), 'existing_evidence_reconcile_before_repeating'
    state = r.state()
    anon = r._api_keys()['anon']
    service = r._api_keys()['service_role']
    sessions = []
    d = {'observed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'minimum_fix_migration': '20261022170000', 'fix_origin_source_commit': 'b183486fdd64209eeedfb007b7cc37b07cdc4ed9', 'normal_Supabase_Auth': True, 'personal_Controller_token_used': False, 'service_key_used_as_MCP_session': False, 'calls': [], 'complete': False, 'VM_commands_executed': 0}

    status, metadata = r._http('GET', MANAGEMENT + '/functions/sandy-guest-operation-api', r._management)
    assert status == 200 and metadata.get('status') == 'ACTIVE' and metadata.get('verify_jwt') is True
    d['observed_guest_release'] = {key: metadata[key] for key in ('version', 'status', 'verify_jwt')}
    d['observed_SQL_sources'] = r._sql(
        "SELECT proname,encode(extensions.digest(prosrc,'sha256'),'hex') source_sha256 FROM pg_proc "
        "WHERE pronamespace='public'::regnamespace AND proname IN "
        "('sandy_guest_admission_current','sandy_engineering_resolve_identity') ORDER BY proname", True)
    assert len(d['observed_SQL_sources']) == 2

    def save():
        path.write_text(json.dumps(d, indent=2) + '\n')
        path.chmod(0o600)

    def rpc(name, body):
        status, data = r._http('POST', BASE + '/rest/v1/rpc/' + name, service, body, service)
        assert status == 200 and data.get('ok') is True, 'private_session_rpc_refused'
        return data

    def issue():
        link = r._auth_admin('POST', 'generate_link', {'type': 'magiclink', 'email': EMAIL})
        props = link.get('properties', link)
        hashed = props.get('hashed_token')
        assert hashed, 'normal_Auth_link_required'
        status, data = r._http('POST', BASE + '/auth/v1/verify', anon, {'type': 'magiclink', 'token_hash': hashed}, anon)
        link = None
        hashed = None
        props = None
        assert status == 200 and isinstance(data.get('access_token'), str), 'normal_Auth_verification_required'
        token = data['access_token']
        claim = json.loads(base64.urlsafe_b64decode(token.split('.')[1] + '==='))
        sid = claim['session_id']
        expiry = datetime.datetime.fromtimestamp(claim['exp'], datetime.timezone.utc).isoformat()
        data = None
        status, user = r._http('GET', BASE + '/auth/v1/user', token, apikey=anon)
        assert status == 200 and user['id'] == state['user_id'] and (user['email'] == EMAIL) and (user['role'] == 'authenticated') and (user.get('app_metadata', {}).get('sandy_engineering_epoch') == state['credential_epoch'])
        sessions.append((sid, token))
        rpc('sandy_engineering_register_session', {'p_user_id': state['user_id'], 'p_session_id': sid, 'p_epoch': state['credential_epoch'], 'p_expires_at': expiry})
        return (sid, token)

    def call(token, name, args, denied=False):
        rid = str(uuid.uuid4())
        mid = str(uuid.uuid4())
        c = {'operation': name, 'request_id': rid, 'MCP_id': mid, 'complete': False}
        d['calls'].append(c)
        save()
        status, result = r._http('POST', BASE + '/functions/v1/sandy-api-mcp', token, {'jsonrpc': '2.0', 'id': mid, 'method': 'tools/call', 'params': {'name': name, 'arguments': {'__sandy_execution': {'request_id': rid}, 'arguments': args}}}, anon)
        m = result.get('result', {}) if isinstance(result, dict) else {}
        content = m.get('content', [{}])
        e = json.loads(content[0].get('text', '{}')) if content else {}
        api = e.get('result', {})
        payload = m.get('structuredContent', {})
        data = payload.get('result', {})
        c.update(HTTP_status=status, MCP_isError=m.get('isError'), API_status=e.get('status'), error=api.get('error') or (result or {}).get('error'), executed=api.get('executed'), admission_id=api.get('admission_id'), complete=True)
        save()
        if denied:
            assert status in (200, 401, 403) and (status in (401, 403) or c['API_status'] in (401, 403)) and (c['executed'] is not True) and (not c['admission_id']), 'expired_session_not_denied'
            assert r._sql('SELECT count(*) count FROM public.sandy_api_execution_admissions WHERE request_id=' + q(rid), True)[0]['count'] == 0
            c['execution_admissions'] = 0
            save()
            return c
        assert status == 200 and c['API_status'] == 200 and (m.get('isError') is False) and (c['executed'] is True) and c['admission_id'], 'MCP_execution_failed'
        aid = c['admission_id']
        a = r._sql('SELECT a.id,a.state,a.actor_id,a.operation,a.result_sha256,a.provider_http_status,e.identity_user_id,e.session_id,e.owner_authority_id,j.status job_status,j.approved_by,j.approved_at FROM public.sandy_api_execution_admissions a JOIN public.sandy_engineering_execution_authorizations e ON e.job_id=a.approval_id JOIN public.sandy_deployment_jobs j ON j.id=e.job_id WHERE a.id=' + q(aid), True)[0]
        assert a['state'] == 'succeeded' and a['identity_user_id'] == state['user_id'] and (a['session_id'] in [s[0] for s in sessions]) and (a['approved_by'] is None) and (a['approved_at'] is None)
        audits = r._sql("SELECT phase,outcome,event_sha256=encode(extensions.digest(previous_sha256||public.sandy_api_audit_payload(a)::text,'sha256'),'hex') hash_valid FROM public.sandy_api_audit_events a WHERE admission_id=" + q(aid) + ' ORDER BY sequence')
        assert audits and all((x['hash_valid'] for x in audits))
        digest = hashlib.sha256(json.dumps(data, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        assert digest == a['result_sha256'], 'MCP_result_receipt_mismatch'
        c.update(admission=a, audit=audits, returned_result_digest=digest)
        if name == 'gcp.vm.agent.status':
            expected = r._sql('SELECT vm_name,enabled,generation,last_seen_at FROM public.sandy_guest_enrollments WHERE vm_name=' + q(args['vm_name']), True)[0]
            assert all((data.get(k) == v for k, v in expected.items()))
            c['independent_enrollment_readback'] = expected
            c['observation'] = 'Sandy enrollment read; no VM execution'
        if name == 'github.repos.get':
            assert payload.get('provider_http_status') == 200 or a['provider_http_status'] == 200
            c['provider_http_status'] = a['provider_http_status']
            c['observation'] = 'Actual GitHub repository metadata read through MCP/API/provider'
        save()
        return c
    try:
        sid, token = issue()
        d['isolated_session_id'] = sid
        save()
        call(token, 'github.repos.get', {})
        call(token, 'gcp.vm.agent.status', {'vm_name': 'sandy-video'})
        rows = r._sql("UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 second' WHERE id=" + q(sid) + ' AND user_id=' + q(state['user_id']) + ' RETURNING id')
        assert len(rows) == 1
        d['only_isolated_session_Auth_not_after_expired'] = True
        save()
        call(token, 'gcp.vm.agent.status', {'vm_name': 'sandy-video'}, True)
        sid2, token2 = issue()
        assert sid2 != sid
        d['fresh_session_id'] = sid2
        save()
        call(token2, 'gcp.vm.agent.status', {'vm_name': 'sandy-video'})
        d['global_Controller_memberships'] = r._sql('SELECT count(*) count FROM public.sandy_controller_admins WHERE auth_user_id=' + q(state['user_id']), True)[0]['count']
        assert d['global_Controller_memberships'] == 0
        d['complete'] = True
        save()
    finally:
        cleanup = []
        for sid, token in sessions:
            retired = {}
            try:
                retired = rpc('sandy_engineering_retire_session', {'p_user_id': state['user_id'], 'p_session_id': sid})
            except Exception:
                pass
            status = None
            try:
                status, _ = r._http('POST', BASE + '/auth/v1/logout?scope=local', token, {}, service)
            except Exception:
                pass
            cleanup.append({'session_id': sid, 'Sandy_session_retired': retired.get('ok') is True, 'Auth_logout_HTTP_status': status})
        d['cleanup'] = cleanup
        d['complete'] = d['complete'] and all((x['Sandy_session_retired'] and x['Auth_logout_HTTP_status'] == 204 for x in cleanup))
        save()
    print(json.dumps({'complete': d['complete'], 'calls': [{k: c.get(k) for k in ['operation', 'HTTP_status', 'API_status', 'executed', 'error', 'admission_id', 'provider_http_status']} for c in d['calls']], 'cleanup': d['cleanup'], 'VM_commands_executed': 0}))
    if not d['complete']:
        raise SystemExit(1)
if __name__ == '__main__':
    main()
