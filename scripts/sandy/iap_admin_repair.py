"""Fixed-target IAP repair through a selected, configured GCP administrator.

Plan first, then apply exactly that saved plan after fresh policy/etag readback.
The sandy-gcp-admin alias uses only the owner-authorized, keyless runtime-to-admin
impersonation chain. No fallback identity, public address or host/network changes.
"""
from __future__ import annotations
import argparse
import copy
import datetime
import hashlib
import json
import os
from pathlib import Path
import ssl
import urllib.error
import urllib.request

PROJECT = "elaborate-haven-511518-a5"
NUMBER = "1030223524306"
ZONE = "europe-west1-b"
MEMBER = "serviceAccount:sandy-computer@elaborate-haven-511518-a5.iam.gserviceaccount.com"
TARGETS = {"sandy-video": ("6831598645020395570", 22), "sandy-windows": ("8120150462304566315", 5986)}
ROLE = "roles/iap.tunnelResourceAccessor"
ADMIN_ALIAS = "sandy-gcp-admin"
RUNTIME_ACCOUNT = "sandy-mcp-runtime@" + PROJECT + ".iam.gserviceaccount.com"
ADMIN_ACCOUNT = "sandy-cloud-administrator@" + PROJECT + ".iam.gserviceaccount.com"
TOKEN_LIFETIME = 1800


class RepairError(RuntimeError):
    pass


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def candidate(policy, name):
    """Never rewrite another binding or guess how an existing condition works."""
    if name not in TARGETS or not isinstance(policy, dict) or not policy.get("etag"):
        raise RepairError("target_policy_etag_required")
    if set(policy) - {"version", "etag", "bindings", "auditConfigs"}:
        raise RepairError("unreviewed_policy_fields")
    bindings = policy.get("bindings", [])
    if not isinstance(bindings, list):
        raise RepairError("invalid_policy_bindings")
    _, port = TARGETS[name]
    expression = f"destination.port == {port}"
    expected = {"role": ROLE, "members": [MEMBER], "condition": {
        "title": "sandy-fixed-" + name + "-port-" + str(port),
        "description": "Authorized Sandy access to this immutable VM and port only",
        "expression": expression}}
    for binding in bindings:
        if not isinstance(binding, dict) or not isinstance(binding.get("members", []), list):
            raise RepairError("invalid_policy_binding")
        if binding.get("role") != ROLE or MEMBER not in binding.get("members", []):
            continue
        condition = binding.get("condition")
        if isinstance(condition, dict) and condition.get("expression") == expression:
            return copy.deepcopy(policy), False
        # An unconditional grant cannot explain a missing target binding. A
        # different condition may deliberately restrict access; do not bypass it.
        raise RepairError("existing_principal_binding_requires_administrator_review")
    result = copy.deepcopy(policy)
    result["version"] = 3
    result["bindings"] = copy.deepcopy(bindings) + [expected]
    return result, True


def connection_env(alias, manifest):
    if not isinstance(manifest, dict) or manifest.get("version") != 1:
        raise RepairError("supported_identity_manifest_required")
    matches = [c for c in manifest.get("connections", []) if c.get("alias") == alias]
    if len(matches) != 1 or matches[0].get("provider_kind") != "gcp":
        raise RepairError("configured_GCP_administrator_connection_required")
    connection = matches[0]
    required = ("config_dir", "configuration_name", "credentials_file")
    if not all(isinstance(connection.get(k), str) and connection[k] for k in required):
        raise RepairError("GCP_connection_selectors_incomplete")
    env = dict(os.environ)
    for key, field in [("CLOUDSDK_CONFIG", "config_dir"), ("CLOUDSDK_ACTIVE_CONFIG_NAME", "configuration_name"), ("GOOGLE_APPLICATION_CREDENTIALS", "credentials_file")]:
        env[key] = connection[field]
    return env


