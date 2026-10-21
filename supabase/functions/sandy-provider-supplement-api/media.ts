/** Bounded transport only. No raw media, signed URL or credential is an output. */
import {
  type Contract,
  GCP_NUMBER,
  GCP_PROJECT,
  type Obj,
  REGION,
  REPOSITORY,
} from "./contracts.ts";
import {
  argumentDigest,
  bytesDigest,
  Calls,
  type Context,
  decode64,
  type Dependencies,
  encode64,
  fail,
  json,
  object,
  optionalText,
  Refusal,
  text,
} from "./runtime.ts";
import { bindingFor, capture } from "./providers.ts";
const parentFor = (args: Obj) =>
  `projects/${GCP_PROJECT}/locations/${REGION}/repositories/${args.repository}`;
const safePath = (value: unknown, max = 1000): string => {
  const result = text(value, max);
  if (
    result.split("/").some((part) => !part || part === "." || part === "..") ||
    result.includes("\\") || /[?#%\r\n]/.test(result)
  ) fail("invalid_media_resource_path", 400);
  return result;
};
async function content(args: Obj): Promise<Uint8Array> {
  const bytes = decode64(args.content_base64);
  if (await bytesDigest(bytes) !== args.sha256) {
    fail("source_content_digest_mismatch", 400);
  }
  return bytes;
}
export async function requireBucket(
  bucket: string,
  calls: Calls,
): Promise<void> {
  const url = new URL(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}`,
  );
  url.searchParams.set("fields", "id,name,projectNumber");
  const metadata = json(await calls.request(url));
  if (
    metadata.name !== bucket || String(metadata.projectNumber) !== GCP_NUMBER
  ) fail("bucket_project_relationship_required", 403);
}
function operation(
  value: Obj,
): { operation_name: string | null; operation_done: boolean | null } {
  if (value.error !== undefined) {
    throw new Refusal("provider_operation_failed", 503, null, null, true);
  }
  const rawName = optionalText(value.name, 1000);
  if (
    rawName !== null &&
    !rawName.startsWith(
      `projects/${GCP_PROJECT}/locations/${REGION}/operations/`,
    )
  ) fail("provider_operation_scope_mismatch", 502);
  if (value.done !== undefined && typeof value.done !== "boolean") {
    fail("provider_response_schema_mismatch", 502);
  }
  return {
    operation_name: rawName,
    operation_done: typeof value.done === "boolean" ? value.done : null,
  };
}
export async function executeMedia(
  op: Contract,
  args: Obj,
  calls: Calls,
  deps: Dependencies,
  context: Context,
  admission: string,
): Promise<Obj> {
  if (
    op.kind.startsWith("artifact_") &&
    !["artifact_download", "artifact_export"].includes(op.kind)
  ) {
    const bytes = await content(args), parent = parentFor(args);
    const categories: Record<string, string> = {
      artifact_apt: "aptArtifacts:create",
      artifact_file: "files:upload",
      artifact_generic: "genericArtifacts:create",
      artifact_go: "goModules:create",
      artifact_googet: "googetArtifacts:create",
      artifact_kfp: "kfpArtifacts:create",
      artifact_yum: "yumArtifacts:create",
    };
    const category = categories[op.kind] ??
      fail("operation_not_implemented", 404);
    const url = new URL(
      `https://artifactregistry.googleapis.com/upload/v1/${parent}/${category}`,
    );
    url.searchParams.set("uploadType", "multipart");
    const boundary = `sandy_${crypto.randomUUID().replaceAll("-", "")}`;
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${
        JSON.stringify(args.metadata)
      }\r\n--${boundary}\r\nContent-Type: ${args.media_type}\r\n\r\n`,
      new Uint8Array(bytes),
      `\r\n--${boundary}--\r\n`,
    ]);
    const reply = await calls.request(
      url,
      "POST",
      body,
      `multipart/related; boundary=${boundary}`,
      [200, 201, 202],
    );
    const value = json(reply),
      record = object(value.operation)
        ? value.operation
        : fail("provider_response_schema_mismatch", 502);
    return {
      source_sha256: args.sha256,
      source_bytes: bytes.length,
      target_sha256: null,
      target: parent,
      provider_response_sha256: reply.sha256,
      ...operation(record),
      effect_confirmed: false,
      transfer_state: "accepted",
    };
  }
  if (op.kind === "storage_upload") {
    const bytes = await content(args), objectName = safePath(args.object_name);
    await requireBucket(String(args.bucket), calls);
    const url = new URL(
      `https://storage.googleapis.com/upload/storage/v1/b/${
        encodeURIComponent(String(args.bucket))
      }/o`,
    );
    url.searchParams.set("uploadType", "media");
    url.searchParams.set("name", objectName);
    url.searchParams.set("ifGenerationMatch", String(args.if_generation_match));
    url.searchParams.set("projection", "noAcl");
    const reply = await calls.request(
      url,
      "POST",
      new Uint8Array(bytes),
      String(args.media_type),
      [200, 201],
    );
    const data = json(reply);
    if (
      data.bucket !== args.bucket || data.name !== objectName ||
      String(data.size) !== String(bytes.length) ||
      typeof data.generation !== "string" ||
      !/^[0-9]{1,20}$/.test(data.generation)
    ) {
      throw new Refusal(
        "provider_upload_readback_mismatch",
        503,
        reply.status,
        reply.id,
        true,
      );
    }
    const readback = new URL(
      `https://storage.googleapis.com/storage/v1/b/${
        encodeURIComponent(String(args.bucket))
      }/o/${encodeURIComponent(objectName)}`,
    );
    readback.searchParams.set("alt", "media");
    readback.searchParams.set("generation", data.generation);
    const downloaded = await calls.request(readback);
    if (
      downloaded.sha256 !== args.sha256 ||
      downloaded.bytes.length !== bytes.length
    ) {
      throw new Refusal(
        "provider_upload_content_readback_mismatch",
        503,
        downloaded.status,
        downloaded.id,
        true,
      );
    }
    return {
      source_sha256: args.sha256,
      source_bytes: bytes.length,
      target_sha256: downloaded.sha256,
      target: `gs://${args.bucket}/${objectName}`,
      provider_response_sha256: reply.sha256,
      operation_name: null,
      operation_done: null,
      effect_confirmed: false,
      transfer_state: "accepted",
    };
  }
  if (op.kind === "artifact_download") {
    const fileId = safePath(args.file_id), parent = parentFor(args);
    const url = new URL(
      `https://artifactregistry.googleapis.com/v1/${parent}/files/${
        encodeURIComponent(fileId)
      }:download`,
    );
    url.searchParams.set("alt", "media");
    const reply = await calls.request(url);
    return await capture(
      reply,
      await bindingFor(
        op,
        args,
        deps,
        context,
        admission,
        url.toString(),
        "artifact",
      ),
      deps,
    );
  }
  if (op.kind === "artifact_export") {
    const parent = parentFor(args),
      prefix = safePath(args.destination_prefix, 300);
    await requireBucket(String(args.destination_bucket), calls);
    // The explicit approved arguments acknowledge the provider's overwrite behavior.
    if (args.overwrite_existing !== true) {
      fail("export_overwrite_acknowledgement_required", 400);
    }
    const source = `${parent}/packages/${
      encodeURIComponent(String(args.package))
    }/${args.source_type}/${encodeURIComponent(String(args.source_id))}`;
    const url = new URL(
      `https://artifactregistry.googleapis.com/v1/${parent}:exportArtifact`,
    );
    const request = {
      gcsPath: `${args.destination_bucket}/${prefix}`,
      [args.source_type === "tags" ? "sourceTag" : "sourceVersion"]: source,
    };
    const reply = await calls.request(
      url,
      "POST",
      JSON.stringify(request),
      "application/json",
      [200, 201, 202],
    );
    const info = operation(json(reply));
    if (!info.operation_name) {
      throw new Refusal(
        "provider_operation_receipt_missing",
        503,
        reply.status,
        reply.id,
        true,
      );
    }
    return {
      target: `gs://${request.gcsPath}`,
      ...info,
      effect_confirmed: false,
      transfer_state: "accepted",
    };
  }
  if (op.kind.startsWith("download_")) {
    let path: string;
    if (op.kind === "download_job") path = `actions/jobs/${args.job_id}/logs`;
    else if (op.kind === "download_step") {
      path = `actions/jobs/${args.job_id}/steps/${args.step_number}/logs`;
    } else if (op.kind === "download_attempt") {
      path = `actions/runs/${args.run_id}/attempts/${args.attempt_number}/logs`;
    } else if (op.kind === "download_run") {
      path = `actions/runs/${args.run_id}/logs`;
    } else if (op.kind === "download_artifact") {
      path = `actions/artifacts/${args.artifact_id}/zip`;
    } else return fail("operation_not_implemented", 404);
    const url = new URL(`https://api.github.com/repos/${REPOSITORY}/${path}`);
    const reply = await calls.request(url, "GET", undefined, undefined, [
      200,
      302,
    ]);
    if (reply.status === 200) {
      return await capture(
        reply,
        await bindingFor(
          op,
          args,
          deps,
          context,
          admission,
          url.toString(),
          "artifact",
        ),
        deps,
      );
    }
    // A fixed-resource provider response can create opaque initiation state. A
    // documented, reviewed storage-host policy is required before following it.
    const raw = reply.headers.get("location");
    let location: URL;
    try {
      location = new URL(raw ?? "");
    } catch {
      return fail("provider_download_location_invalid", 502);
    }
    if (
      location.protocol !== "https:" || location.username ||
      location.password || location.port || location.hash ||
      location.hostname.length > 253 ||
      !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(location.hostname) ||
      /^[0-9.]+$/.test(location.hostname) || (raw?.length ?? 0) > 8192
    ) fail("provider_download_location_invalid", 502);
    const bytes = new TextEncoder().encode(location.toString()),
      sourceSha = await argumentDigest({
        provider_url: url.toString(),
        status: reply.status,
        request_id: reply.id,
        location_sha256: await bytesDigest(bytes),
      });
    const receipt = await deps.saveOpaque({
      ...await bindingFor(
        op,
        args,
        deps,
        context,
        admission,
        url.toString(),
        "redirect",
      ),
      payload_base64: encode64(bytes),
      payload_sha256: await bytesDigest(bytes),
      byte_length: bytes.length,
      media_type: "application/x-sandy-private-download-location",
    });
    return {
      custody_id: receipt.custody_id,
      source_response_sha256: sourceSha,
      signed_url_returned: false,
      content_returned: false,
      transfer_state: "redirect_initiated_private",
      expires_at: receipt.expires_at,
      payload_transfer_complete: false,
    };
  }
  return fail("operation_not_implemented", 404);
}
