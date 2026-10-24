import { type Actor, CloudDomain } from "./domain.ts";
import { apiHandler } from "./api.ts";
if (!Deno.args.includes("--fixture-mode")) {
  throw Error(
    "Explicit --fixture-mode required. This server must never be deployed.",
  );
}
const root = Deno.args.find((a) => a.startsWith("--data="))?.slice(7);
if (!root?.startsWith("/tmp/sandy-cloud-")) {
  throw Error("Use a synthetic data directory /tmp/sandy-cloud-NAME");
}
const port = Number(
  Deno.args.find((a) => a.startsWith("--port="))?.slice(7) || 8787,
);
const origin = `http://127.0.0.1:${port}`;
const domain = new CloudDomain(
  root,
  Deno.readTextFileSync(new URL("./schema.sql", import.meta.url)),
);
const fixtures = [
  { id: "alice", tenantId: "fixture-a", name: "Alice · Personal & Acme" },
  { id: "reader", tenantId: "fixture-a", name: "Reader · Personal only" },
  { id: "bob", tenantId: "fixture-b", name: "Bob · Separate tenant" },
];
domain.seedWorkspace("personal-a", "fixture-a", "Personal", [
  ["alice", "owner"],
  ["reader", "reader"],
]);
domain.seedWorkspace("company-a", "fixture-a", "Acme Company", [[
  "alice",
  "owner",
]]);
domain.seedWorkspace("personal-b", "fixture-b", "Personal", [["bob", "owner"]]);
const tokens = new Map<string, Actor & { name: string }>(
  fixtures.map((f) => [crypto.randomUUID(), f]),
);
const handler = apiHandler(
  domain,
  (req) =>
    tokens.get(
      (req.headers.get("authorization") || "").replace(/^Bearer /, ""),
    ) as Actor ?? null,
  origin,
);
const html = Deno.readTextFileSync(new URL("./drive.html", import.meta.url));
console.log(
  "Synthetic fixture server only. " + origin +
    " — no cloud resources or live accounts.",
);
Deno.serve({ hostname: "127.0.0.1", port }, (req) => {
  const url = new URL(req.url);
  // Host check also rejects DNS rebinding and proxy ingress.
  if (url.origin !== origin) return new Response("Forbidden", { status: 403 });
  if (url.pathname === "/api") return handler(req);
  if (url.pathname === "/fixtures" && req.method === "GET") {
    return Response.json([...tokens].map(([token, f]) => ({ ...f, token })), {
      headers: { "cache-control": "no-store" },
    });
  }
  if (url.pathname === "/" && req.method === "GET") {
    return new Response(html, {
      headers: {
        "content-type": "text/html",
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      },
    });
  }
  return new Response("Not found", { status: 404 });
});
