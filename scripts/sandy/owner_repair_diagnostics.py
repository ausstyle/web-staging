"""Bounded public release diagnostics. No provider messages, source or credentials."""
import errno
import re
import subprocess
import urllib.error
from release_web_canary import Blocked

GUARDS = frozenset('''genuine_pinned_owner_approval_required release_lease_lost
approved_manifest_changed approved_source_changed immutable_module_mismatch
immutable_migration_mismatch published_source_or_version_changed
migration_already_present_reconcile_before_retry relocated_migration_version_already_present
existing_protected_github_release_required transactional_migration_required
source_changed_after_schema_install_no_upload unknown_outcome_no_upload_retry
migration_postcondition_failed rollback_outside_repository_required
management_response_too_large partial_migration_requires_reconciliation'''.split())
SQLSTATES = frozenset('''42501 42703 42P01 42P07 42710 23505 23503 23502 42601
42883 42804 25006 25P02 40001 40P01 55P03 57014 53300 53100 53200 P0001 XX000'''.split())
class ManagementFailure(Blocked):
    def __init__(self, status, sqlstate=None):
        self.status=status;self.sqlstate=sqlstate if sqlstate in SQLSTATES else None
        super().__init__('management_http_'+str(status)+'_no_automatic_retry')

def provider_sqlstate(raw):
    # Only recognized PostgreSQL codes survive; never emit the surrounding text.
    import json
    try:
        value=json.loads(raw)
        if isinstance(value,dict) and value.get('code') in SQLSTATES:return value['code']
    except (ValueError,TypeError):pass
    for match in re.finditer(rb'\bERROR:\s*([A-Z0-9]{5}):',raw):
        code=match[1].decode('ascii')
        if code in SQLSTATES:return code
    return None

def failure_details(error):
    detail={}
    if isinstance(error,ManagementFailure):
        code='management_http_'+str(error.status)+'_no_automatic_retry'
        detail['http_status']=error.status
        if error.sqlstate:detail['sqlstate']=error.sqlstate
    elif isinstance(error,Blocked):
        message=str(error)
        code=message if message in GUARDS or re.fullmatch(r'management_http_[1-5][0-9]{2}_no_automatic_retry',message) else 'release_guard_rejected'
    elif isinstance(error,KeyError):code='required_configuration_or_field_missing'
    elif isinstance(error,subprocess.CalledProcessError):code='immutable_source_read_failed'
    elif isinstance(error,urllib.error.URLError):code='management_transport_unavailable'
    elif isinstance(error,OSError):code={errno.EEXIST:'private_evidence_already_exists',errno.EACCES:'private_evidence_permission_denied',errno.ENOENT:'required_local_artifact_missing'}.get(error.errno,'local_io_failure')
    elif isinstance(error,(ValueError,TypeError)):code='provider_or_artifact_payload_invalid'
    else:code='unexpected_release_failure'
    return {'failure_code':code,**detail}
