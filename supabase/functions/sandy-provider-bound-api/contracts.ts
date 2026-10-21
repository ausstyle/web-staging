import raw from "./provider_contracts.json" with { type: "json" };
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import type {
  Contract as BaseContract,
  Obj,
} from "../sandy-provider-supplement-api/contracts.ts";
export type { Obj } from "../sandy-provider-supplement-api/contracts.ts";
export type Contract = BaseContract & {
  service: string;
  resource_chain: string;
  method_name: string;
  method: string;
  path: string;
  service_host?: string;
  fixed_bindings: Obj;
  fixed_query: Obj;
  response_schemas: Record<string, Obj>;
  $defs: Obj;
  public_defs: Obj;
  result_schema: Obj;
  relationship_guard: string;
  opaque_pagination?: boolean;
  private_diff_capture?: boolean;
  kind: string;
};
const object = (properties: Obj): Obj => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const sha = { type: "string", pattern: "^[a-f0-9]{64}$" },
  uuid = { type: "string", format: "uuid" };
const privateArtifact = object({
  custody_id: uuid,
  sha256: sha,
  byte_length: { type: "integer", minimum: 0, maximum: 1048576 },
  media_type: { const: "text/plain" },
  expires_at: { type: "string", format: "date-time" },
  content_returned: { const: false },
  transfer_state: { const: "captured_private" },
});
export const boundContracts: Readonly<Record<string, Contract>> = Object.freeze(
  Object.fromEntries(
    await Promise.all(raw.map(async (source) => {
      const op = source as unknown as Contract;
      const value = {
        ...op,
        result_schema: op.private_diff_capture
          ? privateArtifact
          : op.result_schema,
        output_schema: {
          ...object({
            ok: { const: true },
            operation: { const: op.operation },
            contract_version: { const: "1.0.0" },
            provider: { const: op.provider },
            request_state: { enum: ["observed", "accepted"] },
            executed: { const: true },
            admission_id: uuid,
            provider_http_status: {
              type: "integer",
              minimum: 200,
              maximum: 299,
            },
            provider_request_id: { type: ["string", "null"], maxLength: 200 },
            result: op.private_diff_capture
              ? privateArtifact
              : op.result_schema,
            next_cursor_id: { anyOf: [uuid, { type: "null" }] },
            possibly_truncated: { type: "boolean" },
            scope_proofs: {
              type: "array",
              maxItems: 35,
              items: object({
                kind: { type: "string", maxLength: 100 },
                resource: { type: "string", maxLength: 1500 },
                response_sha256: sha,
              }),
            },
          }),
          $defs: op.public_defs,
        },
      };
      return [
        op.operation,
        Object.freeze({
          ...value,
          contract_sha256: await argumentDigest(value),
        }) as Contract,
      ];
    })),
  ),
);
