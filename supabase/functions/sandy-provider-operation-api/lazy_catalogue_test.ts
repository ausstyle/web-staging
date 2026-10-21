import assert from "node:assert/strict";
import { createLazyProviderCatalogue } from "./lazy_catalogue.ts";
const hash = "a".repeat(64);
Deno.test("local lazy loader fails closed on corrupt gzip, oversized shards and mismatched contract membership", async () => {
  const index = {
    "gcp.fixture.get": { shard: "fixture", contract_sha256: hash },
  };
  const invalid = createLazyProviderCatalogue(index, {
    fixture: () =>
      Promise.resolve({
        default: { packed: "invalid", expectedBytes: 20, sha256: hash },
      }),
  });
  await assert.rejects(invalid.load("gcp.fixture.get"), {
    message: "provider_catalogue_integrity_failed",
  });
  const huge = createLazyProviderCatalogue(index, {
    fixture: () =>
      Promise.resolve({
        default: { packed: "", expectedBytes: 1024 * 1024 + 1, sha256: hash },
      }),
  });
  await assert.rejects(huge.load("gcp.fixture.get"), {
    message: "provider_catalogue_integrity_failed",
  });
  const mismatch = createLazyProviderCatalogue(
    index,
    {
      fixture: () =>
        Promise.resolve({
          default: { packed: "", expectedBytes: 10, sha256: hash },
        }),
    },
    () =>
      Promise.resolve([{
        operation: "gcp.foreign.get",
        contract_sha256: hash,
      }]),
  );
  await assert.rejects(mismatch.load("gcp.fixture.get"), {
    message: "provider_catalogue_integrity_failed",
  });
  assert.equal(await mismatch.load("gcp.unknown.get"), undefined);
});
Deno.test("lazy loading deduplicates a shard and bounds simultaneous decode work and retained shard count", async () => {
  let calls = 0;
  const releases: (() => void)[] = [];
  const index = Object.fromEntries(
    [0, 1, 2, 3].map(
      (n) => ["gcp.fixture_" + n + ".get", {
        shard: String(n),
        contract_sha256: hash,
      }],
    ),
  );
  const loaders = Object.fromEntries([0, 1, 2, 3].map((n) => [String(n), () => {
    calls++;
    return Promise.resolve({
      default: { packed: String(n), expectedBytes: 10, sha256: hash },
    });
  }]));
  const loader = createLazyProviderCatalogue(index, loaders, async (name) => {
    await new Promise<void>((resolve) => releases.push(resolve));
    return [{
      operation: "gcp.fixture_" + name + ".get",
      contract_sha256: hash,
    }];
  });
  const pending = Object.keys(index).map((op) => loader.load(op));
  const duplicate = loader.load("gcp.fixture_0.get");
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(loader.stats().loading_shards, 2);
  assert.equal(calls, 2);
  releases.splice(0).forEach((release) => release());
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(loader.stats().loading_shards, 2);
  assert.equal(calls, 4);
  releases.splice(0).forEach((release) => release());
  await Promise.all([...pending, duplicate]);
  assert.equal(loader.stats().cached_shards, 2);
  assert.equal(loader.stats().loading_shards, 0);
  loader.clear();
  assert.equal(loader.stats().cached_plaintext_bytes, 0);
});
