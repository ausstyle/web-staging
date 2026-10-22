/** MCP transport metadata only. API owns identity, grants and all execution. */
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

export function executionMetadataHeaders(metadata) {
  const headers = {};
  for (const [key, header] of [["approvalId", "x-sandy-approval-id"], ["requestId", "x-sandy-request-id"]]) {
    const value = metadata?.[key];
    if (value !== undefined) {
      if (!uuid(value)) return null;
      headers[header] = value;
    }
  }
  return headers;
}

/** Relocate local refs when wrapping the API-owned input contract. */
export function transportInputSchema(input) {
  const prefix = "#/$defs/sandy_api_arguments";
  const relocate = value => {
    if (Array.isArray(value)) return value.map(relocate);
    if (!object(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
      key === "$ref" && typeof child === "string" && child.startsWith("#")
        ? prefix + child.slice(1) : relocate(child)]));
  };
  const metadata = { type: "object", minProperties: 1, additionalProperties: false,
    properties: { approval_id: { type: "string", format: "uuid" }, request_id: { type: "string", format: "uuid" } } };
  return { type: "object", $defs: { sandy_api_arguments: relocate(input) }, anyOf: [
    { $ref: prefix },
    { type: "object", required: ["__sandy_execution", "arguments"], additionalProperties: false,
      properties: { __sandy_execution: metadata, arguments: { $ref: prefix } } },
  ] };
}

export function unpackExecution(arguments_, header = {}) {
  if (!object(arguments_) || !object(header) || executionMetadataHeaders(header) === null) return null;
  if (!Object.hasOwn(arguments_, "__sandy_execution")) return { arguments_, metadata: header };
  const value = arguments_.__sandy_execution;
  if (Object.keys(arguments_).length !== 2 || !object(arguments_.arguments) || !object(value) ||
    Object.keys(value).length === 0 || Object.keys(value).some(key => !["approval_id", "request_id"].includes(key))) return null;
  const metadata = { ...header };
  for (const [field, key] of [["approval_id", "approvalId"], ["request_id", "requestId"]]) {
    if (value[field] === undefined) continue;
    if (!uuid(value[field]) || (header[key] !== undefined && header[key].toLowerCase() !== value[field].toLowerCase())) return null;
    metadata[key] = value[field];
  }
  return { arguments_: arguments_.arguments, metadata };
}
