import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_PLATFORM_FLAGS,
  normalizePlatformFlags,
  resolveCheckoutPlan,
} from './platformConfig.js';

test('default platform flags start lean with external carrier quotes, gateways, and worker off', () => {
  assert.equal(DEFAULT_PLATFORM_FLAGS.shippingQuotesEnabled, false);
  assert.equal(DEFAULT_PLATFORM_FLAGS.onlinePaymentEnabled, false);
  assert.equal(DEFAULT_PLATFORM_FLAGS.backgroundWorkerEnabled, false);
  assert.equal(DEFAULT_PLATFORM_FLAGS.codEnabled, true);
  assert.equal(DEFAULT_PLATFORM_FLAGS.sellerDirectCollectEnabled, true);
  assert.equal(DEFAULT_PLATFORM_FLAGS.posMachineEnabled, true);
  assert.equal(DEFAULT_PLATFORM_FLAGS.flatFallbackShippingInr, 0);
});

test('resolveCheckoutPlan bypasses carrier quotes and blocking prepaid gateways when flagged off', () => {
  const plan = resolveCheckoutPlan({
    flags: DEFAULT_PLATFORM_FLAGS,
    cartValueInr: 1800,
    requestedPaymentMode: 'COD',
    requiresPrepaidByProduct: true,
  });

  assert.equal(plan.skipCarrierRateQuotes, true);
  assert.equal(plan.shippingPolicy, 'FREE_FLAGGED_OFF');
  assert.equal(plan.shippingChargeInr, 0);
  assert.equal(plan.effectivePaymentMode, 'COD');
  assert.equal(plan.initialPaymentStatus, 'NOT_REQUIRED');
  assert.equal(plan.posDemandTriggered, false);
});

test('resolveCheckoutPlan triggers POS recommendation and upgrades over COD ceiling', () => {
  const flags = normalizePlatformFlags({
    codEnabled: true,
    codMaxOrderValueInr: 10000,
    posMachineEnabled: true,
    posDemandCartThresholdInr: 5000,
    sellerDirectCollectEnabled: true,
  });

  const mediumCart = resolveCheckoutPlan({
    flags,
    cartValueInr: 6500,
    requestedPaymentMode: 'POS_ON_DELIVERY',
  });
  assert.equal(mediumCart.posDemandTriggered, true);
  assert.equal(mediumCart.effectivePaymentMode, 'POS_ON_DELIVERY');
  assert.equal(mediumCart.posRequested, true);
  assert.equal(mediumCart.codEligible, true);

  const highValueCart = resolveCheckoutPlan({
    flags,
    cartValueInr: 18000,
    requestedPaymentMode: 'COD',
  });
  assert.equal(highValueCart.codEligible, false);
  assert.equal(highValueCart.posDemandTriggered, true);
  assert.equal(highValueCart.effectivePaymentMode, 'POS_ON_DELIVERY');
});

test('resolveCheckoutPlan supports seller direct collection and re-enables gateways/shipping when admin flips flags ON', () => {
  const sellerCollect = resolveCheckoutPlan({
    flags: DEFAULT_PLATFORM_FLAGS,
    cartValueInr: 2400,
    requestedPaymentMode: 'SELLER_COLLECT',
  });
  assert.equal(sellerCollect.effectivePaymentMode, 'SELLER_COLLECT');
  assert.equal(sellerCollect.initialPaymentStatus, 'PENDING');

  const liveEnterprise = normalizePlatformFlags({
    shippingQuotesEnabled: true,
    onlinePaymentEnabled: true,
  });
  const gatewayPlan = resolveCheckoutPlan({
    flags: liveEnterprise,
    cartValueInr: 3200,
    requestedPaymentMode: 'RAZORPAY',
    requiresPrepaidByProduct: true,
  });
  assert.equal(gatewayPlan.skipCarrierRateQuotes, false);
  assert.equal(gatewayPlan.shippingPolicy, 'SEPARATE');
  assert.equal(gatewayPlan.effectivePaymentMode, 'RAZORPAY');
});
