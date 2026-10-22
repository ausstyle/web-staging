"""Verify engineering MCP authorization with an isolated normal non-owner session.

Requires SANDY_SUPABASE_MANAGEMENT_TOKEN for fixture creation/cleanup only.
Provider calls use a normal password-grant access token, never a service key.
The reviewed trigger digest must match before creating a user. No Controller
membership, portal customer, email delivery or provider write is requested.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import urllib.error
import urllib.request
import uuid

PROJECT = "zmqlyygzqoidkcwdysok"
BASE = f"https://{PROJECT}.supabase.co"
MANAGEMENT = f"https://api.supabase.com/v1/projects/{PROJECT}"
REVIEWED_TRIGGERS = "0264bfb63993b90eff70257c5c4b1e6f0c47b59b7b1b2db285ce59c3b646e711"
OPERATIONS = ["github.files.update", "github.commit", "supabase.deploy_edge_function",
              "supabase.db.migrations.apply", "supabase.functions.secrets.set",
              "supabase.logs.query", "engineering.implementation.request", "engineering.job.approve"]

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

OPENER = urllib.request.build_opener(NoRedirect())

def request(method, url, token, apikey=None, body=None):
    headers = {"authorization": "Bearer " + token, "content-type": "application/json"}
    if apikey:
        headers["apikey"] = apikey
    req = urllib.request.Request(url, method=method, headers=headers,
                                 data=None if body is None else json.dumps(body).encode())
    try:
        response = OPENER.open(req, timeout=60)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        status, raw = response.status, response.read(2_500_000)
    try:
        value = json.loads(raw) if raw else None
    except ValueError:
        value = None
    return status, value, hashlib.sha256(raw).hexdigest()

def run():
    management = os.environ["SANDY_SUPABASE_MANAGEMENT_TOKEN"]
    report = {"project_ref": PROJECT, "normal_password_session": False,
              "owner_membership_created": False, "credentials_persisted": False, "tests": []}
    user_id = token = service = anon = None

    def sql(query):
        status, value, _ = request("POST", MANAGEMENT + "/database/query", management,
                                   body={"query": query, "read_only": True})
        if status not in (200, 201):
            raise RuntimeError("fixture_metadata_query_failed")
        return value

    try:
        status, keys, _ = request("GET", MANAGEMENT + "/api-keys", management)
        assert status == 200
        service = next(x["api_key"] for x in keys if x["name"] == "service_role")
        anon = next(x["api_key"] for x in keys if x["name"] == "anon")
        rows = sql("SELECT n.nspname schema_name,c.relname table_name,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) definition,pg_get_functiondef(t.tgfoid) function_source FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND (n.nspname='auth' AND c.relname='users' OR n.nspname='public' AND c.relname IN('email_customers','email_customer_addresses','sandy_memory_settings','sandy_memory_portal_accounts')) ORDER BY n.nspname,c.relname,t.tgname")
        fields = ["schema_name", "table_name", "tgname", "tgenabled", "definition", "function_source"]
        digest = hashlib.sha256(json.dumps(sorted(tuple(x[k] for k in fields) for x in rows),
                                          separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
        assert digest == REVIEWED_TRIGGERS, "fixture_trigger_drift"
        email = "sandy-engineering-boundary-" + str(uuid.uuid4()) + "@example.invalid"
        password = secrets.token_urlsafe(42)
        status, value, _ = request("POST", BASE + "/auth/v1/admin/users", service, service,
                                   {"email": email, "password": password, "email_confirm": True,
                                    "user_metadata": {"sandy_api_isolated_session_test": True}})
        assert status in (200, 201) and value.get("id")
        user_id = value["id"]
        assert sql(f"SELECT count(*) members FROM public.sandy_controller_admins WHERE auth_user_id='{user_id}'") == [{"members": 0}]
        status, value, _ = request("POST", BASE + "/auth/v1/token?grant_type=password", anon, anon,
                                   {"email": email, "password": password})
        password = None
        assert status == 200 and value.get("user", {}).get("role") == "authenticated"
        token = value["access_token"]
        report["normal_password_session"] = True
        for operation in OPERATIONS:
            status, value, digest = request("POST", BASE + "/functions/v1/sandy-api-mcp", token, anon,
                {"jsonrpc": "2.0", "id": str(uuid.uuid4()), "method": "tools/call",
                 "params": {"name": operation, "arguments": {}}})
            result = value.get("result", {}) if isinstance(value, dict) else {}
            envelope = json.loads(result.get("content", [{}])[0].get("text", "{}"))
            passed = (status == 200 and result.get("isError") is True and envelope.get("status") == 403
                      and envelope.get("result", {}).get("error") == "controller_administrator_required")
            report["tests"].append({"operation": operation, "http": status, "api_http": envelope.get("status"),
                "api_error": envelope.get("result", {}).get("error"), "passed": passed,
                "response_sha256": digest})
    except Exception as error:
        report["error_type"] = type(error).__name__
    finally:
        if token:
            report["logout_http"] = request("POST", BASE + "/auth/v1/logout?scope=global", token, anon)[0]
        if user_id:
            report["delete_user_http"] = request("DELETE", BASE + "/auth/v1/admin/users/" + user_id, service, service)[0]
            report["cleanup_readback"] = sql(f"SELECT (SELECT count(*) FROM auth.users WHERE id='{user_id}') auth_users,(SELECT count(*) FROM auth.sessions WHERE user_id='{user_id}') auth_sessions,(SELECT count(*) FROM public.sandy_controller_admins WHERE auth_user_id='{user_id}') controller_memberships,(SELECT count(*) FROM public.sandy_memory_portal_accounts WHERE auth_user_id='{user_id}') portal_accounts")
    report["passed"] = sum(x["passed"] for x in report["tests"])
    report["failed"] = sum(not x["passed"] for x in report["tests"])
    report["complete"] = (report["passed"] == len(OPERATIONS) and report["failed"] == 0
        and not report.get("error_type") and report.get("logout_http") == 204
        and report.get("delete_user_http") == 200
        and all(v == 0 for v in report.get("cleanup_readback", [{}])[0].values()))
    return report

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    report = run()
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: report[k] for k in ["passed", "failed", "complete"]}))
    raise SystemExit(0 if report["complete"] else 1)