def impersonation_credentials(credentials, factory):
    """Inspect SDK identity metadata only; never read a key or credential file."""
    principal = getattr(credentials, "service_account_email", None)
    source = credentials
    if principal == ADMIN_ACCOUNT:
        # Google's impersonated ADC has no public source-credential accessor.
        # Inspect only its identity/type; never inspect a token or signer value.
        if type(credentials).__module__ != "google.auth.impersonated_credentials":
            raise RepairError("keyless_runtime_impersonation_chain_required")
        source = getattr(credentials, "_source_credentials", None)
    if getattr(source, "service_account_email", None) != RUNTIME_ACCOUNT:
        raise RepairError("authorized_MCP_runtime_source_required")
    if type(source).__module__ not in {
        "google.auth.compute_engine.credentials", "google.auth.identity_pool",
        "google.auth.aws", "google.auth.external_account", "google.auth.pluggable",
        "google.auth.impersonated_credentials",
    }:
        raise RepairError("keyless_runtime_source_required")
    # An existing impersonated runtime ADC must also originate from federation
    # or metadata, rather than a service-account key or personal refresh session.
    leaf = source
    for _ in range(8):
        if type(leaf).__module__ != "google.auth.impersonated_credentials":
            break
        leaf = getattr(leaf, "_source_credentials", None)
    if type(leaf).__module__ not in {
        "google.auth.compute_engine.credentials", "google.auth.identity_pool",
        "google.auth.aws", "google.auth.external_account", "google.auth.pluggable",
    }:
        raise RepairError("keyless_runtime_source_required")
    if principal == ADMIN_ACCOUNT:
        return credentials
    return factory(source_credentials=source, target_principal=ADMIN_ACCOUNT,
        target_scopes=["https://www.googleapis.com/auth/cloud-platform"],
        lifetime=TOKEN_LIFETIME)


class Admin:
    def __init__(self, alias):
        manifest = os.environ.get("OIC_MANIFEST_PATH")
        if not manifest:
            raise RepairError("configured_GCP_administrator_connection_required")
        env = connection_env(alias, json.loads(Path(manifest).read_text()))
        self.alias = alias
        self.receipts = []
        self.policy_write_dispatched = False
        # Use the configured ADC selector through Google's supported SDK.
        # Credentials stay inside the SDK; no gcloud installation, login,
        # fallback account or exported credential is required. The named alias
        # adds only the exact runtime-to-administrator impersonation below.
        try:
            import google.auth
            from google.auth.transport.requests import Request
            import requests
            for key in ("CLOUDSDK_CONFIG", "CLOUDSDK_ACTIVE_CONFIG_NAME", "GOOGLE_APPLICATION_CREDENTIALS"):
                os.environ[key] = env[key]
            session = requests.Session()
            trust = ssl.get_default_verify_paths().cafile
            if trust:
                session.verify = trust
            self._auth_request = Request(session=session)
            self._credentials, _ = google.auth.load_credentials_from_file(
                env["GOOGLE_APPLICATION_CREDENTIALS"],
                scopes=["https://www.googleapis.com/auth/cloud-platform"],
                request=self._auth_request)
            if alias == ADMIN_ALIAS:
                from google.auth.impersonated_credentials import Credentials
                self._credentials = impersonation_credentials(self._credentials, Credentials)
            self.principal = getattr(self._credentials, "service_account_email", None) or getattr(self._credentials, "account", None)
            if not isinstance(self.principal, str) or "@" not in self.principal or len(self.principal) > 320:
                raise RepairError("GCP_administrator_principal_unavailable")
            if self.principal == MEMBER.split(":", 1)[1]:
                raise RepairError("separate_GCP_administrator_identity_required")
        except RepairError:
            raise
        except Exception:
            raise RepairError("GCP_administrator_SDK_setup_unavailable") from None

    def refresh_identity(self):
        if self.alias != ADMIN_ALIAS or self.principal != ADMIN_ACCOUNT:
            raise RepairError("authorized_administrator_alias_and_principal_required")
        try:
            self._credentials.refresh(self._auth_request)
            expiry = self._credentials.expiry
            if not isinstance(expiry, datetime.datetime):
                raise ValueError()
            if expiry.tzinfo is None:expiry = expiry.replace(tzinfo=datetime.timezone.utc)
            remaining = (expiry - datetime.datetime.now(datetime.timezone.utc)).total_seconds()
            if not 60 < remaining <= 3610:
                raise ValueError()
            return {"issuance_verified": True, "mechanism": "google_auth_keyless_impersonation",
                "source_principal": RUNTIME_ACCOUNT, "target_principal": self.principal,
                "expires_at": expiry.isoformat(), "remaining_seconds": int(remaining),
                "token_recorded": False, "keys_created": 0}
        except Exception:
            raise RepairError("keyless_administrator_token_issuance_unavailable") from None

    def request(self, method, url, body=None):
        # Every URL is constructed from fixed constants in this module.
        headers = {"Content-Type": "application/json"}
        try:
            self._credentials.before_request(self._auth_request, method, url, headers)
        except Exception:
            raise RepairError("GCP_administrator_token_renewal_unavailable") from None
        request = urllib.request.Request(url, method=method,
            headers=headers,
            data=None if body is None else json.dumps(body).encode())
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None
        try:
            if method == "POST" and url.endswith(":setIamPolicy"):
                self.policy_write_dispatched = True
            with urllib.request.build_opener(NoRedirect()).open(request, timeout=30) as response:
                data = response.read(262145)
                if len(data) > 262144:
                    raise RepairError("administrator_response_limit")
                self.receipts.append({"method": method, "endpoint": url,
                    "http_status": response.status, "response_sha256": hashlib.sha256(data).hexdigest()})
                return json.loads(data)
        except urllib.error.HTTPError as error:
            # Error bodies may contain credential material; expose status only.
            self.receipts.append({"method": method, "endpoint": url, "http_status": error.code})
            raise RepairError("administrator_request_HTTP_" + str(error.code)) from None
        except (OSError, ValueError):
            raise RepairError("administrator_request_unavailable") from None

    def identity(self, name):
        value = self.request("GET", f"https://compute.googleapis.com/compute/v1/projects/{PROJECT}/zones/{ZONE}/instances/{name}")
        if str(value.get("id")) != TARGETS[name][0] or value.get("name") != name:
            raise RepairError("immutable_VM_identity_changed")

    def url(self, name):
        return f"https://iap.googleapis.com/v1/projects/{NUMBER}/iap_tunnel/zones/{ZONE}/instances/{TARGETS[name][0]}"

    def policy(self, name):
        return self.request("POST", self.url(name) + ":getIamPolicy", {"options": {"requestedPolicyVersion": 3}})


