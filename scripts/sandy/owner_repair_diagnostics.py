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

STAGES=frozenset('''initialization candidate_verification approval_verification prior_function_readback
migration_state_readback preflight_verified rollback_capture component_lease_acquire
approval_and_lease_recheck migration_transaction post_migration_source_guard function_upload
function_source_verification migration_postconditions release_audit_record release_verified
function_metadata function_source migration_history migration_columns migration_functions
migration_event_table component_lease release_events'''.split())
def github_annotation(result):
    """Expose bounded codes in check-run annotations when log downloads are unavailable."""
    if result.get('mode')=='management_access_diagnostics':
        from management_access_diagnostics import safe_annotation
        summary=safe_annotation(result.get('management_access',{}))
        kind='notice' if result.get('ok') is True else 'error'
    elif result.get('ok') is False:
        summary={k:result[k] for k in ('failure_code','http_status','sqlstate','read_only') if k in result}
        summary['stage']=result.get('stage') if result.get('stage') in STAGES else 'reconciliation'
        summary['probe_failures']={stage:{k:value[k] for k in ('failure_code','http_status','sqlstate') if k in value}
            for stage,value in result.get('observations',{}).items() if stage in STAGES and isinstance(value,dict) and value.get('ok') is False}
        kind='error'
    else:
        observations=result.get('observations',{})
        metadata=observations.get('function_metadata',{})
        source=observations.get('function_source',{})
        summary={'read_only':result.get('read_only') is True,'clean_retry_preconditions_verified':result.get('clean_retry_preconditions_verified') is True,
                 'function_version':metadata.get('version') if type(metadata.get('version')) is int else None,
                 'deployed_version':result.get('deployed_version') if type(result.get('deployed_version')) is int else None}
        if re.fullmatch('[a-f0-9]{64}',str(source.get('bundle_sha256',''))):summary['bundle_sha256']=source['bundle_sha256']
        kind='notice'
    import json
    text=json.dumps(summary).replace('%','%25').replace('\r','%0D').replace('\n','%0A')
    return '::'+kind+' title=Owner repair diagnostic::'+text
