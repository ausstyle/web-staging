/** Strict resource-ID validation used before the Controller's self-task update. */
export function uuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      value,
    );
}
