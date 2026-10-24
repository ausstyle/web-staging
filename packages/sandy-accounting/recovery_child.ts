import { fixture } from "./fixture.ts";
const dir = process.argv[2];
if (!dir?.startsWith("/tmp/accounting-kill-")) {
  throw Error("isolated_fixture_directory_required");
}
const f = await fixture(dir);
await f.run("accounting.ledger.journal.post", f.journal(), "kill-retry");
console.log("COMMITTED");
setInterval(() => {}, 1000);
