"""Reconcile one previously deployed MCP candidate; never deploy or change traffic."""
from __future__ import annotations
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.error
import urllib.request
from urllib.parse import urlsplit

REPOSITORY = "ausstyle/web-staging"
PROJECT = "elaborate-haven-511518-a5"
SERVICE = "sandy-engineering-mcp"
IDENTITY = f"sandy-mcp-runtime@{PROJECT}.iam.gserviceaccount.com"
WORKFLOW = ".github/workflows/sandy-engineering-mcp-deploy.yml"
DEPLOY_STEP = "Preserve current revision and deploy a candidate without changing traffic"


class Refused(RuntimeError):
    pass


def require(condition, code):
    if not condition:
        raise Refused(code)


def number(value):
    require(isinstance(value, str) and re.fullmatch(r"[1-9][0-9]{0,15}", value), "source_run_and_attempt_required")
    return int(value)


def timestamp(value):
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def select_artifact(run, jobs, artifacts, attempt):
    require(run.get("repository", {}).get("full_name") == REPOSITORY and
            run.get("path") == WORKFLOW and run.get("head_branch") == "main" and
            run.get("event") in ("push", "workflow_dispatch") and
            run.get("run_attempt") == attempt and run.get("status") == "completed" and
            re.fullmatch(r"[a-f0-9]{40}", run.get("head_sha", "")), "trusted_completed_release_required")
    deployed = [j for j in jobs if j.get("name") == "deploy" and
                any(s.get("name") == DEPLOY_STEP and s.get("conclusion") == "success" for s in j.get("steps", []))]
    require(len(deployed) == 1, "successful_original_candidate_deployment_required")
    job = deployed[0]
    matches = [a for a in artifacts if a.get("name") == "sandy-mcp-release-" + run["head_sha"] and
               a.get("expired") is False and
               timestamp(job["started_at"]) <= timestamp(a["created_at"]) <= timestamp(job["completed_at"])]
    require(len(matches) == 1 and isinstance(matches[0].get("id"), int), "one_artifact_from_exact_attempt_required")
    return matches[0]


def active(rows):
    current = sorted((r["revisionName"], r["percent"]) for r in rows if r.get("percent", 0) > 0)
    require(current and sum(p for _, p in current) == 100, "resolved_production_traffic_required")
    return current


def reconcile(metadata, before, after, original_identity, live, revision):
    require(before.get("service") == SERVICE and before.get("project") == PROJECT and
            before.get("source_commit_candidate") == metadata["source_commit"], "original_source_pin_mismatch")
    candidate = f"{SERVICE}-api-{metadata['run_id']}-{metadata['run_attempt']}"
    require(after.get("status", {}).get("latestCreatedRevisionName") == candidate and
            original_identity.get("metadata", {}).get("name") == candidate and
            revision.get("metadata", {}).get("name") == candidate, "exact_candidate_revision_required")
    require(before.get("verified_runtime_identity") == IDENTITY and
            original_identity.get("spec", {}).get("serviceAccountName") == IDENTITY and
            revision.get("spec", {}).get("serviceAccountName") == IDENTITY and
            live.get("spec", {}).get("template", {}).get("spec", {}).get("serviceAccountName") == IDENTITY,
            "google_runtime_identity_mismatch")
    require(any(c.get("type") == "Ready" and c.get("status") == "True" for c in revision.get("status", {}).get("conditions", [])),
            "candidate_revision_not_ready")
    require(active(before.get("traffic", [])) == active(after["status"].get("traffic", [])) ==
            active(live.get("status", {}).get("traffic", [])), "production_traffic_changed_no_automatic_repair")
    require(all(name != candidate for name, _ in active(live["status"]["traffic"])), "candidate_already_receiving_production_traffic")
    origin = urlsplit(before.get("url", ""))
    require(origin.scheme == "https" and not origin.username and not origin.password and not origin.port and
            origin.path in ("", "/") and not origin.query and not origin.fragment and
            re.fullmatch(r"sandy-engineering-mcp-[a-z0-9-]+(?:\.[a-z0-9-]+)?\.run\.app", origin.hostname or ""),
            "fixed_service_url_required")
    tagged = "https://sandy-api-review---" + origin.hostname
    for status in (after["status"], live["status"]):
        matches = [r for r in status.get("traffic", []) if r.get("tag") == "sandy-api-review"]
        require(len(matches) == 1 and matches[0].get("revisionName") == candidate and
                matches[0].get("url", "").rstrip("/") == tagged, "candidate_tag_changed_no_automatic_repair")
    return {"verified": True, "source_commit": metadata["source_commit"], "candidate_revision": candidate,
            "runtime_identity": IDENTITY, "candidate_ready": True, "production_traffic_unchanged": True,
            "source_run_id": metadata["run_id"], "source_run_attempt": metadata["run_attempt"],
            "provider_reads": ["Cloud Run service describe", "Cloud Run candidate revision describe"],
            "image_digest": revision.get("status", {}).get("imageDigest"),
            "candidate_deployments": 0, "traffic_mutations": 0, "administrator_token_issuance_verified": False}


