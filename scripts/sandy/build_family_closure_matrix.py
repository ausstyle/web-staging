"""Assign every family a primary closure dependency without granting authority.
Unreviewed aliases are an API review task, never evidence that exposure must grow.
Inputs are current read-only captures, not executable provider instructions.
"""
import argparse,json
from collections import defaultdict
from pathlib import Path

SPECIAL={
 34:('regional_reads_closed','API + existing resource owner','Review only gcp.region_operations.get/wait for the fixed project and one existing DONE regional operation; require verified target before any activation.'),
 72:('provider_refusal_preserved','Security/resource owner','Diagnose existing SCC entitlement for projects/elaborate-haven-511518-a5/sources/-. No retry, identity substitution or IAM change.'),
 75:('scope_denial_preserved','Existing Controller Owner','Owner may perform supabase.orgs.list under normal policy. Preserve workload denial; no organization-wide delegation.'),
 86:('scope_denial_preserved','Existing Controller Owner','Owner may perform supabase.project.health for zmqlyygzqoidkcwdysok under normal policy. Preserve workload denial.'),
 85:('legacy_fixture_incomplete','API + existing log owner','Define bounded general log-query target/time range and privacy contract; current fixture alone cannot certify the family.'),
 110:('legacy_fixture_incomplete','API + existing log owner','Shares canonical supabase.logs.query with family85; reuse evidence but require both family obligations. Do not rerun the old positive.'),
 113:('existing_app_credential_unavailable','Existing GitHub App administrator','Diagnose existing App JWT binding for GET /repos/ausstyle/web-staging/installation; no key creation, App installation or credential expansion.'),
 115:('ref_delete_outside_delegation','API + Controller Owner','Before proposing delete, identify an owned disposable engineering ref and expected SHA from its creation receipt; never delete default/protected/shared refs or bypass API policy.'),
 117:('binary_custody_software_gap','API','Implement reviewed binary/large-artifact custody without weakening repository material protection; retain text lifecycle evidence. No new provider positive is needed now.'),
 118:('immutable_settlement_and_closed_blob_read','API + scoped release owner','Finish tree settlement; reconcile undeployed blob candidate to current source; separately review closed restricted github.git.get_blob for exact repository/SHA reads. No blanket git scope.'),
}

def build(plan):
    families=plan['families']
    if sorted(f['family_id'] for f in families)!=list(range(1,162)):raise ValueError('exactly_161_families_required')
    groups=defaultdict(list);rows=[]
    for f in sorted(families,key=lambda f:f['family_id']):
        n=f['family_id'];d=f['operation_disposition']
        if plan.get('delegation_active') is not True:
            group,owner,action='delegation_inactive','Existing policy owner','Resolve the captured inactive delegation; no execution inferred from old fixtures.'
        elif n in range(35,41):
            group,owner,action='runtime_owned_execution','Runtime','Runtime supplies guest/native execution and owned fixture receipts; API must not duplicate worker or infrastructure mutations.'
        elif n in range(143,162):
            group,owner,action='tenant_fixture_and_contract_review','Product owner + API','Identify actual synthetic/consented tenant fixture and canonical handler mapping; do not fabricate identity, consent or customer data.'
        elif n in SPECIAL:
            group,owner,action=SPECIAL[n]
        elif not f['constituents_reviewed']:
            group,owner,action='api_constituent_review','API','Review actual canonical actions and aliases against the requirement before any exposure/permission request; continue source work.'
        elif d.get('closed_exposure'):
            group,owner,action='reviewed_contract_activation_and_evidence','API + applicable resource owner','Review implementation, precise target and required permissions for only these canonical constituents. Closed flags alone do not prove an otherwise executable release.'
        else:
            group,owner,action='remaining_evidence_review','API','Reconcile current handler/contract pins and all lifecycle/isolation/recovery cases; existing successes alone cannot certify the family.'
        groups[group].append(n)
        rows.append({'family_id':n,'requirement':f['requirement'],'primary_dependency':group,'owner':owner,'next_action':action,'constituents_reviewed':f['constituents_reviewed'],'operation_disposition':d,'accepted':False,'closure_demonstrated':False,'provider_invocation_recommended':False})
    return {'observed_at_utc':plan['observed_at_utc'],'delegation_version':plan['delegation_version'],'delegation_expires_at':plan['delegation_expires_at'],'source_sha256':plan.get('source_sha256',{}),'grouping':'Mutually exclusive primary dependency; per-family dispositions retain secondary gaps. Not proof that all future executions are blocked.','permissions_changed':False,'accepted_families_added':0,'groups':dict(sorted(groups.items())),'families':rows}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--plan',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();r=build(json.loads(a.plan.read_text()));a.output.write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({k:len(v) for k,v in r['groups'].items()},sort_keys=True))
if __name__=='__main__':main()
