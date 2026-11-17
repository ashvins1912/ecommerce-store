import express, { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import {
  applyLogisticsWebhook,
  createProviderShipmentIntent,
  createShipmentIntent,
  findShipmentForWebhook,
  getProviderRateQuotes,
  getSellerRateQuotes,
  listLogisticsProviders,
  refreshCarrierTrackingForOrder,
} from '../../src/server/services/logistics.js';
import { createInternalServiceAuthMiddleware } from '../../src/server/services/serviceAuth.js';
import { STATUS_CODE } from '../../packages/logistics-core/src/index.js';
import { ShadowfaxAdapter } from '../../packages/adapters/shadowfax/src/index.js';
import { ShiprocketAdapter } from '../../packages/adapters/shiprocket/src/index.js';

export interface ShippingServiceHandlers {
  listLogisticsProviders: typeof listLogisticsProviders;
  getSellerRateQuotes: typeof getSellerRateQuotes;
  getProviderRateQuotes: typeof getProviderRateQuotes;
  createShipmentIntent: typeof createShipmentIntent;
  createProviderShipmentIntent: typeof createProviderShipmentIntent;
  refreshCarrierTrackingForOrder: typeof refreshCarrierTrackingForOrder;
  findShipmentForWebhook: typeof findShipmentForWebhook;
  applyLogisticsWebhook: typeof applyLogisticsWebhook;
}

export interface CreateShippingServiceAppOptions {
  secret?: string;
  workerEnabled?: boolean;
  handlers?: Partial<ShippingServiceHandlers>;
}

export function getShippingServiceReadiness(workerEnabledOverride?: boolean) {
  const logisticsPostgresConfigured = Boolean(
    process.env.LOGISTICS_SUPABASE_URL?.trim() &&
      process.env.LOGISTICS_SUPABASE_SERVICE_ROLE_KEY?.trim()
  );
  const encryptionKeyConfigured = (process.env.ENCRYPTION_MASTER_KEY?.trim() || '').length >= 32;
  const redisConfigured = Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  );
  const internalSecretConfigured = (process.env.SERVICE_INTERNAL_SECRET?.trim() || '').length >= 16;
  const workerEnabled = workerEnabledOverride ?? process.env.ENABLE_QUEUE_POLLING === '1' || process.env.ENABLE_QUEUE_WORKER === '1';

  return {
    ready: internalSecretConfigured && logisticsPostgresConfigured && encryptionKeyConfigured,
    service: 'shipping-integration-service',
    checks: {
      internalSecretConfigured,
      logisticsPostgresConfigured,
      encryptionKeyConfigured,
      redisConfigured,
      workerEnabled,
      adapters: ['shiprocket', 'shadowfax'] as const,
    },
  };
}

