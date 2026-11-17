import mongoose from 'mongoose';
import type {
  IntegrationServiceCheckItem,
  IntegrationServiceDiagnostic,
  IntegrationServicesStatusResponse,
  PlatformServiceFlags,
} from '../../shared/types.js';
import {
  createGatewayCheckout,
  refundGatewayPayment,
  verifyPaymentWebhook,
  type GatewayProvider,
} from './commerce.js';
import {
  getSellerRateQuotes,
  listLogisticsProviders,
  refreshCarrierTrackingForOrder,
} from './logistics.js';
import { callInternalService } from './serviceAuth.js';

export interface ServiceGatewayEnvOverride {
  paymentServiceUrl?: string;
  shippingServiceUrl?: string;
  internalSecret?: string;
}

function getServiceConfig(override?: ServiceGatewayEnvOverride) {
  const paymentUrl = (override?.paymentServiceUrl ?? process.env.PAYMENT_SERVICE_URL ?? '').trim();
  const shippingUrl = (override?.shippingServiceUrl ?? process.env.SHIPPING_SERVICE_URL ?? '').trim();
  const secret = (override?.internalSecret ?? process.env.SERVICE_INTERNAL_SECRET ?? '').trim();
  return { paymentUrl, shippingUrl, secret };
}

function safeOrigin(rawUrl: string): string | null {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).origin;
  } catch {
    return rawUrl;
  }
}

export async function createCheckoutViaPaymentService(
  input: {
    sellerId: string;
    provider: GatewayProvider;
    orderId: string;
    orderNumber: string;
    amountPaise: number;
    currency?: string;
    idempotencyKey?: string;
  },
  override?: ServiceGatewayEnvOverride
) {
  const { paymentUrl, secret } = getServiceConfig(override);
  if (!paymentUrl) {
    return createGatewayCheckout(input);
  }
  if (!secret) {
    throw new Error('PAYMENT_SERVICE_SECRET_REQUIRED');
  }
  const res = await callInternalService<{ checkout: Awaited<ReturnType<typeof createGatewayCheckout>> }>({
    baseUrl: paymentUrl,
    path: '/internal/v1/checkout-intent',
    method: 'POST',
    body: input,
    secret,
  });
  return res.checkout;
}

export async function refundViaPaymentService(
  input: {
    sellerId: string;
    provider: GatewayProvider;
    paymentReference: string;
    amountPaise: number;
    idempotencyKey: string;
  },
  override?: ServiceGatewayEnvOverride
) {
  const { paymentUrl, secret } = getServiceConfig(override);
  if (!paymentUrl) {
    return refundGatewayPayment(input);
  }
  if (!secret) {
    throw new Error('PAYMENT_SERVICE_SECRET_REQUIRED');
  }
  const res = await callInternalService<{ refund: Awaited<ReturnType<typeof refundGatewayPayment>> }>({
    baseUrl: paymentUrl,
    path: '/internal/v1/refunds',
    method: 'POST',
    body: input,
    secret,
  });
  return res.refund;
}

export async function verifyWebhookViaPaymentService(
  input: {
    sellerId: string;
    provider: GatewayProvider;
    signature: string;
    rawBody: Buffer;
  },
  override?: ServiceGatewayEnvOverride
) {
  const { paymentUrl, secret } = getServiceConfig(override);
  if (!paymentUrl) {
    return verifyPaymentWebhook(input);
  }
  if (!secret) {
    throw new Error('PAYMENT_SERVICE_SECRET_REQUIRED');
  }
  const res = await callInternalService<{ valid: boolean }>({
    baseUrl: paymentUrl,
    path: '/internal/v1/webhooks/verify',
    method: 'POST',
    body: {
      sellerId: input.sellerId,
      provider: input.provider,
      signature: input.signature,
      rawBodyBase64: input.rawBody.toString('base64'),
    },
    secret,
  });
  return Boolean(res.valid);
}

