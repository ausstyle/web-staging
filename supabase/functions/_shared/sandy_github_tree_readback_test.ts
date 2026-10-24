import assert from "node:assert/strict";
import { verifyGithubReadback } from "./sandy_github_readback.ts";
import { argumentDigest } from "./sandy_api_protocol.ts";
type Leaf = { mode: string; type: string; sha: string };
async function fixture(
  fn: (
    f: {
      blob: (s: string) => Promise<string>;
      tree: (leaves: Record<string, Leaf>) => Promise<any>;
    },
  ) => Promise<void>,
) {
  const dir = await Deno.makeTempDir({ prefix: "sandy-tree-oracle-" });
  const git = async (args: string[], input = "") => {
    const c = new Deno.Command("git", {
      args: ["--git-dir=" + dir, ...args],
      env: { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const w = c.stdin.getWriter();
    await w.write(new TextEncoder().encode(input));
    await w.close();
    const r = await c.output();
    assert.equal(r.code, 0, new TextDecoder().decode(r.stderr));
    return new TextDecoder().decode(r.stdout);
  };
  try {
    await git(["init", "--bare", dir]);
    const blob = async (s: string) =>
      (await git(["hash-object", "-w", "--stdin"], s)).trim();
    const tree = async (leaves: Record<string, Leaf>) => {
      const build = async (prefix: string): Promise<string> => {
        const entries: string[] = [];
        const dirs = new Set<string>();
        for (const [p, e] of Object.entries(leaves)) {
          if (!p.startsWith(prefix)) continue;
          const rest = p.slice(prefix.length);
          if (rest.includes("/")) dirs.add(rest.split("/")[0]);
          else entries.push(`${e.mode} ${e.type} ${e.sha}\t${rest}`);
        }
        for (const d of dirs) {
          entries.push(`040000 tree ${await build(prefix + d + "/")}\t${d}`);
        }
        return (await git(
          ["mktree", "--missing"],
          entries.reverse().join("\n") + (entries.length ? "\n" : ""),
        )).trim();
      };
      const sha = await build("");
      const listing = await git(["ls-tree", "-r", "-t", "-z", sha]);
      return {
        sha,
        truncated: false,
        tree: listing.split("\0").filter(Boolean).map((line) => {
          const [meta, path] = line.split("\t");
          const [mode, type, sha] = meta.split(" ");
          return { path, mode, type, sha };
        }),
      };
    };
    await fn({ blob, tree });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}
const leaf = (sha: string, mode = "100644"): Leaf => ({
  sha,
  mode,
  type: mode === "160000" ? "commit" : "blob",
});
async function verify(
  body: unknown,
  result: any,
  observations: any[],
  mutate?: () => void,
) {
  let reads = 0;
  const args = { body };
  const evidence = await verifyGithubReadback(
    "github.git.trees.create",
    args,
    { sha: result.sha, url: "https://evil.invalid/ignored" },
    "PRIVATE",
    (async (url, init) => {
      assert.match(
        String(url),
        /^https:\/\/api.github.com\/repos\/ausstyle\/web-staging\/git\/trees\/[a-f0-9]{40}\?recursive=1$/,
      );
      assert.equal(init?.method, "GET");
      assert.equal(init?.redirect, "error");
      mutate?.();
      return Response.json(observations[reads++]);
    }) as typeof fetch,
  );
  return { evidence, reads };
}
Deno.test("tree proof matches independent Git mktree for nested unicode, mode and directory sorting", async () => {
  await fixture(async (f) => {
    const a = await f.blob("α\n"), b = await f.blob("kept");
    const observed = await f.tree({
      "dir/é.txt": leaf(a),
      "dir.txt": leaf(b),
      "z": leaf(b, "100755"),
      "link": leaf(b, "120000"),
      "module": leaf("a".repeat(40), "160000"),
    });
    const body = {
      tree: [
        { path: "dir/é.txt", mode: "100644", type: "blob", content: "α\n" },
        { path: "dir.txt", ...leaf(b) },
        { path: "z", ...leaf(b, "100755") },
        { path: "link", ...leaf(b, "120000") },
        { path: "module", ...leaf("a".repeat(40), "160000") },
      ],
    };
    const { evidence, reads } = await verify(body, observed, [observed]);
    assert.equal(reads, 1);
    assert.equal(evidence.verified, true);
    if (evidence.verified) {
      assert.equal(evidence.proof.input_sha256, await argumentDigest({ body }));
      assert.equal(evidence.proof.base_tree_sha, null);
      assert.equal(evidence.proof.tree_sha, observed.sha);
      assert.ok(!JSON.stringify(evidence).includes("PRIVATE"));
    }
  });
});
Deno.test("tree settlement retains unchanged base entries and verifies replacements/deletion", async () => {
  await fixture(async (f) => {
    const a = await f.blob("old"), b = await f.blob("new");
    const base = await f.tree({
      "keep/a": leaf(a),
      "replace": leaf(a),
      "remove": leaf(a),
    });
    const result = await f.tree({ "keep/a": leaf(a), "replace": leaf(b) });
    const body = {
      base_tree: base.sha,
      tree: [{ path: "replace", ...leaf(b) }, {
        path: "remove",
        mode: "100644",
        type: "blob",
        sha: null,
      }],
    };
    assert.equal(
      (await verify(body, result, [base, result])).evidence.verified,
      true,
    );
    const missing = await f.tree({ replace: leaf(b) });
    assert.equal(
      (await verify(body, missing, [base, missing])).evidence.verified,
      false,
    );
  });
});
Deno.test("tree verification refuses altered root, child hash, mode, duplicates, truncation and missing parents", async () => {
  await fixture(async (f) => {
    const a = await f.blob("x");
    const good = await f.tree({ "d/file": leaf(a) });
    const body = { tree: [{ path: "d/file", ...leaf(a) }] };
    const bads = [
      { ...good, truncated: true },
      { ...good, sha: "b".repeat(40) },
      { ...good, tree: [...good.tree, good.tree[0]] },
      {
        ...good,
        tree: good.tree.filter((e: any) => e.type !== "tree"),
      },
      {
        ...good,
        tree: good.tree.map((e: any) =>
          e.type === "tree" ? { ...e, sha: "c".repeat(40) } : e
        ),
      },
      {
        ...good,
        tree: good.tree.map((e: any) =>
          e.type === "blob" ? { ...e, mode: "100755" } : e
        ),
      },
    ];
    for (const b of bads) {
      assert.equal((await verify(body, good, [b])).evidence.verified, false);
    }
  });
});
Deno.test("unsupported tree patches fail before any provider read", async () => {
  const sha = "a".repeat(40), valid = { path: "x", ...leaf(sha) };
  for (
    const body of [
      { tree: [valid, valid] },
      { tree: [{ ...valid, path: "../x" }] },
      { tree: [{ ...valid, content: "ambiguous" }] },
      { tree: [{ ...valid, type: "tree", mode: "040000" }] },
      { tree: [valid, { ...valid, path: "x/y" }] },
      { base_tree: "../bad", tree: [] },
      {
        tree: Array.from(
          { length: 129 },
          (_, i) => ({ ...valid, path: String(i) }),
        ),
      },
      {
        tree: [{
          path: "x",
          mode: "100644",
          type: "blob",
          content: "x".repeat(65537),
        }],
      },
    ]
  ) {
    const r = await verify(body, { sha }, []);
    assert.equal(r.reads, 0);
    assert.equal(r.evidence.verified, false);
  }
});
Deno.test("missing base deletion, unreferenced additions and semantically different trees never settle", async () => {
  await fixture(async (f) => {
    const a = await f.blob("x"), b = await f.blob("y");
    const base = await f.tree({ keep: leaf(a) });
    const result = await f.tree({ keep: leaf(a), extra: leaf(b) });
    assert.equal(
      (await verify({ base_tree: base.sha, tree: [] }, result, [base, result]))
        .evidence.verified,
      false,
    );
    assert.equal(
      (await verify(
        {
          base_tree: base.sha,
          tree: [{ path: "missing", mode: "100644", type: "blob", sha: null }],
        },
        result,
        [base, result],
      )).evidence.verified,
      false,
    );
  });
});
Deno.test("empty root and immutable request snapshot are supported", async () => {
  await fixture(async (f) => {
    const empty = await f.tree({});
    assert.equal(
      (await verify({ tree: [] }, empty, [empty])).evidence.verified,
      true,
    );
    const a = await f.blob("old"), result = await f.tree({ file: leaf(a) });
    const body = { tree: [{ path: "file", ...leaf(a) }] };
    const digest = await argumentDigest({ body });
    const r = await verify(
      body,
      result,
      [result],
      () => body.tree[0].sha = "f".repeat(40),
    );
    assert.equal(r.evidence.verified, true);
    if (r.evidence.verified) {
      assert.equal(r.evidence.proof.input_sha256, digest);
    }
  });
});
