"""Manage the private, scoped engineering runtime without a personal session.

The published Management credential is used only for authorized provisioning,
Vault bootstrap delivery and credential lifecycle administration. It is never
sent to Sandy MCP as a user session. The deployed runner obtains and verifies
normal short-lived Supabase Auth sessions for its non-owner workload identity.
No command prints or persists a bootstrap key, OTP, access or refresh token.
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import secrets
import time
import urllib.error
import urllib.request
import uuid

PROJECT = "zmqlyygzqoidkcwdysok"
BASE = f"https://{PROJECT}.supabase.co"
MANAGEMENT = f"https://api.supabase.com/v1/projects/{PROJECT}"
EMAIL = "sandy-engineering-test@sandy-ai.internal"

class RuntimeErrorCode(RuntimeError):
    """Fixed codes only; never attach provider response bodies or credentials."""

class RuntimePreDispatchError(RuntimeErrorCode):
    """Bootstrap/configuration failed before any engineering MCP dispatch."""

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

class EngineeringRuntime:
    def __init__(self, management_token=None):
        self._management = management_token or os.environ["SANDY_SUPABASE_MANAGEMENT_TOKEN"]
        self._opener = urllib.request.build_opener(NoRedirect())
        self._keys = None

    def _http(self, method, url, token, body=None, apikey=None):
        headers = {"authorization": "Bearer " + token, "content-type": "application/json"}
        if apikey:
            headers["apikey"] = apikey
        req = urllib.request.Request(url, method=method, headers=headers,
            data=None if body is None else json.dumps(body).encode())
        try:
            response = self._opener.open(req, timeout=120)
        except urllib.error.HTTPError as error:
            response = error
        except (OSError, TimeoutError):
            raise RuntimeErrorCode("runtime_transport_unavailable") from None
        with response:
            status, data = response.status, response.read(2_500_001)
        if len(data) > 2_500_000:
            raise RuntimeErrorCode("runtime_response_limit")
        try:
            value = json.loads(data) if data else None
        except ValueError:
            raise RuntimeErrorCode("runtime_invalid_json") from None
        return status, value

    def _sql(self, query, read_only=False):
        status, value = self._http("POST", MANAGEMENT + "/database/query", self._management,
                                  {"query": query, "read_only": read_only})
        if status not in (200, 201):
            raise RuntimeErrorCode("runtime_administration_query_failed")
        return value

    @staticmethod
    def _quote(value):
        return "'" + str(value).replace("'", "''") + "'"

    def _rpc(self, name, *args):
        # Names are private fixed program constants, never caller-selected URLs/SQL.
        def literal(value):
            if isinstance(value, bool):
                return "true" if value else "false"
            return self._quote(value)
        rows = self._sql("SELECT public." + name + "(" + ",".join(literal(v) for v in args) + ") result")
        result = rows[0]["result"]
        if not isinstance(result, dict) or result.get("ok") is not True:
            raise RuntimeErrorCode("runtime_lifecycle_not_authorized")
        return result

    def _api_keys(self):
        if self._keys is None:
            for attempt in range(3):
                status, rows = self._http("GET", MANAGEMENT + "/api-keys", self._management)
                if status == 200:
                    break
                if status in (408, 429, 500, 502, 503, 504) and attempt < 2:
                    time.sleep(0.25 * (attempt + 1))
                    continue
                raise RuntimeErrorCode("runtime_auth_configuration_unavailable_http_" + str(status))
            if not isinstance(rows, list):
                raise RuntimeErrorCode("runtime_auth_configuration_incomplete")
            keys = {x.get("name"): x.get("api_key") for x in rows if isinstance(x, dict)}
            if not all(isinstance(keys.get(name), str) and keys[name] for name in ("anon", "service_role")):
                raise RuntimeErrorCode("runtime_auth_configuration_incomplete")
            self._keys = {name: keys[name] for name in ("anon", "service_role")}
        return self._keys

    def _auth_admin(self, method, path, body=None):
        key = self._api_keys()["service_role"]
        status, value = self._http(method, BASE + "/auth/v1/admin/" + path, key, body, key)
        if status not in (200, 201):
            raise RuntimeErrorCode("runtime_auth_administration_failed")
        return value

    def state(self):
        rows = self._sql("SELECT p.user_id,p.enabled,p.credential_epoch,p.bootstrap_generation,p.bootstrap_secret_id,"
            "p.bootstrap_rotated_at,p.rotation_state,p.revoked_at FROM public.sandy_engineering_test_identities p "
            "JOIN auth.users u ON u.id=p.user_id WHERE u.email=" + self._quote(EMAIL), True)
        if len(rows) != 1:
            raise RuntimeErrorCode("dedicated_engineering_identity_required")
        return rows[0]

    def provision(self, source_change):
        source_change = str(uuid.UUID(source_change))
        rows = self._sql("SELECT id,raw_app_meta_data FROM auth.users WHERE email=" + self._quote(EMAIL), True)
        if not rows:
            user = self._auth_admin("POST", "users", {"email": EMAIL, "email_confirm": True,
                    "app_metadata": {"sandy_engineering_test": True, "sandy_engineering_epoch": 1}})
            user_id = user["id"]
        elif len(rows) == 1 and rows[0]["raw_app_meta_data"].get("sandy_engineering_test") is True:
            user_id = rows[0]["id"]
        else:
            raise RuntimeErrorCode("dedicated_engineering_identity_conflict")
        self._rpc("sandy_engineering_provision_identity", user_id)
        self._rpc("sandy_engineering_bootstrap_identity", user_id, source_change)
        if self.state()["bootstrap_secret_id"] is None:
            self._install_key(self.state())
        return self.public_status()

    def _install_key(self, state):
        key = secrets.token_urlsafe(48)
        service = self._api_keys()["service_role"]
        status, value = self._http("POST", BASE + "/rest/v1/rpc/sandy_engineering_store_bootstrap", service,
            {"p_user_id": state["user_id"], "p_secret": key}, service)
        key = None
        if status != 200 or not isinstance(value, dict) or value.get("ok") is not True:
            raise RuntimeErrorCode("runtime_encrypted_bootstrap_store_failed")

    def rotate(self):
        state = self.state()
        result = self._rpc("sandy_engineering_rotate_identity", state["user_id"], False)
        epoch = result["credential_epoch"]
        user = self._auth_admin("GET", "users/" + state["user_id"])
        metadata = {**user.get("app_metadata", {}), "sandy_engineering_test": True, "sandy_engineering_epoch": epoch}
        self._auth_admin("PUT", "users/" + state["user_id"], {"app_metadata": metadata})
        confirmed = self._auth_admin("GET", "users/" + state["user_id"])
        if confirmed.get("app_metadata", {}).get("sandy_engineering_epoch") != epoch:
            raise RuntimeErrorCode("runtime_rotation_metadata_not_confirmed")
        self._install_key(self.state())
        self._rpc("sandy_engineering_rotate_identity", state["user_id"], True)
        return self.public_status()

    def authorize_vm_reads(self, source_change):
        source_change = str(uuid.UUID(source_change))
        self._rpc("sandy_engineering_authorize_vm_reads", self.state()["user_id"], source_change)
        return {"purpose": "sandy_video_read", "source_change_id": source_change,
                "provider_writes_authorized": False, **self.public_status()}

    def revoke_vm_reads(self):
        self._rpc("sandy_engineering_administrative_revoke_vm_reads", self.state()["user_id"])
        return {"purpose": "sandy_video_read", "optional_scope_revoked": True, **self.public_status()}

    def revoke(self):
        self._rpc("sandy_engineering_administrative_revoke", self.state()["user_id"])
        return self.public_status()

    def _bootstrap_key(self):
        state = self.state()
        if not state["enabled"] or state["revoked_at"] or state["rotation_state"] != "ready":
            raise RuntimeErrorCode("engineering_identity_not_authorized")
        service = self._api_keys()["service_role"]
        status, value = self._http("POST", BASE + "/rest/v1/rpc/sandy_engineering_runtime_bootstrap", service,
            {"p_user_id": state["user_id"]}, service)
        if status != 200 or not isinstance(value, dict) or value.get("ok") is not True or not isinstance(value.get("credential"), str):
            raise RuntimeErrorCode("runtime_bootstrap_unavailable")
        return value["credential"]

    def invoke(self, message):
        if not isinstance(message, dict):
            raise RuntimeErrorCode("invalid_runtime_message")
        # The bootstrap stays in memory; the runner never returns its user JWT.
        try:
            key = self._bootstrap_key()
            anon = self._api_keys()["anon"]
        except RuntimeErrorCode as error:
            raise RuntimePreDispatchError(str(error)) from None
        return self._http("POST", BASE + "/functions/v1/sandy-engineering-runtime", key,
                          message, anon)

    def public_status(self):
        state = self.state()
        memberships = self._sql("SELECT count(*) count FROM public.sandy_controller_admins WHERE auth_user_id=" + self._quote(state["user_id"]), True)[0]["count"]
        return {"identity_user_id": state["user_id"], "enabled": state["enabled"],
                "credential_epoch": state["credential_epoch"], "bootstrap_generation": state["bootstrap_generation"],
                "rotation_state": state["rotation_state"], "revoked": state["revoked_at"] is not None,
                "controller_memberships": memberships, "personal_controller_session_used": False}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    p = sub.add_parser("provision")
    p.add_argument("--source-change", required=True, help="Existing authenticated owner-approved engineering fixture change UUID")
    p = sub.add_parser("authorize-vm-reads")
    p.add_argument("--source-change", required=True, help="Existing authenticated owner-approved sandy-video change UUID; diagnostics only")
    for action in ("status", "rotate", "revoke", "revoke-vm-reads"):
        sub.add_parser(action)
    p = sub.add_parser("run")
    p.add_argument("--message-file", type=Path, required=True)
    args = parser.parse_args()
    try:
        runtime = EngineeringRuntime()
        if args.action == "run":
            status, result = runtime.invoke(json.loads(args.message_file.read_text()))
            print(json.dumps({"http_status": status, "result": result}))
            raise SystemExit(0 if 200 <= status < 300 else 1)
        if args.action == "authorize-vm-reads":
            print(json.dumps(runtime.authorize_vm_reads(args.source_change)))
            raise SystemExit(0)
        result = runtime.provision(args.source_change) if args.action == "provision" else runtime.public_status() if args.action == "status" else getattr(runtime, args.action.replace("-", "_"))()
        print(json.dumps(result))
    except (RuntimeErrorCode, ValueError, KeyError) as error:
        print(json.dumps({"ok": False, "error_code": str(error) if isinstance(error, RuntimeErrorCode) else "runtime_configuration_invalid"}))
        raise SystemExit(1)
