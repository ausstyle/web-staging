#!/usr/bin/env python3
"""Deliver a validated Architect/Engineer outcome to Supabase using GitHub's short-lived OIDC JWT."""
import json
import os
from pathlib import Path
import re
import urllib.parse
import urllib.request
import urllib.error

AUDIENCE="sandy-engineering-outcomes-zmqlyygzqoidkcwdysok"
ENDPOINT="https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-engineering-oidc-ingest"
OUTCOME=Path("/tmp/sandy-engineering-outcome.json")


def validate_outcome(obj):
    if not isinstance(obj,dict) or not isinstance(obj.get("issue_number"),int) or not 1<=obj["issue_number"]<=999999:
        raise ValueError("Invalid issue number")
    if not isinstance(obj.get("architecture_run_id"),str) or not re.fullmatch(r"[1-9][0-9]{4,19}",obj["architecture_run_id"]):
        raise ValueError("Invalid Architect run id")
    if obj.get("decision") not in ("READY","BLOCKED"):
        raise ValueError("No validated Architect decision")
    pr=obj.get("pr_number")
    if pr is not None and (obj["decision"]!="READY" or not isinstance(pr,int) or not 1<=pr<=9999999):
        raise ValueError("Unverified engineer PR")
    return obj


def main():
    if not OUTCOME.is_file():
        print("No validated architecture artifact; no Supabase state transition")
        return
    obj=validate_outcome(json.loads(OUTCOME.read_text()))
    request_url=os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"]
    request_token=os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]
    separator="&" if "?" in request_url else "?"
    request=urllib.request.Request(
        request_url+separator+urllib.parse.urlencode({"audience":AUDIENCE}),
        headers={"Authorization":"Bearer "+request_token},
    )
    with urllib.request.urlopen(request,timeout=12) as response:
        oidc=json.load(response)["value"]
    body=json.dumps(obj).encode()
    post=urllib.request.Request(ENDPOINT,data=body,method="POST",
        headers={"Authorization":"Bearer "+oidc,"Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(post,timeout=20) as response:
            result=json.load(response)
    except urllib.error.HTTPError as error:
        try:
            failure=json.loads(error.read().decode("utf-8"))
            reason=failure.get("reason","unspecified") if isinstance(failure,dict) else "invalid_response"
            if not isinstance(reason,str) or not re.fullmatch(r"[a-z0-9_]{1,90}",reason):
                reason="invalid_response"
        except (ValueError,UnicodeDecodeError):
            reason="invalid_response"
        raise RuntimeError(f"Signed engineering outcome rejected: HTTP {error.code}, reason={reason}") from None
    if result.get("ok") is not True:
        raise RuntimeError("Supabase rejected signed engineering observation")
    print("Recorded verified engineering observation in Sandy's canonical Supabase cycle")


if __name__=="__main__":
    main()
