/** Immutable GitHub readback. Fixed provider/repository, GET only, bounded data;
 * this neither authorizes an operation nor retries a mutation. */
import { argumentDigest } from "./sandy_api_protocol.ts";
import type { GithubReadbackReason } from "./sandy_execution_receipt_transport.ts";
import { githubMutationSemantics } from "./sandy_github_mutation_semantics.ts";
type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj =>
  !!v && typeof v === "object" && !Array.isArray(v);
const sha = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{40}$/.test(v);
export const githubReadbackOperations = new Set(
  Object.keys(githubMutationSemantics),
);
export type GithubReadback = { verified: true; proof: Obj } | {
  verified: false;
  reason: GithubReadbackReason;
};
class ReadbackError extends Error {
  constructor(readonly reason: GithubReadbackReason) {
    super(reason);
  }
}
function bytes(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || value.length > 100000) return null;
  // GitHub wraps base64 and appends a newline after padding as well as data.
  const normalized = value.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return null;
  try {
    const b = Uint8Array.from(
      atob(normalized),
      (c) => c.charCodeAt(0),
    );
    return b.length <= 65536 ? b : null;
  } catch {
    return null;
  }
}
const digest = async (b: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(b).buffer),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
export async function readGithubObservation(
  request: typeof fetch,
  url: string,
  token: string,
  maximum = 200000,
): Promise<unknown> {
  const target = new URL(url);
  if (
    target.origin !== "https://api.github.com" ||
    !target.pathname.startsWith("/repos/ausstyle/web-staging/") ||
    target.username || target.password || target.hash ||
    !Number.isSafeInteger(maximum) ||
    maximum < 1 || maximum > 2 * 1024 * 1024
  ) {
    throw new ReadbackError("github_readback_unsupported");
  }
  let response: Response | undefined;
  // Retry only immutable GETs. A new commit can be briefly unavailable on a
  // different provider replica; a failed verification must never replay PUT/POST.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await request(url, {
        method: "GET",
        redirect: "error",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
        },
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      if (attempt === 2) {
        throw new ReadbackError("github_readback_transport_unavailable");
      }
    }
    const retryable = !response ||
      [404, 408, 429, 500, 502, 503, 504].includes(response.status);
    if (!retryable || attempt === 2) break;
    await response?.body?.cancel();
    response = undefined;
    await new Promise((resolve) =>
      setTimeout(resolve, attempt === 0 ? 250 : 750)
    );
  }
  if (!response) {
    throw new ReadbackError("github_readback_transport_unavailable");
  }
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel();
    const classified = [
      400,
      401,
      403,
      404,
      408,
      409,
      422,
      429,
      500,
      502,
      503,
      504,
    ].includes(response.status);
    throw new ReadbackError(
      classified
        ? `github_readback_http_${response.status}` as GithubReadbackReason
        : "github_readback_http_error",
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new ReadbackError("github_readback_response_limit");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    throw new ReadbackError("github_readback_invalid_json");
  }
}
export async function verifyGithubReadback(
  operation: string,
  args: Obj,
  raw: unknown,
  token: string,
  request: typeof fetch = fetch,
): Promise<GithubReadback> {
  if (
    !githubReadbackOperations.has(operation) || !object(raw) ||
    !object(args.body)
  ) return { verified: false, reason: "github_readback_unsupported" };
  const body = { ...args.body };
  if (
    githubMutationSemantics[operation] === "commit" &&
    body.parents === undefined
  ) body.parents = [];
  try {
    if (githubMutationSemantics[operation] === "blob") {
      if (
        typeof body.content !== "string" || body.content.length > 100000 ||
        !sha(raw.sha)
      ) throw Error();
      const encoding = body.encoding ?? "utf-8";
      const expected = encoding === "base64"
        ? bytes(body.content)
        : encoding === "utf-8"
        ? new TextEncoder().encode(body.content)
        : null;
      if (
        !expected || expected.length > 65536 ||
        (encoding === "utf-8" &&
          new TextDecoder("utf-8", { ignoreBOM: true }).decode(expected) !==
            body.content)
      ) throw Error();
      const header = new TextEncoder().encode(`blob ${expected.length}\0`);
      const framed = new Uint8Array(header.length + expected.length);
      framed.set(header);
      framed.set(expected, header.length);
      const blobSha = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-1", framed)),
        (v) => v.toString(16).padStart(2, "0"),
      ).join("");
      if (raw.sha !== blobSha) throw Error();
      const observed = await readGithubObservation(
        request,
        `https://api.github.com/repos/ausstyle/web-staging/git/blobs/${blobSha}`,
        token,
      );
      if (
        !object(observed) || observed.sha !== blobSha ||
        observed.encoding !== "base64" ||
        observed.size !== expected.length
      ) throw Error();
      const actual = bytes(observed.content);
      if (
        !actual || actual.length !== expected.length ||
        actual.some((v, i) => v !== expected[i])
      ) throw Error();
      return {
        verified: true,
        proof: {
          version: 1,
          kind: "github_blob",
          repository: "ausstyle/web-staging",
          blob_sha: blobSha,
          byte_length: actual.length,
          content_sha256: await digest(actual),
          read_http_status: 200,
        },
      };
    }
    if (githubMutationSemantics[operation] === "ref") {
      const ref = typeof body.ref === "string"
        ? body.ref
        : object(args.path)
        ? args.path.ref
        : null;
      if (
        typeof ref !== "string" ||
        !/^(refs\/)?heads\/engineering\/[A-Za-z0-9_./-]+$/.test(ref) ||
        /(^|\/)\.{1,2}(\/|$)/.test(ref) || !sha(body.sha) || body.force === true
      ) throw Error();
      const normalized = ref.replace(/^refs\//, "");
      if (
        raw.ref !== "refs/" + normalized || !object(raw.object) ||
        raw.object.sha !== body.sha
      ) throw Error();
      const observed = await readGithubObservation(
        request,
        `https://api.github.com/repos/ausstyle/web-staging/git/ref/${
          normalized.split("/").map(encodeURIComponent).join("/")
        }`,
        token,
      );
      if (
        !object(observed) || observed.ref !== raw.ref ||
        !object(observed.object) || observed.object.sha !== body.sha ||
        observed.object.type !== "commit"
      ) throw Error();
      return {
        verified: true,
        proof: {
          version: 1,
          kind: "github_ref",
          repository: "ausstyle/web-staging",
          ref: raw.ref,
          commit_sha: body.sha,
          read_http_status: 200,
        },
      };
    }
    if (githubMutationSemantics[operation] === "commit") {
      if (
        !sha(raw.sha) || !sha(body.tree) || !Array.isArray(body.parents) ||
        body.parents.length > 10 || !body.parents.every(sha) ||
        typeof body.message !== "string"
      ) throw Error();
      const observed = await readGithubObservation(
        request,
        `https://api.github.com/repos/ausstyle/web-staging/git/commits/${raw.sha}`,
        token,
      );
      if (
        !object(observed) || observed.sha !== raw.sha ||
        !object(observed.tree) || observed.tree.sha !== body.tree ||
        !(observed.message === body.message ||
          (body.message.endsWith("\n") &&
            observed.message === body.message.slice(0, -1))) ||
        !Array.isArray(observed.parents) ||
        observed.parents.length !== body.parents.length ||
        observed.parents.some((p, i) =>
          !object(p) || p.sha !== (body.parents as string[])[i]
        )
      ) throw Error();
      return {
        verified: true,
        proof: {
          version: 1,
          kind: "github_commit",
          repository: "ausstyle/web-staging",
          commit_sha: raw.sha,
          tree_sha: body.tree,
          parents_sha256: await argumentDigest(body.parents),
          message_sha256: await digest(new TextEncoder().encode(body.message)),
          read_http_status: 200,
        },
      };
    }
    if (githubMutationSemantics[operation] === "file_delete") {
      const path = object(args.path) ? args.path.path : undefined;
      if (
        typeof path !== "string" || !path || path.length > 1024 ||
        /[\\%?#\u0000-\u001f\u007f]/.test(path) ||
        path.split("/").some((p) => !p || p === "." || p === "..") ||
        !object(raw.commit) || !sha(raw.commit.sha) || !sha(body.sha) ||
        raw.content !== null
      ) throw Error();
      // A 404 alone could mean a new commit is not visible yet. First prove the
      // immutable commit exists, then prove the exact path is absent there.
      const revision = await readGithubObservation(
        request,
        `https://api.github.com/repos/ausstyle/web-staging/git/commits/${raw.commit.sha}`,
        token,
      );
      if (!object(revision) || revision.sha !== raw.commit.sha) throw Error();
      const response = await request(
        `https://api.github.com/repos/ausstyle/web-staging/contents/${
          path.split("/").map(encodeURIComponent).join("/")
        }?ref=${raw.commit.sha}`,
        {
          method: "GET",
          redirect: "error",
          signal: AbortSignal.timeout(5000),
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
          },
        },
      );
      await response.body?.cancel();
      if (response.status !== 404) throw Error();
      return {
        verified: true,
        proof: {
          version: 1,
          kind: "github_file_deleted",
          repository: "ausstyle/web-staging",
          commit_sha: raw.commit.sha,
          blob_sha: body.sha,
          path,
          read_http_status: 404,
        },
      };
    }
    const path = object(args.path) ? args.path.path : undefined;
    if (
      typeof path !== "string" || path.length > 1024 || !path ||
      /[\\%?#\u0000-\u001f\u007f]/.test(path) || path.split("/").some((p) =>
        !p || p === "." || p === ".."
      ) || !object(raw.commit) || !sha(raw.commit.sha) ||
      !object(raw.content) || !sha(raw.content.sha)
    ) throw Error();
    const expected = bytes(body.content);
    if (!expected) throw Error();
    const observed = await readGithubObservation(
      request,
      `https://api.github.com/repos/ausstyle/web-staging/contents/${
        path.split("/").map(encodeURIComponent).join("/")
      }?ref=${raw.commit.sha}`,
      token,
    );
    if (
      !object(observed) || observed.path !== path || observed.type !== "file" ||
      observed.encoding !== "base64" || observed.sha !== raw.content.sha ||
      observed.size !== expected.length
    ) throw Error();
    const actual = bytes(observed.content);
    if (
      !actual || actual.length !== expected.length ||
      actual.some((v, i) => v !== expected[i])
    ) throw Error();
    return {
      verified: true,
      proof: {
        version: 1,
        kind: "github_file",
        repository: "ausstyle/web-staging",
        commit_sha: raw.commit.sha,
        blob_sha: raw.content.sha,
        path,
        byte_length: actual.length,
        content_sha256: await digest(actual),
        read_http_status: 200,
      },
    };
  } catch (error) {
    return {
      verified: false,
      reason: error instanceof ReadbackError
        ? error.reason
        : "github_readback_not_confirmed",
    };
  }
}
