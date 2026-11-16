export type CarrierDisclosurePolicy = {
  recipientName: boolean;
  recipientPhone: boolean;
  recipientAddress: boolean;
  recipientEmail: boolean;
};

export type CarrierDisclosureField = keyof CarrierDisclosurePolicy;

export const DEFAULT_CARRIER_DISCLOSURE_POLICY: CarrierDisclosurePolicy = {
  recipientName: false,
  recipientPhone: false,
  recipientAddress: false,
  recipientEmail: false,
};

export function normalizeCarrierDisclosurePolicy(
  value: Partial<CarrierDisclosurePolicy> | null | undefined,
): CarrierDisclosurePolicy {
  return {
    recipientName: value?.recipientName === true,
    recipientPhone: value?.recipientPhone === true,
    recipientAddress: value?.recipientAddress === true,
    recipientEmail: value?.recipientEmail === true,
  };
}

/**
 * Fail-closed policy evaluation. Name, phone and the delivery address are the
 * minimum required to create a physical shipment. Email is optional except
 * for carriers whose API contract requires it (currently Shiprocket).
 *
 * The returned field list represents data that will actually be disclosed,
 * not merely fields the seller has enabled in settings.
 */
export function authorizeCarrierDisclosure(
  policyInput: Partial<CarrierDisclosurePolicy> | null | undefined,
  carrierCode: string,
  buyerEmail?: string | null,
):
  | { allowed: false; policy: CarrierDisclosurePolicy; missing: string[]; emailRequired: boolean }
  | { allowed: true; policy: CarrierDisclosurePolicy; fields: CarrierDisclosureField[]; emailRequired: boolean } {
  const policy = normalizeCarrierDisclosurePolicy(policyInput);
  const carrier = String(carrierCode || '').trim().toLowerCase();
  const missing = (['recipientName', 'recipientPhone', 'recipientAddress'] as const)
    .filter((field) => !policy[field]);
  const emailRequired = carrier === 'shiprocket';

  if (missing.length) {
    return { allowed: false, policy, missing, emailRequired };
  }
  if (emailRequired && (!policy.recipientEmail || !String(buyerEmail || '').trim())) {
    return { allowed: false, policy, missing: ['recipientEmail'], emailRequired };
  }

  const fields: CarrierDisclosureField[] = ['recipientName', 'recipientPhone', 'recipientAddress'];
  if (policy.recipientEmail && String(buyerEmail || '').trim()) fields.push('recipientEmail');
  return { allowed: true, policy, fields, emailRequired };
}

function pickAllowed<T extends Record<string, any>>(value: T, allowed: readonly string[]) {
  const result: Record<string, unknown> = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined) {
      result[key] = value[key];
    }
  }
  return result;
}

/** Explicit provider-owned profile projection; never pass a raw Mongoose document. */
export function toProviderSafeProfileDto(profile: Record<string, any>) {
  const dto = pickAllowed(profile, [
    '_id', 'userId', 'businessName', 'contactPerson', 'mobile',
    'whatsapp', 'warehouseAddress', 'settlementDetailsLast4', 'kycStatus',
    'createdAt', 'updatedAt',
  ]);
  dto.linkedSellerCount = Array.isArray(profile.linkedSellerIds) ? profile.linkedSellerIds.length : 0;
  return dto;
}

/** Seller read-only view of a linked provider; never exposes the provider's other seller links. */
export function toSellerSafeProviderProfileDto(profile: Record<string, any>) {
  return pickAllowed(profile, [
    '_id', 'userId', 'businessName', 'contactPerson', 'mobile', 'whatsapp',
    'warehouseAddress', 'settlementDetailsLast4', 'kycStatus', 'createdAt', 'updatedAt',
  ]);
}

/** Explicit provider-owned catalogue projection. */
export function toProviderSafeProductDto(product: Record<string, any>) {
  const dto = pickAllowed(product, [
    '_id', 'providerId', 'title', 'category', 'subCategory',
    'description', 'brand', 'manufacturerName', 'manufacturingDate',
    'sizeVariants', 'colorVariants', 'imageUrls', 'basePricePaise',
    'returnable', 'returnWindowDays', 'damageReplacementPolicy', 'status',
    'retailProductId', 'approvedBasePricePaise', 'approvedAt', 'createdAt', 'updatedAt',
  ]);
  // Negotiation comments are free-form text and may accidentally contain customer
  // contact/address data. Expose only the structured workflow metadata.
  if (Array.isArray(product.negotiationHistory)) {
    dto.negotiationHistory = product.negotiationHistory.map((entry: Record<string, any>) =>
      pickAllowed(entry, ['action', 'fields', 'targetPricePaise', 'createdAt']),
    );
  }
  return dto;
}

/** Explicit provider receivable projection; buyer identity/contact is never part of this contract. */
export function toProviderSafeSettlementDto(settlement: Record<string, any>) {
  return pickAllowed(settlement, [
    '_id', 'orderId', 'orderItemKey', 'providerId',
    'providerProductId', 'quantity', 'unitBasePricePaise', 'amountPaise',
    'currency', 'status', 'availableAt', 'deductionsPaise', 'utrReference',
    'settledAt', 'createdAt', 'updatedAt',
  ]);
}

/** Safe order summary for any future provider order view; no buyer/address/payment fields. */
export function toProviderSafeOrderDto(order: any) {
  return {
    id: String(order?._id ?? order?.id ?? ''),
    orderNumber: String(order?.orderNumber ?? ''),
    status: String(order?.status ?? ''),
    items: (Array.isArray(order?.items) ? order.items : []).map((item: any) => ({
      title: String(item?.title ?? ''),
      sku: String(item?.variantSku ?? item?.sku ?? ''),
      quantity: Number(item?.quantity ?? 0),
      size: String(item?.size ?? ''),
      colorName: String(item?.colorName ?? ''),
    })),
  };
}
