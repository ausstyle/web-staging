"""Restore checksum-pinned official provider schemas without credentials or registry writes."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
from typing import Callable
import urllib.request


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=60) as response:
        data = response.read(40 * 1024 * 1024 + 1)
        if len(data) > 40 * 1024 * 1024:
            raise ValueError("Provider schema exceeds size limit")
        return data


def restore(manifest: list[dict], output: Path, transport: Callable[[str], bytes] = fetch) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    restored, unavailable = [], []
    for row in manifest:
        name = row["provider"]
        if not re.fullmatch(r"github|supabase|gcp-[a-z0-9]+", name):
            raise ValueError("Invalid provider filename")
        if row.get("state") != "downloaded":
            unavailable.append(name)
            continue
        url = row["source"]
        if not re.fullmatch(r"https://raw\.githubusercontent\.com/(?:googleapis|github|supabase)/[A-Za-z0-9_.-]+/[a-f0-9]{40}/[^?#]+", url):
            raise ValueError("Provider schema source is not an official commit-pinned URL")
        path = output / (name + ".json")
        raw = path.read_bytes() if path.is_file() else transport(url)
        if hashlib.sha256(raw).hexdigest() != row["sha256"]:
            raise ValueError("Provider schema checksum mismatch: " + name)
        json.loads(raw)
        if not path.exists():
            path.write_bytes(raw)
        restored.append(name)
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return {"restored": restored, "unavailable": unavailable, "complete": not unavailable}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path("docs/sandy-api/provider-schema-manifest.json"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = restore(json.loads(args.manifest.read_text()), args.output)
    print(json.dumps(result))
    if not result["complete"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
