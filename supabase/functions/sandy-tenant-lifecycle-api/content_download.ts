/** The decoded artifact_json string preserves exact canonical UTF-8 bytes.
 * Its digest is independent of the canonical API/MCP response envelope. */
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import contract from "./content_download_contract.json" with { type: "json" };
import type { UserExportDb } from "./download.ts";
type Obj = Record<string, unknown>;
const object = (value: unknown): value is Obj =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const contentExportDownloadOperation = Object.freeze(contract);
const ajv = new Ajv({ strict: true });
for (const [n, f] of Object.entries(fullFormats)) ajv.addFormat(n, f);
const input = ajv.compile(contract.input_schema),
  output = ajv.compile(contract.artifact_schema);
export async function executeContentExportDownload(
  userDb: UserExportDb,
  args: unknown,
): Promise<Response> {
  const fail = (status: number, error: string) =>
    Response.json({ ok: false, error, executed: false }, {
      status,
      headers: { "cache-control": "no-store" },
    });
  if (!object(args) || !input(args)) return fail(400, "invalid_arguments");
  try {
    const { data, error } = await userDb.rpc(
      "sandy_tenant_content_fragment_download",
      { p_snapshot: args.snapshot_id, p_sequence: args.sequence },
    );
    if (error || !object(data)) {
      return fail(503, "tenant_content_download_unavailable");
    }
    if (
      data.ok === false &&
      [403, 404, 410, 424].includes(Number(data.http_status))
    ) {
      return fail(
        Number(data.http_status),
        Number(data.http_status) === 403
          ? "confirmed_portal_customer_session_required"
          : Number(data.http_status) === 410
          ? "tenant_content_export_expired_or_purged"
          : Number(data.http_status) === 424
          ? "verified_content_download_required"
          : "tenant_content_fragment_not_found",
      );
    }
    if (
      data.ok !== true || data.snapshot_id !== args.snapshot_id ||
      data.sequence !== args.sequence ||
      typeof data.artifact_json !== "string" ||
      typeof data.artifact_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(data.artifact_sha256)
    ) return fail(502, "tenant_content_download_projection_invalid");
    const bytes = new TextEncoder().encode(data.artifact_json);
    if (bytes.byteLength > 1048576) {
      return fail(502, "tenant_content_download_projection_invalid");
    }
    const payload = JSON.parse(data.artifact_json);
    if (
      !object(payload) || !output(payload) ||
      payload.snapshot_id !== args.snapshot_id ||
      payload.sequence !== args.sequence ||
      (payload.table_complete === true) !==
        (payload.table_row_count !== null &&
          payload.table_row_chain_sha256 !== null)
    ) return fail(502, "tenant_content_download_projection_invalid");
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    if (hash !== data.artifact_sha256) {
      return fail(502, "tenant_content_download_integrity_failed");
    }
    return Response.json({
      ok: true,
      snapshot_id: data.snapshot_id,
      sequence: data.sequence,
      artifact_sha256: hash,
      artifact_json: data.artifact_json,
    }, {
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return fail(503, "tenant_content_download_unavailable");
  }
}
