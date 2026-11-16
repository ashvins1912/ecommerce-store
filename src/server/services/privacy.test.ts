import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeCarrierDisclosure, normalizeCarrierDisclosurePolicy, toProviderSafeOrderDto } from './privacy.js';
test('carrier disclosure is default-deny', () => {
  const result = authorizeCarrierDisclosure(undefined, 'shadowfax');
  assert.equal(result.allowed, false);
  assert.deepEqual(result.missing, ['recipientName','recipientPhone','recipientAddress']);
});
test('required shipment fields need seller authorization', () => {
  const result = authorizeCarrierDisclosure({recipientName:true,recipientPhone:true,recipientAddress:false}, 'shadowfax');
  assert.equal(result.allowed, false);
  assert.deepEqual(result.missing, ['recipientAddress']);
});
test('Shiprocket email is separately opt-in', () => {
  const base = {recipientName:true,recipientPhone:true,recipientAddress:true};
  assert.equal(authorizeCarrierDisclosure(base, 'shiprocket', 'buyer@example.com').allowed, false);
  assert.equal(authorizeCarrierDisclosure({...base,recipientEmail:true}, 'shiprocket', 'buyer@example.com').allowed, true);
});
test('provider DTO never returns customer or address data', () => {
  const dto = toProviderSafeOrderDto({_id:'1',orderNumber:'K1',status:'Packed',buyer:{email:'secret'},shippingAddress:{phone:'secret',street:'secret'},paymentReference:'secret',items:[{title:'Ring',variantSku:'R1',quantity:1}]});
  assert.deepEqual(Object.keys(dto).sort(), ['id','items','orderNumber','status']);
  assert.equal(JSON.stringify(dto).includes('secret'), false);
});
test('normalization accepts only explicit true', () => {
  assert.deepEqual(normalizeCarrierDisclosurePolicy({recipientName:1 as any,recipientPhone:true}), {recipientName:false,recipientPhone:true,recipientAddress:false,recipientEmail:false});
});
