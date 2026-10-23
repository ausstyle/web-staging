"""Map every non-heading scope block/table row to evidence; never marks live acceptance."""
import hashlib
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
SOURCE = 'docs/sandy-cloud-hosting-architecture-engineering-scope-v1.md'
TARGET = 'docs/sandy-engineering/evaluations/hosting-architecture-coverage.json'


def build():
    raw = (ROOT / SOURCE).read_bytes()
    lines = raw.decode().splitlines()
    rows, pending = [], []
    section, title = '0', 'Scope metadata'
    categories = {'1': ['G'], '2': ['A', 'B', 'F'], '3': ['A', 'C'], '4': ['B', 'F'],
                  '5': ['C'], '6': ['D', 'E'], '7': ['A', 'B', 'G'], '8': ['A', 'F'],
                  '9': ['C', 'F'], '10': ['F', 'G'], '11': ['G'], '12': ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
                  '13': ['A', 'B', 'C', 'D', 'E', 'F', 'G'], '14': ['F'], '15': ['G'], '16': ['F']}

    def flush():
        if not pending:
            return
        text = '\n'.join(value for _, value in pending)
        implementation = []
        if section in ('2', '3', '7', '8'):
            implementation = ['supabase/functions/sandy-customer-provisioning-api/hosting_accounts.json',
                              'supabase/migrations/20261024010000_sandy_hosting_logical_accounts.sql']
        if section == '4':
            implementation = ['PR #233: sandy/Dockerfile, cloudbuild.yaml, cloud-run-nginx.conf']
        if section == '6':
            implementation = ['supabase/functions/_shared/sandy-hosting/dns_plan.mjs']
        rows.append({'id': 'HOST-S' + section + '-' + str(sum(r['section'] == section for r in rows) + 1).zfill(2),
                     'section': section, 'section_title': title, 'source_lines': [pending[0][0], pending[-1][0]],
                     'text': text, 'text_sha256': hashlib.sha256(text.encode()).hexdigest(),
                     'implementation_sources': implementation,
                     'implementation_status': 'partial_source_only' if implementation else 'not_yet_mapped_to_accepted_implementation',
                     'live_acceptance_categories': categories.get(section, []),
                     'live_acceptance_status': 'not_verified', 'provider_receipts': [],
                     'remaining': ('Logical create/get only; no paid provisioning, role expansion or lifecycle.' if section in ('2', '3', '7', '8') else
                                   'Local marketing preview only; cloud deploy, scan, SBOM, service identity and live canary pending.' if section == '4' else
                                   'Offline standard RRset diff/rollback subset only; actual authority, provider writes, zones, DNSSEC, TLS and delegation pending.' if section == '6' else
                                   'Implement and independently verify this scope block; do not infer completion from source or registry metadata.')})
        pending.clear()

    for i, line in enumerate(lines, 1):
        if line.startswith('#'):
            flush()
            if line.startswith('## ') and line[3:].split('.', 1)[0].isdigit():
                section = line[3:].split('.', 1)[0]
                title = line[3:]
            continue
        if not line.strip():
            flush()
            continue
        if line.startswith('|'):
            flush()
            if not all(c in '| -:' for c in line):
                pending.append((i, line)); flush()
        elif line.startswith(('- ', '**A.', '**B.', '**C.', '**D.', '**E.', '**F.', '**G.')) or line[:1].isdigit():
            flush(); pending.append((i, line)); flush()
        else:
            pending.append((i, line))
    flush()
    return {'scope_source': SOURCE, 'scope_source_sha256': hashlib.sha256(raw).hexdigest(),
            'scope_pr': 234, 'scope_head': 'c318e66508243fb756ee159f1eb6ad3db865e4cd',
            'coverage_kind': 'all_non_heading_blocks_including_context_not_a_completion_count',
            'all_live_acceptance_passed': False, 'rows': rows}


if __name__ == '__main__':
    data = build()
    (ROOT / TARGET).write_text(json.dumps(data, indent=2) + '\n')
    print(f"Mapped {len(data['rows'])} scope blocks; zero claims of live acceptance")
