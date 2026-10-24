/** Exact decimal arithmetic. Money crosses every boundary as a string. */
export function minor(value: string, precision: number): bigint {
  if (!Number.isInteger(precision) || precision < 0 || precision > 6) {
    throw Error("currency_precision");
  }
  if (
    typeof value !== "string" || !/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value) ||
    value.length > 40
  ) throw Error("invalid_decimal");
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  if (fraction.length > precision) throw Error("excess_precision");
  return (negative ? -1n : 1n) *
    BigInt(whole + fraction.padEnd(precision, "0"));
}
export function decimal(value: bigint, precision: number): string {
  const digits = (value < 0n ? -value : value).toString().padStart(
    precision + 1,
    "0",
  );
  return (value < 0n ? "-" : "") +
    (precision
      ? digits.slice(0, -precision) + "." + digits.slice(-precision)
      : digits);
}
/** Explicit half-away-from-zero rounding; never silently balance an FX voucher. */
export function roundRatio(
  value: bigint,
  numerator: bigint,
  denominator: bigint,
): bigint {
  if (numerator < 0n || denominator <= 0n) throw Error("invalid_ratio");
  const product = value * numerator;
  const magnitude = product < 0n ? -product : product;
  return (product < 0n ? -1n : 1n) *
    ((magnitude + denominator / 2n) / denominator);
}
export function date(value: string): string {
  if (
    typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  ) throw Error("invalid_date");
  return value;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.entries(value).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    ).map(([k, v]) =>
      JSON.stringify(k) + ":" + canonical(v)
    ).join(",") + "}";
  }
  return JSON.stringify(value);
}
export async function digest(value: unknown): Promise<string> {
  return contentHash(canonical(value));
}
/** SHA-256 of the actual UTF-8 source bytes, distinct from canonical record digests. */
export async function contentHash(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(value),
      ),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
