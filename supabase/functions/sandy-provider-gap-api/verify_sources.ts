/** Offline source verification against previously downloaded authoritative schemas. */
import {
  buildASTSchema,
  parse,
  print,
  validate as validateGraphQL,
  visit,
} from "npm:graphql@16.11.0";
import { strict as assert } from "node:assert";
import { fixedGraphQLDocuments } from "./graphql.ts";
const paths = {
  supabase: "/workspace/sandy-api-deliverables/provider-schemas/supabase.json",
  github: "/workspace/sandy-api-deliverables/provider-schemas/github.json",
  compute:
    "/workspace/sandy-api-deliverables/provider-schemas/gcp-compute.json",
  ghec:
    "/workspace/sandy-api-deliverables/provider-gap-source/github-ghec.json",
  graphql:
    "/workspace/sandy-api-deliverables/provider-gap-source/github-schema.graphql",
};
const pins = {
  supabase: "a322345cd8bcaab5f22dc615600b3ae1e1a1f37c9534b7a9839971a66cde9434",
  github: "3177ad6a86ca04c57a9bef3fc24e28a339efb8eb040c6f950af3d3ed2fee7fa3",
  compute: "cc007ff6a76526bbfe0a6868678ca2b5b3eec6ee7a3f6f453f627013287629d5",
  ghec: "998ae512e4cd85801b3d94bef91bd34e4a7281f7e2f8704f9841c2782536a7d2",
  graphql: "3c62d0526d133cee53221c89de9b455ade24db78b9e7ad56d642c4c15bce2654",
};
const schemas: Record<string, any> = {};
for (const [name, path] of Object.entries(paths)) {
  const bytes = await Deno.readFile(path),
    digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (x) => x.toString(16).padStart(2, "0"),
    ).join("");
  assert.equal(
    digest,
    pins[name as keyof typeof pins],
    name + " source hash mismatch",
  );
  schemas[name] = name === "graphql"
    ? new TextDecoder().decode(bytes)
    : JSON.parse(new TextDecoder().decode(bytes));
}
// This pinned upstream SDL repeats two EnterpriseOwnerInfo fields verbatim.
// Deduplicate only structurally identical definitions; contradictory schema fails.
let duplicates = 0;
const ast = visit(parse(schemas.graphql), {
  ObjectTypeDefinition(node) {
    const seen = new Map<string, string>();
    return {
      ...node,
      fields: node.fields?.filter((field) => {
        const signature = print({ ...field, description: undefined }),
          previous = seen.get(field.name.value);
        if (previous !== undefined) {
          assert.equal(previous, signature, "conflicting upstream duplicate");
          duplicates++;
          return false;
        }
        seen.set(field.name.value, signature);
        return true;
      }),
    };
  },
});
assert.equal(duplicates, 2, "unexpected upstream SDL duplication");
const graphSchema = buildASTSchema(ast);
for (const [name, document] of Object.entries(fixedGraphQLDocuments)) {
  const errors = validateGraphQL(graphSchema, parse(document));
  assert.deepEqual(errors.map((x) => x.message), [], name);
}
for (
  const [path, method, id] of [
    ["/v1/organizations", "get", "v1-list-all-organizations"],
    ["/v1/organizations/{slug}", "get", "v1-get-an-organization"],
    [
      "/v1/projects/{ref}/analytics/endpoints/logs",
      "get",
      "v1-get-project-logs",
    ],
  ] as const
) assert.equal(schemas.supabase.paths[path][method].operationId, id);
for (
  const [path, method] of [
    ["/repos/{owner}/{repo}/environments/{environment_name}/secrets", "get"],
    [
      "/repos/{owner}/{repo}/environments/{environment_name}/secrets/public-key",
      "get",
    ],
    [
      "/repos/{owner}/{repo}/environments/{environment_name}/secrets/{secret_name}",
      "get",
    ],
    [
      "/repos/{owner}/{repo}/environments/{environment_name}/secrets/{secret_name}",
      "put",
    ],
    [
      "/repos/{owner}/{repo}/environments/{environment_name}/secrets/{secret_name}",
      "delete",
    ],
  ] as const
) assert.ok(schemas.github.paths[path][method].operationId);
for (const owner of ["/orgs/{org}", "/users/{username}"]) {
  for (
    const [suffix, method] of [
      ["", "get"],
      ["/{package_type}/{package_name}", "get"],
      ["/{package_type}/{package_name}", "delete"],
      ["/{package_type}/{package_name}/restore", "post"],
      ["/{package_type}/{package_name}/versions", "get"],
      ["/{package_type}/{package_name}/versions/{package_version_id}", "get"],
      [
        "/{package_type}/{package_name}/versions/{package_version_id}",
        "delete",
      ],
      [
        "/{package_type}/{package_name}/versions/{package_version_id}/restore",
        "post",
      ],
    ]
  ) {
    assert.ok(
      schemas.github.paths[owner + "/packages" + suffix][method].operationId,
    );
  }
}
assert.equal(
  schemas.ghec.paths["/orgs/{org}/audit-log"].get.operationId,
  "orgs/get-audit-log",
);
assert.equal(
  schemas.compute.resources.instances.methods.getSerialPortOutput.id,
  "compute.instances.getSerialPortOutput",
);
console.log(JSON.stringify({
  ok: true,
  source_hashes_verified: 5,
  upstream_identical_sdl_duplicates_normalized: duplicates,
  fixed_graphql_documents_verified: Object.keys(fixedGraphQLDocuments).length,
  rest_and_compute_methods_verified: 26,
}));