export async function listLogisticsProvidersViaShippingService(override?: ServiceGatewayEnvOverride) {
  const { shippingUrl, secret } = getServiceConfig(override);
  if (!shippingUrl) {
    return listLogisticsProviders();
  }
  if (!secret) {
    throw new Error('SHIPPING_SERVICE_SECRET_REQUIRED');
  }
  const res = await callInternalService<{ providers: Awaited<ReturnType<typeof listLogisticsProviders>> }>({
    baseUrl: shippingUrl,
    path: '/internal/v1/providers',
    method: 'GET',
    secret,
  });
  return res.providers;
}

export async function getSellerRateQuotesViaShippingService(
  input: {
    sellerId: string;
    destinationPostalCode: string;
    weightGrams: number;
    codAmountMinor: number;
    declaredValueMinor: number;
    currency: string;
  },
  override?: ServiceGatewayEnvOverride
) {
  const { shippingUrl, secret } = getServiceConfig(override);
  if (!shippingUrl) {
    return getSellerRateQuotes(input);
  }
  if (!secret) {
    throw new Error('SHIPPING_SERVICE_SECRET_REQUIRED');
  }
  const res = await callInternalService<{ quotes: Awaited<ReturnType<typeof getSellerRateQuotes>> }>({
    baseUrl: shippingUrl,
    path: '/internal/v1/rates',
    method: 'POST',
    body: input,
    secret,
  });
  return res.quotes;
}

export async function refreshTrackingViaShippingService(
  orderId: string,
  override?: ServiceGatewayEnvOverride
) {
  const { shippingUrl, secret } = getServiceConfig(override);
  if (!shippingUrl) {
    return refreshCarrierTrackingForOrder(orderId);
  }
  if (!secret) {
    throw new Error('SHIPPING_SERVICE_SECRET_REQUIRED');
  }
  const res = await callInternalService<{
    tracking: Awaited<ReturnType<typeof refreshCarrierTrackingForOrder>>;
  }>({
    baseUrl: shippingUrl,
    path: '/internal/v1/tracking/refresh',
    method: 'POST',
    body: { orderId },
    secret,
  });
  return res.tracking;
}

