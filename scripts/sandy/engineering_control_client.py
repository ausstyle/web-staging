#!/usr/bin/env python3
"""Call governed Engineering Control through the existing renewable runtime.

Reads only the dedicated bootstrap binding or its private retained file. Normal
Auth sessions are issued/renewed inside sandy-engineering-runtime and never leave
that service. No personal Controller JWT is required or stored by this client.
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import stat
import urllib.error
import urllib.request
import uuid

ENDPOINT = "https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-engineering-runtime"
DEFAULT_CREDENTIAL = Path("/workspace/.cloud-setup/credentials/sandy-engineering-bootstrap")

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None

def bootstrap_credential(path: Path = DEFAULT_CREDENTIAL) -> str:
    credential = os.environ.get("SANDY_ENGINEERING_BOOTSTRAP", "")
    if not credential:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            metadata = os.fstat(fd)
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid() or metadata.st_mode & 0o077:
                raise RuntimeError("engineering_bootstrap_file_permissions_invalid")
            with os.fdopen(fd, "r", closefd=False) as stream:
                credential = stream.read(129).strip()
        finally:
            os.close(fd)
    if not 43 <= len(credential) <= 128 or any(c not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-" for c in credential):
        raise RuntimeError("engineering_bootstrap_binding_invalid")
    return credential

def control(body: dict, credential: str) -> tuple[int, dict]:
    message = {"jsonrpc": "2.0", "id": str(uuid.uuid4()), "method": "engineering/control", "params": body}
    request = urllib.request.Request(ENDPOINT, method="POST", headers={
        "authorization": "Bearer " + credential, "content-type": "application/json",
    }, data=json.dumps(message).encode())
    opener = urllib.request.build_opener(NoRedirect())
    try:
        result = opener.open(request, timeout=45)
    except urllib.error.HTTPError as error:
        result = error
    with result:
        raw = result.read(2300001)
        if len(raw) > 2300000:
            raise RuntimeError("engineering_control_response_too_large")
        # Defense in depth: never emit the bootstrap even if an upstream error
        # unexpectedly echoes it. This client does not receive session tokens.
        value = json.loads(raw.decode().replace(credential, "[REDACTED]"))
        return result.status, value

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("request", type=Path, help="JSON Engineering Control request; registration must include a stable idempotency_key")
    parser.add_argument("--credential-file", type=Path, default=DEFAULT_CREDENTIAL)
    args = parser.parse_args()
    try:
        body = json.loads(args.request.read_text())
        status, value = control(body, bootstrap_credential(args.credential_file))
    except (OSError, ValueError, RuntimeError):
        print(json.dumps({"ok": False, "error": "engineering_control_client_unavailable", "automatic_retry": False}))
        return 1
    print(json.dumps({"http_status": status, "response": value}))
    return 0 if 200 <= status < 300 else 1

if __name__ == "__main__":
    raise SystemExit(main())
