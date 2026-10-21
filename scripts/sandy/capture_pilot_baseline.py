#!/usr/bin/env python3
"""Capture the first five read-only pilot journeys through the real web ingress.

Requires the pilot's normal Auth session. It cannot substitute an engineering,
service, or another customer's identity. Responses stay outside the repository;
capture is not an independent quality verdict and does not mark scenarios passed.
"""
import argparse
import json
import os
from pathlib import Path
import urllib.request
import urllib.error
import uuid

BASE = "https://zmqlyygzqoidkcwdysok.supabase.co"
PILOT_EMAIL = "sandyemail.ai@gmail.com"
PUBLIC_KEY = "sb_publishable_OVP7LUMDhtcymPRzZuCK3Q_8JkLC3ts"
CASES = ["P0-007", "P0-019", "P0-020", "P0-021", "P0-026"]
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None

def capture(token: str, cohort: dict, output: Path) -> dict:
    opener = urllib.request.build_opener(NoRedirect())
    headers = {"authorization": "Bearer " + token, "apikey": PUBLIC_KEY, "content-type": "application/json"}
    def request(path, body=None):
        req = urllib.request.Request(BASE + path, headers=headers, data=json.dumps(body).encode() if body is not None else None)
        try:
            response = opener.open(req, timeout=130)
        except urllib.error.HTTPError as error:
            # Do not retry an uncertain accepted turn or print provider bodies.
            return error.code, {"error":"pilot_http_error"}
        with response:
            raw = response.read(2300001)
            if len(raw) > 2300000:
                raise RuntimeError("pilot_response_too_large")
            return response.status, json.loads(raw.decode().replace(token, "[REDACTED]"))
    status, user = request("/auth/v1/user")
    if status != 200 or not user.get("id") or str(user.get("email", "")).lower() != PILOT_EMAIL or not user.get("email_confirmed_at"):
        raise RuntimeError("normal_pilot_authentication_required")
    cases = {case["case_id"]:case for case in cohort["cases"]}
    observed = []
    for case_id in CASES:
        status, conversation = request("/functions/v1/sandy-workspace?action=web_new_conversation", {})
        if status != 200 or not conversation.get("conversation_id"):
            raise RuntimeError("pilot_conversation_not_created")
        request_id = "p0qa_" + uuid.uuid4().hex
        status, response = request("/functions/v1/sandy-workspace?action=ask", {
            "question":cases[case_id]["request"], "conversation_id":conversation["conversation_id"],
            "request_id":request_id, "timezone":"Europe/Rome",
        })
        observed.append({"case_id":case_id, "request_id":request_id, "conversation_id":conversation["conversation_id"],
            "http_status":status, "response":response, "status":"captured_unscored"})
        # Keep actual turn outcomes, including failures. A rerun must explicitly
        # reconcile its request/task ID rather than silently create another turn.
        output.write_text(json.dumps({"cohort":cohort["version"], "observations":observed, "acceptance_passed":False},indent=2))
        if status != 200:
            break
    return {"captured_cases":len(observed), "successful_http_responses":sum(row["http_status"]==200 for row in observed), "quality_scored":False, "output":str(output)}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    checkout=Path(__file__).resolve().parents[2]
    output=args.output.resolve()
    if output.is_relative_to(checkout):
        parser.error("Pilot responses must stay outside the checkout")
    token=os.environ.get("SANDY_PILOT_ACCESS_TOKEN","")
    if not token:
        print(json.dumps({"state":"blocked","missing_binding":"SANDY_PILOT_ACCESS_TOKEN","accepted_cases":0}));return 2
    try:
        output.parent.mkdir(parents=True,exist_ok=True)
        fd=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.close(fd)
        cohort=json.loads((checkout/"docs/sandy-engineering/evaluations/p0-cohort-v1.json").read_text())
        print(json.dumps(capture(token,cohort,output)));return 0
    except (OSError,RuntimeError,ValueError):
        print(json.dumps({"state":"blocked_or_interrupted","error":"pilot_capture_unavailable","automatic_retry":False}));return 1

if __name__=="__main__":
    raise SystemExit(main())
