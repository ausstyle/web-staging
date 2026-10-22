/** Fixed compiled customer-fragment adapters. Caller identity is the real userDb
 * JWT; neither this factory nor its public arguments accepts a principal. */
import { Ajv, type ValidateFunction } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import type { UserExportDb } from "./download.ts";
type Obj = Record<string, unknown>;
type Descriptor = {
  input_schema: Obj;
  output_schema: Obj;
  artifact_schema?: Obj;
};
const object = (v: unknown): v is Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const fail = (status: number, error: string) =>
  Response.json({ ok: false, error, executed: false }, {
    status,
    headers: { "cache-control": "no-store" },
  });
function validators(contract: Descriptor) {
  let compiled: {
    input: ValidateFunction;
    output: ValidateFunction;
    artifact?: ValidateFunction;
  } | undefined;
  return () => {
    if (!compiled) {
      const ajv = new Ajv({ strict: true });
      for (const [name, format] of Object.entries(fullFormats)) {
        ajv.addFormat(name, format);
      }
      compiled = {
        input: ajv.compile(contract.input_schema),
        output: ajv.compile(contract.output_schema),
        ...(contract.artifact_schema
          ? { artifact: ajv.compile(contract.artifact_schema) }
          : {}),
      };
    }
    return compiled;
  };
}
export function createUserFragmentDownload(
  contract: Descriptor,
  rpcName: "sandy_tenant_financial_fragment_download",
) {
  const validation = validators(contract);
  return async (userDb: UserExportDb, args: unknown): Promise<Response> => {
    if (!object(args) || !validation().input(args)) {
      return fail(400, "invalid_arguments");
    }
    try {
      const { data, error } = await userDb.rpc(rpcName, {
        p_snapshot: args.snapshot_id,
        p_sequence: args.sequence,
      });
      if (error || !object(data)) {
        return fail(503, "tenant_financial_download_unavailable");
      }
      if (
        data.ok === false &&
        [403, 404, 410, 424].includes(Number(data.http_status))
      ) {
        return fail(
          Number(data.http_status),
          "tenant_financial_download_refused",
        );
      }
      if (
        !validation().output(data) || data.snapshot_id !== args.snapshot_id ||
        data.sequence !== args.sequence ||
        typeof data.artifact_json !== "string" ||
        typeof data.artifact_sha256 !== "string"
      ) return fail(502, "tenant_financial_download_projection_invalid");
      const bytes = new TextEncoder().encode(data.artifact_json);
      if (bytes.byteLength > 1048576) {
        return fail(502, "tenant_financial_download_projection_invalid");
      }
      const artifact = JSON.parse(data.artifact_json);
      if (
        !object(artifact) || validation().artifact?.(artifact) !== true ||
        artifact.snapshot_id !== args.snapshot_id ||
        artifact.sequence !== args.sequence ||
        (artifact.table_complete === true) !==
          (artifact.table_row_count !== null &&
            artifact.table_row_chain_sha256 !== null)
      ) return fail(502, "tenant_financial_download_projection_invalid");
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      if (digest !== data.artifact_sha256) {
        return fail(502, "tenant_financial_download_integrity_failed");
      }
      return Response.json({
        ok: true,
        snapshot_id: args.snapshot_id,
        sequence: args.sequence,
        artifact_sha256: digest,
        artifact_json: data.artifact_json,
      }, {
        headers: {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      return fail(503, "tenant_financial_download_unavailable");
    }
  };
}
export function createUserFragmentAvailable(
  contract: Descriptor,
  rpcName: "sandy_tenant_financial_exports_available",
) {
  const validation = validators(contract);
  return async (userDb: UserExportDb, args: unknown): Promise<Response> => {
    if (!object(args) || !validation().input(args)) {
      return fail(400, "invalid_arguments");
    }
    try {
      const { data, error } = await userDb.rpc(rpcName, {
        p_offset: args.offset,
        p_limit: args.limit,
      });
      if (error || !object(data)) {
        return fail(503, "tenant_financial_discovery_unavailable");
      }
      if (data.ok === false && [403, 424].includes(Number(data.http_status))) {
        return fail(
          Number(data.http_status),
          "tenant_financial_discovery_refused",
        );
      }
      if (
        !validation().output(data) || data.offset !== args.offset ||
        data.limit !== args.limit || !Array.isArray(data.items) ||
        data.items.length !==
          Math.min(
            Number(args.limit),
            Math.max(Number(data.total_count) - Number(args.offset), 0),
          ) ||
        data.next_offset !==
          (Number(args.offset) + data.items.length < Number(data.total_count)
            ? Number(args.offset) + data.items.length
            : null)
      ) return fail(502, "tenant_financial_discovery_projection_invalid");
      return Response.json(data, {
        headers: {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      return fail(503, "tenant_financial_discovery_unavailable");
    }
  };
}