export function createShippingServiceApp(options?: CreateShippingServiceAppOptions) {
  const handlers: ShippingServiceHandlers = {
    listLogisticsProviders,
    getSellerRateQuotes,
    getProviderRateQuotes,
    createShipmentIntent,
    createProviderShipmentIntent,
    refreshCarrierTrackingForOrder,
    findShipmentForWebhook,
    applyLogisticsWebhook,
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
    const readiness = getShippingServiceReadiness(options?.workerEnabled);
    res.json({
      ok: true,
      service: readiness.service,
      mode: 'standalone',
      adapters: readiness.checks.adapters,
      workerEnabled: readiness.checks.workerEnabled,
    });
  });

  app.get('/ready', (_req, res) => {
    res.json(getShippingServiceReadiness(options?.workerEnabled));
  });

  const requireInternalAuth = createInternalServiceAuthMiddleware(
    () => options?.secret ?? process.env.SERVICE_INTERNAL_SECRET
  );
  app.use('/internal/v1', requireInternalAuth);

  app.get('/internal/v1/providers', async (_req, res, next) => {
    try {
      const providers = await handlers.listLogisticsProviders();
      res.json({ providers });
    } catch (error) {
      next(error);
    }
  });

  app.post('/internal/v1/rates', async (req, res, next) => {
    const parsed = z
      .object({
        sellerId: z.string().min(1),
        destinationPostalCode: z.string().max(16),
        weightGrams: z.number().int().positive(),
        codAmountMinor: z.number().int().min(0),
        declaredValueMinor: z.number().int().min(0),
        currency: z.string().min(3).max(6).default('INR'),
      })
      .strict()
      .safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'INVALID_SHIPPING_RATE_REQUEST' });
    }
    try {
      const quotes = await handlers.getSellerRateQuotes(parsed.data);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ quotes });
    } catch (error) {
      next(error);
    }
  });

  app.post('/internal/v1/provider-rates', async (req, res, next) => {
    const parsed = z
      .object({
        providerUserId: z.string().min(1),
        carrierConfigId: z.string().uuid(),
        warehouseId: z.string().uuid(),
        destinationPostalCode: z.string().max(16),
        weightGrams: z.number().int().positive(),
        codAmountMinor: z.number().int().min(0),
        declaredValueMinor: z.number().int().min(0),
        currency: z.string().min(3).max(6).default('INR'),
      })
      .strict()
      .safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'INVALID_PROVIDER_RATE_REQUEST' });
    }
    try {
      const quotes = await handlers.getProviderRateQuotes(parsed.data);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ quotes });
    } catch (error) {
      next(error);
    }
  });

  app.post('/internal/v1/shipments/intent', async (req, res, next) => {
    try {
      const shipment = await handlers.createShipmentIntent(req.body);
      res.status(shipment.duplicate ? 200 : 201).json({ shipment });
    } catch (error) {
      next(error);
    }
  });

  app.post('/internal/v1/shipments/provider-intent', async (req, res, next) => {
    try {
      const shipment = await handlers.createProviderShipmentIntent(req.body);
      res.status(shipment.duplicate ? 200 : 201).json({ shipment });
    } catch (error) {
      next(error);
    }
  });

  app.post('/internal/v1/tracking/refresh', async (req, res, next) => {
    const parsed = z.object({ orderId: z.string().min(1) }).strict().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'INVALID_TRACKING_REFRESH_REQUEST' });
    }
    try {
      const tracking = await handlers.refreshCarrierTrackingForOrder(parsed.data.orderId);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ tracking });
    } catch (error) {
      next(error);
    }
  });

  app.post('/internal/v1/webhooks/apply', async (req, res, next) => {
    const parsed = z
      .object({
        providerCode: z.enum(['shiprocket', 'shadowfax']),
        signature: z.string().min(1),
        rawBodyBase64: z.string().min(1),
      })
      .strict()
      .safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: 'INVALID_LOGISTICS_WEBHOOK_PAYLOAD' });
    }
    try {
      const raw = Buffer.from(parsed.data.rawBodyBase64, 'base64');
      const noHttp = {
        request: async () => {
          throw new Error('HTTP_NOT_AVAILABLE_IN_WEBHOOK_PARSER');
        },
      };
      const adapter =
        parsed.data.providerCode === 'shadowfax'
          ? new ShadowfaxAdapter(noHttp, process.env.SHADOWFAX_API_BASE_URL || 'https://invalid.local')
          : new ShiprocketAdapter(noHttp, process.env.SHIPROCKET_API_BASE_URL || 'https://invalid.local');

      const event = adapter.parseWebhook(JSON.parse(raw.toString('utf8')));
      const shipment = await handlers.findShipmentForWebhook(parsed.data.providerCode, event.awbNumber);
      if (!shipment) {
        return res.status(202).json({ accepted: true, applied: false, reason: 'SHIPMENT_NOT_FOUND' });
      }
      if (!adapter.verifyWebhook(raw, parsed.data.signature, shipment.webhookSecret)) {
        return res.status(401).json({ error: 'INVALID_WEBHOOK_SIGNATURE' });
      }
      const applied = await handlers.applyLogisticsWebhook({
        shipmentId: shipment.shipmentId,
        eventHash: event.eventHash,
        statusCode: STATUS_CODE[event.status as keyof typeof STATUS_CODE],
        locationCode: event.locationCode,
        eventTimestamp: event.occurredAt,
        expectedStatusCode: shipment.currentStatusCode,
        expectedLastEventAt: shipment.lastEventAt,
      });
      res.status(200).json({
        accepted: true,
        applied: Boolean(applied),
        reason: applied ? undefined : 'DUPLICATE_STALE_OR_INVALID_TRANSITION',
      });
    } catch (error) {
      next(error);
    }
  });

  app.use((err: Error & { statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    res.status(status).json({ error: err.message || 'SHIPPING_SERVICE_ERROR' });
  });

  return app;
}
