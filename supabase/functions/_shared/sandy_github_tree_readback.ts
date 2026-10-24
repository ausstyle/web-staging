/** Bounded immutable Git-tree verification. No credentials, dispatch or scope
 * authority here. Unsupported/truncated trees stay accepted-but-unverified.
 */
import { argumentDigest } from "./sandy_api_protocol.ts";
type Obj = Record<string, unknown>;
type Entry = { path: string; mode: string; type: string; sha: string };
const object = (v: unknown): v is Obj =>
  !!v && typeof v === "object" && !Array.isArray(v);
const sha = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{40}$/.test(v);
const encoder = new TextEncoder();
function fail(): never {
  throw Error("github_tree_readback_not_confirmed");
}
function path(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    encoder.encode(value).length <= 1024 &&
    new TextDecoder("utf-8", { fatal: true }).decode(encoder.encode(value)) ===
      value &&
    !/[\\\u0000-\u001f\u007f]/.test(value) &&
    value.split("/").every((p) =>
      p !== "" && p !== "." && p !== ".." && encoder.encode(p).length <= 255
    );
}
function validMode(mode: unknown, type: unknown): boolean {
  return (type === "blob" && typeof mode === "string" &&
    ["100644", "100755", "120000"].includes(mode)) ||
    (type === "commit" && mode === "160000") ||
    (type === "tree" && mode === "040000");
}
const parent = (p: string) =>
  p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);
