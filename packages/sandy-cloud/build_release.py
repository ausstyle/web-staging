"""Build a source-pinned integration bundle; never install, migrate or deploy it."""
import argparse
import gzip
import hashlib
import io
import json
import pathlib
import subprocess
import tarfile

FILES = (
    "packages/sandy-cloud/integrity.ts",
    "packages/sandy-cloud/gcs_protocol.ts",
    "packages/sandy-cloud/restore.ts",
    "packages/sandy-cloud/postgres/commit.ts",
    "packages/sandy-cloud/postgres/shared_scan.ts",
    "packages/sandy-cloud/postgres/schema.sql",
    "packages/sandy-cloud/postgres/authority.ts",
    "packages/sandy-cloud/postgres/projection.ts",
    "packages/sandy-cloud/postgres/projection.sql",
    "packages/sandy-cloud/postgres/transfer_custody.ts",
    "packages/sandy-api/cloud/admission.ts",
    "packages/sandy-api/cloud/transport.ts",
    "packages/sandy-cloud/postgres/README.md",
    "docs/sandy-cloud/metadata-decision.md",
    "docs/sandy-cloud/production-integration-handoff.md",
    "docs/sandy-engineering/tasks/SANDY-ENG-0012-sandy-cloud-drive-backup.md",
)
ROOT = pathlib.Path(__file__).resolve().parents[2]


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def build(output):
    # Bundle committed bytes only; refuse misleading local edits to included files.
    source = git("rev-parse", "HEAD").decode().strip()
    if git("status", "--porcelain", "--", *FILES):
        raise SystemExit("Commit integration sources before packaging")
    content = {name: git("show", f"{source}:{name}") for name in FILES}
    manifest = {
        "format": "sandy-cloud-integration-source-v1",
        "source_commit": source,
        "scope": "SANDY-ENG-0012",
        "runtime_dependency_commit": "ab2cfa4fb29fc5ba72a72fb77c0665fd1181ae55",
        "installable": False,
        "deployed": False,
        "provider_acceptance": False,
        "files": {name: hashlib.sha256(data).hexdigest()
                  for name, data in sorted(content.items())},
        "required_owner_bindings": [
            "canonical transaction-pinned actor/session/device/company admission",
            "canonical universal-file projection CAS and lifecycle audit in same transaction",
            "admitted GCS transport and server-owned scan receipts",
            "transfer intent creation, quota reservation and expiry owner",
            "existing Mission outbox consumer and usage settlement owner",
        ],
        "release_gates": [
            "reviewed additive schema and exact database role/RLS plan",
            "resource inventory, region, USD10 proposal and exact workload binding approval",
            "shared component owner release slot and protected source preservation",
            "two-tenant provider E2E, multi-connection concurrency, recovery and rollback",
        ],
        "rollback": "Freeze Cloud writes; preserve versions, receipts and bytes; restore prior routing and owner source. No destructive down migration.",
    }
    content["manifest.json"] = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode()
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        for name, data in sorted(content.items()):
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o644
            info.mtime = 0
            archive.addfile(info, io.BytesIO(data))
    payload = gzip.compress(buffer.getvalue(), mtime=0)
    output.mkdir(parents=True, exist_ok=True)
    artifact = output / f"sandy-cloud-integration-{source}.tar.gz"
    artifact.write_bytes(payload)
    (output / "manifest.json").write_bytes(content["manifest.json"])
    receipt = {"artifact": artifact.name, "sha256": hashlib.sha256(payload).hexdigest(),
               "source_commit": source, "deployed": False}
    (output / "artifact-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=pathlib.Path)
    build(parser.parse_args().output)
