/** Reserved adapter contract. No processor has been chosen or instantiated.
 * Internal journal/invoice/reconciliation records never satisfy this interface. */
export type DecimalMinor = string;
export type ProviderEvidence = {
  provider: string;
  providerAccountBinding: string;
  providerRequestId: string;
  observedAt: string;
  httpStatus: number;
  responseSha256: string;
};
export type ProcessorContext = {
  tenantId: string;
  actorId: string;
  admissionId: string;
  idempotencyKey: string;
  currency: string;
  minorUnitExponent: number;
  approvedSecretReference: string;
};
export interface CommerceProcessor {
  readonly provider: string;
  createPaymentIntent(
    context: ProcessorContext,
    args: {
      invoiceId: string;
      amountMinor: DecimalMinor;
      returnOrigin: string;
    },
  ): Promise<
    {
      state: "requires_customer_action" | "processing" | "succeeded" | "failed";
      intentId: string;
      evidence: ProviderEvidence;
    }
  >;
  refund(
    context: ProcessorContext,
    args: { paymentId: string; amountMinor: DecimalMinor; reason: string },
  ): Promise<
    {
      refundId: string;
      state: "pending" | "succeeded" | "failed";
      evidence: ProviderEvidence;
    }
  >;
  getPayout(
    context: ProcessorContext,
    payoutId: string,
  ): Promise<
    {
      payoutId: string;
      amountMinor: DecimalMinor;
      state: string;
      evidence: ProviderEvidence;
    }
  >;
  getTax(
    context: ProcessorContext,
    args: { invoiceId: string; jurisdictionPolicyReference: string },
  ): Promise<
    {
      taxMinor: DecimalMinor;
      calculationId: string;
      evidence: ProviderEvidence;
    }
  >;
  reconcile(
    context: ProcessorContext,
    args: { externalReference: string },
  ): Promise<
    {
      providerObjectId: string;
      settlementState: string;
      evidence: ProviderEvidence;
    }
  >;
}
export const configuredCommerceProcessor: null = null;
export function requireCommerceProcessor(): never {
  throw new Error("explicit_processor_and_merchant_policy_required");
}
