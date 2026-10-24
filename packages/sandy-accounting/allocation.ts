export type Component = { ordinal: number; account_id: string; amount: string };

/** Largest remainders against the remaining component budgets. Every payment
 * keeps its allocation snapshot; subsequent reversals remove that exact snapshot. */
export function allocate(amount: bigint, budgets: Component[]): Component[] {
  const total = budgets.reduce((n, c) => n + BigInt(c.amount), 0n);
  if (
    amount <= 0n || amount > total || budgets.some((c) => BigInt(c.amount) < 0n)
  ) {
    throw Error("allocation_budget");
  }
  const rows = budgets.map((c) => ({
    ...c,
    value: amount * BigInt(c.amount) / total,
    remainder: amount * BigInt(c.amount) % total,
  }));
  let remainder = amount - rows.reduce((n, c) => n + c.value, 0n);
  for (
    const c of [...rows].sort((a, b) =>
      a.remainder === b.remainder
        ? a.ordinal - b.ordinal
        : a.remainder > b.remainder
        ? -1
        : 1
    )
  ) {
    if (remainder === 0n) break;
    c.value++;
    remainder--;
  }
  return rows.filter((c) => c.value > 0n).map((c) => ({
    ordinal: c.ordinal,
    account_id: c.account_id,
    amount: c.value.toString(),
  }));
}
