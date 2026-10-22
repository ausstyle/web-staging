"""Build a reproducible compact gateway entrypoint without bundling dependencies.

The readable TypeScript stays in Git. Only type erasure and whitespace removal
are applied using pinned esbuild; names and syntax minification are disabled.
Deployments retain both source and uploaded artifact digests for readback.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

VERSION = "0.25.10"
SOURCE = "supabase/functions/sandy-operation-api/index.ts"
OPTIONS = ["--loader=ts", "--minify-whitespace", "--target=esnext", "--charset=utf8", "--legal-comments=none", "--sourcefile=" + SOURCE]

def build(root: Path, commit: str, output: Path, source_path: str = SOURCE):
    source = Path(source_path)
    if source.is_absolute() or ".." in source.parts or not source_path.startswith("supabase/functions/") or source.suffix != ".ts":
        raise RuntimeError("invalid_gateway_module_source")
    commit = subprocess.check_output(["git", "rev-parse", "--verify", commit + "^{commit}"], cwd=root, text=True).strip()
    source = subprocess.check_output(["git", "show", commit + ":" + source_path], cwd=root)
    command = ["deno", "run", "--allow-env", "--allow-read", "--allow-run", "--allow-write", "--allow-net", "npm:esbuild@" + VERSION]
    version = subprocess.check_output(command + ["--version"], text=True).strip()
    if version != VERSION:
        raise RuntimeError("pinned_builder_version_mismatch")
    options = OPTIONS[:-1] + ["--sourcefile=" + source_path]
    result = subprocess.run(command + options, input=source, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    artifact = result.stdout
    if len(artifact) >= len(source):
        raise RuntimeError("compact_gateway_not_smaller")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(artifact)
    report = {"builder": "esbuild", "version": version, "options": options,
        "source_path": source_path, "source_commit": commit,
        "source_sha256": hashlib.sha256(source).hexdigest(), "source_bytes": len(source),
        "artifact_sha256": hashlib.sha256(artifact).hexdigest(), "artifact_bytes": len(artifact),
        "artifact_path": str(output.resolve()), "bundled": False, "identifier_minification": False}
    output.with_suffix(output.suffix + ".json").write_text(json.dumps(report, indent=2) + "\n")
    return report

if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--root", type=Path, required=True)
    p.add_argument("--commit", required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--source-path", default=SOURCE)
    args = p.parse_args()
    print(json.dumps(build(args.root, args.commit, args.output, args.source_path)))
