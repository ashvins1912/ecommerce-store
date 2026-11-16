import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeCarrierDisclosure,
  normalizeCarrierDisclosurePolicy,
  toProviderSafeOrderDto,
  toProviderSafeProfileDto,
  toProviderSafeProductDto,
  toProviderSafeSettlementDto,
} from './privacy.js';

test('carrier disclosure is default-deny', () => {
  const result = authorizeCarrierDisclosure(undefined, 'shadowfax');
  assert.equal(result.allowed, false);
  assert.deepEqual(result.missing, ['recipientName', 'recipientPhone', 'recipientAddress']);
});

test('required shipment fields need explicit seller authorization', () => {
  const result = authorizeCarrierDisclosure(
    { recipientName: true, recipientPhone: true, recipientAddress: false },
    'shadowfax',
  );
  assert.equal(result.allowed, false);
  assert.deepEqual(result.missing, ['recipientAddress']);
});

test('Shiprocket email is separately opt-in and requires a real buyer email', () => {
  const base = { recipientName: true, recipientPhone: true, recipientAddress: true };
  assert.equal(authorizeCarrierDisclosure(base, 'shiprocket', 'buyer@example.com').allowed, false);
  assert.equal(authorizeCarrierDisclosure({ ...base, recipientEmail: true }, 'shiprocket', '').allowed, false);
  const result = authorizeCarrierDisclosure({ ...base, recipientEmail: true }, 'SHIPROCKET', 'buyer@example.com');
  assert.equal(result.allowed, true);
  if (result.allowed) assert.deepEqual(result.fields, ['recipientName', 'recipientPhone', 'recipientAddress', 'recipientEmail']);
});

test('optional email is not included in the disclosure scope when no email exists', () => {
  const result = authorizeCarrierDisclosure({
    recipientName: true, recipientPhone: true, recipientAddress: true, recipientEmail: true,
  }, 'shadowfax', '');
  assert.equal(result.allowed, true);
  if (result.allowed) assert.deepEqual(result.fields, ['recipientName', 'recipientPhone', 'recipientAddress']);
});

test('normalization accepts only explicit true', () => {
  assert.deepEqual(
    normalizeCarrierDisclosurePolicy({ recipientName: 1 as any, recipientPhone: true }),
    { recipientName: false, recipientPhone: true, recipientAddress: false, recipientEmail: false },
  );
});

test('provider order DTO is an allowlist and never returns buyer, address or payment data', () => {
  const dto = toProviderSafeOrderDto({
    _id: '1', orderNumber: 'K1', status: 'Packed', buyer: { email: 'secret@example.com' },
    shippingAddress: { phone: 'secret-phone', street: 'secret-address' }, paymentReference: 'secret-payment',
    items: [{ title: 'Ring', variantSku: 'R1', quantity: 1, size: 'M', colorName: 'Gold', customerNote: 'secret' }],
  });
  assert.deepEqual(Object.keys(dto).sort(), ['id', 'items', 'orderNumber', 'status']);
  assert.equal(JSON.stringify(dto).includes('secret'), false);
  assert.equal(dto.items[0].title, 'Ring');
});

test('provider profile DTO exposes only provider-owned profile fields', () => {
  const dto = toProviderSafeProfileDto({
    userId: 'provider-1', businessName: 'Craft Co', mobile: '+910000000000',
    encryptedTaxId: 'secret-tax', encryptedSettlementDetails: 'secret-bank',
    customerEmail: 'buyer@example.com', shippingAddress: 'buyer address',
  });
  assert.equal(dto.businessName, 'Craft Co');
  assert.equal('encryptedTaxId' in dto, false);
  assert.equal('encryptedSettlementDetails' in dto, false);
  assert.equal('customerEmail' in dto, false);
  assert.equal('shippingAddress' in dto, false);
});

test('provider product DTO is an allowlist and drops unexpected customer fields', () => {
  const dto = toProviderSafeProductDto({
    title: 'Bracelet', basePricePaise: 1000, status: 'APPROVED',
    customer: { email: 'buyer@example.com' }, recipientPhone: 'secret-phone',
    privateMetadata: 'must-not-leak',
  });
  assert.equal(dto.title, 'Bracelet');
  assert.equal('customer' in dto, false);
  assert.equal('recipientPhone' in dto, false);
  assert.equal('privateMetadata' in dto, false);
});

test('provider settlement DTO excludes customer identity and encrypted receipt', () => {
  const dto = toProviderSafeSettlementDto({
    orderId: 'order-1', amountPaise: 1000, status: 'SETTLED',
    buyerEmail: 'buyer@example.com', recipientPhone: 'secret-phone',
    encryptedReceipt: 'secret-receipt',
  });
  assert.equal(dto.orderId, 'order-1');
  assert.equal('buyerEmail' in dto, false);
  assert.equal('recipientPhone' in dto, false);
  assert.equal('encryptedReceipt' in dto, false);
});
