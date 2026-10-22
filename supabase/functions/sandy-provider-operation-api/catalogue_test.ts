import assert from "node:assert/strict";
import catalogue, { decodeProviderCatalogue } from "./catalogue.ts";
async function sha256(value: Uint8Array) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(value))), b => b.toString(16).padStart(2, "0")).join(""); }
async function packed(value: Uint8Array) {
  const bytes = new Uint8Array(await new Response(new Blob([new Uint8Array(value)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
  return btoa(String.fromCharCode(...bytes));
}
Deno.test("generated gzip catalogue loads all595 reviewed contracts without external files or network", () => {
  assert.equal((catalogue as { operations: unknown[] }).operations.length, 595);
});
Deno.test("catalogue loader enforces byte count, digest, gzip integrity and strict UTF8 before parsing", async () => {
  const value = new TextEncoder().encode('{"reviewed":true}');
  const payload = await packed(value), digest = await sha256(value);
  assert.deepEqual(await decodeProviderCatalogue(payload, value.length, digest), { reviewed: true });
  for (const [body, size, sha] of [[payload, value.length - 1, digest], [payload, value.length + 1, digest], [payload, value.length, "0".repeat(64)], [payload.slice(0, -8), value.length, digest], ["not-base64", value.length, digest], [payload, 20 * 1024 * 1024, digest]] as [string, number, string][]) {
    await assert.rejects(decodeProviderCatalogue(body, size, sha), { message: "provider_catalogue_integrity_failed" });
  }
  const invalidUtf8 = new Uint8Array([0xff]);
  await assert.rejects(decodeProviderCatalogue(await packed(invalidUtf8), invalidUtf8.length, await sha256(invalidUtf8)), { message: "provider_catalogue_integrity_failed" });
});
