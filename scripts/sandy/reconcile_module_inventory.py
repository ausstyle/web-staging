#!/usr/bin/env python3
"""Fail-closed Sandy deployed-function inventory reconciler.

Requires SUPABASE_ACCESS_TOKEN and SUPABASE_SERVICE_ROLE_KEY in GitHub Actions Secrets.
Service-role key is only used by this trusted server-side job; never exposed to browser clients.
"""
import json, os, sys, urllib.request, urllib.error
PROJECT="zmqlyygzqoidkcwdysok"
BASE=f"https://{PROJECT}.supabase.co"
def request(url,headers,method="GET",body=None):
    payload=json.dumps(body).encode() if body is not None else None
    req=urllib.request.Request(url,data=payload,headers=headers,method=method)
    with urllib.request.urlopen(req,timeout=25) as response:
        return json.loads(response.read() or b"null")
def main():
    pat=os.getenv("SUPABASE_ACCESS_TOKEN","").strip()
    role=os.getenv("SUPABASE_SERVICE_ROLE_KEY","").strip()
    if not pat or not role:
        raise RuntimeError("Inventory sync BLOCKED: SUPABASE_ACCESS_TOKEN and SUPABASE_SERVICE_ROLE_KEY are required as repository secrets")
    deployments=request(f"https://api.supabase.com/v1/projects/{PROJECT}/functions",{"Authorization":f"Bearer {pat}","Accept":"application/json"})
    if not isinstance(deployments,list) or len(deployments)<20:
        raise RuntimeError("Inventory sync BLOCKED: management API response unexpectedly small/invalid")
    observed=[]
    for f in deployments:
        slug=f.get("slug")
        version=f.get("version")
        if not slug or version is None:
            raise RuntimeError("Inventory sync BLOCKED: incomplete deployment metadata")
        observed.append({"module_key":slug,"deployment_state":str(f.get("status","unknown")),
                         "deployed_version":str(version),"observed_at":None})
    headers={"apikey":role,"Authorization":f"Bearer {role}","Content-Type":"application/json"}
    # Reconcile with an existing registry record only; never implicitly authorize a new module.
    current=request(BASE+"/rest/v1/sandy_module_status?select=module_key,deployed_version",headers)
    by_key={m["module_key"]:m["deployed_version"] for m in current}
    if not by_key:
        raise RuntimeError("Inventory sync BLOCKED: registry is empty")
    changed=0
    for f in observed:
        slug=f["module_key"]
        if slug not in by_key:
            print("New unregistered module (requires cataloguing):",slug)
            continue
        new_ver=f["deployed_version"]
        patch={"deployed_version":new_ver,"deployment_state":f["deployment_state"],
               "observed_at":__import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()}
        if by_key[slug]!=new_ver:
            patch.update({"operational_status":"unverified","last_tested_at":None,
                          "evidence":None,"evidence_source":None,"evidence_id":None})
            changed+=1
        from urllib.parse import quote
        request(BASE+"/rest/v1/sandy_module_status?module_key=eq."+quote(slug,safe=""),
                {**headers,"Prefer":"return=minimal"},"PATCH",patch)
    print(json.dumps({"deployment_inventory_count":len(observed),"registered_count":len(by_key),"versions_changed":changed,"succeeded":True}))
if __name__=="__main__":
    try: main()
    except Exception as exc:
        print(str(exc),file=sys.stderr)
        sys.exit(1)
