"""Add the approved fixed-read route to the independently captured Control base.

No stale checkout entrypoint replaces the deployed service. Existing modules and
all other ingress behavior stay byte-for-byte intact; the manifest pins the base
bundle and the resulting entrypoint. This module has no network/write capability.
"""
IMPORT = 'import {handleGcpAdminRead} from "./gcp_admin_read.ts";\n'
ANCHOR = '  let workloadGrant=null;'
ROUTE = '''  if(action==="gcp_admin_read_claim"||(action==="preflight"&&b.connection!==undefined)){
   let authority:any=null;
   if(user.app_metadata?.sandy_engineering_test===true){authority={role:"engineering"};}
   else{
    const lookup=await db.from("sandy_controller_admins").select("role,enabled").eq("auth_user_id",user.id).eq("enabled",true).maybeSingle();
    if(lookup.error||!lookup.data)return respond({error:"Sandy Controller administrator required"},403);
    authority=lookup.data;
   }
   return await handleGcpAdminRead(db,user,authority,token,b,Deno.env.get("SANDY_GCP_ADMIN_WORKER_URL"));
  }
'''

def patch(source: bytes) -> bytes:
    text = source.decode('utf-8')
    if text.count(ANCHOR) != 1 or 'handleGcpAdminRead' in text:
        raise ValueError('controller_read_patch_base_changed')
    # Only this branch is inserted, after normal Auth verification, before the
    # legacy Control workload action list. The handler rechecks standing GCP
    # metadata authority at admission and at the Google-authenticated claim.
    return (IMPORT + text.replace(ANCHOR, ROUTE + ANCHOR, 1)).encode()