def write(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")
    path.chmod(0o600)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("action", choices=["select", "verify"])
    p.add_argument("--output-dir", type=Path, required=True)
    p.add_argument("--release-dir", type=Path)
    args = p.parse_args()
    try:
        run_id, attempt = number(os.environ.get("SOURCE_RUN_ID", "")), number(os.environ.get("SOURCE_RUN_ATTEMPT", ""))
        args.output_dir.mkdir(parents=True, exist_ok=True)
        if args.action == "select":
            class NoRedirect(urllib.request.HTTPRedirectHandler):
                def redirect_request(self, *unused):
                    return None
            opener = urllib.request.build_opener(NoRedirect())
            def api(path):
                request = urllib.request.Request("https://api.github.com/repos/" + REPOSITORY + path,
                    headers={"authorization": "Bearer " + os.environ["GH_TOKEN"], "accept": "application/vnd.github+json"})
                with opener.open(request, timeout=30) as response:
                    raw = response.read(2000001)
                    require(len(raw) <= 2000000, "release_metadata_size_limit")
                    return json.loads(raw)
            run = api(f"/actions/runs/{run_id}/attempts/{attempt}")
            jobs = api(f"/actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100")
            artifacts = api(f"/actions/runs/{run_id}/artifacts?per_page=100")
            require(jobs.get("total_count", 101) <= 100 and artifacts.get("total_count", 101) <= 100, "release_metadata_pagination_required")
            artifact = select_artifact(run, jobs["jobs"], artifacts["artifacts"], attempt)
            tree = lambda ref: subprocess.check_output(["git", "rev-parse", ref + ":services/sandy-engineering-mcp"], text=True).strip()
            require(tree("HEAD") == tree(run["head_sha"]), "candidate_runtime_source_changed")
            value = {"run_id": run_id, "run_attempt": attempt, "source_commit": run["head_sha"], "artifact_id": artifact["id"],
                     "artifact_digest": artifact.get("digest"), "runtime_source_tree": tree(run["head_sha"])}
            write(args.output_dir / "source-metadata.json", value)
            with open(os.environ["GITHUB_OUTPUT"], "a") as output:
                output.write(f"artifact_id={artifact['id']}\nsource_commit={run['head_sha']}\n")
        else:
            require(args.release_dir is not None, "preserved_release_directory_required")
            read = lambda name: json.loads((args.release_dir / name).read_text())
            metadata = json.loads((args.output_dir / "source-metadata.json").read_text())
            require(metadata["run_id"] == run_id and metadata["run_attempt"] == attempt, "source_run_changed")
            candidate = f"{SERVICE}-api-{run_id}-{attempt}"
            def describe(kind, name, fields):
                data = subprocess.check_output(["gcloud", "run", kind, "describe", name, "--project", PROJECT,
                    "--region", "europe-west1", "--format=json(" + fields + ")"], stderr=subprocess.PIPE)
                return json.loads(data)
            live = describe("services", SERVICE, "metadata.name,status.traffic,spec.template.spec.serviceAccountName")
            revision = describe("revisions", candidate, "metadata.name,spec.serviceAccountName,status.conditions,status.imageDigest")
            value = reconcile(metadata, read("before.json"), read("after.json"), read("candidate-runtime-identity.json"), live, revision)
            write(args.release_dir / "reused-candidate-reconciliation.json", value)
            print(json.dumps(value))
        return 0
    except (Refused, OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        print(json.dumps({"verified": False, "error": str(error) if isinstance(error, Refused) else "candidate_reconciliation_failed",
                          "candidate_deployments": 0, "traffic_mutations": 0}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
