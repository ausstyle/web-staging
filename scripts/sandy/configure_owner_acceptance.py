#!/usr/bin/env python3
"""Owner-operated, hidden-input handoff. Never run in the engineering workload.
Requires the Owner's EXISTING password and own GitHub CLI authentication. Does
not create users, reset passwords, assign roles, persist JWTs or change IAM.
"""
import argparse
import datetime as dt
import getpass
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

BASE = 'https://zmqlyygzqoidkcwdysok.supabase.co'
ANON = 'sb_publishable_OVP7LUMDhtcymPRzZuCK3Q_8JkLC3ts'
OWNER = 'ffba8e24-f452-44c8-ba9d-228b8657e3cc'
REPO = 'ausstyle/web-staging'
ENVIRONMENT = 'sandy-production'
SECRET = 'SANDY_OWNER_ACCEPTANCE_CREDENTIAL'


class HandoffError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def request(path, token=ANON, body=None, post=False):
    allowed = {'/token?grant_type=password', '/user', '/logout?scope=local', '/token?grant_type=refresh_token'}
    if path not in allowed:
        raise HandoffError('authentication_endpoint_not_allowed')
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + '/auth/v1' + path, data=data,
        method='POST' if body is not None or post else 'GET', headers={
        'apikey': ANON, 'authorization': 'Bearer ' + token, 'content-type': 'application/json'})
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=30) as response:
            raw = response.read(1024 * 1024 + 1)
            if len(raw) > 1024 * 1024:
                raise HandoffError('authentication_response_too_large')
            return response.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        # Do not print response bodies, request bodies, credentials or exceptions.
        try:
            value = json.loads(error.read(4096))
            code = value.get('error_code', value.get('code'))
        except (ValueError, OSError):
            code = None
        return error.code, {'code': code if code in {'refresh_token_not_found', 'session_not_found', 'refresh_token_already_used'} else 'redacted'}
    except (OSError, ValueError):
        raise HandoffError('authentication_transport_failed_no_automatic_retry') from None


def retire(session, send=request):
    status, _ = send('/logout?scope=local', session['access_token'], post=True)
    if status != 204:
        raise HandoffError('bootstrap_session_retirement_failed')
    # Use the real refresh credential only against its Auth endpoint to prove
    # retirement. A success is a failure, and its new session is also retired.
    status, value = send('/token?grant_type=refresh_token', body={'refresh_token': session['refresh_token']})
    if status == 200 and isinstance(value.get('access_token'), str):
        send('/logout?scope=local', value['access_token'], post=True)
    if status != 400 or value.get('code') not in {'refresh_token_not_found', 'session_not_found', 'refresh_token_already_used'}:
        raise HandoffError('bootstrap_session_retirement_not_independently_verified')


def verify_existing_owner(email, password, send=request):
    status, session = send('/token?grant_type=password', body={'email': email, 'password': password})
    if status != 200:
        raise HandoffError('normal_owner_sign_in_rejected_http_' + str(status))
    if not all(isinstance(session.get(k), str) and session[k] for k in ('access_token', 'refresh_token')):
        raise HandoffError('normal_owner_sign_in_response_invalid')
    try:
        status, user = send('/user', session['access_token'])
        if status != 200 or user.get('id') != OWNER or user.get('email', '').lower() != email.lower() or not user.get('email_confirmed_at') or user.get('app_metadata', {}).get('sandy_engineering_test') is True:
            raise HandoffError('existing_owner_identity_required')
        if any(f.get('status') == 'verified' for f in user.get('factors', [])):
            raise HandoffError('MFA_requires_supported_interactive_flow_no_downgrade')
    finally:
        retire(session, send)


def credential(email, password, hours, now=None):
    if not 1 <= hours <= 168:
        raise HandoffError('credential_use_window_must_be_1_to_168_hours')
    now = now or dt.datetime.now(dt.timezone.utc)
    return {'version': 1, 'project': 'zmqlyygzqoidkcwdysok', 'purpose': 'sandy-gcp-admin-read-acceptance',
            'email': email, 'password': password, 'issued_at': now.isoformat(),
            'expires_at': (now + dt.timedelta(hours=hours)).isoformat()}


def handoff(value, run=subprocess.run):
    # argv contains only the secret NAME. Its value goes over stdin to gh, which
    # seals it for GitHub's environment secret API. No temporary credential file.
    result = run(['gh', 'secret', 'set', SECRET, '--repo', REPO, '--env', ENVIRONMENT],
                 input=json.dumps(value), text=True, capture_output=True, check=False)
    if result.returncode:
        raise HandoffError('github_environment_secret_write_denied_or_unavailable_use_Owner_gh_auth')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--hours', type=int, default=24, help='credential use window, 1–168 hours (default 24)')
    parser.add_argument('--revoke', action='store_true', help='delete the acceptance binding; no account or IAM changes')
    args = parser.parse_args()
    try:
        if os.environ.get('GITHUB_ACTIONS') or os.environ.get('SANDY_SUPABASE_MANAGEMENT_TOKEN'):
            raise HandoffError('run_only_on_Owner_computer_not_engineering_runtime')
        if args.revoke:
            result = subprocess.run(['gh', 'secret', 'delete', SECRET, '--repo', REPO, '--env', ENVIRONMENT], capture_output=True)
            if result.returncode:
                raise HandoffError('github_environment_secret_revocation_failed')
            print('Acceptance binding removed. New runs cannot sign in. Active sessions must still retire or expire.')
            return 0
        if not sys.stdin.isatty():
            raise HandoffError('interactive_Owner_terminal_required_no_piped_passwords')
        credential('owner@example.invalid', 'validation-only', args.hours)
        print('Target: ausstyle/web-staging → sandy-production → ' + SECRET)
        print('Uses your EXISTING Sandy Owner password. Stores it as a protected environment secret, not a JWT.')
        print('Does not set/reset a password, change roles, deploy, or start a workflow.')
        email = input('Existing Sandy Owner email: ').strip().lower()
        password = getpass.getpass('Existing Sandy Owner password (hidden): ')
        if not password or '\n' in password or '\r' in password:
            raise HandoffError('existing_owner_password_required')
        verify_existing_owner(email, password)
        handoff(credential(email, password, args.hours))
        print('Owner sign-in verified; bootstrap refresh session retired; protected credential binding saved.')
        print('Tell the engineering task the binding is available. Do not copy any credential into chat.')
        return 0
    except (HandoffError, FileNotFoundError) as error:
        print('Not configured: ' + (str(error) if isinstance(error, HandoffError) else 'GitHub_CLI_required'))
        return 1
    except (EOFError, KeyboardInterrupt):
        print('\nCancelled. No success claimed.')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
