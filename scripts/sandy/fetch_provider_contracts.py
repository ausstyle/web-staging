"""Restore checksum-pinned official provider schemas without credentials or registry writes."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
from typing import Callable
import urllib.request
import urllib.parse


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=60) as response:
        data = response.read(40 * 1024 * 1024 + 1)
        if len(data) > 40 * 1024 * 1024:
            raise ValueError("Provider schema exceeds size limit")
        return data


def _validate_location(source: dict, filename: str, contract_format: str) -> None:
    suffix = {"json": ".json", "protobuf": ".proto"}.get(contract_format)
    if suffix is None or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", filename) or not filename.endswith(suffix):
        raise ValueError("Invalid provider contract filename or format")
    url = source.get("source", "")
    if not isinstance(url, str) or not re.fullmatch(r"https://raw\.githubusercontent\.com/(?:googleapis|github|supabase)/[A-Za-z0-9_.-]+/[a-f0-9]{40}/[^\s?#]+", url):
        raise ValueError("Provider schema source is not an official commit-pinned URL")
    if "%" in url or any(part in {".", ".."} for part in urllib.parse.urlsplit(url).path.split("/")):
        raise ValueError("Ambiguous provider contract source path")
    if not isinstance(source.get("sha256"), str) or not re.fullmatch(r"[a-f0-9]{64}", source["sha256"]):
        raise ValueError("Invalid provider contract checksum")
    if contract_format == "protobuf" and (type(source.get("bytes")) is not int or source["bytes"] < 1):
        raise ValueError("Supplemental provider contract requires an exact byte count")


def _validate_content(source: dict, raw: bytes, name: str, contract_format: str) -> None:
    if not isinstance(raw, bytes) or len(raw) > 40 * 1024 * 1024:
        raise ValueError("Provider schema exceeds size limit")
    if hashlib.sha256(raw).hexdigest() != source["sha256"]:
        raise ValueError("Provider schema checksum mismatch: " + name)
    if "bytes" in source and source["bytes"] != len(raw):
        raise ValueError("Provider contract byte count mismatch: " + name)
    if contract_format == "json":
        json.loads(raw)
    else:
        text = raw.decode("utf-8")
        if not re.search(r'^\s*syntax\s*=\s*"proto3"\s*;', text, re.M) or not re.search(r"^\s*package\s+[A-Za-z_][A-Za-z0-9_.]*\s*;", text, re.M):
            raise ValueError("Supplemental contract is not a proto3 document: " + name)


def read_cached_contract(source: dict, output: Path, filename: str, contract_format: str = "json") -> bytes:
    """Read verified bytes only; inventory must never fetch an absent cache file."""
    _validate_location(source, filename, contract_format)
    path = output / filename
    if path.is_symlink():
        raise ValueError("Provider contract cache must not be a symlink")
    if path.exists() and not path.is_file():
        raise ValueError("Provider contract cache must be a regular file")
    raw = path.read_bytes()
    _validate_content(source, raw, filename, contract_format)
    return raw


def _restore_contract(source: dict, output: Path, filename: str, contract_format: str,
                      transport: Callable[[str], bytes]) -> None:
    _validate_location(source, filename, contract_format)
    path = output / filename
    if path.is_symlink():
        raise ValueError("Provider contract cache must not be a symlink")
    if path.exists() and not path.is_file():
        raise ValueError("Provider contract cache must be a regular file")
    raw = path.read_bytes() if path.is_file() else transport(source["source"])
    _validate_content(source, raw, filename, contract_format)
    if not path.exists():
        path.write_bytes(raw)


def restore(manifest: list[dict], output: Path, transport: Callable[[str], bytes] = fetch) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    restored, unavailable, supplemental = [], [], []
    filenames: set[str] = set()
    for row in manifest:
        name = row["provider"]
        if not re.fullmatch(r"github|supabase|gcp-[a-z0-9]+", name):
            raise ValueError("Invalid provider filename")
        if row.get("state") == "downloaded":
            filename = name + ".json"
            if filename in filenames:
                raise ValueError("Provider contract cache filename collision")
            filenames.add(filename)
            _restore_contract(row, output, filename, "json", transport)
            restored.append(name)
        else:
            unavailable.append(name)
        for source in row.get("alternative_contract_sources", []):
            filename = source.get("cache_file", "")
            if source.get("format") != "protobuf" or not isinstance(filename, str) or not filename.startswith(name + "-"):
                raise ValueError("Unsupported supplemental provider contract")
            if filename in filenames:
                raise ValueError("Provider contract cache filename collision")
            filenames.add(filename)
            _restore_contract(source, output, filename, "protobuf", transport)
            supplemental.append(filename)
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return {"restored": restored, "restored_supplemental": supplemental,
            "unavailable": unavailable, "complete": not unavailable}


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
