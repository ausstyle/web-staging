/** Loopback-only synthetic fixture adapter. NOT an alternative production API. */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fixture } from "./fixture.ts";
const port = Number(process.env.ACCOUNTING_FIXTURE_PORT ?? "4313");
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw Error("invalid_fixture_port");
}
const f = await fixture(
  process.env.ACCOUNTING_FIXTURE_DIR ?? "/tmp/sandy-accounting-synthetic-books",
);
const html = await readFile(
  new URL("./workspace.html", import.meta.url),
  "utf8",
);
const origin = "http://127.0.0.1:" + port;
const token = crypto.randomUUID();
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'nonce-" + token + "'; style-src 'nonce-" +
      token +
      "'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  );
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.headers.host !== new URL(origin).host) {
    return json(403, { error: "invalid_host" });
  }
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html.replaceAll("__NONCE__", token));
    return;
  }
  if (req.method !== "POST" || req.url !== "/api/run") {
    return json(404, { error: "not_found" });
  }
  if (
    req.headers.origin !== origin ||
    req.headers["x-synthetic-session"] !== token ||
    req.headers["content-type"] !== "application/json"
  ) return json(403, { error: "local_fixture_session_required" });
  try {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 250000) {
        json(413, { error: "request_too_large" });
        return;
      }
    }
    const input = JSON.parse(raw);
    const result = await f.app.execute("local-synthetic-session", input);
    json(200, { result });
  } catch (e) {
    json(400, { error: e instanceof Error ? e.message : "request_failed" });
  }
});
server.listen(
  port,
  "127.0.0.1",
  () => console.log("Synthetic Sandy Accounting workspace: " + origin),
);
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () =>
    server.close(async () => {
      await f.db.close();
      process.exit(0);
    }));
}
