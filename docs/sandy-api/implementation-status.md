# Sandy API engineering status

Status date: 20 October 2026. Production completion is blocked; no production
deployment, migration, GCP/customer-provider mutation or registry verification update has been
performed by this engineering task.

## Requirements and source review

The checklist is [api-scope-161.md](api-scope-161.md), read alongside this
directory's README and the original PDF. All 161 operation names match the
original Excel workbook in the same order. Wildcards and slash-delimited entries
are families; implementing one member does not complete a family.

[requirement-source-review.json](requirement-source-review.json) records all 161
source assessments, evidence paths, missing coverage and access prerequisites.
It is a source review, not a reconciliation against the live registry. Local
source absence does not establish production absence.

| Source assessment | Requirement rows |
| --- | ---: |
| Partial source coverage | 48 |
| No local handler identified | 97 |
| Configured workflow only | 9 |
| Partial delegation to a worker | 2 |
| Queue admission only | 3 |
| Preflight forwarding only | 2 |
| Total source-reviewed | 161 |

The source inventory contains 22 Edge Function entrypoints, 117 literal action
candidates, two explicit dispatch mappings in the new gateway, nine migrations,
and references to two workers whose source is absent: `sandy-deploy-provision`
and `sandy-gcp-read-worker`. Action candidates are not registry operations.

## Engineering changes

- API discovery filters to enabled, registered handlers and hides owner-only
  release operations from other administrators. Registry schemas are preserved.
- MCP discovery uses the API's executable catalogue instead of a second
  hardcoded operation list. Initialization authenticates through Sandy API;
  JSON-RPC validation, identity forwarding and failure propagation are tested.
- Successful MCP calls return structured operation output while retaining the
  API evidence envelope. Generic registry JSON Schema conformance is not yet
  validated; this remains required work.
- Release metadata no longer proves functional verification. Responses retain
  separate deployment, metadata, functional and rollback states. Ambiguous
  provider writes and receipt-persistence failures require reconciliation.
  Existing-function overwrites remain blocked without a recovery executor.
- Added repeatable source inventory, canonical Markdown/Excel import and
  read-only live-inspection tools, plus CI for their tests.

These changes do not implement the full provider catalogue, durable orchestration,
general rollback or missing customer-service families. Existing implementations
were preserved; no speculative registry entries or success records were added.

## Validation

Local validation passed: 211 Python regression tests and 41 Deno tests covering
API/MCP authorization, registry discovery, composed dispatch and release evidence.
The Deno tests require no network or environment permissions. Their database and
provider dependencies are injected fixtures; they do not prove live provider
behavior. The existing Node MCP health/authentication test also passed during
environment setup. Production integration, tenant-isolation, rollback and
provider end-to-end suites remain unrun.

## Access observations and blockers

API egress initially returned proxy HTTP 403. After saving the required network
destinations, GitHub authenticated repository reads work. Supabase Management,
the project API and Google Cloud answer unauthenticated probes with HTTP 401.
Reachability does not establish authorization or deployed functionality.

`SANDY_SUPABASE_MANAGEMENT_TOKEN` and `SANDY_CONTROLLER_ACCESS_TOKEN` are unavailable
in this cloud machine. Existing deployed-server bindings remain unknown. Secure
binding requirements were saved in environment settings; values must never enter
chat, source or audit output. GitHub's secret/variable metadata endpoints return
HTTP 403 for the current integration, so their presence cannot be inferred.

The GitHub `sandy-production` environment requires its configured reviewer.
The new **Sandy API production inspection** workflow retains that environment
gate and reads only registry/function metadata using existing approved secret
bindings. It does not deploy or change database state. A queued or waiting audit
is not a completed inspection.

Before deployment: obtain authorized live metadata and deployed-source access,
establish source parity and recovery artifacts, inspect effective provider and
tenant grants, then implement the remaining operations in dependency order.
Historical versions and registry counts in README/PDF are not current evidence.

## Reproduction

Use the existing isolated checkout; do not create a worktree unless requested.
Activate the installed Node/Deno tools with
`export PATH=/workspace/.cloud-tools/node_modules/.bin:$PATH`.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/sandy -p 'test_*.py'
deno test supabase/functions/sandy-operation-api/ supabase/functions/sandy-api-mcp/ supabase/functions/sandy-deployment-api/
python3 scripts/sandy/inspect_api_production.py --probe-network --output /workspace/sandy-api-deliverables/production-inspection.json
```

To regenerate the 161-row reconciliation without attachments, place the checked-in
JSON review in a directory containing only that JSON file, then run:

```sh
mkdir -p /workspace/sandy-api-review
cp docs/sandy-api/requirement-source-review.json /workspace/sandy-api-review/review.json
python3 scripts/sandy/api_scope_inventory.py --scope docs/sandy-api/api-scope-161.md --reconciliation-dir /workspace/sandy-api-review --output-dir /workspace/sandy-api-deliverables --xlsx
```

XLSX output requires `openpyxl==3.1.5`. Generated metadata and the Excel workbook
belong outside the checkout; the original requirements remain unchanged.
