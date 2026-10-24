#!/usr/bin/env python3
"""Release the pinned P0 web canary only after a real Controller owner approval.

Uses the existing renewable workload for Controller metadata and the configured
Management credential for its intended deployment API. Never approves a change,
issues customer tokens, changes grants, or retries an uncertain provider write.
Default mode is read-only. Source verification is not functional acceptance.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import struct
import subprocess
import urllib.error
import urllib.request
import uuid

from engineering_control_client import NoRedirect, bootstrap_credential, control

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "docs/sandy-engineering/evaluations/p0-web-canary-source-manifest.json"
CHANGE = "8ed79487-8eeb-41a6-9e7c-6bc24cee568b"
PROJECT = "zmqlyygzqoidkcwdysok"
BASE = f"https://api.supabase.com/v1/projects/{PROJECT}"
TARGETS = {"sandy-agent-runtime-v4": 22, "sandy-workspace": 39}
PIN = "d79833a2643d23ef4b0476517a3899bfd758f255d09602cd342380e4b06c08a9"


class Blocked(RuntimeError):
    pass


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def load_candidate(raw: bytes) -> tuple[dict, dict[str, dict[str, bytes]]]:
    if digest(raw) != PIN:
        raise Blocked("release_manifest_changed_requires_new_owner_review")
    manifest = json.loads(raw)
    commit = manifest["source_commit"]
    if not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise Blocked("invalid_source_commit")
    if {f["slug"]: f["expected_prior_version"] for f in manifest["functions"]} != TARGETS:
        raise Blocked("release_targets_changed")
    sources = {}
    for function in manifest["functions"]:
        files = {}
        for name, expected in function["files"].items():
            path = PurePosixPath(name)
            if path.is_absolute() or ".." in path.parts or not re.fullmatch(r"[A-Za-z0-9_./-]+", name):
                raise Blocked("unsafe_source_path")
            value = subprocess.check_output(
                ["git", "show", f"{commit}:supabase/functions/{name}"], cwd=ROOT,
                stderr=subprocess.DEVNULL,
            )
            if digest(value) != expected:
                raise Blocked("committed_source_digest_mismatch")
            files[name] = value
        if function["slug"] + "/index.ts" not in files:
            raise Blocked("entrypoint_missing")
        # A manifest may not omit a relative dependency or smuggle in extra code.
        visited = set()
        def visit(name):
            if name in visited:
                return
            visited.add(name)
            if name not in files:
                raise Blocked("manifest_dependency_missing")
            if name.endswith(".json"):
                return
            for _, spec in re.findall(r'''(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)(["'])(\.[^"']+)\1''', files[name].decode()):
                resolved = (ROOT / "supabase/functions" / name).parent.joinpath(spec).resolve()
                try:
                    dependency = resolved.relative_to(ROOT / "supabase/functions").as_posix()
                except ValueError:
                    raise Blocked("source_dependency_escapes_functions") from None
                visit(dependency)
        visit(function["slug"] + "/index.ts")
        if visited != set(files):
            raise Blocked("manifest_contains_unused_source")
        sources[function["slug"]] = files
    return manifest, sources


def check_control(value: dict, manifest: dict) -> None:
    change = value.get("change", {})
    if change.get("id") != CHANGE or change.get("status") not in ("approved", "implementing"):
        raise Blocked("controller_owner_approval_required")
    if not set(TARGETS).issubset(set(change.get("scope", []))):
        raise Blocked("controller_release_scope_mismatch")
    if not any(t.get("outcome") == "passed" and
               t.get("evidence", {}).get("manifest_sha256") == PIN and
               t.get("evidence", {}).get("source_commit") == manifest["source_commit"] and
               t.get("evidence", {}).get("release_manifest") == manifest
               for t in value.get("tests", [])):
        raise Blocked("pinned_predeployment_evidence_required")


def check_live(function: dict, metadata: dict, bundle: bytes) -> None:
    if (metadata.get("slug") != function["slug"] or metadata.get("status") != "ACTIVE" or
        metadata.get("version") != function["expected_prior_version"] or
        metadata.get("verify_jwt") is not False or digest(bundle) != function["prior_bundle_sha256"]):
        raise Blocked("published_source_or_configuration_changed")


def original_sources(bundle: bytes) -> dict[str, bytes]:
    """Read original sources from Management's ESZIP2.3 source maps; fail closed.

    Compiled JS is not accepted as evidence of TypeScript source parity.
    No files from the archive are executed or written to caller-selected paths.
    """
    position = 8
    def uint():
        nonlocal position
        if position + 4 > len(bundle):
            raise Blocked("truncated_deployed_bundle")
        n = int.from_bytes(bundle[position:position + 4], "big")
        position += 4
        return n
    def section():
        nonlocal position
        length = uint()
        end = position + length
        if end > len(bundle):
            raise Blocked("truncated_deployed_bundle")
        result = bundle[position:end]
        position = end
        return result
    if bundle[:8] != b"ESZIP2.3" or section() != bytes([0, 0, 1, 0]):
        raise Blocked("unsupported_deployed_bundle")
    header = section()
    section()  # Header checksum section.
    source_start = position + 4
    source_length = uint()
    source_end = source_start + source_length
    if source_end + 4 > len(bundle):
        raise Blocked("truncated_deployed_bundle")
    map_length = int.from_bytes(bundle[source_end:source_end + 4], "big")
    map_start = source_end + 4
    if map_start + map_length > len(bundle):
        raise Blocked("truncated_deployed_bundle")
    result = {}
    offset = 0
    while offset < len(header):
        size = int.from_bytes(header[offset:offset + 4], "big")
        offset += 4
        name = header[offset:offset + size].decode()
        offset += size
        kind = header[offset]
        offset += 1
        if kind == 0:
            source_offset, source_size, map_offset, length = struct.unpack_from(">IIII", header, offset)
            offset += 17
            if name.startswith("source/"):
                if name[7:] in result:
                    raise Blocked("ambiguous_deployed_source")
                # Plain JavaScript/JSON can be stored byte-for-byte without a
                # source map. TypeScript still requires its original map.
                if not length and name.endswith((".js", ".mjs", ".json")):
                    if source_offset + source_size > source_length:
                        raise Blocked("truncated_deployed_bundle")
                    result[name[7:]] = bundle[source_start + source_offset:source_start + source_offset + source_size]
                    continue
                if not length or map_offset + length > map_length:
                    raise Blocked("original_deployed_source_unavailable")
                mapping = json.loads(bundle[map_start + map_offset:map_start + map_offset + length])
                contents = mapping.get("sourcesContent", [])
                if len(contents) != 1 or not isinstance(contents[0], str):
                    raise Blocked("ambiguous_deployed_source")
                result[name[7:]] = contents[0].encode()
        elif kind == 1:
            size = int.from_bytes(header[offset:offset + 4], "big")
            offset += 4 + size
        elif kind == 2:
            offset += 4
        else:
            raise Blocked("unsupported_deployed_module")
    return result


def private_write(directory: Path, name: str, value: bytes) -> None:
    fd = os.open(directory / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(value)


class Release:
    def __init__(self, manifest: dict, sources: dict, evidence: Path):
        self.manifest, self.sources, self.evidence = manifest, sources, evidence
        self.credential = bootstrap_credential()
        self.holder = "p0-web-" + uuid.uuid4().hex
        self.opener = urllib.request.build_opener(NoRedirect())

    def api(self, method: str, path: str, data: bytes | None = None, mime="application/json") -> bytes:
        request = urllib.request.Request(BASE + path, method=method, data=data, headers={
            "authorization": "Bearer " + os.environ["SANDY_SUPABASE_MANAGEMENT_TOKEN"],
            "content-type": mime,
        })
        try:
            with self.opener.open(request, timeout=55) as response:
                value = response.read(32 * 1024 * 1024 + 1)
                if len(value) > 32 * 1024 * 1024:
                    raise Blocked("management_response_too_large")
                return value
        except urllib.error.HTTPError as error:
            raise Blocked(f"management_http_{error.code}_no_automatic_retry") from None

    def sql(self, query: str):
        return json.loads(self.api("POST", "/database/query", json.dumps({"query": query}).encode()))

    def admission(self, lease=False):
        status, value = control({"action": "get", "change_id": CHANGE}, self.credential)
        if status != 200:
            raise Blocked(f"renewable_controller_get_http_{status}")
        check_control(value, self.manifest)
        # Approval must be an actual current owner Auth action bound to this
        # immutable manifest. Management credentials cannot fabricate approval.
        rows = self.sql(f"""SELECT EXISTS (
          SELECT 1 FROM public.sandy_engineering_changes c
          JOIN public.sandy_engineering_test_identities i ON i.user_id=c.requested_by
          JOIN public.sandy_controller_admins a ON a.auth_user_id=i.authorized_by
          JOIN public.sandy_engineering_change_events e ON e.change_id=c.id AND e.actor=a.auth_user_id
          WHERE c.id='{CHANGE}' AND c.status IN ('approved','implementing')
          AND i.enabled AND i.revoked_at IS NULL AND a.enabled AND a.role='owner'
          AND e.event_type='status_changed' AND e.detail->>'to'='approved'
          AND position('{PIN}' in coalesce(e.detail->>'reason',''))>0
          AND position('{self.manifest['source_commit']}' in coalesce(e.detail->>'reason',''))>0
        ) AS approved;""")
        if rows != [{"approved": True}]:
            raise Blocked("manifest_bound_controller_owner_approval_required")
        if lease:
            rows = self.sql(f"SELECT count(*)::integer AS held FROM public.sandy_engineering_component_leases WHERE holder='{self.holder}' AND change_id='{CHANGE}' AND expires_at>clock_timestamp();")
            if rows != [{"held": len(TARGETS)}]:
                raise Blocked("release_lease_lost")

    def acquire(self):
        statements = ["BEGIN;"]
        for function in self.manifest["functions"]:
            statements.append(f"""DO $$ BEGIN
              INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at)
              VALUES('{function['slug']}','{self.holder}','{CHANGE}','{function['prior_bundle_sha256']}',clock_timestamp()+interval '15 minutes')
              ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,
                expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp()
              WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();
              IF NOT FOUND THEN RAISE EXCEPTION 'component release already leased'; END IF;
              END $$;""")
        self.sql("\n".join(statements + ["COMMIT;"]))

    def inspect(self):
        for function in self.manifest["functions"]:
            slug = function["slug"]
            metadata = json.loads(self.api("GET", "/functions/" + slug))
            bundle = self.api("GET", "/functions/" + slug + "/body")
            check_live(function, metadata, bundle)
        return {"published_versions": TARGETS, "source_guard_passed": True}

    def deploy(self):
        self.admission()
        self.acquire()
        versions = {}
        try:
            self.inspect()  # Validate the whole pair before the first write.
            for function in self.manifest["functions"]:
                slug = function["slug"]
                self.admission(lease=True)
                metadata = self.api("GET", "/functions/" + slug)
                before = self.api("GET", "/functions/" + slug + "/body")
                check_live(function, json.loads(metadata), before)
                private_write(self.evidence, slug + ".before-metadata.json", metadata)
                private_write(self.evidence, slug + ".before.body", before)
                boundary = "sandy-" + uuid.uuid4().hex
                parts = []
                def part(name, value, filename=None):
                    disposition = f'Content-Disposition: form-data; name="{name}"'
                    if filename:
                        disposition += f'; filename="{filename}"'
                    mime = "application/typescript" if filename else "application/json"
                    parts.append(f"--{boundary}\r\n{disposition}\r\nContent-Type: {mime}\r\n\r\n".encode() + value + b"\r\n")
                part("metadata", json.dumps({"name": slug, "entrypoint_path": slug + "/index.ts", "verify_jwt": False}).encode())
                for name, source in self.sources[slug].items():
                    part("file", source, name)
                parts.append(f"--{boundary}--\r\n".encode())
                # No replay: a timeout means the provider outcome is unknown.
                receipt = self.api("POST", "/functions/deploy?slug=" + slug, b"".join(parts), "multipart/form-data; boundary=" + boundary)
                private_write(self.evidence, slug + ".provider-receipt.json", receipt)
                observed = json.loads(self.api("GET", "/functions/" + slug))
                after = self.api("GET", "/functions/" + slug + "/body")
                private_write(self.evidence, slug + ".after.body", after)
                if (observed.get("status") != "ACTIVE" or observed.get("version") != TARGETS[slug] + 1 or
                    observed.get("verify_jwt") is not False or original_sources(after) != self.sources[slug]):
                    raise Blocked("provider_write_requires_source_reconciliation")
                status, _ = control({"action": "artifact", "change_id": CHANGE, "artifact_type": "edge_function",
                    "target": slug, "before_ref": "version:" + str(TARGETS[slug]),
                    "after_ref": "version:" + str(observed["version"]), "rollback_strategy": "redeploy_prior",
                    "rollback_notes": "Disable pilot enrollment; restore captured source under the same component leases without replaying accepted work.",
                    "metadata": {"source_commit": self.manifest["source_commit"], "manifest_sha256": PIN,
                        "all_original_sources_verified": True, "functional_acceptance_passed": False}}, self.credential)
                if status != 201:
                    raise Blocked("deployed_but_controller_artifact_not_recorded")
                versions[slug] = observed["version"]
        finally:
            self.sql(f"DELETE FROM public.sandy_engineering_component_leases WHERE holder='{self.holder}' AND change_id='{CHANGE}';")
        return {"published_versions": versions, "source_guard_passed": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--deploy", action="store_true")
    parser.add_argument("--evidence-dir", type=Path)
    args = parser.parse_args()
    try:
        manifest, sources = load_candidate(MANIFEST.read_bytes())
        evidence = args.evidence_dir or Path("/workspace/sandy-intelligence-evidence") / ("web-release-" + uuid.uuid4().hex)
        if args.deploy:
            evidence = evidence.resolve()
            if evidence.is_relative_to(ROOT):
                raise Blocked("private_release_evidence_must_be_outside_repository")
            evidence.mkdir(mode=0o700)  # A new directory, never overwrite rollback evidence.
        release = Release(manifest, sources, evidence)
        observed = release.inspect()
        release.admission()
        if args.deploy:
            observed = release.deploy()
        print(json.dumps({"ok": True, "deployed": args.deploy, **observed,
            "source_commit": manifest["source_commit"], "manifest_sha256": PIN,
            "pilot_enrolled": False, "functional_acceptance_passed": False}))
        return 0
    except (Blocked, OSError, ValueError, KeyError, IndexError, struct.error, subprocess.CalledProcessError):
        # Only stable locally-defined errors are safe to publish. Never expose
        # upstream bodies, signed URLs, credentials or customer payloads.
        import sys
        error = sys.exc_info()[1]
        reason = str(error) if isinstance(error, Blocked) else "release_check_failed_no_automatic_retry"
        print(json.dumps({"ok": False, "blocker": reason, "automatic_retry": False,
            "deployment_or_partial_deployment_must_be_reconciled": args.deploy,
            "functional_acceptance_passed": False}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
