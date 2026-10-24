#!/usr/bin/env python3
"""Non-mutating Google IAP/OS Login diagnostic for the one Sandy worker VM.

Uses credentials supplied by an authorized Google Cloud execution environment.
No grant is created, no policy content or credential is printed or saved.
"""
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

PROJECT = "elaborate-haven-511518-a5"
PROJECT_NUMBER = "1030223524306"
ZONE = "europe-west1-b"
INSTANCE = "sandy-deploy"
INSTANCE_ID = "1940793259055617677"
ATTACHED_SA = "sandy-vm-runtime@" + PROJECT + ".iam.gserviceaccount.com"
ACTOR = "serviceAccount:sandy-computer@" + PROJECT + ".iam.gserviceaccount.com"
URL_VM = f"https://compute.googleapis.com/compute/v1/projects/{PROJECT}/zones/{ZONE}/instances/{INSTANCE}"
URL_PROJECT = f"https://compute.googleapis.com/compute/v1/projects/{PROJECT}"
URL_IAP = (f"https://iap.googleapis.com/v1/projects/{PROJECT_NUMBER}/iap_tunnel"
           f"/zones/{ZONE}/instances/{INSTANCE_ID}:getIamPolicy")

def access_token():
    p = subprocess.run(["gcloud", "auth", "print-access-token"], check=True,
                       capture_output=True, text=True, timeout=20)
    token = p.stdout.strip()
    if not token or len(token) > 6000:
        raise RuntimeError("token_unavailable")
    return token

def request(url, token, body=None):
    args = dict(headers={"Authorization": "Bearer " + token,
                         "Accept": "application/json"},
                method="POST" if body is not None else "GET", timeout=20)
    if body is not None:
        args["headers"]["Content-Type"] = "application/json"
        args["data"] = json.dumps(body, separators=(",", ":")).encode()
    req = urllib.request.Request(url, **{k:v for k,v in args.items() if k != "timeout"})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=20) as resp:
            data = resp.read(262144)
            if resp.status != 200 or len(data) >= 262144:
                raise RuntimeError("provider_response_invalid")
            obj = json.loads(data)
            if not isinstance(obj, dict):
                raise RuntimeError("provider_response_invalid")
            return obj, 200
    except urllib.error.HTTPError as exc:
        return None, exc.code

def metadata_flag(obj, key):
    metadata = obj.get("metadata", {}) if isinstance(obj, dict) else {}
    items = metadata.get("items", []) if isinstance(metadata, dict) else []
    for entry in items if isinstance(items, list) else []:
        if isinstance(entry, dict) and entry.get("key") == key:
            return str(entry.get("value", "")).strip().upper()
    return None

def summarise_instance(vm, project):
    if (vm.get("name") != INSTANCE or str(vm.get("id")) != INSTANCE_ID
            or vm.get("status") != "RUNNING"
            or not str(vm.get("zone", "")).endswith("/" + ZONE)):
        raise RuntimeError("immutable_vm_identity_or_state_mismatch")
    sa = vm.get("serviceAccounts")
    if not isinstance(sa, list) or len(sa) != 1 or sa[0].get("email") != ATTACHED_SA:
        raise RuntimeError("attached_service_account_mismatch")
    networks = vm.get("networkInterfaces", [])
    if not isinstance(networks, list) or len(networks) != 1:
        raise RuntimeError("unexpected_vm_network")
    external_ip = bool(networks[0].get("accessConfigs"))
    local = metadata_flag(vm, "enable-oslogin")
    common = metadata_flag(project, "enable-oslogin")
    effective = local if local is not None else common
    return {"instance_identity_confirmed": True,
            "running": True, "no_external_ip": not external_ip,
            "attached_service_account_confirmed": True,
            "instance_oslogin_metadata": local, "project_oslogin_metadata": common,
            "effective_oslogin_enabled": effective == "TRUE",
            "metadata_ssh_login_must_not_be_changed": effective != "TRUE"}

def summarise_iap(policy):
    exact = []
    for binding in policy.get("bindings", []):
        if not isinstance(binding, dict):
            raise RuntimeError("unexpected_iap_policy")
        if (binding.get("role") == "roles/iap.tunnelResourceAccessor"
                and ACTOR in binding.get("members", [])):
            exact.append({"condition": binding.get("condition", {}).get("expression")
                          if isinstance(binding.get("condition"), dict) else None})
    return {"iap_policy_read": True, "etag_present": bool(policy.get("etag")),
            "existing_actor_bindings": exact}

def main():
    if len(sys.argv) != 1:
        raise RuntimeError("no_arguments_allowed")
    result = {"target": INSTANCE, "instance_id": INSTANCE_ID,
              "project": PROJECT, "zone": ZONE, "mutations": 0}
    try:
        token = access_token()
        vm, status = request(URL_VM, token)
        result["vm_http"] = status
        if status != 200:
            raise RuntimeError("compute_instance_read_denied_or_unavailable")
        project, status = request(URL_PROJECT, token)
        result["project_http"] = status
        if status != 200:
            raise RuntimeError("project_metadata_read_denied_or_unavailable")
        result.update(summarise_instance(vm, project))
        policy, status = request(URL_IAP, token,
                                 {"options": {"requestedPolicyVersion": 3}})
        result["iap_http"] = status
        if status != 200:
            raise RuntimeError("iap_policy_read_denied_or_unavailable")
        result.update(summarise_iap(policy))
        result["ok"] = True
    except Exception as exc:
        # Preserve only our own known non-sensitive error code.
        result["ok"] = False
        safe = str(exc)
        result["error"] = safe if safe in {
            "no_arguments_allowed", "token_unavailable",
            "provider_response_invalid", "immutable_vm_identity_or_state_mismatch",
            "attached_service_account_mismatch", "unexpected_vm_network",
            "unexpected_iap_policy", "compute_instance_read_denied_or_unavailable",
            "project_metadata_read_denied_or_unavailable",
            "iap_policy_read_denied_or_unavailable"} else "diagnostic_unavailable"
    print(json.dumps(result, separators=(",", ":"), sort_keys=True))
    if "GITHUB_OUTPUT" in os.environ:
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as out:
            out.write("ready=" + str(result.get("ok") is True).lower() + "\n")
    return 0 if result.get("ok") else 1

if __name__ == "__main__":
    raise SystemExit(main())
