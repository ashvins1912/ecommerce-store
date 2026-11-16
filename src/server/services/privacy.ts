export type CarrierDisclosurePolicy = {
  recipientName: boolean;
  recipientPhone: boolean;
  recipientAddress: boolean;
  recipientEmail: boolean;
};
export const DEFAULT_CARRIER_DISCLOSURE_POLICY: CarrierDisclosurePolicy = {
  recipientName: false, recipientPhone: false, recipientAddress: false, recipientEmail: false,
};
export function normalizeCarrierDisclosurePolicy(value: Partial<CarrierDisclosurePolicy> | null | undefined): CarrierDisclosurePolicy {
  return {
    recipientName: value?.recipientName === true,
    recipientPhone: value?.recipientPhone === true,
    recipientAddress: value?.recipientAddress === true,
    recipientEmail: value?.recipientEmail === true,
  };
}
export function authorizeCarrierDisclosure(policyInput: Partial<CarrierDisclosurePolicy> | null | undefined, carrierCode: string, buyerEmail?: string | null) {
  const policy = normalizeCarrierDisclosurePolicy(policyInput);
  const missing = (['recipientName','recipientPhone','recipientAddress'] as const).filter((field) => !policy[field]);
  const emailRequired = carrierCode.toLowerCase() === 'shiprocket';
  if (missing.length) return { allowed: false as const, policy, missing, emailRequired };
  if (emailRequired && (!policy.recipientEmail || !buyerEmail)) return { allowed: false as const, policy, missing: ['recipientEmail'], emailRequired };
  return { allowed: true as const, policy, fields: (Object.keys(policy) as Array<keyof CarrierDisclosurePolicy>).filter((field) => policy[field]), emailRequired };
}
export function toProviderSafeOrderDto(order: any) {
  return {
    id: String(order?._id ?? order?.id ?? ''),
    orderNumber: String(order?.orderNumber ?? ''),
    status: String(order?.status ?? ''),
    items: (Array.isArray(order?.items) ? order.items : []).map((item: any) => ({
      title: String(item?.title ?? ''), sku: String(item?.variantSku ?? item?.sku ?? ''),
      quantity: Number(item?.quantity ?? 0), size: String(item?.size ?? ''), colorName: String(item?.colorName ?? ''),
    })),
    // Deliberately excludes buyer identity, contact details, shipping/billing address and payment identifiers.
  };
}

const PROVIDER_FORBIDDEN_KEYS = /^(buyer|buyerId|customer|customerId|customerName|customerEmail|customerPhone|shippingAddress|billingAddress|recipient|recipientName|recipientPhone|recipientEmail|deliveryAddress|deliveryInstructions)$/i;
export function toProviderSafeDto<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => toProviderSafeDto(item)) as T;
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (PROVIDER_FORBIDDEN_KEYS.test(key)) continue;
    output[key] = toProviderSafeDto(nested);
  }
  return output as T;
}
