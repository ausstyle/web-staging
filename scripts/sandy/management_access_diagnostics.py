"""Fixed read-only probes for the existing release credential; never export it."""
import base64
import json
import os

from inspect_api_production import MANAGEMENT_BASE, PROJECT_REF, _request, http_transport

ACCOUNT_BASE = 'https://api.supabase.com/v1'
PROBES = frozenset(('project_list', 'project_metadata', 'function_metadata', 'database_select', 'database_privileges'))
CONCLUSIONS = frozenset(('management_reads_verified', 'project_api_key_not_management_identity',
    'target_project_not_visible', 'target_project_access_denied', 'database_query_access_denied',
    'database_object_privileges_missing', 'management_credential_rejected', 'management_access_unverified',
    'credential_binding_missing'))
PRIVILEGE_QUERY = """SELECT
 has_schema_privilege(current_user,'public','CREATE') AS public_schema_create,
 has_schema_privilege(current_user,'supabase_migrations','USAGE') AS migration_schema_usage,
 has_table_privilege(current_user,'supabase_migrations.schema_migrations','INSERT') AS migration_history_insert,
 (has_table_privilege(current_user,'public.sandy_engineering_component_leases','INSERT')
 AND has_table_privilege(current_user,'public.sandy_engineering_component_leases','UPDATE')
 AND has_table_privilege(current_user,'public.sandy_engineering_component_leases','DELETE')) AS component_lease_write,
 has_table_privilege(current_user,'public.sandy_engineering_change_events','INSERT') AS release_audit_insert,
 EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname='sandy_engineering_delegation_policy'
 AND pg_has_role(current_user,c.relowner,'USAGE')) AS delegation_policy_owner_role"""
PRIVILEGES = frozenset(('public_schema_create', 'migration_schema_usage', 'migration_history_insert',
    'component_lease_write', 'release_audit_insert', 'delegation_policy_owner_role'))

def credential_kind(token):
    # This is format diagnosis, never credential authentication or a scope grant.
    if token.startswith('sbp_'):return 'management_token_format'
    if token.startswith(('sb_secret_', 'sb_publishable_')):return 'project_api_key_format'
    try:
        parts=token.split('.')
        if len(parts)==3 and len(parts[1])<=8192:
            claims=json.loads(base64.urlsafe_b64decode(parts[1]+'='*(-len(parts[1])%4)))
            if isinstance(claims,dict) and claims.get('role') in ('anon','service_role'):
                return 'project_api_jwt_format'
    except (ValueError,TypeError,UnicodeError):pass
    return 'opaque_or_unrecognized_format'

def diagnose_access(environment=None, transport=http_transport):
    env=os.environ if environment is None else environment
    token=env.get('SANDY_SUPABASE_MANAGEMENT_TOKEN','')
    result={'read_only':True,'production_writes_dispatched':False,
        'credential_binding':'sandy-production/SUPABASE_ACCESS_TOKEN' if env.get('GITHUB_ACTIONS')=='true' else 'runner/SANDY_SUPABASE_MANAGEMENT_TOKEN',
        'credential_present':bool(token),'credential_kind':credential_kind(token) if token else None,
        'project_ref':PROJECT_REF,'provider_role_verified':False,
        'function_deploy_permission_verified':False,'probes':{}}
    if not token:
        result.update(ok=False,conclusion='credential_binding_missing');return result
    def probe(name,method,url,body=None):
        response=_request(transport,method,url,token,body)
        observed=response.failure is None and response.status is not None and 200<=response.status<300
        result['probes'][name]={'method':method,'endpoint':url,'http_status':response.status,'observed':observed}
        return response.payload if observed else None
    projects=probe('project_list','GET',ACCOUNT_BASE+'/projects')
    visible=None
    if isinstance(projects,list) and all(isinstance(x,dict) for x in projects):
        visible=any(x.get('id')==PROJECT_REF or x.get('ref')==PROJECT_REF for x in projects)
    result['target_project_visible_in_list']=visible
    project=probe('project_metadata','GET',MANAGEMENT_BASE)
    result['target_project_metadata_verified']=isinstance(project,dict) and (project.get('id')==PROJECT_REF or project.get('ref')==PROJECT_REF)
    function=probe('function_metadata','GET',MANAGEMENT_BASE+'/functions/sandy-engineering-control')
    if isinstance(function,dict) and type(function.get('version')) is int:
        result['function_version']=function['version']
    selected=probe('database_select','POST',MANAGEMENT_BASE+'/database/query',{'query':'SELECT 1::integer AS management_read_probe;'})
    result['database_query_access_verified']=selected==[{'management_read_probe':1}]
    if result['database_query_access_verified']:
        privileges=probe('database_privileges','POST',MANAGEMENT_BASE+'/database/query',{'query':PRIVILEGE_QUERY})
        if isinstance(privileges,list) and len(privileges)==1 and isinstance(privileges[0],dict) and all(type(privileges[0].get(k)) is bool for k in PRIVILEGES):
            result['database_privileges']={k:privileges[0][k] for k in sorted(PRIVILEGES)}
    p=result['probes'];result['ok']=False
    if result['credential_kind'] in ('project_api_key_format','project_api_jwt_format'):
        conclusion='project_api_key_not_management_identity'
    elif any(x['http_status']==401 for x in p.values()):conclusion='management_credential_rejected'
    elif visible is False:conclusion='target_project_not_visible'
    elif p['project_metadata']['http_status']==403:conclusion='target_project_access_denied'
    elif p['database_select']['http_status']==403:conclusion='database_query_access_denied'
    elif result.get('database_privileges') and not all(result['database_privileges'].values()):conclusion='database_object_privileges_missing'
    elif result['target_project_metadata_verified'] and result['database_query_access_verified'] and all(x['observed'] for x in p.values()) and all(result.get('database_privileges',{}).values()) and result.get('database_privileges'):
        conclusion='management_reads_verified';result['ok']=True
    else:conclusion='management_access_unverified'
    result['conclusion']=conclusion
    return result

def safe_annotation(result):
    """Only fixed codes/statuses survive into public CI check annotations."""
    return {'conclusion':result.get('conclusion') if result.get('conclusion') in CONCLUSIONS else 'management_access_unverified',
        'read_only':True,'database_query_access_verified':result.get('database_query_access_verified') is True,
        'target_project_visible_in_list':result.get('target_project_visible_in_list') if type(result.get('target_project_visible_in_list')) is bool else None,
        'database_privileges':{k:v for k,v in result.get('database_privileges',{}).items() if k in PRIVILEGES and type(v) is bool},
        'http_statuses':{k:v.get('http_status') for k,v in result.get('probes',{}).items() if k in PROBES and isinstance(v,dict) and type(v.get('http_status')) is int and 100<=v['http_status']<=599}}
