import raw from "./provider_contracts.json" with { type: "json" };
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import type {
  Contract as BaseContract,
  Obj,
} from "../sandy-provider-supplement-api/contracts.ts";
export type { Obj } from "../sandy-provider-supplement-api/contracts.ts";
export type Contract = BaseContract & {
  service: string;
  method: string;
  host: string;
  path: string;
  resource_parameter: string;
  provider_request_schema: Obj;
  provider_response_schema: Obj;
  provider_request_crc_fields: string[];
  provider_response_crc_fields: string[];
  provider_response_verified_fields: string[];
};
const object = (properties: Obj): Obj => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const uuid = { type: "string", format: "uuid" };
const sha = { type: "string", pattern: "^[a-f0-9]{64}$" };
export const sensitiveContracts: Readonly<Record<string, Contract>> = Object
  .freeze(Object.fromEntries(
    await Promise.all(raw.map(async (source) => {
      const value = {
        ...source,
        output_schema: object({
          ok: { const: true },
          operation: { const: source.operation },
          contract_version: { const: "1.0.0" },
          provider: { const: "gcp" },
          request_state: { enum: ["observed", "accepted"] },
          executed: { const: true },
          admission_id: uuid,
          provider_http_status: { type: "integer", minimum: 200, maximum: 299 },
          provider_request_id: { type: ["string", "null"], maxLength: 200 },
          result: object({
            custody_id: uuid,
            sha256: sha,
            byte_length: { type: "integer", minimum: 0, maximum: 1048576 },
            media_type: { const: "application/json" },
            expires_at: { type: "string", format: "date-time" },
            content_returned: { const: false },
            transfer_state: { const: "captured_private" },
          }),
        }),
      };
      return [
        source.operation,
        Object.freeze({
          ...value,
          contract_sha256: await argumentDigest(value),
        }) as unknown as Contract,
      ];
    })),
  ));