async function probeServiceEndpoint(baseUrl: string): Promise<{
  reachable: boolean;
  ready: boolean;
  latencyMs: number;
  remoteChecks?: Record<string, boolean>;
  detail: string;
}> {
  const normalized = baseUrl.replace(/\/$/, '');
  const started = Date.now();
  try {
    const healthRes = await fetch(`${normalized}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(4000),
    });
    const latencyMs = Math.max(1, Date.now() - started);
    if (!healthRes.ok) {
      return {
        reachable: false,
        ready: false,
        latencyMs,
        detail: `Health endpoint returned HTTP ${healthRes.status}`,
      };
    }

    let ready = true;
    let remoteChecks: Record<string, boolean> | undefined;
    try {
      const readyRes = await fetch(`${normalized}/ready`, {
        method: 'GET',
        signal: AbortSignal.timeout(4000),
      });
      if (readyRes.ok) {
        const readyJson = (await readyRes.json()) as {
          ready?: boolean;
          checks?: Record<string, boolean>;
        };
        ready = Boolean(readyJson.ready);
        remoteChecks = readyJson.checks;
      }
    } catch {
      // Keep health status even if /ready could not be parsed
    }

    return {
      reachable: true,
      ready,
      latencyMs,
      remoteChecks,
      detail: ready
        ? `Connected in ${latencyMs} ms; all dependencies verified.`
        : `Reachable (${latencyMs} ms); check remote dependency configuration.`,
    };
  } catch (error) {
    return {
      reachable: false,
      ready: false,
      latencyMs: Math.max(1, Date.now() - started),
      detail: `Unreachable (${(error as Error).message || 'connection failed'}).`,
    };
  }
}

export async function inspectIntegrationServices(input: {
  liveProbe: boolean;
  flags: PlatformServiceFlags;
  envOverride?: ServiceGatewayEnvOverride;
}): Promise<IntegrationServicesStatusResponse> {
  const { paymentUrl, shippingUrl, secret } = getServiceConfig(input.envOverride);
  const internalSecretConfigured = secret.length >= 16;
  const encryptionKeyConfigured = (process.env.ENCRYPTION_MASTER_KEY?.trim() || '').length >= 32;
  const httpsAppUrlConfigured = /^https:\/\//i.test(process.env.APP_URL?.trim() || '');
  const mongodbConnected = mongoose.connection.readyState === 1;
  const logisticsPostgresConfigured = Boolean(
    process.env.LOGISTICS_SUPABASE_URL?.trim() &&
      process.env.LOGISTICS_SUPABASE_SERVICE_ROLE_KEY?.trim()
  );
  const redisConfigured = Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  );
  const checkedAt = new Date().toISOString();

  const paymentLocalChecks: IntegrationServiceCheckItem[] = [
    { key: 'ENCRYPTION_MASTER_KEY', label: 'Gateway AES-256 master key', configured: encryptionKeyConfigured },
    { key: 'APP_URL', label: 'HTTPS Stripe callback origin', configured: httpsAppUrlConfigured },
    { key: 'MONGODB_URI', label: 'MongoDB gateway secret vault', configured: mongodbConnected },
    { key: 'SERVICE_INTERNAL_SECRET', label: 'Signed service-to-service secret', configured: internalSecretConfigured },
  ];

  const shippingLocalChecks: IntegrationServiceCheckItem[] = [
    { key: 'LOGISTICS_SUPABASE_URL', label: 'Logistics Postgres & job queue', configured: logisticsPostgresConfigured },
    { key: 'ENCRYPTION_MASTER_KEY', label: 'Carrier credential master key', configured: encryptionKeyConfigured },
    { key: 'UPSTASH_REDIS_REST_URL', label: 'Upstash rate-quote cache', configured: redisConfigured },
    { key: 'SERVICE_INTERNAL_SECRET', label: 'Signed service-to-service secret', configured: internalSecretConfigured },
  ];

  let paymentDiag: IntegrationServiceDiagnostic = {
    serviceKey: 'payment',
    serviceName: 'Payment Gateway Service',
    templateServiceName: 'ecommerce-payment-service',
    defaultLocalPort: 4010,
    startCommand: 'npm run dev:payment',
    mode: paymentUrl ? 'external_http' : 'local_fallback',
    urlConfigured: Boolean(paymentUrl),
    targetOrigin: safeOrigin(paymentUrl),
    featureFlagEnabled: Boolean(input.flags.onlinePaymentEnabled),
    reachable: null,
    ready: encryptionKeyConfigured && (!paymentUrl || internalSecretConfigured),
    latencyMs: null,
    checkedAt,
    detail: paymentUrl
      ? internalSecretConfigured
        ? 'Configured to route gateway intents and webhook verification via HTTP RPC.'
        : 'PAYMENT_SERVICE_URL is set, but SERVICE_INTERNAL_SECRET is missing or shorter than 16 chars.'
      : 'Standby local fallback active. Deploy ecommerce-payment-service and set PAYMENT_SERVICE_URL when traffic grows.',
    capabilities: ['Razorpay Orders', 'Stripe Checkout Sessions', 'Signed Webhooks', 'Gateway Refunds'],
    checks: paymentLocalChecks,
  };

  let shippingDiag: IntegrationServiceDiagnostic = {
    serviceKey: 'shipping',
    serviceName: 'Shipping Services Integration',
    templateServiceName: 'ecommerce-shipping-service',
    defaultLocalPort: 4020,
    startCommand: 'npm run dev:shipping',
    mode: shippingUrl ? 'external_http' : 'local_fallback',
    urlConfigured: Boolean(shippingUrl),
    targetOrigin: safeOrigin(shippingUrl),
    featureFlagEnabled: Boolean(input.flags.shippingQuotesEnabled),
    reachable: null,
    ready: logisticsPostgresConfigured && encryptionKeyConfigured && (!shippingUrl || internalSecretConfigured),
    latencyMs: null,
    checkedAt,
    detail: shippingUrl
      ? internalSecretConfigured
        ? 'Configured to route live carrier rates, webhooks, and tracking via HTTP RPC.'
        : 'SHIPPING_SERVICE_URL is set, but SERVICE_INTERNAL_SECRET is missing or shorter than 16 chars.'
      : 'Standby local fallback active. Deploy ecommerce-shipping-service and set SHIPPING_SERVICE_URL when enabling live carriers.',
    capabilities: ['Shiprocket Adapter', 'Shadowfax Adapter', 'Hybrid Rate Engine', 'Optional Queue Worker'],
    checks: shippingLocalChecks,
  };

  if (input.liveProbe) {
    const [paymentProbe, shippingProbe] = await Promise.all([
      paymentUrl ? probeServiceEndpoint(paymentUrl) : Promise.resolve(null),
      shippingUrl ? probeServiceEndpoint(shippingUrl) : Promise.resolve(null),
    ]);

    if (paymentProbe) {
      paymentDiag = {
        ...paymentDiag,
        reachable: paymentProbe.reachable,
        ready: paymentProbe.ready && internalSecretConfigured,
        latencyMs: paymentProbe.latencyMs,
        detail: paymentProbe.detail,
        checks: paymentProbe.remoteChecks
          ? [
              {
                key: 'ENCRYPTION_MASTER_KEY',
                label: 'Gateway AES-256 master key (remote)',
                configured: Boolean(paymentProbe.remoteChecks.encryptionKeyConfigured),
              },
              {
                key: 'APP_URL',
                label: 'HTTPS Stripe callback origin (remote)',
                configured: Boolean(paymentProbe.remoteChecks.httpsAppUrlConfigured),
              },
              {
                key: 'MONGODB_URI',
                label: 'MongoDB gateway secret vault (remote)',
                configured: Boolean(paymentProbe.remoteChecks.mongodbConnected),
              },
              {
                key: 'SERVICE_INTERNAL_SECRET',
                label: 'Signed service-to-service secret',
                configured: Boolean(paymentProbe.remoteChecks.internalSecretConfigured) && internalSecretConfigured,
              },
            ]
          : paymentLocalChecks,
      };
    }

    if (shippingProbe) {
      shippingDiag = {
        ...shippingDiag,
        reachable: shippingProbe.reachable,
        ready: shippingProbe.ready && internalSecretConfigured,
        latencyMs: shippingProbe.latencyMs,
        detail: shippingProbe.detail,
        checks: shippingProbe.remoteChecks
          ? [
              {
                key: 'LOGISTICS_SUPABASE_URL',
                label: 'Logistics Postgres & job queue (remote)',
                configured: Boolean(shippingProbe.remoteChecks.logisticsPostgresConfigured),
              },
              {
                key: 'ENCRYPTION_MASTER_KEY',
                label: 'Carrier credential master key (remote)',
                configured: Boolean(shippingProbe.remoteChecks.encryptionKeyConfigured),
              },
              {
                key: 'UPSTASH_REDIS_REST_URL',
                label: 'Upstash rate-quote cache (remote)',
                configured: Boolean(shippingProbe.remoteChecks.redisConfigured),
              },
              {
                key: 'SERVICE_INTERNAL_SECRET',
                label: 'Signed service-to-service secret',
                configured: Boolean(shippingProbe.remoteChecks.internalSecretConfigured) && internalSecretConfigured,
              },
            ]
          : shippingLocalChecks,
      };
    }
  }

  return {
    internalSecretConfigured,
    checkedAt,
    payment: paymentDiag,
    shipping: shippingDiag,
  };
}
