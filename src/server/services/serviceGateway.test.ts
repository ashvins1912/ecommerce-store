import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import {
  signServiceHeaders,
  verifyServiceSignature,
} from './serviceAuth.js';
import {
  createCheckoutViaPaymentService,
  getSellerRateQuotesViaShippingService,
  inspectIntegrationServices,
  verifyWebhookViaPaymentService,
} from './serviceGateway.js';
import { DEFAULT_PLATFORM_FLAGS } from './platformConfig.js';
import { createPaymentServiceApp } from '../../../apps/payment-service/src/app.js';
import { createShippingServiceApp } from '../../../apps/shipping-service/src/app.js';

const TEST_SECRET = 'test_internal_service_secret_32_bytes_ok';

test('HMAC service auth signs, verifies, rejects tampering, and rejects expired timestamps', () => {
  const nowEpoch = 1_750_000_000;
  const rawBody = JSON.stringify({ orderId: 'ord_123', amountPaise: 49900 });
  const headers = signServiceHeaders({
    method: 'POST',
    path: '/internal/v1/checkout-intent',
    rawBody,
    secret: TEST_SECRET,
    timestamp: String(nowEpoch),
  });

  const valid = verifyServiceSignature({
    method: 'POST',
    path: '/internal/v1/checkout-intent',
    rawBody,
    timestampHeader: headers['x-service-timestamp'],
    signatureHeader: headers['x-service-signature'],
    secret: TEST_SECRET,
    nowEpochSeconds: nowEpoch + 10,
  });
  assert.equal(valid.ok, true);

  const tampered = verifyServiceSignature({
    method: 'POST',
    path: '/internal/v1/checkout-intent',
    rawBody: JSON.stringify({ orderId: 'ord_123', amountPaise: 100 }),
    timestampHeader: headers['x-service-timestamp'],
    signatureHeader: headers['x-service-signature'],
    secret: TEST_SECRET,
    nowEpochSeconds: nowEpoch + 10,
  });
  assert.equal(tampered.ok, false);
  assert.equal(tampered.reason, 'INVALID_SERVICE_SIGNATURE');

  const expired = verifyServiceSignature({
    method: 'POST',
    path: '/internal/v1/checkout-intent',
    rawBody,
    timestampHeader: headers['x-service-timestamp'],
    signatureHeader: headers['x-service-signature'],
    secret: TEST_SECRET,
    nowEpochSeconds: nowEpoch + 601,
  });
  assert.equal(expired.ok, false);
  assert.equal(expired.reason, 'EXPIRED_OR_INVALID_TIMESTAMP');
});

