/** Structured private transport failures never include credential or remote error text. */
export class ProtocolRefusal extends Error {
  constructor(
    public code: string,
    public mayHaveExecuted = false,
    public cleanupRequired = false,
  ) {
    super(code);
  }
}