export async function gitObjectSha(
  kind: "blob" | "tree",
  bytes: Uint8Array,
): Promise<string> {
  const head = encoder.encode(`${kind} ${bytes.length}\0`),
    framed = new Uint8Array(head.length + bytes.length);
  framed.set(head);
  framed.set(bytes, head.length);
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-1", framed)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
function compare(a: Entry, b: Entry): number {
  const x = encoder.encode(basename(a.path) + (a.type === "tree" ? "/" : ""));
  const y = encoder.encode(basename(b.path) + (b.type === "tree" ? "/" : ""));
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return x.length - y.length;
}
async function directorySha(children: Entry[]): Promise<string> {
  const parts = children.slice().sort(compare).map((e) => {
    const prefix = encoder.encode(
      `${e.type === "tree" ? "40000" : e.mode} ${basename(e.path)}\0`,
    );
    const bytes = new Uint8Array(prefix.length + 20);
    bytes.set(prefix);
    bytes.set(
      Uint8Array.from(e.sha.match(/../g)!, (h) => parseInt(h, 16)),
      prefix.length,
    );
    return bytes;
  });
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    all.set(p, offset);
    offset += p.length;
  }
  return await gitObjectSha("tree", all);
}
/** Verify every directory hash, not just a provider-asserted root SHA. */
async function verifiedLeaves(
  raw: unknown,
  expected: string,
): Promise<Map<string, Entry>> {
  if (
    !object(raw) || raw.sha !== expected || raw.truncated !== false ||
    !Array.isArray(raw.tree) || raw.tree.length > 1024
  ) fail();
  const entries = new Map<string, Entry>();
  for (const e of raw.tree as unknown[]) {
    if (
      !object(e) || !path(e.path) || !validMode(e.mode, e.type) ||
      !sha(e.sha) || entries.has(e.path)
    ) fail();
    entries.set(e.path, {
      path: e.path,
      mode: e.mode as string,
      type: e.type as string,
      sha: e.sha,
    });
  }
  for (const e of entries.values()) {
    if (parent(e.path) && entries.get(parent(e.path))?.type !== "tree") fail();
  }
  const dirs = [...entries.values()].filter((e) => e.type === "tree").sort((
    a,
    b,
  ) => b.path.split("/").length - a.path.split("/").length);
  for (
    const dir of [...dirs, {
      path: "",
      mode: "040000",
      type: "tree",
      sha: expected,
    }]
  ) {
    const children = [...entries.values()].filter((e) =>
      parent(e.path) === dir.path
    );
    // Empty subtrees have no leaf representation; refuse rather than silently
    // erase them while comparing effects. Empty root trees remain supported.
    if (dir.path && children.length === 0) fail();
    if (await directorySha(children) !== dir.sha) fail();
  }
  return new Map([...entries].filter(([, e]) => e.type !== "tree"));
}
export async function verifyGitTree(
  args: Obj,
  raw: unknown,
  read: (url: string) => Promise<unknown>,
): Promise<Obj> {
  // Snapshot before the first await; caller mutation cannot change the proof.
  const snapshot: unknown = JSON.parse(JSON.stringify(args));
  if (!object(snapshot) || !object(snapshot.body)) fail();
  const body = snapshot.body;
  if (
    Object.keys(body).some((k) => !["base_tree", "tree"].includes(k)) ||
    (body.base_tree !== undefined && !sha(body.base_tree)) ||
    !Array.isArray(body.tree) || body.tree.length > 128 ||
    encoder.encode(JSON.stringify(body)).length > 100000 || !object(raw) ||
    !sha(raw.sha)
  ) fail();
  const resultSha = raw.sha, baseSha = body.base_tree as string | undefined;
  const patches: {
    path: string;
    mode: string;
    type: string;
    sha: string | null;
    content?: string;
  }[] = [];
  const paths = new Set<string>();
  let inlineBytes = 0;
  for (const e of body.tree as unknown[]) {
    if (
      !object(e) || !path(e.path) || !validMode(e.mode, e.type) ||
      e.type === "tree" || paths.has(e.path) ||
      Object.keys(e).some((k) =>
        !["path", "mode", "type", "sha", "content"].includes(k)
      ) ||
      (Object.hasOwn(e, "sha") === Object.hasOwn(e, "content"))
    ) fail();
    paths.add(e.path);
    if (Object.hasOwn(e, "content")) {
      if (e.type !== "blob" || typeof e.content !== "string") fail();
      const bytes = encoder.encode(e.content);
      if (
        new TextDecoder("utf-8", { fatal: true }).decode(bytes) !== e.content
      ) fail();
      inlineBytes += bytes.length;
      if (inlineBytes > 65536) fail();
      patches.push({
        path: e.path,
        mode: e.mode as string,
        type: e.type as string,
        sha: null,
        content: e.content,
      });
    } else {
      if (e.sha !== null && !sha(e.sha)) fail();
      patches.push({
        path: e.path,
        mode: e.mode as string,
        type: e.type as string,
        sha: e.sha as string | null,
      });
    }
  }
  // Conflicting parent/child patches are deliberately not interpreted in an
  // order-dependent manner. Ordinary nested leaf additions are supported.
  for (const p of paths) {
    for (const other of paths) {
      if (p !== other && p.startsWith(other + "/")) fail();
    }
  }
  const endpoint = (s: string) =>
    `https://api.github.com/repos/ausstyle/web-staging/git/trees/${s}?recursive=1`;
  const expected = baseSha
    ? await verifiedLeaves(await read(endpoint(baseSha)), baseSha)
    : new Map<string, Entry>();
  for (const p of patches) {
    if (p.sha === null && p.content === undefined) {
      if (!expected.delete(p.path)) fail();
      continue;
    }
    if (
      [...expected.keys()].some((k) =>
        k !== p.path &&
        (k.startsWith(p.path + "/") || p.path.startsWith(k + "/"))
      )
    ) fail();
    const value = p.content === undefined
      ? p.sha!
      : await gitObjectSha("blob", encoder.encode(p.content));
    expected.set(p.path, {
      path: p.path,
      mode: p.mode,
      type: p.type,
      sha: value,
    });
  }
  if (expected.size > 1024) fail();
  const observed = await verifiedLeaves(
    await read(endpoint(resultSha)),
    resultSha,
  );
  if (observed.size !== expected.size) fail();
  for (const [p, e] of expected) {
    const got = observed.get(p);
    if (
      !got || got.mode !== e.mode || got.type !== e.type || got.sha !== e.sha
    ) fail();
  }
  return {
    version: 1,
    kind: "github_tree",
    repository: "ausstyle/web-staging",
    tree_sha: resultSha,
    base_tree_sha: baseSha ?? null,
    input_sha256: await argumentDigest(snapshot),
    read_http_status: 200,
  };
}
