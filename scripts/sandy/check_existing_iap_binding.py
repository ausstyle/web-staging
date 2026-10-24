#!/usr/bin/env python3
"""Fail early if the protected IAP worker is already bound.

Read-only. Must run BEFORE gcloud run deploy so a new candidate cannot displace
a pre-existing review tag and then fail the binding no-overwrite guard.
Never print the secret API response, secret digests or credentials.
"""
import json
from bind_iap_transport_runtime import NAMES
from release_gcp_admin_read import Installer,digest
from release_web_canary import Blocked

PREVIOUS = {
    'SANDY_IAP_REPAIR_WORKER_URL':
        'https://sandy-iap-repair-review---sandy-engineering-mcp-4pqn6jsfxq-ew.a.run.app',
    'SANDY_IAP_REPAIR_SOURCE_SHA256':
        '1b9ee79c72b160b15d2b3a6d6a44838e15eaf5d33c2db4fcb01de6a7e7ad0df1',
    'SANDY_IAP_REPAIR_WORKER_REVISION':
        'sandy-engineering-mcp-iap-40047740407-1',
}

def assess(rows):
    if not isinstance(rows,list) or not all(isinstance(r,dict) and
        isinstance(r.get('name'),str) and isinstance(r.get('value'),str)
        for r in rows):
        raise Blocked('iap_secret_inventory_unverifiable')
    found={r['name']:r['value'] for r in rows if r['name'] in NAMES}
    if not found:
        return {'ready':True,'reason':'no_existing_iap_binding'}
    complete=len(found)==len(NAMES)
    previous=complete and all(
        found[name]==digest(PREVIOUS[name].encode('utf-8')) for name in NAMES)
    return {'ready':False,
        'reason':('existing_previous_iap_candidate_requires_reconciliation'
                  if previous else
                  'existing_iap_binding_requires_reconciliation'),
        'binding_count':len(found),'binding_complete':complete,
        'matching_previous_verified_candidate':previous}

def main():
    import os
    from pathlib import Path
    if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main':
        raise Blocked('protected_main_release_required')
    root=Path(os.environ['RUNNER_TEMP'])/'iap-binding-preflight'
    root.mkdir(parents=True,exist_ok=True)
    r=Installer(root)
    result=assess(json.loads(r.api('GET','/secrets')))
    # Only safe classification is logged; no secret names, digests or values.
    print('::notice title=Existing IAP binding preflight::'+json.dumps({
        **result,'IAM_changes':0,'cloud_run_deployments':0},separators=(',',':')))
    if not result['ready']:raise Blocked(result['reason'])

if __name__=='__main__':
    try:main()
    except Blocked as exc:
        print('::error title=Protected IAP candidate deployment stopped::'+str(exc))
        raise SystemExit(1)
    except Exception:
        print('::error title=Protected IAP preflight unavailable::iap_binding_inventory_unavailable_no_deploy')
        raise SystemExit(1)
