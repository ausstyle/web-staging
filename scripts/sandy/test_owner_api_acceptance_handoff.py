import datetime as dt
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location('owner_handoff', Path(__file__).with_name('configure_owner_acceptance.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class OwnerHandoffTests(unittest.TestCase):
    def test_hidden_credential_goes_only_to_gh_stdin_not_arguments(self):
        calls = []
        value = m.credential('owner@example.invalid', 'fixture-password', 24)
        def run(args, **kwargs):
            calls.append((args, kwargs))
            return SimpleNamespace(returncode=0)
        m.handoff(value, run)
        self.assertNotIn('fixture-password', str(calls[0][0]))
        self.assertIn('fixture-password', calls[0][1]['input'])
        self.assertEqual(calls[0][0], ['gh', 'secret', 'set', m.SECRET, '--repo', m.REPO, '--env', m.ENVIRONMENT])
        self.assertNotIn('shell', calls[0][1])

    def test_no_write_if_github_denies_secret_administration(self):
        with self.assertRaisesRegex(m.HandoffError, 'secret_write_denied'):
            m.handoff({}, lambda *a, **k: SimpleNamespace(returncode=1, stderr='private-provider-message'))

    def test_bounded_credential_expiry(self):
        now = dt.datetime(2026, 10, 23, tzinfo=dt.timezone.utc)
        value = m.credential('owner@example.invalid', 'fixture-password', 24, now)
        self.assertEqual(dt.datetime.fromisoformat(value['expires_at']) - now, dt.timedelta(hours=24))
        for hours in [0, -1, 169]:
            with self.assertRaises(m.HandoffError):
                m.credential('owner@example.invalid', 'fixture-password', hours)

    def fixture(self, user=None, signin_status=200, refresh_status=400, refresh_code='session_not_found'):
        calls = []
        def send(path, token=m.ANON, body=None, post=False):
            calls.append((path, token, body, post))
            if path == '/token?grant_type=password':
                return signin_status, {'access_token': 'fixture-access', 'refresh_token': 'fixture-refresh'}
            if path == '/user':
                return 200, user or {'id': m.OWNER, 'email': 'owner@example.invalid', 'email_confirmed_at': 'confirmed'}
            if path == '/logout?scope=local':
                return 204, {}
            if path == '/token?grant_type=refresh_token':
                return refresh_status, {'code': refresh_code, **({'access_token': 'unexpected-refresh-access'} if refresh_status == 200 else {})}
            raise AssertionError('unexpected endpoint')
        return calls, send

    def test_normal_owner_verified_and_bootstrap_session_retired_before_handoff(self):
        calls, send = self.fixture()
        m.verify_existing_owner('owner@example.invalid', 'fixture-password', send)
        self.assertEqual([r[0] for r in calls], ['/token?grant_type=password', '/user', '/logout?scope=local', '/token?grant_type=refresh_token'])

    def test_wrong_identity_and_mfa_still_retire_bootstrap_session(self):
        for user in [{'id': 'another'}, {'id': m.OWNER, 'email': 'owner@example.invalid', 'email_confirmed_at': 'confirmed', 'factors': [{'status': 'verified'}]}]:
            calls, send = self.fixture(user)
            with self.assertRaises(m.HandoffError):
                m.verify_existing_owner('owner@example.invalid', 'fixture-password', send)
            self.assertEqual(calls[-1][0], '/token?grant_type=refresh_token')

    def test_sign_in_failure_never_uses_admin_api_or_writes_binding(self):
        calls, send = self.fixture(signin_status=400)
        with self.assertRaisesRegex(m.HandoffError, 'sign_in_rejected_http_400'):
            m.verify_existing_owner('owner@example.invalid', 'fixture-password', send)
        self.assertEqual(len(calls), 1)

    def test_retirement_requires_actual_revoked_refresh_result(self):
        for status, code in [(200, 'none'), (403, 'none'), (400, 'redacted')]:
            calls, send = self.fixture(refresh_status=status, refresh_code=code)
            with self.assertRaisesRegex(m.HandoffError, 'retirement_not_independently_verified'):
                m.verify_existing_owner('owner@example.invalid', 'fixture-password', send)
            if status == 200:
                self.assertEqual(calls[-1][1], 'unexpected-refresh-access')


if __name__ == '__main__':
    unittest.main()
