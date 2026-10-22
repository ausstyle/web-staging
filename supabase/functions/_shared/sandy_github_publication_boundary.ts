/** Standing Git source publication protects approved security/credential files
 * across the complete referenced tree, including indirect base-tree changes.
 * Detached Git objects do not grant reference publication authority. */
import { readGithubObservation } from "./sandy_github_readback.ts";
type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj =>
  !!v && typeof v === "object" && !Array.isArray(v);
const sha = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{40}$/.test(v);
const root = "https://api.github.com/repos/ausstyle/web-staging/git/";
const protectedPath = (p: string) =>
  /(^|\/)(\.env[^/]*|\.git|\.github)(\/|$)|(^|\/)[^/]*(credential|private.?key|service.?account)[^/]*\.json$|\.(pem|key|p12|pfx)$/i
    .test(p);
export type GithubPublicationRequest = {
  admission_id: string;
  operation: string;
  method: "POST" | "PATCH";
  arguments: Obj;
  token: string;
};
export type GithubPublicationResult = { allowed: true } | {
  allowed: false;
  error:
    | "engineering_source_boundary_unavailable"
    | "engineering_protected_source_denied"
    | "engineering_source_authority_denied";
  http_status: 403 | 503;
};
type Db = {
  rpc(name: string, args: Obj): PromiseLike<{ data: unknown; error: unknown }>;
};
export function createGithubPublicationBoundary(
  db: Db,
  request: typeof fetch = fetch,
) {
  // Immutable observations only. The current credential must still read main
  // on every publication, and the requested mutation retains provider IAM.
  const cache = new Map<string, Map<string, string>>();
  async function protectedTree(commit: string, token: string) {
    const cached = cache.get(commit);
    if (cached) return cached;
    const metadata = await readGithubObservation(
      request,
      root + "commits/" + commit,
      token,
    );
    if (
      !object(metadata) || metadata.sha !== commit || !object(metadata.tree) ||
      !sha(metadata.tree.sha)
    ) throw Error();
    const tree = await readGithubObservation(
      request,
      root + "trees/" + metadata.tree.sha + "?recursive=1",
      token,
      2 * 1024 * 1024,
    );
    if (
      !object(tree) || tree.sha !== metadata.tree.sha ||
      tree.truncated !== false || !Array.isArray(tree.tree) ||
      tree.tree.length > 10000
    ) throw Error();
    const entries = new Map<string, { type: string; value: string }>();
    for (const item of tree.tree) {
      if (
        !object(item) || typeof item.path !== "string" || !item.path ||
        item.path.startsWith("/") ||
        /(^|\/)\.{1,2}(\/|$)|[\u0000-\u001f\u007f]/.test(item.path) ||
        !sha(item.sha) || typeof item.mode !== "string" ||
        !["blob", "tree", "commit"].includes(String(item.type)) ||
        entries.has(item.path)
      ) throw Error();
      entries.set(item.path, {
        type: String(item.type),
        value: item.type + ":" + item.mode + ":" + item.sha,
      });
    }
    const result = new Map<string, string>();
    for (const [path, entry] of entries) {
      if (!protectedPath(path)) continue;
      // Nonempty directory hashes may differ when two independently approved
      // baselines contain different files. Every leaf (and empty directory)
      // must independently match an approved path, mode, type and object hash.
      if (
        entry.type === "tree" &&
        [...entries.keys()].some((p) => p.startsWith(path + "/"))
      ) continue;
      result.set(path, entry.value);
    }
    if (cache.size >= 32) cache.delete(cache.keys().next().value!);
    cache.set(commit, result);
    return result;
  }
  return async (
    input: GithubPublicationRequest,
  ): Promise<GithubPublicationResult> => {
    try {
      const { data, error } = await db.rpc(
        "sandy_engineering_github_publication_context",
        { p_admission_id: input.admission_id },
      );
      if (error || !object(data)) throw Error();
      if (data.ok !== true) {
        return {
          allowed: false,
          error: "engineering_source_authority_denied",
          http_status: 403,
        };
      }
      // This is an existing exact, independently approved human-owner admission,
      // never a fallback for a standing engineering request.
      if (data.mode === "explicit_owner_approval") return { allowed: true };
      if (
        data.mode !== "standing_engineering" || !sha(data.baseline_commit) ||
        data.repository !== "ausstyle/web-staging" ||
        data.operation !== input.operation || data.method !== input.method ||
        typeof data.delegation_id !== "string" ||
        !/^[a-f0-9-]{36}$/.test(data.delegation_id) ||
        !Number.isSafeInteger(data.version) || Number(data.version) < 1 ||
        !object(input.arguments.body) || !sha(input.arguments.body.sha)
      ) throw Error();
      const ref = input.method === "POST"
        ? input.arguments.body.ref
        : object(input.arguments.path)
        ? input.arguments.path.ref
        : null;
      if (
        !["POST", "PATCH"].includes(input.method) || typeof ref !== "string" ||
        !/^(refs\/)?heads\/engineering\/[A-Za-z0-9_./-]+$/.test(ref) ||
        /(^|\/)\.{1,2}(\/|$)/.test(ref) || input.arguments.body.force === true
      ) throw Error();
      const main = await readGithubObservation(
        request,
        root + "ref/heads/main",
        input.token,
      );
      if (
        !object(main) || main.ref !== "refs/heads/main" ||
        !object(main.object) || !sha(main.object.sha) ||
        main.object.type !== "commit"
      ) throw Error();
      const approved = await protectedTree(data.baseline_commit, input.token);
      const current = await protectedTree(main.object.sha, input.token);
      const candidate = await protectedTree(
        input.arguments.body.sha,
        input.token,
      );
      for (
        const path of new Set([
          ...approved.keys(),
          ...current.keys(),
          ...candidate.keys(),
        ])
      ) {
        const value = candidate.get(path);
        if (
          value === undefined ||
          value !== approved.get(path) && value !== current.get(path)
        ) {
          return {
            allowed: false,
            error: "engineering_protected_source_denied",
            http_status: 403,
          };
        }
      }
      const final = await db.rpc(
        "sandy_engineering_github_publication_context",
        { p_admission_id: input.admission_id },
      );
      if (final.error || !object(final.data)) throw Error();
      if (
        final.data.ok !== true || final.data.mode !== data.mode ||
        final.data.baseline_commit !== data.baseline_commit ||
        final.data.delegation_id !== data.delegation_id ||
        final.data.version !== data.version
      ) {
        return {
          allowed: false,
          error: "engineering_source_authority_denied",
          http_status: 403,
        };
      }
      return { allowed: true };
    } catch {
      return {
        allowed: false,
        error: "engineering_source_boundary_unavailable",
        http_status: 503,
      };
    }
  };
}
