/** Bounded, local-only contract loading. Every shard is digest checked before use. */
import { decodeProviderCatalogue } from "./catalogue.ts";
type Row = Record<string, unknown>;
export type OperationLocation = { shard: string; contract_sha256: string };
export type PackedShard = {
  packed: string;
  expectedBytes: number;
  sha256: string;
};
type Loader = () => Promise<{ default: PackedShard }>;
const object = (value: unknown): value is Row =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export function createLazyProviderCatalogue(
  index: Readonly<Record<string, OperationLocation>>,
  loaders: Record<string, Loader>,
  decode = decodeProviderCatalogue,
) {
  const maxShardBytes = 1024 * 1024, maxCacheBytes = 2 * maxShardBytes;
  const cache = new Map<
    string,
    { operations: Map<string, Row>; bytes: number }
  >();
  const pending = new Map<string, Promise<Map<string, Row>>>();
  let cachedBytes = 0, loading = 0;
  const waiters: (() => void)[] = [];
  const acquire = async () => {
    if (loading >= 2) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    } else loading++;
  };
  const release = () => {
    const next = waiters.shift();
    if (next) next();
    else loading--;
  };
  const shard = async (name: string): Promise<Map<string, Row>> => {
    const ready = cache.get(name);
    if (ready) {
      cache.delete(name);
      cache.set(name, ready);
      return ready.operations;
    }
    const active = pending.get(name);
    if (active) return active;
    const promise = (async () => {
      await acquire();
      try {
        if (!Object.hasOwn(loaders, name)) throw Error();
        const { default: packed } = await loaders[name]();
        if (
          !Number.isSafeInteger(packed.expectedBytes) ||
          packed.expectedBytes < 1 || packed.expectedBytes > maxShardBytes
        ) throw Error();
        const raw = await decode(
          packed.packed,
          packed.expectedBytes,
          packed.sha256,
        );
        if (!Array.isArray(raw) || raw.length < 1 || raw.length > 48) {
          throw Error();
        }
        const operations = new Map<string, Row>();
        for (const row of raw) {
          if (
            !object(row) || typeof row.operation !== "string" ||
            !Object.hasOwn(index, row.operation) ||
            index[row.operation].shard !== name ||
            index[row.operation].contract_sha256 !== row.contract_sha256 ||
            operations.has(row.operation)
          ) throw Error();
          operations.set(row.operation, Object.freeze(row));
        }
        const expected = Object.entries(index).filter(([, location]) =>
          location.shard === name
        ).map(([operation]) => operation);
        if (
          expected.length !== operations.size ||
          expected.some((operation) => !operations.has(operation))
        ) throw Error();
        while (
          (cachedBytes + packed.expectedBytes > maxCacheBytes ||
            cache.size >= 2) && cache.size
        ) {
          const oldest = cache.keys().next().value!;
          cachedBytes -= cache.get(oldest)!.bytes;
          cache.delete(oldest);
        }
        cache.set(name, { operations, bytes: packed.expectedBytes });
        cachedBytes += packed.expectedBytes;
        return operations;
      } catch {
        throw Error("provider_catalogue_integrity_failed");
      } finally {
        release();
        pending.delete(name);
      }
    })();
    pending.set(name, promise);
    return promise;
  };
  return {
    load: async (operation: string): Promise<Row | undefined> => {
      if (!Object.hasOwn(index, operation)) return undefined;
      return (await shard(index[operation].shard)).get(operation);
    },
    clear: () => {
      cache.clear();
      cachedBytes = 0;
    },
    stats: () => ({
      cached_shards: cache.size,
      cached_plaintext_bytes: cachedBytes,
      pending_shards: pending.size,
      loading_shards: loading,
      max_cached_plaintext_bytes: maxCacheBytes,
      max_loading_shards: 2,
    }),
  };
}
