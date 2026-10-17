#!/usr/bin/env python3
"""Run Sandy's evidence-backed feature discovery using ephemeral GitHub OIDC."""
import http.client
import json
import os
import re
import urllib.parse
import urllib.error
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


REPO="ausstyle/web-staging"
KEY=re.compile(r"^[a-z][a-z0-9_]{5,79}$")
def clean_for_public_issue(value):
    """Strictly minimise customer-derived details posted to a PUBLIC repository."""
    string=str(value or "").replace("\n"," ").replace("\r"," ")
    string=re.sub(r"https?://\S+","[reference]",string)
    string=re.sub(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}","[contact]",string,flags=re.I)
    string=re.sub(r"\b[0-9a-f]{8}-[0-9a-f-]{27,}\b","[reference]",string,flags=re.I)
    string=re.sub(r"\+?\d[\d .()-]{7,}\d","[number]",string)
    return string[:480]


def validate_pending(item):
    if not isinstance(item,dict) or not KEY.fullmatch(str(item.get("key",""))):
        return None
    if item.get("risk") not in ("low","medium","high"):
        return None
    if not isinstance(item.get("priority"),(int,float)):
        return None
    problem=clean_for_public_issue(item.get("problem"))
    ideal=clean_for_public_issue(item.get("ideal"))
    if len(problem)<30 or len(ideal)<30:
        return None
    return {"key":item["key"],"problem":problem,"ideal":ideal,
            "risk":item["risk"],"priority":max(1,min(100,int(item["priority"])))}


def github(method, resource, data=None):
    url="https://api.github.com/repos/"+REPO+"/"+resource
    request=urllib.request.Request(url,
      method=method,
      data=json.dumps(data).encode() if data is not None else None,
      headers={"authorization":"Bearer "+os.environ["GH_TOKEN"],
               "accept":"application/vnd.github+json",
               "content-type":"application/json",
               "user-agent":"sandy-verified-feature-handoff"})
    with urllib.request.urlopen(request,timeout=20) as response:
        return json.load(response)


def complete_issue_inventory():
    """Require a complete, validated inventory before any public handoff."""
    issues=[]
    seen=set()
    try:
        for page in range(1,6):
            batch=github("GET", "issues?state=all&per_page=100&sort=created&direction=asc&page="+str(page))
            if not isinstance(batch,list) or len(batch)>100:
                raise ValueError
            for issue in batch:
                if (not isinstance(issue,dict)
                    or type(issue.get("number")) is not int
                    or issue["number"]<=0
                    or "body" not in issue
                    or (issue["body"] is not None and not isinstance(issue["body"],str))
                    or issue["number"] in seen):
                    raise ValueError
                seen.add(issue["number"])
            issues.extend(batch)
            if len(batch)<100:
                return issues
    except (OSError, ValueError, http.client.HTTPException):
        raise RuntimeError("GitHub issue inventory could not be completed") from None
    raise RuntimeError("GitHub issue inventory could not be completed")


def issue_for(item, existing):
    marker="<!-- sandy-feature-key:"+item["key"]+" -->"
    matches=[x for x in existing if marker in str(x.get("body") or "") and not x.get("pull_request")]
    if matches:
        return matches[0]["number"]
    title="Sandy feature: "+item["key"].replace("_"," ")
    body=("### Product improvement hypothesis (not yet implemented)\n\n"
      +item["problem"]+"\n\n### Intended behavior\n\n"+item["ideal"]
      +"\n\nPriority: "+str(item["priority"])+"/100. Risk: "+item["risk"]+" (provisional AI classification).\n\n"
      "Independent Architect must verify source code, scope, privacy and the actual need; "
      "create only tested draft PRs. No production deployment is authorised by this issue.\n\n"
      +marker)
    can_auto_plan=item["risk"]=="low" and item["priority"]>=80
    proposal={"title":title,"body":body,
      "labels":["sandy-autonomous-ready"] if can_auto_plan else []}
    created=github("POST","issues",proposal)
    existing.append(created)
    return created["number"]


def acknowledge(assertion, item, issue):
    request=urllib.request.Request(ENDPOINT,method="POST",
      data=json.dumps({"op":"acknowledge","key":item["key"],"issue_number":issue}).encode(),
      headers={"authorization":"Bearer "+assertion,"content-type":"application/json"})
    with urllib.request.urlopen(request,timeout=25) as response:
        result=json.load(response)
    if result.get("ok") is not True or result.get("issue_number")!=issue:
        raise RuntimeError("GitHub issue acknowledgement not verified")


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
    try:
        with urllib.request.urlopen(request,timeout=120) as response:
            outcome=json.load(response)
    except urllib.error.HTTPError as error:
        try:
            payload=json.loads(error.read(2048))
            reason=payload.get("error","rejected")
        except (ValueError,UnicodeError):
            reason="rejected"
        if reason not in ("unauthorised","worker_unconfigured","evidence_lookup_failed",
                          "feature_assessment_unavailable","invalid_assessment_response",
                          "invalid_assessment_schema","invalid_op","invalid_json"):
            reason="unclassified"
        raise RuntimeError(f"Feature discovery returned HTTP {error.code}: {reason}") from None
    report=verify_response(outcome)
    if os.environ.get("GITHUB_EVENT_NAME")=="push":
        print(json.dumps({**report,"smoke_only":True,"github_publication":False}))
        return
    issues=complete_issue_inventory()
    for pending in (outcome.get("pending") or [])[:5]:
        feature=validate_pending(pending)
        if feature is None:
            raise RuntimeError("Unsafe feature proposal was not forwarded to GitHub")
        issue=issue_for(feature,issues)
        acknowledge(assertion,feature,issue)
        report.setdefault("verified_engineering_handoffs",[]).append(issue)
    print(json.dumps(report))


if __name__=="__main__":
    main()