def verify_administrator(admin):
    """Provider reads only. Role names are evidence, not assumed permissions."""
    issuance = admin.refresh_identity()
    service = admin.request("GET", f"https://run.googleapis.com/v2/projects/{PROJECT}/locations/europe-west1/services/sandy-engineering-mcp")
    actual_runtime = service.get("template", {}).get("serviceAccount")
    if actual_runtime != RUNTIME_ACCOUNT:
        raise RepairError("deployed_MCP_runtime_identity_mismatch")
    account_url = f"https://iam.googleapis.com/v1/projects/{PROJECT}/serviceAccounts/{ADMIN_ACCOUNT}"
    account = admin.request("GET", account_url)
    if account.get("email") != ADMIN_ACCOUNT or account.get("disabled", False) is not False:
        raise RepairError("enabled_administrator_account_required")
    service_policy = admin.request("GET", account_url + ":getIamPolicy?options.requestedPolicyVersion=3")
    direct = [b for b in service_policy.get("bindings", []) if b.get("role") == "roles/iam.serviceAccountTokenCreator" and "serviceAccount:" + RUNTIME_ACCOUNT in b.get("members", [])]
    if not direct:
        raise RepairError("direct_runtime_token_creator_binding_not_verified")
    project_policy = admin.request("POST", f"https://cloudresourcemanager.googleapis.com/v1/projects/{PROJECT}:getIamPolicy", {"options": {"requestedPolicyVersion": 3}})
    roles = [{"role": b.get("role"), "condition": b.get("condition")} for b in project_policy.get("bindings", []) if "serviceAccount:" + ADMIN_ACCOUNT in b.get("members", [])]
    targets = []
    required = ["iap.tunnelInstances.getIamPolicy", "iap.tunnelInstances.setIamPolicy"]
    for name, (instance, port) in TARGETS.items():
        admin.identity(name)
        permissions = admin.request("POST", admin.url(name) + ":testIamPermissions", {"permissions": required})
        policy = admin.policy(name)
        targets.append({"vm_name": name, "instance_id": instance, "port": port,
            "etag": policy.get("etag"), "policy_sha256": digest(policy), "policy_version": policy.get("version", 1),
            "binding_count": len(policy.get("bindings", [])),
            "target_member_bindings": [{"role": b.get("role"), "condition": b.get("condition")} for b in policy.get("bindings", []) if MEMBER in b.get("members", [])],
            "effective_permissions": [p for p in permissions.get("permissions", []) if p in required],
            "missing_permissions": [p for p in required if p not in permissions.get("permissions", [])]})
    return {"ok": all(not t["missing_permissions"] and t["etag"] for t in targets),
        "read_only": True, "administrator_alias": admin.alias, "administrator_principal": admin.principal,
        "deployed_runtime_identity": actual_runtime, "latest_ready_revision": service.get("latestReadyRevision"),
        "administrator_enabled": True, "token_issuance": issuance,
        "direct_token_creator_binding_verified": True, "service_account_policy_etag": service_policy.get("etag"),
        "observed_project_role_bindings": roles, "project_policy_etag": project_policy.get("etag"),
        "inherited_roles_enumerated": False, "targets": targets, "provider_receipts": admin.receipts,
        "IAM_changes": 0, "agents_enrolled": 0, "software_installed": 0}


