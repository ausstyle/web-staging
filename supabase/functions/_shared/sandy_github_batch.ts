/** Atomic fixed-repository batch commit. One provider mutation uses its native
 * expectedHeadOid precondition; no force update or caller GraphQL is accepted. */
import { argumentDigest } from "./sandy_api_protocol.ts";
import {
  bytesDigest,
  type Calls,
  decode64,
  fail,
  json,
  object,
  Refusal,
} from "../sandy-provider-supplement-api/runtime.ts";
type Obj = Record<string, unknown>;
const repository = "ausstyle/web-staging";
export const githubBatchDocument =
  `mutation SandyFixedRepositoryBatch($input:CreateCommitOnBranchInput!) {
 createCommitOnBranch(input:$input) {
  clientMutationId
  commit { oid tree { oid } parents(first:1) { nodes { oid } } repository { nameWithOwner } }
  ref { name prefix repository { nameWithOwner } target { oid } }
 }
}`;
const oid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
function refUrl(branch: string) {
  return new URL(
    "https://api.github.com/repos/ausstyle/web-staging/git/ref/" +
      encodeURIComponent("heads/" + branch),
  );
}
function branchName(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_][A-Za-z0-9_./-]{0,199}$/.test(value) ||
    value.includes("..") || value.endsWith("/") || value.endsWith(".") ||
    value.split("/").some((p) => !p || p.endsWith(".lock"))
  ) return fail("invalid_batch_branch", 400);
  return value;
}
export async function validateGithubBatchMaterial(args: Obj) {
  branchName(args.branch);
  if (
    args.repository !== repository || !oid(args.expected_head_oid) ||
    !Array.isArray(args.files) || args.files.length < 1 ||
    args.files.length > 32
  ) return fail("invalid_fixed_repository_batch", 400);
  const seen = new Set<string>(),
    additions: { path: string; contents: string }[] = [],
    manifest: { path: string; sha256: string }[] = [];
  let total = 0;
  for (const entry of args.files) {
    if (
      !object(entry) || typeof entry.path !== "string" ||
      entry.path.length > 240 ||
      !/^[A-Za-z0-9_.@+-]+(?:\/[A-Za-z0-9_.@+-]+)*$/.test(entry.path) ||
      entry.path.split("/").some((p) =>
        p === "." || p === ".." || p.toLowerCase() === ".git"
      ) || seen.has(entry.path)
    ) return fail("invalid_or_duplicate_batch_path", 400);
    const bytes = decode64(entry.content_base64, 65536);
    total += bytes.length;
    if (total > 262144) return fail("batch_total_source_size_limit", 413);
    const digest = await bytesDigest(bytes);
    if (digest !== entry.sha256) {
      return fail("batch_source_digest_mismatch", 400);
    }
    seen.add(entry.path);
    manifest.push({ path: entry.path, sha256: digest });
    additions.push({
      path: entry.path,
      contents: String(entry.content_base64),
    });
  }
  manifest.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (await argumentDigest(manifest) !== args.files_sha256) {
    return fail("batch_manifest_digest_mismatch", 400);
  }
  return additions;
}
function head(reply: Obj, branch: string): string {
  const target = object(reply.object) ? reply.object : {};
  if (
    reply.ref !== "refs/heads/" + branch || target.type !== "commit" ||
    !oid(target.sha)
  ) return fail("github_batch_head_response_mismatch", 502);
  return target.sha;
}
export async function executeGithubBatch(
  args: Obj,
  calls: Calls,
  admission: string,
): Promise<Obj> {
  const additions = await validateGithubBatchMaterial(args),
    branch = branchName(args.branch);
  const observed = head(json(await calls.request(refUrl(branch))), branch);
  if (observed !== args.expected_head_oid) {
    throw new Refusal("github_batch_expected_head_changed", 409);
  }
  const response = await calls.request(
    new URL("https://api.github.com/graphql"),
    "POST",
    JSON.stringify({
      query: githubBatchDocument,
      variables: {
        input: {
          branch: { repositoryNameWithOwner: repository, branchName: branch },
          clientMutationId: admission,
          expectedHeadOid: args.expected_head_oid,
          fileChanges: { additions },
          message: {
            headline: args.headline,
            ...(args.message_body === undefined
              ? {}
              : { body: args.message_body }),
          },
        },
      },
    }),
    "application/json",
    [200],
  );
  const value = json(response),
    data = object(value.data) ? value.data : {},
    payload = object(data.createCommitOnBranch)
      ? data.createCommitOnBranch
      : {};
  const commit = object(payload.commit) ? payload.commit : {},
    ref = object(payload.ref) ? payload.ref : {},
    tree = object(commit.tree) ? commit.tree : {},
    parents = object(commit.parents) ? commit.parents : {},
    nodes = Array.isArray(parents.nodes) ? parents.nodes : [],
    target = object(ref.target) ? ref.target : {};
  if (
    value.errors !== undefined &&
      (!Array.isArray(value.errors) || value.errors.length > 0) ||
    payload.clientMutationId !== admission || !oid(commit.oid) ||
    !oid(tree.oid) || !object(commit.repository) ||
    commit.repository.nameWithOwner !== repository || !object(ref.repository) ||
    ref.repository.nameWithOwner !== repository || ref.name !== branch ||
    ref.prefix !== "refs/heads/" || target.oid !== commit.oid ||
    nodes.length !== 1 || !object(nodes[0]) ||
    nodes[0].oid !== args.expected_head_oid
  ) {
    throw new Refusal(
      "github_batch_mutation_response_ambiguous",
      503,
      response.status,
      response.id,
      true,
    );
  }
  const readback = head(json(await calls.request(refUrl(branch))), branch);
  if (readback !== commit.oid) {
    throw new Refusal(
      "github_batch_postcondition_changed",
      503,
      calls.last?.status ?? null,
      calls.last?.id ?? null,
      true,
    );
  }
  return {
    repository,
    branch,
    previous_head_oid: args.expected_head_oid,
    commit_oid: commit.oid,
    tree_oid: tree.oid,
    files_changed: additions.length,
    native_precondition: "expectedHeadOid",
    branch_head_observed_match: true,
    transfer_state: "accepted",
    effect_confirmed: false,
  };
}
