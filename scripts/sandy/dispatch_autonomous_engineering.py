#!/usr/bin/env python3
"""Poll Sandy's controller using GitHub OIDC; dispatch only an approved Architect issue."""
import json
import os
import re
import subprocess
import urllib.parse
import urllib.request

AUDIENCE = "sandy-autonomous-engineering"
BRIDGE = "https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-autonomous-engineering-bridge"

def validate_claim(data):
    if data.get("claimed") is False:
        return None
    if data.get("claimed") is not True:
        raise ValueError("Unexpected controller claim")
    issue, lease, key = data.get("issue_number"), data.get("lease"), data.get("issue_key")
    if type(issue) is not int or not 1 <= issue <= 999999:
        raise ValueError("Invalid issue number")
    if not isinstance(lease,str) or not re.fullmatch(r"[0-9a-f-]{36}",lease):
        raise ValueError("Invalid lease")
    if not isinstance(key,str) or not re.fullmatch(r"[a-zA-Z0-9:_-]{5,160}",key):
        raise ValueError("Invalid issue key")
    return issue,lease,key

def identity():
    endpoint=os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"]
    address=endpoint + ("&" if "?" in endpoint else "?") + urllib.parse.urlencode({"audience":AUDIENCE})
    headers={"Authorization":"Bearer "+os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]}
    with urllib.request.urlopen(urllib.request.Request(address,headers=headers),timeout=20) as resp:
        token=json.load(resp).get("value")
    if not isinstance(token,str) or len(token)<40:
        raise ValueError("GitHub identity unavailable")
    return token

def bridge(token, body):
    request=urllib.request.Request(BRIDGE,
        data=json.dumps(body,separators=(",",":")).encode(),
        headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"},
        method="POST")
    with urllib.request.urlopen(request,timeout=25) as resp:
        return json.load(resp)

def main():
    token=identity()
    claim=validate_claim(bridge(token,{"action":"claim"}))
    if not claim:
        print("No eligible Architect dispatch; waiting for verified source evidence.")
        return
    issue,lease,key=claim
    succeeded=False
    error=""
    try:
        subprocess.run(["gh","workflow","run","sandy-codex-engineering.yml",
                        "--repo","ausstyle/web-staging","--ref","main",
                        "-f",f"issue_number={issue}"],check=True,
                       capture_output=True,text=True,timeout=45)
        succeeded=True
    except (subprocess.SubprocessError,OSError) as exc:
        error=type(exc).__name__
    receipt=bridge(token,{"action":"confirm","issue_key":key,"lease":lease,
                          "succeeded":succeeded,"error":error})
    if receipt.get("accepted") is not True:
        raise RuntimeError("Controller did not accept dispatch receipt")
    if not succeeded:
        raise RuntimeError("Architect dispatch unsuccessful (receipt recorded)")
    print(f"Architect workflow accepted for issue #{issue}; engineering is still approval-gated.")

if __name__=="__main__":
    main()