def plan(admin, name):
    if name not in TARGETS:
        raise RepairError("fixed_target_required")
    admin.identity(name)
    before = admin.policy(name)
    after, changed = candidate(before, name)
    return {"schema": "sandy-fixed-IAP-repair-v1", "administrator_alias": admin.alias,
        "administrator_principal": admin.principal, "project": PROJECT, "vm_name": name,
        "instance_id": TARGETS[name][0], "port": TARGETS[name][1], "member": MEMBER,
        "before": before, "before_sha256": digest(before), "candidate": after,
        "candidate_sha256": digest(after), "change_required": changed}


def apply(admin, saved, evidence_path):
    name = saved.get("vm_name")
    if name not in TARGETS or saved.get("schema") != "sandy-fixed-IAP-repair-v1":
        raise RepairError("reviewed_fixed_target_plan_required")
    if evidence_path.exists():
        raise RepairError("existing_attempt_reconcile_before_retry")
    if admin.alias == ADMIN_ALIAS and not verify_administrator(admin)["ok"]:
        raise RepairError("administrator_effective_IAP_permissions_required")
    # Fresh full readback also checks administrator identity and immutable VM.
    fresh = plan(admin, name)
    if fresh != saved:
        raise RepairError("administrator_or_policy_preimage_changed")
    evidence = {"plan_sha256": digest(saved), "administrator": admin.principal,
                "vm_name": name, "instance_id": saved["instance_id"], "port": saved["port"],
                "attempted": False, "outcome": "not_started", "rollback_policy": saved["before"]}
    evidence_path.write_text(json.dumps(evidence, indent=2) + "\n")
    evidence_path.chmod(0o600)
    if saved["change_required"]:
        evidence.update(attempted=True, outcome="unknown_reconcile_before_retry")
        evidence_path.write_text(json.dumps(evidence, indent=2) + "\n")
        admin.request("POST", admin.url(name) + ":setIamPolicy", {"policy": saved["candidate"]})
    observed = admin.policy(name)
    # etag legitimately changes, all other fields must match the exact candidate.
    if {k:v for k,v in observed.items() if k != "etag"} != {k:v for k,v in saved["candidate"].items() if k != "etag"}:
        raise RepairError("IAP_policy_readback_requires_reconciliation")
    evidence.update(outcome="policy_readback_verified", observed_policy=observed,
                    tunnel_execution_verified=False, host_or_network_changes=0)
    evidence_path.write_text(json.dumps(evidence, indent=2) + "\n")
    return evidence


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--administrator-alias", required=True)
    sub = parser.add_subparsers(dest="action", required=True)
    p = sub.add_parser("verify"); p.add_argument("--output", type=Path, required=True)
    p = sub.add_parser("plan"); p.add_argument("--vm", choices=TARGETS, required=True); p.add_argument("--output", type=Path, required=True)
    p = sub.add_parser("apply"); p.add_argument("--plan", type=Path, required=True); p.add_argument("--evidence", type=Path, required=True)
    args = parser.parse_args()
    admin = None
    try:
        admin = Admin(args.administrator_alias)
        if args.action == "verify":
            if args.output.exists():raise RepairError("existing_verification_requires_review")
            result = verify_administrator(admin)
            args.output.write_text(json.dumps(result, indent=2) + "\n");args.output.chmod(0o600)
            print(json.dumps({"ok": result["ok"], "read_only": True, "administrator_alias": admin.alias,
                "administrator_principal": admin.principal, "token_issuance_verified": True,
                "targets": [{"vm_name": t["vm_name"], "missing_permissions": t["missing_permissions"]} for t in result["targets"]]}))
            if not result["ok"]:raise SystemExit(1)
        elif args.action == "plan":
            if args.output.exists():
                raise RepairError("existing_plan_requires_review")
            result = plan(admin, args.vm)
            args.output.write_text(json.dumps(result, indent=2) + "\n"); args.output.chmod(0o600)
            print(json.dumps({"plan_created": True, "vm_name": args.vm, "change_required": result["change_required"], "no_mutation": True}))
        else:
            result = apply(admin, json.loads(args.plan.read_text()), args.evidence)
            print(json.dumps({"vm_name": result["vm_name"], "outcome": result["outcome"], "tunnel_execution_verified": False}))
    except RepairError as error:
        failure = {"ok": False, "error": str(error),
            "provider_receipts": getattr(admin, "receipts", []),
            "policy_write_dispatched": getattr(admin, "policy_write_dispatched", False),
            "IAM_changes": None if getattr(admin, "policy_write_dispatched", False) else 0}
        if args.action == "verify" and not args.output.exists():
            fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "w") as stream:json.dump(failure, stream, indent=2)
        print(json.dumps(failure))
        raise SystemExit(1)
