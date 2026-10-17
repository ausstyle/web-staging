#!/usr/bin/env python3
"""Run Sandy's evidence-backed feature discovery using ephemeral GitHub OIDC."""
import json
import os
import urllib.parse
import urllib.request

AUDIENCE="sandy-feature-discovery-zmqlyygzqoidkcwdysok"
ENDPOINT="https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-feature-discovery"


def verify_response(data):
    if not isinstance(data, dict) or data.get("ok") is not True:
        raise RuntimeError("Feature discovery failed or did not return verified success")
    if not isinstance(data.get("created"), int) or not 0 <= data["created"] <= 2:
        raise RuntimeError("Feature discovery result count invalid")
    return {"assessed": data.get("assessed"), "created": data["created"],
            "proposed_not_deployed": True}


def main():
    if os.environ.get("GITHUB_REPOSITORY")!="ausstyle/web-staging":
        raise RuntimeError("Unexpected GitHub repository")
    issuer_url=os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"]
    request_token=os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]
    separator="&" if "?" in issuer_url else "?"
    token_request=urllib.request.Request(
      issuer_url+separator+urllib.parse.urlencode({"audience":AUDIENCE}),
      headers={"Authorization":"Bearer "+request_token})
    with urllib.request.urlopen(token_request,timeout=15) as response:
        assertion=json.load(response)["value"]
    payload=json.dumps({"op":"discover"}).encode("utf-8")
    request=urllib.request.Request(ENDPOINT,method="POST",data=payload,
      headers={"authorization":"Bearer "+assertion,"content-type":"application/json"})
    with urllib.request.urlopen(request,timeout=120) as response:
        outcome=json.load(response)
    print(json.dumps(verify_response(outcome)))


if __name__=="__main__":
    main()
