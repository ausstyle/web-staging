import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { fixture } from "./fixture.ts";
test("SIGKILL after committed posting preserves one effect and retry receipt", {
  timeout: 30000,
}, async () => {
  const dir = await mkdtemp("/tmp/accounting-kill-");
  const child = spawn(process.execPath, [
    new URL("./recovery_child.ts", import.meta.url).pathname,
    dir,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => stderr += chunk);
  try {
    const exited = once(child, "exit");
    let committed = false;
    for await (const chunk of child.stdout) {
      if (chunk.toString().includes("COMMITTED")) {
        committed = true;
        break;
      }
    }
    assert.ok(committed, stderr);
    child.kill("SIGKILL");
    await exited;
    const f = await fixture(dir);
    try {
      const retry = await f.run(
        "accounting.ledger.journal.post",
        f.journal(),
        "kill-retry",
      );
      assert.equal(retry.state, "POSTED");
      assert.equal(
        (await f.db.query<{ n: number }>(
          "SELECT count(*)::int n FROM accounting.journals",
        )).rows[0].n,
        1,
      );
      assert.equal((await f.run("accounting.audit.verify")).events, 1);
    } finally {
      await f.db.close();
    }
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    await rm(dir, { recursive: true, force: true });
  }
});
