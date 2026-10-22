#!/usr/bin/env python3
"""Verify exact fallback candidates and preserved archived source sections.

Optionally pass --baseline-dir to verify against an authorized production source
archive. No network access or environment credentials are used.
"""
import argparse
import hashlib
import json
from pathlib import Path


def sha(source: bytes) -> str:
    return hashlib.sha256(source).hexdigest()


def fragment(source: str, start: str, end: str | None) -> str:
    if source.count(start) != 1:
        raise ValueError(f"Expected one source boundary: {start}")
    first = source.index(start)
    last = source.index(end, first) if end else len(source)
    return source[first:last]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-dir", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    manifest = json.loads((root / "docs/sandy-api/fallback-runtime-source-guards.json").read_text())
    checked = 0
    for runtime in manifest["runtimes"]:
        source = (root / runtime["path"]).read_bytes()
        if sha(source) != runtime["candidate_source_sha256"]:
            raise ValueError(f"Candidate changed without source review: {runtime['runtime']}")
        baseline = None
        if args.baseline_dir:
            baseline = (args.baseline_dir / (runtime["runtime"] + ".ts")).read_bytes()
            if sha(baseline) != runtime["baseline_source_sha256"]:
                raise ValueError(f"Unrecognized baseline: {runtime['runtime']}")
        for protected in runtime["preserved_sections"]:
            selected = fragment(source.decode(), protected["start"], protected.get("candidate_end", protected["end"])).encode()
            if sha(selected) != protected["sha256"] or len(selected) != protected["bytes"]:
                raise ValueError(f"Changed original behavior: {runtime['runtime']}/{protected['name']}")
            if baseline and fragment(baseline.decode(), protected["start"], protected["end"]).encode() != selected:
                raise ValueError(f"Baseline behavior differs: {runtime['runtime']}/{protected['name']}")
            checked += 1
    for dependency in manifest["dependencies"]:
        if sha((root / dependency["path"]).read_bytes()) != dependency["sha256"]:
            raise ValueError(f"Changed archived dependency: {dependency['path']}")
    for shared in manifest.get("shared_sections", []):
        selected = fragment((root / shared["path"]).read_text(), shared["start"], shared["end"]).encode()
        if sha(selected) != shared["sha256"] or len(selected) != shared["bytes"]:
            raise ValueError(f"Changed shared original behavior: {shared['path']}")
        if args.baseline_dir:
            for runtime in manifest["runtimes"]:
                baseline = (args.baseline_dir / (runtime["runtime"] + ".ts")).read_text()
                if fragment(baseline, shared["start"], shared["baseline_end"]).encode() != selected:
                    raise ValueError(f"Shared source differs from archive: {runtime['runtime']}/{shared['path']}")
    print(json.dumps({"status": "pass", "runtimes": len(manifest["runtimes"]), "preserved_source_sections": checked, "shared_original_sections": len(manifest.get("shared_sections", [])), "dependencies": len(manifest["dependencies"]), "baseline_checked": args.baseline_dir is not None}))


if __name__ == "__main__":
    main()
