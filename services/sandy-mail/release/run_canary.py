#!/usr/bin/env python3
"""Invoked by the existing protected release owner; never provisions authority.
Default is validation only. Provider observations are precondition evidence, not
an approval. The caller must validate existing admission/identity before execute.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

PROJECT = "elaborate-haven-511518-a5"
SCOPE = {"Tenant":"23900000-0000-4000-8000-000000000001", "Account":"23900000-0000-4000-8000-000000000002", "Mailbox":"23900000-0000-4000-8000-000000000003"}
RAW_HASH = "c93407efbafd6a3193d6331b8358ff71d8ae0e0dde72f238d1717b562b921244"
ATTACHMENT_HASH = "78c696a93e4fcb4a88f4e9581262e928ab70aefc303d38983b6c51d6fc02bbff"

class GateError(ValueError): pass

def require(value, code):
    if not value: raise GateError(code)

def validate(manifest, observed, binary, now=None):
    require(set(manifest)=={"version","project","region","instance","connection_name","database","bucket","source_commit","binary_sha256","scope","runtime_service_account"},"manifest_fields")
    require(manifest["version"]==1 and manifest["project"]==PROJECT,"project_binding")
    require(manifest["database"]=="sandy_mail_canary","dedicated_canary_database")
    require(manifest["scope"]==SCOPE,"synthetic_scope_only")
    require(re.fullmatch(r"[a-f0-9]{40}",manifest["source_commit"] or ""),"immutable_source")
    require(re.fullmatch(r"[a-f0-9]{64}",manifest["binary_sha256"] or ""),"artifact_digest")
    require(hashlib.sha256(binary.read_bytes()).hexdigest()==manifest["binary_sha256"],"artifact_mismatch")
    require(manifest["connection_name"]==f'{PROJECT}:{manifest["region"]}:{manifest["instance"]}',"connection_binding")
    require(re.fullmatch(r"[a-z][a-z0-9-]{1,61}",manifest["instance"]),"instance_name")
    require(manifest["runtime_service_account"].endswith('@'+PROJECT+'.iam.gserviceaccount.com'),"workload_project")
    timestamp=dt.datetime.fromisoformat(observed["observed_at"].replace('Z','+00:00'))
    age=((now or dt.datetime.now(dt.timezone.utc))-timestamp).total_seconds()
    require(0<=age<=900,"fresh_provider_observations_required")
    sql=observed["instance"]; bucket=observed["bucket"]
    require(sql.get("project")==PROJECT and sql.get("name")==manifest["instance"] and sql.get("connectionName")==manifest["connection_name"],"observed_instance_binding")
    require(sql.get("region")==manifest["region"] and sql.get("state")=="RUNNABLE","instance_readiness")
    require(sql.get("databaseVersion","").startswith("POSTGRES_") and int(sql["databaseVersion"].split('_')[1])>=17,"postgres17_required")
    require(sql.get("settings",{}).get("availabilityType")=="REGIONAL","regional_HA_required")
    require(observed.get("database",{}).get("name")==manifest["database"] and observed["database"].get("instance")==manifest["instance"] and observed["database"].get("project")==PROJECT,"database_not_observed")
    require(bucket.get("name")==manifest["bucket"] and bucket.get("location","").lower()==manifest["region"],"bucket_residency_binding")
    require(bucket.get("iamConfiguration",{}).get("uniformBucketLevelAccess",{}).get("enabled") is True,"uniform_bucket_access_required")
    require(bucket.get("iamConfiguration",{}).get("publicAccessPrevention")=="enforced","public_access_prevention_required")
    require(bucket.get("versioning",{}).get("enabled") is True,"versioning_required")
    require(observed.get("runtime_service_account")==manifest["runtime_service_account"],"observed_workload_identity")
    require(isinstance(observed.get("canonical_read_receipt_ids"),list) and len(observed["canonical_read_receipt_ids"])>=2,"canonical_read_receipts_required")
    return {"preconditions_validated":True,"authorization_granted_by_runner":False,"cloud_writes":0}

def verify_result(result, manifest, expected_receipt=None):
    require(result.get("environment")=="cloudsql-canary" and result.get("database")==manifest["database"],"result_database_binding")
    require(result.get("configured_cloudsql_connection")==manifest["connection_name"] and result.get("configured_gcs_bucket")==manifest["bucket"],"result_provider_binding")
    require(result.get("scope")==SCOPE and result.get("external_messages_sent")==0 and result.get("raw_byte_equal") is True,"result_fixture_binding")
    message=result["message"];receipt=message["receipt"]
    require(receipt.get("release_ref")==manifest["source_commit"],"receipt_source_mismatch")
    require(receipt.get("delivery_id")=="synthetic-first-001" and receipt.get("raw",{}).get("sha256")==RAW_HASH and receipt["raw"].get("size")==1101,"raw_fixture_integrity")
    require(receipt.get("attachment_count")==1 and len(message.get("attachments",[]))==1 and message["attachments"][0].get("sha256")==ATTACHMENT_HASH,"attachment_integrity")
    require(message.get("security_state")=="quarantined","scanner_bypass")
    require(receipt.get("receipt_id") and (expected_receipt is None or receipt["receipt_id"]==expected_receipt),"receipt_replay_mismatch")
    require(receipt["raw"].get("generation",0)>0 and receipt.get("recovery_ledger",{}).get("generation",0)>0,"object_generations_required")
    return receipt["receipt_id"]

def execute(manifest, binary, output, invoke=subprocess.run):
    require(os.getenv("MAIL_MIGRATOR_DSN") and os.getenv("MAIL_RUNTIME_DSN"),"existing_scoped_database_credentials_required")
    # DSNs remain in child environment only; never put them in manifest/argv/logs.
    env=os.environ.copy()
    env.pop("MAIL_MIGRATOR_DSN",None);env.pop("MAIL_RUNTIME_DSN",None)
    env.update(MAIL_ENVIRONMENT="cloudsql-canary",MAIL_EXPECTED_DATABASE=manifest["database"],MAIL_CLOUDSQL_CONNECTION_NAME=manifest["connection_name"],MAIL_GCS_BUCKET=manifest["bucket"],MAIL_REGION=manifest["region"],MAIL_RELEASE_REF=manifest["source_commit"],MAIL_TENANT_ID=SCOPE["Tenant"],MAIL_ACCOUNT_ID=SCOPE["Account"],MAIL_MAILBOX_ID=SCOPE["Mailbox"])
    report={"source_commit":manifest["source_commit"],"stages":[],"state":"executing","independent_provider_acceptance":False}
    receipt=None
    for action in ("migrate","seed-synthetic","ingest","read","ingest","read"):
        env["MAIL_DATABASE_DSN"]=os.environ["MAIL_MIGRATOR_DSN" if action in ("migrate","seed-synthetic") else "MAIL_RUNTIME_DSN"]
        try:
            r=invoke([str(binary.resolve()),action],env=env,capture_output=True,text=True,timeout=180,check=False)
            require(r.returncode==0,"canary_stage_failed")
            value=json.loads(r.stdout)
            if action in ("migrate","seed-synthetic"):
                require(value.get("database")==manifest["database"] and value.get("environment")=="cloudsql-canary" and value.get("migration_applied" if action=="migrate" else "synthetic_seeded") is True,"migration_seed_readback")
            else: receipt=verify_result(value,manifest,receipt)
            report["stages"].append({"action":action,"state":"verified","result":value})
        except Exception as error:
            report["state"]="unknown_outcome" if action != "read" else "verification_failed"
            report["stages"].append({"action":action,"state":report["state"],"error":"stage_timeout_reconcile_same_delivery" if isinstance(error,subprocess.TimeoutExpired) else "stage_failed_no_automatic_retry"})
            output.write_text(json.dumps(report,indent=2)+'\n');raise GateError(report["stages"][-1]["error"]) from None
        output.write_text(json.dumps(report,indent=2)+'\n')
    report.update(state="synthetic_canary_verified",receipt_id=receipt)
    output.write_text(json.dumps(report,indent=2)+'\n');return report

def main():
    p=argparse.ArgumentParser();p.add_argument('--manifest',type=Path,required=True);p.add_argument('--observations',type=Path,required=True);p.add_argument('--binary',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--execute',action='store_true');args=p.parse_args()
    try:
        manifest=json.loads(args.manifest.read_text());observed=json.loads(args.observations.read_text());result=validate(manifest,observed,args.binary)
        if args.execute: result=execute(manifest,args.binary,args.output)
        else: args.output.write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps({"state":result.get("state","preconditions_validated_only"),"execution_requested":args.execute}))
    except (GateError,ValueError,KeyError,TypeError,OSError):
        print('Mail release precondition or execution failed; inspect bounded receipt; no authority was created.',file=sys.stderr);return 1
    return 0
if __name__=='__main__':sys.exit(main())