test('Standalone Payment and Shipping services serve health, enforce HMAC auth, route signed calls, and answer Admin live probes', async () => {
  let receivedCheckoutOrderId = '';
  let receivedWebhookRaw = '';
  let receivedRateSellerId = '';

  const paymentApp = createPaymentServiceApp({
    secret: TEST_SECRET,
    handlers: {
      createGatewayCheckout: async (input) => {
        receivedCheckoutOrderId = input.orderId;
        return {
          provider: 'razorpay',
          reference: 'order_test_001',
          keyId: 'rzp_test_123',
          amountPaise: input.amountPaise,
          currency: 'INR',
        };
      },
      verifyPaymentWebhook: async (input) => {
        receivedWebhookRaw = input.rawBody.toString('utf8');
        return input.signature === 'sig_valid';
      },
    },
  });

  const shippingApp = createShippingServiceApp({
    secret: TEST_SECRET,
    workerEnabled: false,
    handlers: {
      getSellerRateQuotes: async (input) => {
        receivedRateSellerId = input.sellerId;
        return [
          {
            id: 'cfg1:SURFACE',
            configId: 'cfg1',
            priorityRank: 1,
            providerCode: 'shiprocket',
            serviceCode: 'SURFACE',
            costMinor: 8500,
            estimatedTransitHours: 72,
            currency: 'INR',
            score: 0.92,
            selectionScore: 0.92,
            carrierConfigId: 'cfg1',
            quote: {
              providerCode: 'shiprocket',
              serviceCode: 'SURFACE',
              amountMinor: 8500,
              currency: 'INR',
              estimatedTransitHours: 72,
              serviceable: true,
              codSupported: true,
              fetchedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            },
          } as any,
        ];
      },
    },
  });

  const paymentServer = paymentApp.listen(0, '127.0.0.1');
  const shippingServer = shippingApp.listen(0, '127.0.0.1');
  await Promise.all([
    new Promise<void>((resolve) => paymentServer.once('listening', () => resolve())),
    new Promise<void>((resolve) => shippingServer.once('listening', () => resolve())),
  ]);

  try {
    const paymentPort = (paymentServer.address() as AddressInfo).port;
    const shippingPort = (shippingServer.address() as AddressInfo).port;
    const paymentUrl = `http://127.0.0.1:${paymentPort}`;
    const shippingUrl = `http://127.0.0.1:${shippingPort}`;

    // 1. Unauthenticated internal calls must fail closed with 401
    const unauthRes = await fetch(`${paymentUrl}/internal/v1/checkout-intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(unauthRes.status, 401);

    // 2. Signed payment checkout RPC forwards cleanly
    const checkout = await createCheckoutViaPaymentService(
      {
        sellerId: 'seller_1',
        provider: 'razorpay',
        orderId: 'ord_remote_1',
        orderNumber: 'KK-1001',
        amountPaise: 125000,
      },
      { paymentServiceUrl: paymentUrl, internalSecret: TEST_SECRET }
    );
    assert.equal(receivedCheckoutOrderId, 'ord_remote_1');
    assert.equal(checkout.reference, 'order_test_001');

    // 3. Raw webhook buffer verification preserves exact bytes across base64 RPC
    const webhookValid = await verifyWebhookViaPaymentService(
      {
        sellerId: 'seller_1',
        provider: 'razorpay',
        signature: 'sig_valid',
        rawBody: Buffer.from('{"event":"payment.captured"}', 'utf8'),
      },
      { paymentServiceUrl: paymentUrl, internalSecret: TEST_SECRET }
    );
    assert.equal(webhookValid, true);
    assert.equal(receivedWebhookRaw, '{"event":"payment.captured"}');

    // 4. Signed shipping rate quote RPC forwards cleanly
    const quotes = await getSellerRateQuotesViaShippingService(
      {
        sellerId: 'seller_99',
        destinationPostalCode: '400001',
        weightGrams: 500,
        codAmountMinor: 0,
        declaredValueMinor: 125000,
        currency: 'INR',
      },
      { shippingServiceUrl: shippingUrl, internalSecret: TEST_SECRET }
    );
    assert.equal(receivedRateSellerId, 'seller_99');
    assert.equal(quotes.length, 1);
    assert.equal(quotes[0].providerCode, 'shiprocket');

    // 5. Missing secret fails closed when external URL is configured
    await assert.rejects(
      () =>
        createCheckoutViaPaymentService(
          {
            sellerId: 'seller_1',
            provider: 'razorpay',
            orderId: 'ord_remote_2',
            orderNumber: 'KK-1002',
            amountPaise: 10000,
          },
          { paymentServiceUrl: paymentUrl, internalSecret: '' }
        ),
      /PAYMENT_SERVICE_SECRET_REQUIRED/
    );

    // 6. Admin service probe detects both external endpoints as reachable and reports local fallback when unset
    const probed = await inspectIntegrationServices({
      liveProbe: true,
      flags: DEFAULT_PLATFORM_FLAGS,
      envOverride: {
        paymentServiceUrl: paymentUrl,
        shippingServiceUrl: shippingUrl,
        internalSecret: TEST_SECRET,
      },
    });
    assert.equal(probed.payment.mode, 'external_http');
    assert.equal(probed.payment.reachable, true);
    assert.ok((probed.payment.latencyMs ?? 0) >= 1);
    assert.equal(probed.shipping.mode, 'external_http');
    assert.equal(probed.shipping.reachable, true);
    assert.ok((probed.shipping.latencyMs ?? 0) >= 1);

    const standby = await inspectIntegrationServices({
      liveProbe: false,
      flags: DEFAULT_PLATFORM_FLAGS,
      envOverride: { paymentServiceUrl: '', shippingServiceUrl: '', internalSecret: '' },
    });
    assert.equal(standby.payment.mode, 'local_fallback');
    assert.equal(standby.payment.reachable, null);
    assert.equal(standby.shipping.mode, 'local_fallback');
    assert.equal(standby.shipping.reachable, null);
  } finally {
    await Promise.all([
      new Promise<void>((resolve) => paymentServer.close(() => resolve())),
      new Promise<void>((resolve) => shippingServer.close(() => resolve())),
    ]);
  }
});
