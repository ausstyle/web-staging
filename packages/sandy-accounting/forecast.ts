import { date, decimal, minor } from "./money.ts";
export type ForecastInput = {
  as_of: string;
  captured_at: string;
  currency: string;
  precision: number;
  opening: string;
  horizon: "13_weeks" | "12_months";
  flows: {
    source_id: string;
    due: string;
    amount: string;
    probability_bps: number;
  }[];
};
/** Deterministic scenarios, never posted facts or promises of future collections. */
export function forecast(input: ForecastInput) {
  date(input.as_of);
  if (
    !Number.isFinite(Date.parse(input.captured_at)) ||
    !["13_weeks", "12_months"].includes(input.horizon)
  ) throw Error("forecast_metadata");
  const start = new Date(input.as_of + "T00:00:00Z"),
    boundaries: Date[] = [start];
  for (let i = 1; i <= (input.horizon === "13_weeks" ? 13 : 12); i++) {
    const next = new Date(start);
    if (input.horizon === "13_weeks") {
      next.setUTCDate(next.getUTCDate() + i * 7);
    } else {
      const day = start.getUTCDate();
      next.setUTCDate(1);
      next.setUTCMonth(next.getUTCMonth() + i);
      const last = new Date(
        Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
      ).getUTCDate();
      next.setUTCDate(Math.min(day, last));
    }
    boundaries.push(next);
  }
  const ids = new Set<string>();
  for (const f of input.flows) {
    date(f.due);
    minor(f.amount, input.precision);
    if (
      !f.source_id || ids.has(f.source_id) ||
      !Number.isInteger(f.probability_bps) || f.probability_bps < 0 ||
      f.probability_bps > 10000
    ) throw Error("forecast_input");
    ids.add(f.source_id);
  }
  let balance = minor(input.opening, input.precision);
  const buckets = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const from = boundaries[i].toISOString().slice(0, 10),
      until = boundaries[i + 1].toISOString().slice(0, 10);
    const contributing = input.flows.filter((f) =>
      (f.due < input.as_of ? input.as_of : f.due) >= from &&
      (f.due < input.as_of ? input.as_of : f.due) < until
    );
    let movement = 0n;
    for (const f of contributing) {
      const product = minor(f.amount, input.precision) *
        BigInt(f.probability_bps);
      movement += (product < 0n ? -1n : 1n) *
        (((product < 0n ? -product : product) + 5000n) / 10000n);
    }
    const opening = balance;
    balance += movement;
    buckets.push({
      from,
      until_exclusive: until,
      opening: decimal(opening, input.precision),
      movement: decimal(movement, input.precision),
      closing: decimal(balance, input.precision),
      source_ids: contributing.map((f) => f.source_id),
    });
  }
  return {
    state: "FORECAST",
    currency: input.currency,
    as_of: input.as_of,
    captured_at: input.captured_at,
    horizon: input.horizon,
    buckets,
    excluded_source_ids: input.flows.filter((f) =>
      f.due >= boundaries.at(-1)!.toISOString().slice(0, 10)
    ).map((f) => f.source_id),
    assumptions: [
      "Overdue flows are placed in the first bucket.",
      "Probabilities are explicit scenario inputs, not model confidence.",
      "No payroll, tax, debt or unrecorded commitments are inferred.",
    ],
    ledger_mutated: false,
  };
}
