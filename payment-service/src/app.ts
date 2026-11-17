import express, { type Request, type Response, type NextFunction } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import {
  createGatewayCheckout,
  listGatewayConfigurations,
  refundGatewayPayment,
  saveGatewayConfiguration,
  verifyPaymentWebhook,
} from '../../src/server/services/commerce.js';
import { createInternalServiceAuthMiddleware } from '../../src/server/services/serviceAuth.js';

export interface PaymentServiceHandlers {
  createGatewayCheckout: typeof createGatewayCheckout;
  refundGatewayPayment: typeof refundGatewayPayment;
  verifyPaymentWebhook: typeof verifyPaymentWebhook;
  listGatewayConfigurations: typeof listGatewayConfigurations;
  saveGatewayConfiguration: typeof saveGatewayConfiguration;
}

export interface CreatePaymentServiceAppOptions {
  secret?: string;
  handlers?: Partial<PaymentServiceHandlers>;
}

const providerSchema = z.enum(['razorpay', 'stripe']);

export function getPaymentServiceReadiness() {
  const encryptionRaw = process.env.ENCRYPTION_MASTER_KEY?.trim() || '';
  const appUrl = process.env.APP_URL?.trim() || '';
  const internalSecret = process.env.SERVICE_INTERNAL_SECRET?.trim() || '';
  const mongodbConnected = mongoose.connection.readyState === 1;
  const encryptionKeyConfigured = encryptionRaw.length >= 32;
  const httpsAppUrlConfigured = /^https:\/\//i.test(appUrl);
  const internalSecretConfigured = internalSecret.length >= 16;

  return {
    ready: internalSecretConfigured && encryptionKeyConfigured && mongodbConnected,
    service: 'payment-gateway-service',
    checks: {
      internalSecretConfigured,
      encryptionKeyConfigured,
      httpsAppUrlConfigured,
      mongodbConnected,
      providers: ['razorpay', 'stripe'] as const,
    },
  };
}

export function createPaymentServiceApp(options?: CreatePaymentServiceAppOptions) {
  const handlers: PaymentServiceHandlers = {
    createGatewayCheckout,
    refundGatewayPayment,
    verifyPaymentWebhook,
    listGatewayConfigurations,
    saveGatewayConfiguration,
    ...options?.handlers,
  };

  const app = express();
  app.set('trust proxy', 1);
  app.use(
    express.json({
      limit: '2mb',
      verify: (req: Request & { rawBody?: Buffer }, _res, buffer) => {
        req.rawBody = Buffer.from(buffer);
      },
    })
  );

  app.get('/health', (_req, res) => {
    const readiness = getPaymentServiceReadiness();
    res.json({
      ok: true,
      service: readiness.service,
      mode: 'standalone',
      providers: readiness.checks.providers,
      mongodbConnected: readiness.checks.mongodbConnected,
    });
  });

  app.get('/ready', (_req, res) => {
    res.json(getPaymentServiceReadiness());
  });

  const requireInternalAuth = createInternalServiceAuthMiddleware(
    () => options?.secret ?? process.env.SERVICE_INTERNAL_SECRET
  );
  app.use('/internal/v1', requireInternalAuth);

  app.post('/internal/v1/checkout-intent', async (req, res, next) => {
    const parsed = z
      .object({
        sellerId: z.string().min(1),
        provider: providerSchema,
        orderId: z.string().min(1),
        orderNumber: z.string().min(1),
        amountPaise: z.number().int().positive(),
        currency: z.string().min(3).max(6).optional(),
        idempotencyKey: z.string().min(1).optional(),
      })
      .strict()
      .safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'INVALID_CHECKOUT_INTENT_PAYLOAD' });
    }
    try {
      const checkout = await handlers.createGatewayCheckout(parsed.data);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ checkout });
    } catch (error) {
      next(error);
    }
  });

  app.post('/internal/v1/refunds', async (req, res, next) => {
    const parsed = z
      .object({
        sellerId: z.string().min(1),
        provider: providerSchema,
        paymentReference: z.string().min(1),
        amountPaise: z.number().int().positive(),
        idempotencyKey: z.string().min(1),
      })
      .strict()
      .safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'INVALID_REFUND_PAYLOAD' });
    }
    try {
      const refund = await handlers.refundGatewayPayment(parsed.data);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ refund });
    } catch (error) {
      next(error);
    }
  });

  app.post('/internal/v1/webhooks/verify', async (req, res, next) => {
    const parsed = z
      .object({
        sellerId: z.string().min(1),
        provider: providerSchema,
        signature: z.string(),
        rawBodyBase64: z.string().min(1),
      })
      .strict()
      .safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: 'INVALID_WEBHOOK_VERIFY_PAYLOAD' });
    }
    try {
      const rawBody = Buffer.from(parsed.data.rawBodyBase64, 'base64');
      const valid = await handlers.verifyPaymentWebhook({
        sellerId: parsed.data.sellerId,
        provider: parsed.data.provider,
        signature: parsed.data.signature,
        rawBody,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ valid: Boolean(valid) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/internal/v1/gateways/:sellerId', async (req, res, next) => {
    try {
      const gateways = await handlers.listGatewayConfigurations(req.params.sellerId);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ gateways });
    } catch (error) {
      next(error);
    }
  });

  app.put('/internal/v1/gateways/:sellerId/:provider', async (req, res, next) => {
    const provider = providerSchema.safeParse(req.params.provider);
    if (!provider.success) {
      return res.status(400).json({ error: 'UNSUPPORTED_PAYMENT_PROVIDER' });
    }
    const parsed = z
      .object({
        keyId: z.string().trim().min(4).max(160),
        secret: z.string().max(500).optional().default(''),
        webhookSecret: z.string().max(500).optional().default(''),
        enabled: z.boolean(),
      })
      .strict()
      .safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'INVALID_GATEWAY_CONFIGURATION' });
    }
    try {
      const gateway = await handlers.saveGatewayConfiguration({
        sellerId: req.params.sellerId,
        provider: provider.data,
        ...parsed.data,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ gateway });
    } catch (error) {
      next(error);
    }
  });

  app.use((err: Error & { statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    res.status(status).json({ error: err.message || 'PAYMENT_SERVICE_ERROR' });
  });

  return app;
}
