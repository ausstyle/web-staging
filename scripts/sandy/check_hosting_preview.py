"""Read-only smoke check of an explicitly selected marketing preview; no redirects."""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, build_opener

ROOT = Path(__file__).resolve().parents[2]
PORTAL = 'https://ausstyle.github.io/web-staging/sandy'


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def check(base):
    parsed = urlsplit(base)
    if (parsed.scheme not in ('http', 'https') or not parsed.hostname
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in ('', '/')
            or (parsed.scheme == 'http' and parsed.hostname not in ('127.0.0.1', 'localhost', '::1'))):
        raise ValueError('Use an HTTPS origin or local HTTP preview origin')
    opener = build_opener(NoRedirect())
    checks = []

    def read(path):
        try:
            response = opener.open(base.rstrip('/') + path, timeout=15)
        except HTTPError as error:
            response = error
        with response:
            return response.code, response.headers, response.read(2_000_000)

    def record(name, passed):
        checks.append({'check': name, 'passed': bool(passed)})

    status, headers, body = read('/')
    record('page_matches_source', status == 200 and hashlib.sha256(body).digest() == hashlib.sha256((ROOT / 'sandy/index.html').read_bytes()).digest())
    record('security_headers', headers.get('X-Content-Type-Options') == 'nosniff'
           and headers.get('X-Frame-Options') == 'DENY'
           and headers.get('Referrer-Policy') == 'strict-origin-when-cross-origin')
    status, _, body = read('/healthz')
    record('health', status == 200 and body == b'ok')
    for path, destination in [
        ('/app', PORTAL + '/app/'),
        ('/app?pilot=1', PORTAL + '/app/?pilot=1'),
        ('/app/', PORTAL + '/app/'),
        ('/app/engineering-delegation.html?pilot=1', PORTAL + '/app/engineering-delegation.html?pilot=1'),
        ('/app/?next=https://example.invalid/', PORTAL + '/app/?next=https://example.invalid/'),
    ]:
        status, headers, _ = read(path)
        record('portal_redirect:' + path, status == 302 and headers.get('Location') == destination)
    for path in ['/controller/', '/.git/config', '/Dockerfile', '/cloudbuild.yaml', '/missing']:
        status, _, _ = read(path)
        record('not_packaged:' + path, status == 404)
    return {'kind': 'marketing_preview_http_smoke', 'origin': base, 'hosting_acceptance': False,
            'passed': all(x['passed'] for x in checks), 'checks': checks}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('origin')
    args = parser.parse_args()
    result = check(args.origin)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result['passed'] else 1)
