/** Bounded catalogue transfer. Cursors select within an independently authorized
 * catalogue; they never confer authorization or select a handler. */
export const CATALOGUE_CURSOR = /^sc1\.[a-f0-9]{64}\.[1-9][0-9]{0,5}$/;
export type CatalogueRecord = Record<string, unknown>;
export function cataloguePage(
  records: CatalogueRecord[],
  version: string,
  limit: unknown,
  cursor: unknown,
  byteLimit = 1750000,
):
  | { ok: true; operations: CatalogueRecord[]; next_cursor?: string }
  | { ok: false; status: number; error: string } {
  if (
    !Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 100 ||
    (cursor !== undefined &&
      (typeof cursor !== "string" || !CATALOGUE_CURSOR.test(cursor)))
  ) return { ok: false, status: 400, error: "invalid_catalogue_page" };
  let offset = 0;
  if (typeof cursor === "string") {
    const [, expected, position] = cursor.split(".");
    offset = Number(position);
    if (expected !== version || offset >= records.length) {
      return {
        ok: false,
        status: 409,
        error: "catalogue_changed_restart_discovery",
      };
    }
  }
  const operations: CatalogueRecord[] = [];
  const encoder = new TextEncoder();
  let bytes = 2048;
  for (const record of records.slice(offset, offset + Number(limit))) {
    const size = encoder.encode(JSON.stringify(record)).byteLength + 1;
    if (bytes + size > byteLimit) {
      if (!operations.length) {
        return { ok: false, status: 503, error: "catalogue_entry_size_limit" };
      }
      break;
    }
    operations.push(record);
    bytes += size;
  }
  const next = offset + operations.length;
  return {
    ok: true,
    operations,
    ...(next < records.length ? { next_cursor: `sc1.${version}.${next}` } : {}),
  };
}
