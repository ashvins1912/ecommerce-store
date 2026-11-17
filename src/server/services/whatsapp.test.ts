import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSellerOrderNotificationNumber,
  sendWhatsAppMessage,
} from './whatsapp.js';

test('seller order alert routing prefers the configured destination, then verified WhatsApp, then mobile', () => {
  assert.equal(getSellerOrderNotificationNumber({
    orderNotificationWhatsAppNumber: '+919800000001',
    whatsappNumber: '+919800000002',
    mobileNumber: '+919800000003',
  }), '+919800000001');
  assert.equal(getSellerOrderNotificationNumber({
    whatsappNumber: '+919800000002',
    mobileNumber: '+919800000003',
  }), '+919800000002');
  assert.equal(getSellerOrderNotificationNumber({ mobileNumber: '+919800000003' }), '+919800000003');
  assert.equal(getSellerOrderNotificationNumber({}), '');
});

test('WhatsApp API absence returns a wa.me fallback for the configured recipient', async () => {
  const envKeys = ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'EVOLUTION_API_URL', 'EVOLUTION_API_KEY', 'EVOLUTION_INSTANCE'];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  try {
    const result = await sendWhatsAppMessage('+919800000001', 'New order ORD-1');
    assert.equal(result.delivered, false);
    assert.equal(result.channel, 'wa_me_fallback');
    assert.equal(result.waLink, 'https://wa.me/919800000001?text=New%20order%20ORD-1');
  } finally {
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
});
