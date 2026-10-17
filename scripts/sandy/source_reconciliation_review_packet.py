#!/usr/bin/env python3
"""Create a strictly metadata-only review packet from an approved source comparison."""
import json
import pathlib
import re
import sys

def review_packet(comparison, issue, run):
    if not re.fullmatch(r"[1-9][0-9]{0,5}", issue) or not re.fullmatch(r"[0-9]{5,20}", run):
        raise ValueError("Invalid source audit identity")
    if comparison.get("schema_version") != 1 or comparison.get("project_ref") != "zmqlyygzqoidkcwdysok":
        raise ValueError("Unexpected source project")
    slug = comparison.get("function_slug")
    if not isinstance(slug, str) or not re.fullmatch(r"sandy-[a-z0-9-]{1,80}", slug):
        raise ValueError("Unexpected function slug")
    if comparison.get("production_parity_certified") is not False:
        raise ValueError("Untrusted parity assertion")
    files = comparison.get("files")
    statuses = {"hash_match","hash_mismatch","missing_in_repository","not_in_audited_bundle"}
    if not isinstance(files, list) or not files or len(files) > 160:
        raise ValueError("Invalid comparison entries")
    entries = []
    for item in files:
        if not isinstance(item, dict):
            raise ValueError("Invalid entry")
        path, status = item.get("path"), item.get("status")
        if not isinstance(path, str) or not re.fullmatch(r"[a-zA-Z0-9_.-]+(?:/[a-zA-Z0-9_.-]+)*", path) or ".." in path.split("/") or status not in statuses:
            raise ValueError("Invalid path or status")
        entries.append({"path":path,"status":status})
    mismatched = [e for e in entries if e["status"] != "hash_match"]
    return {"schema_version":1,"issue_number":int(issue),"source_audit_run":int(run),
            "audit_url":f"https://github.com/ausstyle/web-staging/actions/runs/{run}",
            "project_ref":comparison["project_ref"],"function_slug":slug,
            "review_status":"requires_human_source_review" if mismatched else "snapshot_hashes_match_review_required",
            "production_parity_certified":False,"source_contents_included":False,
            "files":entries,"instructions":"Review source differences in a secure environment before importing deployed source. Do not auto-deploy or assert parity."}

if __name__=="__main__":
    m=json.loads(pathlib.Path(sys.argv[1]).read_text())
    result=review_packet(m,sys.argv[2],sys.argv[3])
    pathlib.Path(sys.argv[4]).write_text(json.dumps(result,indent=2,sort_keys=True)+"\n")
