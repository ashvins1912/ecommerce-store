import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import compression from 'compression';
import sharp from 'sharp';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { timingSafeEqual } from 'node:crypto';
import { UserModel, ProductModel, OrderModel, ReturnRequestModel, RootInviteModel, RootAccessAuditModel } from './src/server/models/schemas.js';
import { SellerPrivacySettingsModel, PrivacyDisclosureAuditModel } from './src/server/models/schemas.js';
import { DEFAULT_CARRIER_DISCLOSURE_POLICY, authorizeCarrierDisclosure, normalizeCarrierDisclosurePolicy, toProviderSafeProfileDto, toSellerSafeProviderProfileDto, toProviderSafeProductDto, toProviderSafeSettlementDto } from './src/server/services/privacy.js';
import { ProviderInviteModel, ProviderProfileModel, ProviderProductModel, ProviderSettlementModel, ProviderAuditModel, ProviderFulfillmentDelegationModel } from './src/server/models/providerSchemas.js';
import { encryptField } from './src/server/services/fieldEncryption.js';
import { canInviteRole } from './src/server/services/roles.js';
import { saveGatewayConfiguration, listGatewayConfigurations, getGatewaySecrets, claimPaymentEvent, getPaymentEventState, markPaymentEventProcessed, releasePaymentEvent, restoreCancelledOrderInventory, getWalletSummary, applyWalletTransaction } from './src/server/services/commerce.js';
import {
  createCheckoutViaPaymentService,
  getSellerRateQuotesViaShippingService,
  inspectIntegrationServices,
  listLogisticsProvidersViaShippingService,
  refreshTrackingViaShippingService,
  refundViaPaymentService,
  verifyWebhookViaPaymentService,
} from './src/server/services/serviceGateway.js';
import { getPlatformFlags, platformFlagsPatchSchema, resolveCheckoutPlan, updatePlatformFlags } from './src/server/services/platformConfig.js';
import { buildDynamicStorefrontSitemap, generateRobotsTxt } from './src/server/services/sitemap.js';
import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { createServer as createViteServer } from 'vite';
import {
  initDatabase,
  queryProducts,
  getSearchSuggestions,
  getProductByIdOrSlug,
  incrementProductView,
  createProduct,
  updateProductDiscountOrStock,
  findUserById,
  findUserByEmail,
  updateSellerOrderNotificationNumber,
  updateSellerVerifiedWhatsAppNumber,
  saveLocalOrderWhatsAppDispatch,
  syncSupabaseCustomerUser,
  registerCustomerAccount,
  authenticateCustomerAccount,
  updateUserCheckoutProfile,
  ensureRootSuperuser, updateRootSuperuserPassword,
  createSellerInvite,
  listSellerInvites,
  revokeSellerInvite,
  validateSellerInviteToken,
  acceptSellerInvite,
  getLikedProductIds,
  getLikedProductsForActor,
  toggleProductLike,
  mergeGuestIntoUser,
  incrementCartAddCount,
  getProductReviews,
  createVerifiedReview,
  getOrdersForUser,
  createOrder,
  updateOrderStatusOrTracking,
  aggregateOrderHistoryByDate,
  getHybridRecommendations,
  getSellerAnalytics,
  recalculateTrendingAndBadges,
  getLocalCartBackup,
  setLocalCartBackup,
  saveAuthSession,
  findActiveAuthSession,
  touchAuthSession,
  listUserSessions,
  revokeAuthSession,
  revokeOtherUserSessions,
  listStorefrontCampaigns,
  listSellerCampaigns,
  createSalesCampaign,
  updateSalesCampaign,
  deleteSalesCampaign,
  listSellerCoupons,
  listKnownCustomers,
  listApplicableCoupons,
  createSellerCoupon,
  updateSellerCoupon,
  deleteSellerCoupon,
  validateCouponForCart,
  listCategories,
  createCategoryControl,
  updateCategoryControl,
  deleteCategoryControl,
  logShareEvent,
  listSellerManagedProducts,
  updateProductControlState,
  removeProductCompletely,
  sanitizeCartItems,
} from './src/server/services/store.js';
import {
  verifySslSessionToken,
  extractBearerOrCookieToken,
  getSslSessionCookieOpts,
  createSessionArtifact,
  toSessionSummary,
  attachSslSecurityHeaders,
  type AuthSessionRecord,
} from './src/server/services/session.js';
import {
  isSupabaseAuthConfigured,
  supabaseSignUpCustomer,
  supabaseSignInWithPassword,
  supabaseGetUserFromAccessToken,
} from './src/server/services/supabaseAuth.js';
import {
  getCartCache,
  setCartCache,
  deleteCartCache,
  storeOtp,
  verifyOtpCode,
  checkRateLimit,
} from './src/server/services/redis.js';
import { processAndStoreImage, getUploadDir } from './src/server/services/storage.js';
import { migrateCommerceDefaults } from './src/server/migrations/2026-11-commerce-defaults.js';
import {
  listSellerCarrierConfigs, saveSellerCarrierConfig, setSellerCarrierActive,
  listSellerWarehouses, createSellerWarehouse, createShipmentIntent, listSellerShipments,
  listProviderCarrierConfigs, saveProviderCarrierConfig, setProviderCarrierActive, getProviderCarrierSecret,
  listProviderWarehouses, createProviderWarehouse, getProviderWarehouse, getProviderRateQuotes, createProviderShipmentIntent,
  retryProviderShipment, listProviderShipments,
  getCustomerTrackingEvents, findShipmentForWebhook, applyLogisticsWebhook, retrySellerShipment,
} from './src/server/services/logistics.js';
import { STATUS_CODE, verifyHmacSha256 } from './packages/logistics-core/src/index.js';
import { ShadowfaxAdapter } from './packages/adapters/shadowfax/src/index.js';
import { ShiprocketAdapter } from './packages/adapters/shiprocket/src/index.js';
import {
  isValidE164,
  getSellerOrderNotificationNumber,
  checkWhatsAppNumberExists,
  sendWhatsAppMessage,
} from './src/server/services/whatsapp.js';
import type {
  CartItem,
  OrderStatus,
  OrderTab,
  TimeGranularity,
  SortOption,
  ProductCategory,
  OccasionType,
  SeasonType,
  ReviewClass,
  ProductControlAction,
  Order,
  User,
} from './src/shared/types.js';

const PORT = Number(process.env.PORT || 3000);
const DISABLE_STATIC_UI = process.env.DISABLE_STATIC_UI === '1';
// Keep Sharp libvips cache strictly bounded so container RSS stays safely under 512 MB.
sharp.cache({ memory: 24, files: 0, items: 16 });
sharp.concurrency(1);
const optimizedImageCache = new Map<string, Buffer>();
const MAX_OPTIMIZED_IMAGE_CACHE_ENTRIES = DISABLE_STATIC_UI ? 8 : 24;
const escapeRegex = (value: string) => value.split('').map((character) => '.^$*+?()[]{}|\\'.includes(character) ? '\\' + character : character).join('');
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET must be configured in production.');
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

function signValue(val: string): string {
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(val).digest('hex').slice(0, 16);
  return `${val}.${sig}`;
}

function unsignValue(signed?: string): string | null {
  if (!signed || !signed.includes('.')) return null;
  const idx = signed.lastIndexOf('.');
  const val = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(val)
    .digest('hex')
    .slice(0, 16);
  return sig === expected ? val : null;
}

function getCookieOpts() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: (process.env.CORS_ALLOWED_ORIGINS ? 'none' : 'lax') as 'none' | 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30,
    path: '/',
  };
}

// clearCookie must not receive maxAge; Express 5 expires the cookie immediately.
function getClearCookieOpts() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: (process.env.CORS_ALLOWED_ORIGINS ? 'none' : 'lax') as 'none' | 'lax',
    path: '/',
  };
}

function getAppBaseUrl(req: Request): string {
  if (process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL') {
    return process.env.APP_URL.replace(/\/$/, '');
  }
  const rawProto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http');
  const proto = rawProto.split(',')[0].trim() || 'http';
  const rawHost = String(req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`);
  const host = rawHost.split(',')[0].trim() || `localhost:${PORT}`;
  return `${proto}://${host}`.replace(/\/$/, '');
}

async function resolveActor(req: Request, res: Response): Promise<{
  guestToken: string;
  user: User | null;
  session: AuthSessionRecord | null;
}> {
  let guestToken = unsignValue(req.cookies?.kk_guest);
  if (!guestToken) {
    guestToken = `gst_${crypto.randomBytes(10).toString('hex')}`;
    res.cookie('kk_guest', signValue(guestToken), getCookieOpts());
  }

  const sslToken = extractBearerOrCookieToken(req);
  if (sslToken) {
    const payload = verifySslSessionToken(sslToken);
    if (payload) {
      const session = await findActiveAuthSession(payload.sid);
      if (session && session.userId === payload.sub) {
        const user = await findUserById(session.userId);
        if (user) {
          await touchAuthSession(session.sessionId);
          return { guestToken, user, session };
        }
      }
    }
    if (req.cookies?.kk_session) {
      res.clearCookie('kk_session', getClearCookieOpts());
    }
  }

  // Legacy fallback only when explicitly present without invalid SSL token
  const legacyUserId = !sslToken ? unsignValue(req.cookies?.kk_user) : null;
  const legacyUser = legacyUserId ? await findUserById(legacyUserId) : null;
  return { guestToken, user: legacyUser, session: null };
}

async function issueUserSession(
  req: Request,
  res: Response,
  user: User,
  provider: 'supabase' | 'invite' | 'demo'
) {
  const { record, token } = createSessionArtifact(req, user, provider);
  await saveAuthSession(record);
  res.cookie('kk_session', token, getSslSessionCookieOpts());
  res.clearCookie('kk_user', getClearCookieOpts());
  return {
    accessToken: token,
    csrfToken: record.csrfToken,
    sessionInfo: toSessionSummary(record, record.sessionId),
    record,
  };
}

async function loadCartForActor(actor: { userId?: string | null; guestToken: string }): Promise<CartItem[]> {
  const cacheKey = actor.userId ? `user:${actor.userId}` : `guest:${actor.guestToken}`;
  const cached = await getCartCache(cacheKey);
  const raw = cached ?? (await getLocalCartBackup(cacheKey));
  const sanitized = await sanitizeCartItems(raw);
  if (sanitized.length !== raw.length) {
    await saveCartForActor(actor, sanitized);
  }
  return sanitized;
}

async function saveCartForActor(
  actor: { userId?: string | null; guestToken: string },
  items: CartItem[]
): Promise<void> {
  const cacheKey = actor.userId ? `user:${actor.userId}` : `guest:${actor.guestToken}`;
  await setCartCache(cacheKey, items);
  await setLocalCartBackup(cacheKey, items);
}

async function startServer() {
  const dbStatus = await initDatabase();
  await ensureRootSuperuser();
  if (dbStatus.mode === 'mongodb') await migrateCommerceDefaults();
  await recalculateTrendingAndBadges();

  const app = express();
  app.set('trust proxy', 1);
  // Compress JSON, HTML, CSS and JavaScript responses with Brotli/gzip where supported.
  app.use(compression({ threshold: 1024 }));
  app.use((_req, res, next) => {
    attachSslSecurityHeaders(res);
    next();
  });
  app.use(express.json({ limit: '4mb', verify: (req: any, _res, buffer) => { req.rawBody = Buffer.from(buffer); } }));
  app.use(cookieParser());

  // Cross-origin CORS + preflight handling for split Static UI -> Lean API deployments.
  const originConfig = process.env.CORS_ALLOWED_ORIGINS || ((process.env.APP_URL || '').startsWith('http') ? process.env.APP_URL! : '');
  const configuredOrigins = originConfig
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .flatMap((origin) => {
      try {
        return [new URL(origin).origin];
      } catch {
        return [];
      }
    });
  app.use((req, res, next) => {
    const requestOriginHeader = String(req.headers.origin || '').trim();
    if (requestOriginHeader) {
      const hostOrigin = `${req.protocol}://${req.get('host')}`;
      const isAllowed =
        configuredOrigins.includes(requestOriginHeader) ||
        requestOriginHeader === hostOrigin ||
        (process.env.NODE_ENV !== 'production' && /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(requestOriginHeader));
      if (isAllowed) {
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Origin', requestOriginHeader);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization, X-CSRF-Token, Idempotency-Key'
        );
        res.setHeader('Access-Control-Max-Age', '600');
      }
    }
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // Same-origin and synchronized-token CSRF protection for state-changing APIs.
  app.use(async (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || req.path.startsWith('/api/webhooks/') || req.path.startsWith('/api/logistics/webhooks/')) return next();
    let suppliedOrigin = String(req.headers.origin || '');
    if (!suppliedOrigin && req.headers.referer) { try { suppliedOrigin = new URL(String(req.headers.referer)).origin; } catch { return res.status(403).json({ error: 'INVALID_REFERER' }); } }
    if (suppliedOrigin) {
      const requestOrigin = req.protocol + '://' + req.get('host');
      const allowed = configuredOrigins.length ? Array.from(new Set([...configuredOrigins, requestOrigin])) : [requestOrigin];
      if (!allowed.includes(suppliedOrigin)) return res.status(403).json({ error: 'ORIGIN_NOT_ALLOWED' });
    }
    const hasSessionCredential = Boolean(req.cookies?.kk_session || String(req.headers.authorization || '').toLowerCase().startsWith('bearer '));
    if (hasSessionCredential) {
      try {
        const actor = await resolveActor(req, res);
        if (actor.session) {
          const supplied = String(req.headers['x-csrf-token'] || '');
          const expected = actor.session.csrfToken;
          const a = Buffer.from(supplied); const b = Buffer.from(expected);
          if (!supplied || a.length !== b.length || !timingSafeEqual(a, b)) return res.status(403).json({ error: 'CSRF_TOKEN_INVALID' });
        } else if (req.cookies?.kk_session) return res.status(401).json({ error: 'SESSION_INVALID' });
      } catch { return res.status(403).json({ error: 'CSRF_VALIDATION_FAILED' }); }
    }
    next();
  });

  // Level 0 root is the platform-wide administrator. Route handlers still enforce
  // their domain-specific authorization; root is represented as ADMIN plus the immutable root flag.


  // Serve source raster assets as cached WebP to browsers that support it.
  // The original URL is retained, so existing product records and image references remain valid.
  const sourceAssetRoot = path.resolve(process.cwd(), 'src/assets');
  app.get(/^\/src\/assets\/(.+\.(?:jpe?g|png))$/i, async (req, res, next) => {
    res.vary('Accept');
    if (!req.accepts('image/webp')) return next();

    try {
      const relativePath = String(req.params[0] || '');
      const sourcePath = path.resolve(sourceAssetRoot, relativePath);
      if (!sourcePath.startsWith(sourceAssetRoot + path.sep)) return res.sendStatus(400);

      let webp = optimizedImageCache.get(sourcePath);
      if (!webp) {
        webp = await sharp(sourcePath).rotate().webp({ quality: 80, effort: 4 }).toBuffer();
        if (optimizedImageCache.size >= MAX_OPTIMIZED_IMAGE_CACHE_ENTRIES) {
          const oldestKey = optimizedImageCache.keys().next().value;
          if (oldestKey) optimizedImageCache.delete(oldestKey);
        }
        optimizedImageCache.set(sourcePath, webp);
      }

      res.vary('Accept');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.type('image/webp').send(webp);
    } catch (error) {
      next(error);
    }
  });

  // Static serving for generated images & Sharp WebP uploads.
  app.use('/uploads', express.static(getUploadDir(), { maxAge: '1d', etag: true }));
  app.use('/src/assets', express.static(sourceAssetRoot, { maxAge: '1d', etag: true }));

  // --- Health & Runtime Platform Config ---
  app.get('/api/health', async (_req, res) => {
    const ready = process.env.NODE_ENV !== 'production' || dbStatus.mode === 'mongodb';
    const flags = await getPlatformFlags().catch(() => null);
    res.status(ready ? 200 : 503).json({
      ok: ready,
      status: ready ? 'ready' : 'not_ready',
      dbMode: dbStatus.mode,
      staticUiDisabled: DISABLE_STATIC_UI,
      workerActive: process.env.RUN_LOGISTICS_WORKER === '1' && Boolean(flags?.backgroundWorkerEnabled),
    });
  });

  app.get('/api/config/platform', async (_req, res) => {
    try {
      const flags = await getPlatformFlags();
      res.setHeader('Cache-Control', 'public, max-age=15');
      res.json({ flags });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message || 'PLATFORM_CONFIG_UNAVAILABLE' });
    }
  });

  app.get('/api/admin/platform-flags', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'ADMIN_ACCESS_REQUIRED' });
    }
    const flags = await getPlatformFlags();
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ flags });
  });

  app.put('/api/admin/platform-flags', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'ADMIN_ACCESS_REQUIRED' });
    }
    const parsed = platformFlagsPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'INVALID_PLATFORM_FLAGS' });
    }
    const updated = await updatePlatformFlags(parsed.data, { _id: user._id, name: user.name });
    await auditRootAccess(user, req, 'PLATFORM_FLAGS_UPDATED', 'platform_config', 'default', JSON.stringify(parsed.data));
    res.json({ flags: updated });
  });

  app.get('/api/admin/services/status', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'ADMIN_ACCESS_REQUIRED' });
    }
    const flags = await getPlatformFlags();
    const services = await inspectIntegrationServices({ liveProbe: false, flags });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ services });
  });

  app.post('/api/admin/services/check', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'ADMIN_ACCESS_REQUIRED' });
    }
    const flags = await getPlatformFlags();
    const services = await inspectIntegrationServices({ liveProbe: true, flags });
    await auditRootAccess(user, req, 'SERVICE_READINESS_PROBED', 'integration_services', 'default', 'liveProbe');
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ services });
  });

  // --- SEO: Dynamic Sitemap & Robots ---
  app.get('/sitemap.xml', async (req, res, next) => {
    try {
      const xml = await buildDynamicStorefrontSitemap(getAppBaseUrl(req));
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.status(200).send(xml);
    } catch (error) {
      next(error);
    }
  });

  app.get('/robots.txt', (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).send(generateRobotsTxt(getAppBaseUrl(req)));
  });

  // --- Logistics: separate PostgreSQL persistence boundary ---
  const requireLogisticsSeller = (user: User | null) => Boolean(user && (user.role === 'SELLER' || user.role === 'ADMIN'));
  const requireVerifiedLogisticsSeller = (user: User | null) => Boolean(user && (user.role === 'ADMIN' || (user.role === 'SELLER' && user.isWhatsappVerified)));

  app.get('/api/logistics/providers', async (_req, res) => {
    try { res.json({ providers: await listLogisticsProvidersViaShippingService() }); }
    catch (error) { const e = error as any; res.status(e.statusCode || 503).json({ error: e.message || 'LOGISTICS_UNAVAILABLE' }); }
  });

  app.post('/api/logistics/rates', async (req, res) => {
    const flags = await getPlatformFlags();
    if (!flags.shippingQuotesEnabled) {
      return res.json({
        flaggedOff: true,
        shippingPolicy: flags.flatFallbackShippingInr > 0 ? 'FLAT_FALLBACK' : 'FREE_FLAGGED_OFF',
        flatFallbackShippingInr: flags.flatFallbackShippingInr,
        groups: [],
      });
    }
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'BUYER') return res.status(401).json({ error: 'BUYER_AUTH_REQUIRED' });
    const rateLimit = await checkRateLimit('logistics-rates:' + user._id, 12, 60);
    const ipRateLimit = await checkRateLimit('logistics-rates-ip:' + req.ip, 30, 60);
    if (!rateLimit.allowed || !ipRateLimit.allowed) return res.status(429).json({ error: 'LOGISTICS_RATE_LIMITED' });
    const parsed = z.object({
      items: z.array(z.object({ productId: z.string().min(1), quantity: z.coerce.number().int().min(1).max(50) })).min(1).max(50),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'INVALID_RATE_REQUEST' });
    const quantities = new Map<string, number>();
    for (const item of parsed.data.items) quantities.set(item.productId, (quantities.get(item.productId) || 0) + item.quantity);
    if ([...quantities.values()].some(quantity => quantity > 50)) return res.status(400).json({ error: 'INVALID_ITEM_QUANTITY' });
    const requestedProductKeys = [...quantities.keys()];
    try {
      // Resolve product IDs and public slugs against the catalog before ObjectId use.
      const resolvedProducts = await Promise.all(requestedProductKeys.map(key => getProductByIdOrSlug(key, { includeControlled: true })));
      if (resolvedProducts.some(product => !product)) return res.status(404).json({ error: 'ONE_OR_MORE_PRODUCTS_UNAVAILABLE' });
      const products = resolvedProducts.map(product => product as any);
      if (products.some(product => product.visibility === 'ASSIGNED' && !product.assignedCustomerIds?.map(String).includes(String(user._id)))) {
        return res.status(403).json({ error: 'PRODUCT_NOT_ASSIGNED_TO_BUYER' });
      }
      const productIdByKey = new Map<string, string>();
      products.forEach((product, index) => {
        const canonicalId = String(product._id);
        if (!mongoose.isValidObjectId(canonicalId)) throw new Error('INVALID_CATALOG_PRODUCT_ID');
        productIdByKey.set(requestedProductKeys[index], canonicalId);
      });
      const quantitiesByCanonicalId = new Map<string, number>();
      for (const [key, quantity] of quantities) {
        const canonicalId = productIdByKey.get(key)!;
        quantitiesByCanonicalId.set(canonicalId, (quantitiesByCanonicalId.get(canonicalId) || 0) + quantity);
      }
      if ([...quantitiesByCanonicalId.values()].some(quantity => quantity > 50)) return res.status(400).json({ error: 'INVALID_ITEM_QUANTITY' });
      if (products.length !== requestedProductKeys.length) return res.status(404).json({ error: 'ONE_OR_MORE_PRODUCTS_UNAVAILABLE' });
      const bySeller = new Map<string, { weightGrams: number; declaredValueMinor: number; codAmountMinor: number; prepaidRequired: boolean }>();
      for (const product of products) {
        const sellerId = String(product.sellerId);
        const quantity = quantitiesByCanonicalId.get(String(product._id)) || 0;
        const current = bySeller.get(sellerId) || { weightGrams: 100, declaredValueMinor: 0, codAmountMinor: 0, prepaidRequired: false };
        current.weightGrams += Math.max(1, Number(product.shippingWeightGrams) || 500) * quantity;
        current.declaredValueMinor += Math.round(Number(product.salePrice || 0) * quantity * 100);
        if (product.codAllowed === false || product.onlinePaymentRequired === true) current.prepaidRequired = true;
        else current.codAmountMinor += Math.round(Number(product.salePrice || 0) * quantity * 100);
        bySeller.set(sellerId, current);
      }
      const groups = await Promise.all([...bySeller.entries()].map(async ([sellerId, parcel]) => {
        if (parcel.prepaidRequired) parcel.codAmountMinor = 0;
        const [quotes, seller] = await Promise.all([
          getSellerRateQuotesViaShippingService({ sellerId, destinationPostalCode: String(user.shippingAddresses?.find(a => a.isDefault)?.pincode || user.shippingAddresses?.[0]?.pincode || ''),
            weightGrams: parcel.weightGrams, codAmountMinor: parcel.codAmountMinor,
            declaredValueMinor: parcel.declaredValueMinor, currency: 'INR' }),
          UserModel.findById(sellerId).select('sellerProfile.shippingMarkupPercent').lean(),
        ]);
        const markupPercent = Math.min(100, Math.max(0, Number((seller as any)?.sellerProfile?.shippingMarkupPercent || 0)));
        return { sellerId, markupPercent, quotes: quotes.map(({ providerCode, serviceCode, costMinor, currency, estimatedTransitHours, score, quote }) => ({
          providerCode, serviceCode, costMinor, currency, estimatedTransitHours, score,
          sellerMarkupMinor: Math.round(costMinor * markupPercent / 100),
          customerChargeMinor: costMinor + Math.round(costMinor * markupPercent / 100),
          expiresAt: quote?.expiresAt,
        })) };
      }));
      const projection = { groups, partial: groups.some(group => group.quotes.length === 0), estimateBasis: 'CATALOG_SHIPPING_WEIGHT' };
      const etag = '"' + crypto.createHash('sha256').update(JSON.stringify(projection)).digest('hex') + '"';
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'private, no-cache');
      if (req.headers['if-none-match'] === etag) return res.status(304).end();
      res.json(projection);
    } catch (error) { const e = error as any; res.status(e.statusCode || 503).json({ error: e.message || 'RATE_LOOKUP_FAILED' }); }
  });

  app.get('/api/seller/shipping-policy', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!requireLogisticsSeller(user)) return res.status(403).json({ error: 'SELLER_ROLE_REQUIRED' });
    const seller = await UserModel.findById(user!._id).select('sellerProfile.shippingMarkupPercent').lean() as any;
    res.json({ policy: 'SEPARATE', markupPercent: Math.min(100, Math.max(0, Number(seller?.sellerProfile?.shippingMarkupPercent || 0))) });
  });

  app.patch('/api/seller/shipping-policy', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!requireLogisticsSeller(user)) return res.status(403).json({ error: 'SELLER_ROLE_REQUIRED' });
    const parsed = z.object({ markupPercent: z.coerce.number().min(0).max(100) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_SHIPPING_MARKUP' });
    await UserModel.updateOne({ _id: new mongoose.Types.ObjectId(user!._id) }, { $set: { 'sellerProfile.shippingMarkupPercent': parsed.data.markupPercent } });
    res.json({ policy: 'SEPARATE', markupPercent: parsed.data.markupPercent });
  });

  app.get('/api/seller/logistics/carriers', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!requireLogisticsSeller(user)) return res.status(403).json({ error: 'SELLER_ROLE_REQUIRED' });
    try { res.json({ carriers: await listSellerCarrierConfigs(user!._id) }); }
    catch (error) { const e = error as any; res.status(e.statusCode || 503).json({ error: e.message || 'LOGISTICS_UNAVAILABLE' }); }
  });

  app.post('/api/seller/logistics/carriers', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!requireLogisticsSeller(user)) return res.status(403).json({ error: 'SELLER_ROLE_REQUIRED' });
    const parsed = z.object({
      providerId: z.string().uuid(),
      credentials: z.record(z.string(), z.string()),
      priorityRank: z.coerce.number().int().min(0).max(10000).default(100),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'INVALID_CARRIER_CONFIG' });
    try {
      const saved = await saveSellerCarrierConfig({ sellerId: user!._id, ...parsed.data });
      res.status(201).json({ carrier: saved, message: 'Credentials encrypted and saved. Verify against the carrier sandbox before using live shipments.' });
    } catch (error) { const e = error as any; res.status(e.statusCode || 503).json({ error: e.message || 'CARRIER_CONFIG_SAVE_FAILED' }); }
  });

  app.patch('/api/seller/logistics/carriers/:id/active', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!requireLogisticsSeller(user)) return res.status(403).json({ error: 'SELLER_ROLE_REQUIRED' });
    const parsed = z.object({ isActive: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_ACTIVE_FLAG' });
    try {
      const updated = await setSellerCarrierActive(user!._id, req.params.id, parsed.data.isActive);
      if (!updated) return res.status(404).json({ error: 'CARRIER_CONFIG_NOT_FOUND' });
      res.json({ carrier: updated });
    } catch (error) { const e = error as any; res.status(e.statusCode || 503).json({ error: e.message || 'CARRIER_UPDATE_FAILED' }); }
  });

  app.get('/api/seller/privacy-settings', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!requireVerifiedLogisticsSeller(user)) return res.status(403).json({ error: 'SELLER_ROLE_REQUIRED' });
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: 'PRIVACY_POLICY_STORE_UNAVAILABLE' });
    try {
      const settings = await SellerPrivacySettingsModel.findOne({ sellerId: user!._id }).lean();
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ carrierDisclosure: normalizeCarrierDisclosurePolicy(settings?.carrierDisclosure || DEFAULT_CARRIER_DISCLOSURE_POLICY) });
    } catch { res.status(503).json({ error: 'SELLER_PRIVACY_SETTINGS_UNAVAILABLE' }); }
  });

  app.put('/api/seller/privacy-settings', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!requireVerifiedLogisticsSeller(user)) return res.status(403).json({ error: 'SELLER_ROLE_REQUIRED' });
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: 'PRIVACY_POLICY_STORE_UNAVAILABLE' });
    const parsed = z.object({
      carrierDisclosure: z.object({
        recipientName: z.boolean(), recipientPhone: z.boolean(),
        recipientAddress: z.boolean(), recipientEmail: z.boolean(),
      }).strict(),
    }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PRIVACY_SETTINGS' });
    try {
      const settings = await SellerPrivacySettingsModel.findOneAndUpdate(
        { sellerId: user!._id },
        { $set: { sellerId: user!._id, carrierDisclosure: parsed.data.carrierDisclosure } },
        { upsert: true, returnDocument: 'after', runValidators: true },
      ).lean();
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ carrierDisclosure: normalizeCarrierDisclosurePolicy(settings?.carrierDisclosure) });
    } catch { res.status(503).json({ error: 'SELLER_PRIVACY_SETTINGS_SAVE_FAILED' }); }
  });

  app.get('/api/seller/privacy-disclosures', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!requireVerifiedLogisticsSeller(user)) return res.status(403).json({ error: 'SELLER_ROLE_REQUIRED' });
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: 'PRIVACY_POLICY_STORE_UNAVAILABLE' });
    const filter = user!.role === 'ADMIN' ? {} : { sellerId: user!._id };
    const disclosures = await PrivacyDisclosureAuditModel.find(filter)
      .sort({ authorizedAt: -1 }).limit(100)
      .select('sellerId orderId carrierConfigId carrierCode fieldsAuthorized actorId authorizedAt jobId dispatchStatus dispatchedAt dispatchErrorCode purpose')
      .lean();
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ disclosures });
  });

  app.get('/api/seller/logistics/warehouses', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!requireLogisticsSeller(user)) return res.status(403).json({ error: 'SELLER_ROLE_REQUIRED' });
    try { res.json({ warehouses: await listSellerWarehouses(user!._id) }); }
    catch (error) { const e = error as any; res.status(e.statusCode || 503).json({ error: e.message || 'LOGISTICS_UNAVAILABLE' }); }
  });

  app.post('/api/seller/logistics/warehouses', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!requireLogisticsSeller(user)) return res.status(403).json({ error: 'SELLER_ROLE_REQUIRED' });
    const parsed = z.object({
      warehouseCode: z.string().trim().min(2).max(64), name: z.string().trim().min(2).max(120),
      contactName: z.string().trim().min(2).max(120), contactPhone: z.string().trim().min(8).max(24),
      addressLine1: z.string().trim().min(3).max(180), addressLine2: z.string().max(180).optional(),
      locality: z.string().max(120).optional(), city: z.string().trim().min(2).max(100),
      state: z.string().trim().min(2).max(100), postalCode: z.string().trim().min(4).max(12),
      countryCode: z.string().length(2).default('IN'), isDefault: z.boolean().default(false),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'INVALID_WAREHOUSE' });
    try { res.status(201).json({ warehouse: await createSellerWarehouse({ sellerId: user!._id, ...parsed.data }) }); }
    catch (error) { const e = error as any; res.status(e.statusCode || 503).json({ error: e.message || 'WAREHOUSE_CREATE_FAILED' }); }
  });

  app.get('/api/seller/logistics/shipments', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!requireLogisticsSeller(user)) return res.status(403).json({ error: 'SELLER_ROLE_REQUIRED' });
    try { res.json({ shipments: await listSellerShipments(user!._id) }); }
    catch (error) { const e = error as any; res.status(e.statusCode || 503).json({ error: e.message || 'LOGISTICS_UNAVAILABLE' }); }
  });

  app.post('/api/seller/logistics/shipments', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!requireVerifiedLogisticsSeller(user)) return res.status(403).json({ error: 'SELLER_ROLE_REQUIRED' });
    const parsed = z.object({
      orderId: z.string().min(1), carrierConfigId: z.string().uuid(), warehouseId: z.string().uuid(),
      weightGrams: z.coerce.number().int().min(1).max(100000),
      serviceCode: z.string().trim().min(1).max(100).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'INVALID_SHIPMENT_REQUEST' });
    if (!mongoose.isValidObjectId(parsed.data.orderId)) return res.status(400).json({ error: 'INVALID_ORDER_ID' });
    let disclosureAuditId: string | null = null;
    try {
      const order = await OrderModel.findById(parsed.data.orderId).lean() as any;
      if (!order) return res.status(404).json({ error: 'ORDER_NOT_FOUND' });
      if (String(order.sellerId) !== user!._id) return res.status(403).json({ error: 'ORDER_NOT_OWNED_BY_SELLER' });
      if (['Cancelled', 'CANCELLED'].includes(order.status)) return res.status(409).json({ error: 'CANCELLED_ORDER_CANNOT_SHIP' });
      if (order.status !== 'Packed') return res.status(409).json({ error: 'ORDER_MUST_BE_PACKED_BEFORE_SHIPMENT' });
      if (!['COD', 'SELLER_COLLECT', 'POS_ON_DELIVERY'].includes(order.paymentMode) && order.paymentStatus !== 'PAID') return res.status(409).json({ error: 'PAYMENT_MUST_BE_CONFIRMED_BEFORE_SHIPMENT' });
      const address = order.shippingAddress || {};
      const pin = String(address.pincode || '').trim();
      if (!pin || !address.street || !address.city || !address.state || !address.fullName || !address.phone) return res.status(422).json({ error: 'ORDER_SHIPPING_ADDRESS_INCOMPLETE' });
      const buyer = await findUserById(String(order.buyerId));
      const sellerCarriers = (await listSellerCarrierConfigs(String(order.sellerId))) || [];
      const selectedCarrier = sellerCarriers.find((carrier: any) => String(carrier.id) === parsed.data.carrierConfigId);
      if (!selectedCarrier) return res.status(422).json({ error: 'SELLER_CARRIER_CONFIGURATION_NOT_FOUND' });
      const carrierCode = String(selectedCarrier.logistics_providers?.[0]?.code || '').toLowerCase();
      if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: 'PRIVACY_POLICY_STORE_UNAVAILABLE' });
      const privacySettings = await SellerPrivacySettingsModel.findOne({ sellerId: String(order.sellerId) }).lean();
      const disclosure = authorizeCarrierDisclosure(privacySettings?.carrierDisclosure, carrierCode, buyer?.email);
      if (!disclosure.allowed) return res.status(403).json({
        error: disclosure.emailRequired && disclosure.missing.includes('recipientEmail') ? 'SELLER_MUST_AUTHORIZE_CUSTOMER_EMAIL_FOR_CARRIER' : 'SELLER_CUSTOMER_DATA_DISCLOSURE_NOT_AUTHORIZED',
        requiredFields: disclosure.missing,
      });
      const disclosureAudit = await PrivacyDisclosureAuditModel.create({
        sellerId: String(order.sellerId), orderId: String(order._id), carrierConfigId: parsed.data.carrierConfigId,
        carrierCode, fieldsAuthorized: disclosure.fields, actorId: user!._id,
        authorizedAt: new Date(), dispatchStatus: 'AUTHORIZED', purpose: 'SHIPMENT_FULFILLMENT',
      });
      disclosureAuditId = String(disclosureAudit._id);
      const result = await createShipmentIntent({
        orderId: String(order._id), sellerId: String(order.sellerId), carrierConfigId: parsed.data.carrierConfigId, carrierCode,
        warehouseId: parsed.data.warehouseId, weightGrams: parsed.data.weightGrams, serviceCode: parsed.data.serviceCode,
        destinationPostalCode: pin, destinationCountryCode: 'IN',
        codAmountMinor: order.paymentMode === 'COD' ? Math.round(Number(order.totalAmount || 0) * 100) : 0,
        declaredValueMinor: Math.round(Number(order.totalAmount || 0) * 100), currency: 'INR',
        recipientName: disclosure.policy.recipientName ? String(address.fullName) : '', recipientPhone: disclosure.policy.recipientPhone ? String(address.phone) : '', recipientEmail: disclosure.policy.recipientEmail ? (buyer?.email || '') : '',
        disclosureAuthorizedAt: new Date().toISOString(), disclosureFields: disclosure.fields,
        disclosureAuditId,
        destinationAddressLine1: disclosure.policy.recipientAddress ? String(address.street) : '', destinationCity: disclosure.policy.recipientAddress ? String(address.city) : '', destinationState: disclosure.policy.recipientAddress ? String(address.state) : '',
        orderDate: new Date(order.createdAt || Date.now()).toISOString(),
        items: (order.items || []).map((item: any) => ({ name: String(item.title), sku: String(item.variantSku || item.productId), quantity: Number(item.quantity), unitPrice: Number(item.unitPrice) })),
      });
      await PrivacyDisclosureAuditModel.updateOne(
        { _id: disclosureAudit._id },
        { $set: result.duplicate
          ? { jobId: result.jobId || null, dispatchStatus: 'NOT_DISPATCHED', dispatchErrorCode: 'DUPLICATE_SHIPMENT_NO_NEW_DISCLOSURE' }
          : { jobId: result.jobId || null } },
      );
      res.status(result.duplicate ? 200 : 202).json({ ...result, status: result.duplicate ? 'ALREADY_QUEUED_OR_BOOKED' : 'QUEUED', message: result.duplicate ? 'A shipment already exists for this order; no duplicate booking was created.' : 'Shipment creation queued for the logistics worker.' });
    } catch (error) {
      if (disclosureAuditId) {
        await PrivacyDisclosureAuditModel.updateOne(
          { _id: disclosureAuditId, dispatchStatus: 'AUTHORIZED' },
          { $set: { dispatchStatus: 'FAILED', dispatchErrorCode: 'SHIPMENT_QUEUE_FAILED' } },
        ).catch(() => {});
      }
      const e = error as any;
      res.status(e.statusCode || 503).json({ error: e.message || 'SHIPMENT_QUEUE_FAILED' });
    }
  });

  app.post('/api/seller/logistics/shipments/:id/retry', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!requireLogisticsSeller(user)) return res.status(403).json({ error: 'SELLER_ROLE_REQUIRED' });
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: 'INVALID_SHIPMENT_ID' });
    try {
      const jobId = await retrySellerShipment(user!._id, req.params.id);
      res.status(202).json({ jobId, status: 'QUEUED', message: 'Shipment booking retry queued.' });
    } catch (error) { const e = error as any; res.status(e.statusCode || 409).json({ error: e.message || 'SHIPMENT_NOT_RETRYABLE' }); }
  });

  app.post('/api/logistics/webhooks/:providerCode', async (req, res) => {
    try {
      const providerCode = String(req.params.providerCode || '').toLowerCase();
      const raw = (req as any).rawBody as Buffer | undefined;
      const signature = String(req.headers['x-api-key'] || req.headers['x-logistics-signature'] || req.headers['x-signature'] || '');
      if (!raw || !signature) return res.status(400).json({ error: 'WEBHOOK_RAW_BODY_OR_SIGNATURE_MISSING' });
      let adapter: any;
      const noHttp = { request: async () => { throw new Error('HTTP_NOT_AVAILABLE_IN_WEBHOOK_PARSER'); } };
      if (providerCode === 'shadowfax') adapter = new ShadowfaxAdapter(noHttp, process.env.SHADOWFAX_API_BASE_URL || 'https://invalid.local');
      else if (providerCode === 'shiprocket') adapter = new ShiprocketAdapter(noHttp, process.env.SHIPROCKET_API_BASE_URL || 'https://invalid.local');
      else return res.status(404).json({ error: 'UNKNOWN_LOGISTICS_PROVIDER' });
      const event = adapter.parseWebhook(JSON.parse(raw.toString('utf8')));
      const shipment = await findShipmentForWebhook(providerCode, event.awbNumber);
      if (!shipment) return res.status(202).json({ accepted: true, applied: false, reason: 'SHIPMENT_NOT_FOUND' });
      if (!adapter.verifyWebhook(raw, signature, shipment.webhookSecret)) return res.status(401).json({ error: 'INVALID_WEBHOOK_SIGNATURE' });
      const applied = await applyLogisticsWebhook({
        shipmentId: shipment.shipmentId, eventHash: event.eventHash, statusCode: STATUS_CODE[event.status as keyof typeof STATUS_CODE],
        locationCode: event.locationCode, eventTimestamp: event.occurredAt,
        expectedStatusCode: shipment.currentStatusCode, expectedLastEventAt: shipment.lastEventAt,
      });
      res.status(200).json({ accepted: true, applied: Boolean(applied), reason: applied ? undefined : 'DUPLICATE_STALE_OR_INVALID_TRANSITION' });
    } catch (error) { const e = error as any; res.status(e.statusCode || 400).json({ error: e.message || 'WEBHOOK_PROCESSING_FAILED' }); }
  });

  app.get('/api/logistics/orders/:orderId/tracking', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    if (!mongoose.isValidObjectId(req.params.orderId)) return res.status(400).json({ error: 'INVALID_ORDER_ID' });
    try {
      const order = await OrderModel.findById(req.params.orderId).select('buyerId').lean() as any;
      if (!order || String(order.buyerId) !== user._id) return res.status(404).json({ error: 'ORDER_NOT_FOUND' });
      const trackingLimit = await checkRateLimit('logistics-tracking:' + user._id, 12, 60);
      if (!trackingLimit.allowed) return res.status(429).json({ error: 'TRACKING_RATE_LIMITED' });
      const tracking = await refreshTrackingViaShippingService(req.params.orderId) as any;
      if (!tracking) return res.status(404).json({ error: 'TRACKING_NOT_AVAILABLE' });
      const names: Record<number,string> = {10:'CREATED',20:'MANIFESTED',30:'IN_TRANSIT',40:'OUT_FOR_DELIVERY',50:'DELIVERED',60:'NDR',70:'RTO_INITIATED',80:'RTO_DELIVERED',90:'CANCELLED'};
      const projection = { status: names[tracking.statusCode] || 'CREATED', eta: tracking.eta, latestCheckpoint: tracking.latestCheckpoint ? { status: names[tracking.latestCheckpoint.status_code] || 'UNKNOWN', location: tracking.latestCheckpoint.location_code, timestamp: tracking.latestCheckpoint.event_timestamp } : null };
      const etag = '"'+crypto.createHash('sha256').update(JSON.stringify(projection)).digest('hex')+'"';
      res.setHeader('ETag', etag);
      if (req.headers['if-none-match'] === etag) return res.status(304).end();
      res.json(projection);
    } catch (error) { const e = error as any; res.status(e.statusCode || 503).json({ error: e.message || 'TRACKING_LOOKUP_FAILED' }); }
  });

  // --- Auth & Guest Session ---
  app.get('/api/auth/me', async (req, res) => {
    const { guestToken, user, session } = await resolveActor(req, res);
    const likedProductIds = await getLikedProductIds({
      userId: user?._id || null,
      guestToken,
    });
    const cart = await loadCartForActor({ userId: user?._id || null, guestToken });
    res.json({
      authenticated: Boolean(user),
      role: user ? user.role : 'GUEST',
      user,
      guestToken,
      csrfToken: session?.csrfToken,
      sessionInfo: session ? toSessionSummary(session, session.sessionId) : null,
      likedProductIds,
      cart,
      authConfig: {
        supabaseConfigured: isSupabaseAuthConfigured(),
      },
    });
  });

  // Helper to merge guest likes + cart into authenticated user account
  async function mergeGuestSessionData(guestToken: string, userId: string) {
    await mergeGuestIntoUser(guestToken, userId);

    const guestCart = await loadCartForActor({ userId: null, guestToken });
    if (guestCart.length > 0) {
      const userCart = await loadCartForActor({ userId, guestToken });
      const merged = [...userCart];
      for (const item of guestCart) {
        const match = merged.find(
          (m) => m.productId === item.productId && m.variantSku === item.variantSku
        );
        if (match) match.quantity += item.quantity;
        else merged.push(item);
      }
      await saveCartForActor({ userId, guestToken }, merged);
      await deleteCartCache(`guest:${guestToken}`);
    }
  }

  function normalizeCustomerMobile(raw?: string): string | undefined {
    const trimmed = (raw || '').trim();
    if (!trimmed) return undefined;
    const digits = trimmed.replace(/[^\d+]/g, '');
    const normalized = /^\d{10}$/.test(digits) ? `+91${digits}` : digits;
    if (!isValidE164(normalized)) {
      throw new Error('Mobile number must be a valid 10-digit Indian number or E.164 format (e.g., +919876543210).');
    }
    return normalized;
  }

  // Supabase OAuth callback exchange: validate provider token, then issue the app's own session.
  app.post('/api/auth/oauth', async (req, res) => {
    const schema = z.object({ accessToken: z.string().min(20).max(8192) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'A valid Supabase access token is required.' });
    }

    const { guestToken } = await resolveActor(req, res);
    try {
      const profile = await supabaseGetUserFromAccessToken(parsed.data.accessToken);
      const user = await syncSupabaseCustomerUser({
        supabaseUid: profile.supabaseUid,
        email: profile.email,
        name: profile.name,
        mobileNumber: profile.mobileNumber,
      });
      await mergeGuestSessionData(guestToken, user._id);
      const issued = await issueUserSession(req, res, user, 'supabase');
      const likedProductIds = await getLikedProductIds({ userId: user._id, guestToken });
      const cart = await loadCartForActor({ userId: user._id, guestToken });
      return res.json({
        user,
        accessToken: issued.accessToken,
        csrfToken: issued.csrfToken,
        sessionInfo: issued.sessionInfo,
        likedProductIds,
        cart,
      });
    } catch (err) {
      const status = (err as { status?: number }).status || 401;
      return res.status(status).json({ error: (err as Error).message || 'Social sign-in failed' });
    }
  });

  // Account Sign-Up via Supabase Auth (with persistent salted scrypt fallback)
  app.post('/api/auth/signup', async (req, res) => {
    const allowed = await checkRateLimit(`signup:${req.ip}`, 20, 600);
    if (!allowed) {
      return res.status(429).json({ error: 'Too many sign-up attempts. Please wait a few minutes.' });
    }

    const schema = z.object({
      name: z.string().trim().min(2, 'Please enter your full name (at least 2 characters).').max(80),
      email: z.string().trim().email('Please enter a valid email address.'),
      password: z.string().min(6, 'Password must be at least 6 characters.').max(128),
      mobileNumber: z.string().trim().max(24).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid sign-up details' });
    }

    let mobileNumber: string | undefined;
    try {
      mobileNumber = normalizeCustomerMobile(parsed.data.mobileNumber);
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }

    const { guestToken } = await resolveActor(req, res);

    try {
      let user: User;
      if (isSupabaseAuthConfigured()) {
        const supa = await supabaseSignUpCustomer({
          name: parsed.data.name,
          email: parsed.data.email,
          password: parsed.data.password,
          mobileNumber,
          redirectTo: getAppBaseUrl(req),
        });
        user = await syncSupabaseCustomerUser({
          supabaseUid: supa.supabaseUid,
          email: supa.email,
          name: supa.name,
          mobileNumber: supa.mobileNumber,
        });

        if (!supa.hasSession) {
          return res.status(200).json({
            ok: true,
            requiresEmailVerification: true,
            email: supa.email,
            message:
              'Account created in Supabase. Please check your inbox to confirm your email before signing in.',
          });
        }
      } else {
        user = await registerCustomerAccount({
          name: parsed.data.name,
          email: parsed.data.email,
          password: parsed.data.password,
          mobileNumber,
        });
      }

      await mergeGuestSessionData(guestToken, user._id);
      const issued = await issueUserSession(req, res, user, 'supabase');
      const likedProductIds = await getLikedProductIds({ userId: user._id, guestToken });
      const cart = await loadCartForActor({ userId: user._id, guestToken });

      return res.status(201).json({
        user,
        accessToken: issued.accessToken,
        csrfToken: issued.csrfToken,
        sessionInfo: issued.sessionInfo,
        likedProductIds,
        cart,
      });
    } catch (err) {
      const status = (err as { status?: number }).status || 400;
      return res.status(status).json({ error: (err as Error).message || 'Sign up failed' });
    }
  });

  // Account Sign-In via Supabase Auth (or 1-click dummy test role switch) + SSL Token Issue
  app.post('/api/auth/signin', async (req, res) => {
    const schema = z.union([
      z.object({
        quickDemoUserId: z.string().min(1),
        email: z.string().email().optional(),
      }),
      z.object({
        email: z.string().trim().email('Please enter a valid email address.'),
        password: z.string().min(1, 'Please enter your password.'),
      }),
    ]);

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid credentials' });
    }

    const { guestToken } = await resolveActor(req, res);

    try {
      let user: User | null = null;
      let sessionProvider: 'supabase' | 'demo' = 'supabase';

      if ('quickDemoUserId' in parsed.data) {
        if (process.env.NODE_ENV === 'production') {
          return res.status(404).json({ error: 'Test accounts are disabled in production.' });
        }
        // Prefer the demo email because MongoDB seed records receive generated ObjectIds;
        // the stable demo IDs are used by the local JSON store and UI only.
        user = parsed.data.email ? await findUserByEmail(parsed.data.email) : null;
        if (!user) {
          try {
            user = await findUserById(parsed.data.quickDemoUserId);
          } catch {
            user = null;
          }
        }
        if (!user) {
          return res.status(404).json({ error: 'Test account not found.' });
        }
        sessionProvider = 'demo';
      } else {
        const rootCandidate = await findUserByEmail(parsed.data.email);
        if (rootCandidate?.isRootSuperuser) {
          const rootLoginLimit = await checkRateLimit('root-signin:' + req.ip + ':' + rootCandidate._id, 5, 300);
          if (!rootLoginLimit.allowed) return res.status(429).json({ error: 'Root sign-in temporarily rate limited. Try again later.' });
          user = await authenticateCustomerAccount({ email: parsed.data.email, password: parsed.data.password });
          if (!user.isRootSuperuser || user.role !== 'ADMIN') return res.status(403).json({ error: 'ROOT_ACCOUNT_NOT_PROVISIONED' });
        } else if (isSupabaseAuthConfigured()) {
          const supa = await supabaseSignInWithPassword({
            email: parsed.data.email,
            password: parsed.data.password,
          });
          user = await syncSupabaseCustomerUser({
            supabaseUid: supa.supabaseUid,
            email: supa.email,
            name: supa.name,
            mobileNumber: supa.mobileNumber,
          });
        } else {
          user = await authenticateCustomerAccount({
            email: parsed.data.email,
            password: parsed.data.password,
          });
        }
        sessionProvider = 'supabase';
      }

      await mergeGuestSessionData(guestToken, user._id);
      const issued = await issueUserSession(req, res, user, sessionProvider);
      const likedProductIds = await getLikedProductIds({ userId: user._id, guestToken });
      const cart = await loadCartForActor({ userId: user._id, guestToken });

      return res.json({
        user,
        accessToken: issued.accessToken,
        csrfToken: issued.csrfToken,
        sessionInfo: issued.sessionInfo,
        likedProductIds,
        cart,
      });
    } catch (err) {
      const status = (err as { status?: number }).status || 401;
      return res.status(status).json({ error: (err as Error).message || 'Sign in failed' });
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    const { session } = await resolveActor(req, res);
    if (session) {
      await revokeAuthSession(session.sessionId);
    }
    res.clearCookie('kk_session', getClearCookieOpts());
    res.clearCookie('kk_user', getClearCookieOpts());
    res.json({ ok: true });
  });

  // --- SSL Token Authentication Session Manager ---
  app.get('/api/auth/sessions', async (req, res) => {
    const { user, session } = await resolveActor(req, res);
    if (!user) {
      return res.status(401).json({ error: 'Sign in to manage active SSL token sessions.' });
    }
    const sessions = await listUserSessions(user._id);
    res.json({
      sessions: sessions.map((s) => toSessionSummary(s, session?.sessionId)),
      currentSessionId: session?.sessionId || null,
    });
  });

  app.post('/api/auth/sessions/rotate', async (req, res) => {
    const { user, session } = await resolveActor(req, res);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required to rotate session token.' });
    }
    if (session) {
      await revokeAuthSession(session.sessionId, user._id);
    }
    const issued = await issueUserSession(req, res, user, session?.provider || 'supabase');
    const sessions = await listUserSessions(user._id);
    res.json({
      accessToken: issued.accessToken,
      csrfToken: issued.csrfToken,
      sessionInfo: issued.sessionInfo,
      sessions: sessions.map((s) => toSessionSummary(s, issued.record.sessionId)),
    });
  });

  app.delete('/api/auth/sessions/:sessionId', async (req, res) => {
    const { user, session } = await resolveActor(req, res);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    const targetId = req.params.sessionId;
    const revoked = await revokeAuthSession(targetId, user._id);
    if (!revoked) return res.status(404).json({ error: 'Session not found' });
    const loggedOutCurrent = session?.sessionId === targetId;
    if (loggedOutCurrent) {
      res.clearCookie('kk_session', getClearCookieOpts());
      res.clearCookie('kk_user', getClearCookieOpts());
    }
    res.json({ ok: true, loggedOutCurrent });
  });

  app.post('/api/auth/sessions/revoke-others', async (req, res) => {
    const { user, session } = await resolveActor(req, res);
    if (!user || !session) {
      return res.status(401).json({ error: 'Active SSL session required' });
    }
    const revokedCount = await revokeOtherUserSessions(user._id, session.sessionId);
    const sessions = await listUserSessions(user._id);
    res.json({
      revokedCount,
      sessions: sessions.map((s) => toSessionSummary(s, session.sessionId)),
    });
  });

  // Mandatory Checkout Gate: Save Mobile + Shipping Address
  app.post('/api/auth/checkout-profile', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user) return res.status(401).json({ error: 'Please sign in before saving checkout details.' });

    const schema = z.object({
      mobileNumber: z.string().refine(isValidE164, 'Enter mobile in E.164 format (e.g. +919876543210)'),
      address: z.object({
        label: z.string().min(1).default('Home'),
        fullName: z.string().min(2),
        street: z.string().min(4),
        city: z.string().min(2),
        state: z.string().min(2),
        pincode: z.string().min(4).max(10),
      }),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid profile fields' });
    }

    const updated = await updateUserCheckoutProfile(user._id, parsed.data.mobileNumber, {
      ...parsed.data.address,
      phone: parsed.data.mobileNumber,
    });
    res.json({ user: updated });
  });


  // Root superuser is a separate, immutable-at-the-application-layer break-glass identity.
  // It is read-only across business records; only root invitations and own credential rotation mutate state.
  const requireRootSuperuser = async (req: Request, res: Response) => {
    const actor = await resolveActor(req, res);
    if (!actor.user || actor.user.role !== 'ADMIN' || actor.user.isRootSuperuser !== true) {
      res.status(403).json({ error: 'ROOT_SUPERUSER_ACCESS_REQUIRED' });
      return null;
    }
    return actor.user;
  };
  const auditRootAccess = async (actor: User, req: Request, action: string, targetType = '', targetId = '', query = '') => {
    await RootAccessAuditModel.create({
      actorId: actor._id, action, targetType, targetId,
      query: query ? crypto.createHash('sha256').update(query).digest('hex') : '',
      ip: req.ip || '',
    });
  };

  app.get('/api/root/overview', async (req, res) => {
    const root = await requireRootSuperuser(req, res);
    if (!root) return;
    const [users, admins, sellers, providers, customers, products, orders, returns, providerProducts, settlements, pendingInvites] = await Promise.all([
      UserModel.countDocuments(), UserModel.countDocuments({ role: 'ADMIN', isRootSuperuser: { $ne: true } }),
      UserModel.countDocuments({ role: 'SELLER' }), UserModel.countDocuments({ role: 'PROVIDER' }),
      UserModel.countDocuments({ role: 'BUYER' }), ProductModel.countDocuments(),
      OrderModel.countDocuments(), ReturnRequestModel.countDocuments(), ProviderProductModel.countDocuments(),
      ProviderSettlementModel.countDocuments(), RootInviteModel.countDocuments({ status: 'PENDING', expiresAt: { $gt: new Date() } }),
    ]);
    await auditRootAccess(root, req, 'ROOT_OVERVIEW_READ', 'dashboard');
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ counts: { users, admins, sellers, providers, customers, products, orders, returns, providerProducts, settlements, pendingInvites } });
  });

  app.get('/api/root/users', async (req, res) => {
    const root = await requireRootSuperuser(req, res);
    if (!root) return;
    const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(50, Math.max(5, Number.parseInt(String(req.query.limit || '20'), 10) || 20));
    const query = String(req.query.q || '').trim().slice(0, 100);
    const role = String(req.query.role || 'ALL').toUpperCase();
    const sortKey = String(req.query.sort || 'createdAt');
    const sortField = ({ name: 'name', email: 'email', role: 'role', createdAt: 'createdAt', updatedAt: 'updatedAt' } as Record<string, string>)[sortKey] || 'createdAt';
    const direction = String(req.query.direction || 'desc') === 'asc' ? 1 : -1;
    const filter: Record<string, any> = {};
    if (role !== 'ALL' && ['BUYER', 'SELLER', 'PROVIDER', 'ADMIN'].includes(role)) filter.role = role;
    if (query) {
      const safe = escapeRegex(query);
      filter.$or = [{ name: { $regex: safe, $options: 'i' } }, { email: { $regex: safe, $options: 'i' } }, { mobileNumber: { $regex: safe, $options: 'i' } }, { _id: { $regex: safe, $options: 'i' } }];
    }
    const [total, users] = await Promise.all([
      UserModel.countDocuments(filter),
      UserModel.find(filter).select('_id name email role isRootSuperuser mobileNumber whatsappNumber isWhatsappVerified sellerProfile createdAt updatedAt').sort({ [sortField]: direction, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);
    await auditRootAccess(root, req, 'ROOT_USER_SEARCH', 'users', '', query);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ users: users.map((user: any) => ({ ...user, _id: String(user._id) })), total, page, limit, totalPages: Math.ceil(total / limit) });
  });

  app.get('/api/root/users/:id', async (req, res) => {
    const root = await requireRootSuperuser(req, res);
    if (!root) return;
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'INVALID_USER_ID' });
    const user = await UserModel.findById(req.params.id).select('-passwordHash -supabaseUid -oauthAccounts').lean() as any;
    if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND' });
    const [orders, products, providerProfile, providerProducts, settlements] = await Promise.all([
      OrderModel.find({ $or: [{ buyerId: user._id }, { sellerId: user._id }] }).sort({ createdAt: -1 }).limit(50).lean(),
      ProductModel.find({ sellerId: user._id }).sort({ updatedAt: -1 }).limit(50).lean(),
      ProviderProfileModel.findOne({ userId: String(user._id) }).select('-encryptedTaxId -encryptedSettlementDetails').lean(),
      ProviderProductModel.find({ providerId: String(user._id) }).sort({ updatedAt: -1 }).limit(50).lean(),
      ProviderSettlementModel.find({ providerId: String(user._id) }).select('-encryptedReceipt').sort({ createdAt: -1 }).limit(50).lean(),
    ]);
    await auditRootAccess(root, req, 'ROOT_USER_DETAIL_READ', 'user', String(user._id));
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ user: { ...user, _id: String(user._id) }, records: { orders, products, providerProfile, providerProducts, settlements } });
  });

  app.get('/api/root/records', async (req, res) => {
    const root = await requireRootSuperuser(req, res);
    if (!root) return;
    const type = String(req.query.type || '');
    const allowed = ['products', 'orders', 'returns', 'providers', 'providerProducts', 'settlements'];
    if (!allowed.includes(type)) return res.status(400).json({ error: 'UNSUPPORTED_RECORD_TYPE', allowed });
    const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(50, Math.max(5, Number.parseInt(String(req.query.limit || '20'), 10) || 20));
    const query = String(req.query.q || '').trim().slice(0, 100);
    const filter: Record<string, any> = {};
    if (query) {
      const safe = escapeRegex(query);
      const searchFields: Record<string, string[]> = {
        products: ['title', 'sku', 'category'], orders: ['orderNumber', 'status'],
        returns: ['orderId', 'productId', 'status', 'reason'], providers: ['businessName', 'contactPerson', 'mobile'],
        providerProducts: ['title', 'category', 'brand', 'status'], settlements: ['orderId', 'utrReference', 'status'],
      };
      filter.$or = (searchFields[type] || []).map(field => ({ [field]: { $regex: safe, $options: 'i' } }));
    }
    const sort = { createdAt: -1, _id: -1 } as any;
    let model: any;
    if (type === 'products') model = ProductModel;
    else if (type === 'orders') model = OrderModel;
    else if (type === 'returns') model = ReturnRequestModel;
    else if (type === 'providers') model = ProviderProfileModel;
    else if (type === 'providerProducts') model = ProviderProductModel;
    else model = ProviderSettlementModel;
    const [total, rows] = await Promise.all([
      model.countDocuments(filter),
      model.find(filter).select(type === 'providers' ? '-encryptedTaxId -encryptedSettlementDetails' : type === 'settlements' ? '-encryptedReceipt' : type === 'orders' ? '-paymentTransactionId -paymentReference' : undefined).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
    ]);
    await auditRootAccess(root, req, 'ROOT_RECORD_SEARCH', type, '', query);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ type, rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  });

  app.get('/api/root/audit', async (req, res) => {
    const root = await requireRootSuperuser(req, res);
    if (!root) return;
    const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
    const rows = await RootAccessAuditModel.find().sort({ createdAt: -1 }).skip((page - 1) * 50).limit(50).lean();
    await auditRootAccess(root, req, 'ROOT_AUDIT_LOG_READ', 'audit');
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ rows, page, limit: 50 });
  });

  app.post('/api/root/password', async (req, res) => {
    const { user, session } = await resolveActor(req, res);
    if (!user || user.role !== 'ADMIN' || user.isRootSuperuser !== true || !session) return res.status(403).json({ error: 'ROOT_SUPERUSER_ACCESS_REQUIRED' });
    const parsed = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(16).max(128) }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'ROOT_PASSWORD_MUST_BE_AT_LEAST_16_CHARACTERS' });
    const changed = await updateRootSuperuserPassword(user._id, parsed.data.currentPassword, parsed.data.newPassword);
    if (!changed) return res.status(400).json({ error: 'CURRENT_PASSWORD_INVALID' });
    await auditRootAccess(user, req, 'ROOT_PASSWORD_ROTATED', 'user', user._id);
    res.json({ ok: true });
  });

  app.get('/api/root/invites', async (req, res) => {
    const root = await requireRootSuperuser(req, res);
    if (!root) return;
    const invites = await RootInviteModel.find({ invitedByRootId: root._id }).select('-tokenHash').sort({ createdAt: -1 }).limit(100).lean();
    await auditRootAccess(root, req, 'ROOT_INVITES_READ', 'invites');
    res.json({ invites });
  });

  app.post('/api/root/invites', async (req, res) => {
    const root = await requireRootSuperuser(req, res);
    if (!root) return;
    const parsed = z.object({ email: z.string().trim().email().max(254), role: z.enum(['ADMIN', 'SELLER', 'PROVIDER']), expiresInDays: z.number().int().min(1).max(30).default(7), note: z.string().trim().max(300).optional().default('') }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'VALID_EMAIL_ROLE_AND_EXPIRY_REQUIRED' });
    if (!canInviteRole(root, parsed.data.role)) return res.status(403).json({ error: 'ROLE_INVITATION_NOT_PERMITTED' });
    const email = parsed.data.email.toLowerCase();
    const existingUser = await UserModel.findOne({ email }).select('_id role isRootSuperuser').lean() as any;
    if (existingUser?.isRootSuperuser) return res.status(409).json({ error: 'ROOT_ACCOUNT_CANNOT_BE_INVITED_OR_REASSIGNED' });
    const pending = await RootInviteModel.findOne({ email, role: parsed.data.role, status: 'PENDING', expiresAt: { $gt: new Date() } }).lean();
    if (pending) return res.status(409).json({ error: 'ACTIVE_INVITATION_ALREADY_EXISTS' });
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + parsed.data.expiresInDays * 86400000);
    const invite = await RootInviteModel.create({ tokenHash: crypto.createHash('sha256').update(token).digest('hex'), email, role: parsed.data.role, invitedByRootId: root._id, expiresAt });
    const inviteUrl = getAppBaseUrl(req) + '/?rootInvite=' + encodeURIComponent(token);
    await auditRootAccess(root, req, 'ROOT_INVITE_CREATED', parsed.data.role, String(invite._id), email);
    res.status(201).json({ invite: { id: String(invite._id), email, role: invite.role, status: invite.status, expiresAt }, inviteUrl, note: parsed.data.note });
  });

  app.post('/api/root/invites/:id/revoke', async (req, res) => {
    const root = await requireRootSuperuser(req, res);
    if (!root) return;
    const invite = await RootInviteModel.findOneAndUpdate({ _id: req.params.id, invitedByRootId: root._id, status: 'PENDING' }, { $set: { status: 'REVOKED' } }, { returnDocument: 'after' }).select('-tokenHash').lean();
    if (!invite) return res.status(404).json({ error: 'PENDING_ROOT_INVITE_NOT_FOUND' });
    await auditRootAccess(root, req, 'ROOT_INVITE_REVOKED', invite.role, String(invite._id));
    res.json({ invite });
  });

  app.get('/api/root/invites/validate', async (req, res) => {
    const limited = await checkRateLimit('root-invite-validate:' + req.ip, 20, 60);
    if (!limited.allowed) return res.status(429).json({ error: 'INVITE_VALIDATION_RATE_LIMITED' });
    const token = String(req.query.token || '');
    if (token.length < 32 || token.length > 128) return res.status(400).json({ error: 'INVALID_ROOT_INVITE_TOKEN' });
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const invite = await RootInviteModel.findOne({ tokenHash, status: 'PENDING', expiresAt: { $gt: new Date() } }).select('email role expiresAt').lean() as any;
    if (!invite) return res.status(410).json({ error: 'ROOT_INVITE_EXPIRED_OR_USED' });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ email: invite.email, role: invite.role, expiresAt: invite.expiresAt });
  });

  app.post('/api/root/invites/accept', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user) return res.status(401).json({ error: 'SIGN_IN_REQUIRED' });
    const parsed = z.object({
      token: z.string().min(32).max(128),
      storeName: z.string().trim().min(2).max(120).optional(),
      description: z.string().trim().max(1000).optional().default(''),
      whatsappNumber: z.string().trim().max(24).optional().default(''),
      businessName: z.string().trim().min(2).max(180).optional(),
      contactPerson: z.string().trim().min(2).max(120).optional(),
      mobile: z.string().trim().min(8).max(20).optional(),
      whatsapp: z.string().trim().max(20).optional().default(''),
      warehouseAddress: z.string().trim().min(8).max(1000).optional(),
      taxId: z.string().trim().min(4).max(80).optional(),
      settlementDetails: z.string().trim().min(6).max(1000).optional(),
    }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_ROOT_INVITE_ACCEPTANCE_DETAILS' });
    const tokenHash = crypto.createHash('sha256').update(parsed.data.token).digest('hex');
    const pending = await RootInviteModel.findOne({ tokenHash, status: 'PENDING', expiresAt: { $gt: new Date() } }).lean() as any;
    if (!pending) return res.status(410).json({ error: 'ROOT_INVITE_EXPIRED_OR_USED' });
    if (pending.email !== user.email.toLowerCase()) return res.status(403).json({ error: 'ROOT_INVITE_EMAIL_MISMATCH' });
    if (user.isRootSuperuser || (user.role !== 'BUYER' && user.role !== pending.role)) return res.status(409).json({ error: 'ACCOUNT_ALREADY_HAS_A_DIFFERENT_ROLE' });
    if (pending.role === 'SELLER' && (!parsed.data.storeName || parsed.data.storeName.length < 2)) return res.status(400).json({ error: 'SELLER_STORE_NAME_REQUIRED' });
    if (pending.role === 'PROVIDER' && (!parsed.data.businessName || !parsed.data.contactPerson || !parsed.data.mobile || !parsed.data.warehouseAddress || !parsed.data.taxId || !parsed.data.settlementDetails)) return res.status(400).json({ error: 'COMPLETE_PROVIDER_ONBOARDING_FIELDS_REQUIRED' });
    if (pending.role === 'PROVIDER' && !process.env.ENCRYPTION_MASTER_KEY) return res.status(503).json({ error: 'PROVIDER_ENCRYPTION_NOT_CONFIGURED' });
    const consumed = await RootInviteModel.findOneAndUpdate({ _id: pending._id, status: 'PENDING', expiresAt: { $gt: new Date() } }, { $set: { status: 'ACCEPTED', acceptedUserId: user._id, acceptedAt: new Date() } }, { returnDocument: 'after' }).lean();
    if (!consumed) return res.status(409).json({ error: 'ROOT_INVITE_ALREADY_CONSUMED' });
    try {
      if (pending.role === 'PROVIDER') {
        await ProviderProfileModel.findOneAndUpdate({ userId: user._id }, { $set: {
          businessName: parsed.data.businessName, contactPerson: parsed.data.contactPerson, mobile: parsed.data.mobile,
          whatsapp: parsed.data.whatsapp, warehouseAddress: parsed.data.warehouseAddress,
          encryptedTaxId: encryptField(parsed.data.taxId!), encryptedSettlementDetails: encryptField(parsed.data.settlementDetails!),
          settlementDetailsLast4: parsed.data.settlementDetails!.slice(-4), kycStatus: 'PENDING',
        }, $setOnInsert: { userId: user._id, linkedSellerIds: [] } }, { upsert: true, returnDocument: 'after', runValidators: true });
      }
      const update: Record<string, any> = { role: pending.role, authProvider: 'invite' };
      if (pending.role === 'SELLER') update.sellerProfile = { storeName: parsed.data.storeName, description: parsed.data.description || '', trustScore: 4.8, isTrustedSeller: false, totalOrders: 0, cancelledOrders: 0 };
      if (pending.role === 'SELLER' && parsed.data.whatsappNumber) update.whatsappNumber = parsed.data.whatsappNumber;
      await UserModel.updateOne({ _id: user._id, role: user.role }, { $set: update });
      const updatedUser = await findUserById(user._id);
      if (updatedUser) await issueUserSession(req, res, updatedUser, 'invite');
      await RootAccessAuditModel.create({ actorId: pending.invitedByRootId, action: 'ROOT_INVITE_ACCEPTED', targetType: pending.role, targetId: String(pending._id), ip: req.ip || '' });
      return res.json({ ok: true, user: updatedUser });
    } catch (error) {
      await RootInviteModel.updateOne({ _id: pending._id, acceptedUserId: user._id, status: 'ACCEPTED' }, { $set: { status: 'PENDING', acceptedUserId: null, acceptedAt: null } });
      throw error;
    }
  });

  // --- Admin-Only Seller Invites & Invite-Gated Seller Onboarding ---
  app.get('/api/admin/seller-invites', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only platform Administrators can view seller invites.' });
    }
    const baseUrl = getAppBaseUrl(req);
    const invites = await listSellerInvites();
    res.json({
      invites: invites.map((inv) => ({
        ...inv,
        inviteUrl: `${baseUrl}/?sellerInvite=${encodeURIComponent(inv.token)}`,
      })),
    });
  });

  app.post('/api/admin/seller-invites', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !canInviteRole(user, 'SELLER') || user.isRootSuperuser === true) {
      return res.status(403).json({ error: 'Only Level 1 Administrators can issue seller invitations.' });
    }
    const schema = z.object({
      email: z.string().email('Valid seller email is required').optional().or(z.literal('')),
      storeName: z.string().max(80).optional(),
      note: z.string().max(240).optional(),
      expiresInDays: z.number().int().min(1).max(90).optional(),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid invite details' });
    }
    const invite = await createSellerInvite({
      adminId: user._id,
      adminName: user.name,
      email: parsed.data.email || '',
      storeName: parsed.data.storeName,
      note: parsed.data.note,
      expiresInDays: parsed.data.expiresInDays,
    });
    const baseUrl = getAppBaseUrl(req);
    const inviteUrl = `${baseUrl}/?sellerInvite=${encodeURIComponent(invite.token)}`;
    let mailtoUrl: string | undefined;
    if (invite.email) {
      const subject = encodeURIComponent(
        `Invitation to join Kala & Karat as a Seller${invite.storeName ? ` — ${invite.storeName}` : ''}`
      );
      const body = encodeURIComponent(
        `Hello,\n\nYou have been invited by ${user.name} (Kala & Karat Admin) to onboard your atelier${invite.storeName ? ` (${invite.storeName})` : ''} on Kala & Karat.\n\nUse your private one-time onboarding link below to complete verification and activate your seller dashboard:\n${inviteUrl}\n\n${invite.note ? `Admin note: ${invite.note}\n\n` : ''}This invitation expires on ${new Date(invite.expiresAt).toLocaleDateString('en-IN')}.`
      );
      mailtoUrl = `mailto:${encodeURIComponent(invite.email)}?subject=${subject}&body=${body}`;
    }
    res.status(201).json({ invite: { ...invite, inviteUrl }, mailtoUrl });
  });

  app.post('/api/admin/seller-invites/:id/revoke', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only platform Administrators can revoke seller invites.' });
    }
    const updated = await revokeSellerInvite(req.params.id);
    if (!updated) return res.status(404).json({ error: 'Invite not found' });
    res.json({ invite: updated });
  });

  app.get('/api/seller/invites/validate', async (req, res) => {
    const token = String(req.query.token || '');
    const result = await validateSellerInviteToken(token);
    res.json(result);
  });

  app.post('/api/seller/whatsapp/request-otp', async (req, res) => {
    const { user } = await resolveActor(req, res);
    const schema = z.object({
      whatsappNumber: z.string().refine(isValidE164, 'Valid E.164 WhatsApp number required (e.g. +919820112233)'),
      inviteToken: z.string().min(4).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid number' });
    }

    // Strict invite-only gate: no self-serve seller OTP without a valid invite token or existing seller/admin role
    const isExistingSellerOrAdmin = user && (user.role === 'SELLER' || user.role === 'ADMIN');
    if (!isExistingSellerOrAdmin) {
      if (!parsed.data.inviteToken) {
        return res.status(403).json({
          error: 'Seller onboarding is strictly invite-only. Use an Admin-issued invite link.',
        });
      }
      const checkInvite = await validateSellerInviteToken(parsed.data.inviteToken);
      if (!checkInvite.valid) {
        return res.status(403).json({
          error: 'Your seller invitation link is invalid, revoked, or expired.',
        });
      }
    }

    const check = await checkWhatsAppNumberExists(parsed.data.whatsappNumber);
    if (!check.exists) {
      return res.status(400).json({ error: 'WhatsApp account not found on this number.' });
    }

    const otpCode = String(Math.floor(100000 + Math.random() * 900000));
    await storeOtp(parsed.data.whatsappNumber, otpCode, 300);

    const dispatch = await sendWhatsAppMessage(
      parsed.data.whatsappNumber,
      `Kala & Karat Seller Verification OTP: ${otpCode}. Valid for 5 minutes.`
    );

    res.json({
      ok: true,
      checkedVia: check.checkedVia,
      dispatch,
      // Expose preview code only when external WhatsApp API credentials are not provisioned
      sandboxOtpPreview: dispatch.delivered ? undefined : otpCode,
    });
  });

  app.post('/api/seller/whatsapp/verify-number', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['SELLER', 'ADMIN'].includes(user.role)) {
      return res.status(403).json({ error: 'SELLER_ACCESS_REQUIRED' });
    }
    const parsed = z.object({
      whatsappNumber: z.string().refine(isValidE164, 'Enter a valid WhatsApp number in E.164 format (e.g. +919820112233)'),
      otpCode: z.string().regex(/^\d{6}$/, 'Enter the 6-digit verification code'),
    }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'INVALID_VERIFICATION_DETAILS' });
    }
    if (!(await verifyOtpCode(parsed.data.whatsappNumber, parsed.data.otpCode))) {
      return res.status(400).json({ error: 'Invalid or expired 6-digit OTP code.' });
    }
    const updated = await updateSellerVerifiedWhatsAppNumber(user._id, parsed.data.whatsappNumber);
    if (!updated) return res.status(404).json({ error: 'USER_NOT_FOUND' });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ user: updated });
  });

  app.post('/api/seller/invites/accept', async (req, res) => {
    const { guestToken, user } = await resolveActor(req, res);
    const schema = z.object({
      inviteToken: z.string().min(6),
      name: z.string().min(2).max(80),
      email: z.string().email().optional().or(z.literal('')),
      whatsappNumber: z.string().refine(isValidE164),
      otpCode: z.string().length(6),
      storeName: z.string().min(2).max(80),
      description: z.string().min(5).max(300).default('Curated fashion & artificial jewellery atelier.'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid onboarding details' });
    }

    const validOtp = await verifyOtpCode(parsed.data.whatsappNumber, parsed.data.otpCode);
    if (!validOtp) {
      return res.status(400).json({ error: 'Invalid or expired 6-digit OTP code.' });
    }

    try {
      const result = await acceptSellerInvite({
        token: parsed.data.inviteToken,
        name: parsed.data.name,
        email: parsed.data.email || undefined,
        whatsappNumber: parsed.data.whatsappNumber,
        storeName: parsed.data.storeName,
        description: parsed.data.description,
        actingUser: user,
      });
      await mergeGuestIntoUser(guestToken, result.user._id);
      const issued = await issueUserSession(req, res, result.user, 'invite');
      const likedProductIds = await getLikedProductIds({ userId: result.user._id, guestToken });
      const cart = await loadCartForActor({ userId: result.user._id, guestToken });
      res.json({
        user: result.user,
        invite: result.invite,
        accessToken: issued.accessToken,
        csrfToken: issued.csrfToken,
        sessionInfo: issued.sessionInfo,
        likedProductIds,
        cart,
      });
    } catch (err) {
      res.status(403).json({ error: (err as Error).message });
    }
  });

  // --- Hybrid Flexible Search, Autocomplete & Strict limit(20) Catalog ---
  app.get('/api/products/suggest', async (req, res) => {
    const q = String(req.query.q || '');
    const suggestions = await getSearchSuggestions(q);
    res.json({ suggestions });
  });

  app.get('/api/products', async (req, res) => {
    const { user } = await resolveActor(req, res);
    const allowDisabled =
      req.query.includeDisabled === 'true' &&
      Boolean(user && (user.role === 'SELLER' || user.role === 'ADMIN'));
    const result = await queryProducts({
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
      category: (req.query.category as ProductCategory | 'All') || 'All',
      occasion: (req.query.occasion as OccasionType | 'All') || 'All',
      season: (req.query.season as SeasonType | 'All') || 'All',
      campaignId: typeof req.query.campaignId === 'string' ? req.query.campaignId : undefined,
      color: typeof req.query.color === 'string' ? req.query.color : undefined,
      minPrice: req.query.minPrice ? Number(req.query.minPrice) : undefined,
      maxPrice: req.query.maxPrice ? Number(req.query.maxPrice) : undefined,
      minDiscount: req.query.minDiscount ? Number(req.query.minDiscount) : undefined,
      inStockOnly: req.query.inStockOnly === 'true',
      sort: (req.query.sort as SortOption) || 'most_demanding',
      page: req.query.page ? Number(req.query.page) : 1,
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
      limit: 20, // Strictly 20 products per page
      sellerId: typeof req.query.sellerId === 'string' ? req.query.sellerId : undefined,
      includeDisabled: allowDisabled,
      viewerId: user?._id,
    });
    res.json(result);
  });

  app.get('/api/products/:idOrSlug', async (req, res) => {
    const { user } = await resolveActor(req, res);
    const product = await getProductByIdOrSlug(req.params.idOrSlug);
    if (!product || (product.visibility === 'ASSIGNED' && (!user || !(product.assignedCustomerIds || []).map(String).includes(user._id)))) return res.status(404).json({ error: 'Product not found' });
    await incrementProductView(product._id);
    const [reviews, recData] = await Promise.all([
      getProductReviews(product._id),
      getHybridRecommendations(product._id, 4),
    ]);
    res.json({
      product: { ...product, viewsCount: product.viewsCount + 1 },
      reviews,
      recommendations: recData.recommendations.filter((item: any) => item.visibility !== 'ASSIGNED' || (user && (item.assignedCustomerIds || []).map(String).includes(user._id))),
      recommendationStrategy: recData.strategySummary,
    });
  });

  // --- Categories & Seller Category Control Panel ---
  app.get('/api/categories', async (_req, res) => {
    const categories = await listCategories(false);
    res.json({ categories });
  });

  app.get('/api/seller/categories', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || (user.role !== 'SELLER' && user.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'Seller access required.' });
    }
    const categories = await listCategories(true);
    res.json({ categories });
  });

  app.post('/api/seller/categories', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || (user.role !== 'SELLER' && user.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'Seller access required.' });
    }
    const schema = z.object({
      name: z.string().min(2, 'Category name is required').max(60),
      description: z.string().max(180).optional().default(''),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid category name' });
    }
    try {
      const category = await createCategoryControl({
        sellerId: user._id,
        sellerName: user.sellerProfile?.storeName || user.name,
        name: parsed.data.name,
        description: parsed.data.description,
      });
      res.status(201).json({ category });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.patch('/api/seller/categories/:id', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || (user.role !== 'SELLER' && user.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'Seller access required.' });
    }
    const schema = z.object({
      isEnabled: z.boolean().optional(),
      name: z.string().min(2).max(60).optional(),
      description: z.string().max(180).optional(),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid category update' });
    }
    try {
      const updated = await updateCategoryControl(req.params.id, parsed.data);
      if (!updated) return res.status(404).json({ error: 'Category not found' });
      res.json({ category: updated });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/seller/categories/:id', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || (user.role !== 'SELLER' && user.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'Seller access required.' });
    }
    const result = await deleteCategoryControl(req.params.id);
    if (!result.ok) {
      return res.status(400).json({ error: result.error || 'Could not delete category' });
    }
    res.json({ ok: true });
  });

  // Seller Create Product
  app.post('/api/products', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || (user.role !== 'SELLER' && user.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'Verified Seller account required.' });
    }
    if (user.role === 'SELLER' && !user.isWhatsappVerified) {
      return res.status(403).json({ error: 'Complete WhatsApp verification before listing products.' });
    }

    const schema = z.object({
      title: z.string().min(3).max(140),
      sku: z.string().min(2).max(40),
      category: z.string().min(2).max(60),
      subCategory: z.string().min(2),
      description: z.string().min(10),
      careInstructions: z.string().default('Store dry in protective pouch.'),
      basePrice: z.number().positive(),
      visibility: z.enum(['PUBLIC', 'ASSIGNED']).default('PUBLIC'),
      assignedCustomerIds: z.array(z.string().min(1)).max(500).default([]),
      onlinePaymentRequired: z.boolean().default(false),
      codAllowed: z.boolean().default(true),
      isReturnable: z.boolean().default(true),
      returnWindowDays: z.number().int().min(0).max(90).default(7),
      discountPercent: z.number().min(0).max(90).default(0),
      totalStock: z.number().int().min(0),
      images: z
        .array(
          z.object({
            url: z.string().min(1),
            thumbUrl: z.string().min(1),
            altText: z.string().default('Product image'),
            sortOrder: z.number().default(0),
          })
        )
        .min(1),
      occasions: z
        .array(z.enum(['Wedding', 'Festive', 'Party', 'Office Wear', 'Casual', 'Daily Wear']))
        .min(1),
      seasons: z
        .array(z.enum(['Diwali', 'Christmas', 'New Year', 'Winter', 'Summer']))
        .optional(),
      variants: z
        .array(
          z.object({
            variantSku: z.string().min(1),
            size: z.string().min(1),
            colorName: z.string().min(1),
            colorHex: z.string().min(4),
            stock: z.number().int().min(0),
            priceOverride: z.number().optional(),
            variantImageUrl: z.string().optional(),
          })
        )
        .min(1),
      jewellerySpecs: z
        .object({
          baseMetal: z.string(),
          plating: z.string(),
          stoneType: z.string(),
          weightGrams: z.number(),
          dimensions: z.string(),
          closureType: z.string(),
          occasionWear: z.string(),
        })
        .optional(),
      clothingSpecs: z
        .object({
          fabric: z.string(),
          fit: z.string(),
          pattern: z.string(),
          sleeveType: z.string(),
          neckType: z.string(),
          washCare: z.string(),
        })
        .optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid product payload' });
    }

    if (parsed.data.visibility === 'ASSIGNED' && parsed.data.assignedCustomerIds.length === 0) return res.status(400).json({ error: 'ASSIGNED_PRODUCTS_REQUIRE_CUSTOMERS' });
    const validCustomers = parsed.data.assignedCustomerIds.length ? await UserModel.countDocuments({ _id: { $in: parsed.data.assignedCustomerIds }, role: 'BUYER' }) : 0;
    if (validCustomers !== parsed.data.assignedCustomerIds.length) return res.status(400).json({ error: 'INVALID_ASSIGNED_CUSTOMER' });
    const created = await createProduct(user._id, {
      ...parsed.data,
      seasons: parsed.data.seasons && parsed.data.seasons.length > 0 ? parsed.data.seasons : ['Diwali', 'New Year'],
      salePrice: Math.round(
        parsed.data.basePrice * (1 - (parsed.data.discountPercent || 0) / 100)
      ),
      isActive: true,
    });
    res.status(201).json({ product: created });
  });

  // Seller Dynamic Discount / Stock / Seasons Update
  app.patch('/api/products/:id', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || (user.role !== 'SELLER' && user.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'Seller access required.' });
    }
    const schema = z.object({
      discountPercent: z.number().min(0).max(95).optional(),
      visibility: z.enum(['PUBLIC', 'ASSIGNED']).optional(),
      assignedCustomerIds: z.array(z.string().min(1)).max(500).optional(),
      onlinePaymentRequired: z.boolean().optional(),
      codAllowed: z.boolean().optional(),
      isReturnable: z.boolean().optional(),
      returnWindowDays: z.number().int().min(0).max(90).optional(),
      salePrice: z.number().positive().optional(),
      basePrice: z.number().positive().optional(),
      totalStock: z.number().int().min(0).optional(),
      shippingWeightGrams: z.number().int().min(1).max(100000).optional(),
      title: z.string().min(3).optional(),
      seasons: z
        .array(z.enum(['Diwali', 'Christmas', 'New Year', 'Winter', 'Summer']))
        .optional(),
      images: z
        .array(
          z.object({
            url: z.string().min(1),
            thumbUrl: z.string().min(1),
            altText: z.string().default('Product image'),
            sortOrder: z.number().default(0),
          })
        )
        .min(1)
        .optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid update values' });
    }
    if (parsed.data.visibility === 'ASSIGNED' && !(parsed.data.assignedCustomerIds?.length)) return res.status(400).json({ error: 'ASSIGNED_PRODUCTS_REQUIRE_CUSTOMERS' });
    if (parsed.data.assignedCustomerIds?.length) {
      const validCustomers = await UserModel.countDocuments({ _id: { $in: parsed.data.assignedCustomerIds }, role: 'BUYER' });
      if (validCustomers !== parsed.data.assignedCustomerIds.length) return res.status(400).json({ error: 'INVALID_ASSIGNED_CUSTOMER' });
    }
    const updated = await updateProductDiscountOrStock(req.params.id, user._id, parsed.data);
    if (updated && ('visibility' in parsed.data || 'assignedCustomerIds' in parsed.data)) {
      await ProductModel.updateOne({ _id: req.params.id, ...(user.role === 'ADMIN' ? {} : { sellerId: user._id }) }, { $set: {
        ...(parsed.data.visibility !== undefined ? { visibility: parsed.data.visibility } : {}),
        ...(parsed.data.assignedCustomerIds !== undefined ? { assignedCustomerIds: parsed.data.assignedCustomerIds } : {}),
      }});
    }
    if (updated && ['onlinePaymentRequired', 'codAllowed', 'isReturnable', 'returnWindowDays'].some((key) => key in parsed.data)) {
      await ProductModel.updateOne({ _id: req.params.id, ...(user.role === 'ADMIN' ? {} : { sellerId: user._id }) }, { $set: {
        ...(parsed.data.onlinePaymentRequired !== undefined ? { onlinePaymentRequired: parsed.data.onlinePaymentRequired } : {}),
        ...(parsed.data.codAllowed !== undefined ? { codAllowed: parsed.data.codAllowed } : {}),
        ...(parsed.data.isReturnable !== undefined ? { isReturnable: parsed.data.isReturnable } : {}),
        ...(parsed.data.returnWindowDays !== undefined ? { returnWindowDays: parsed.data.returnWindowDays } : {}),
      }});
    }
    if (!updated) return res.status(404).json({ error: 'Product not found or unauthorized' });
    res.json({ product: updated });
  });

  // Seller Control Panel: Full Catalog with Active Order Counts & Lifecycle Actions
  app.get('/api/seller/products', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || (user.role !== 'SELLER' && user.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'Seller access required.' });
    }
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : undefined;
    const products = await listSellerManagedProducts(user._id, user.role, { q, statusFilter });
    res.json({ products });
  });

  app.patch('/api/products/:id/control', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || (user.role !== 'SELLER' && user.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'Seller access required.' });
    }
    const schema = z.object({
      action: z.enum([
        'publish',
        'unpublish',
        'unlist',
        'relist',
        'mark_out_of_stock',
        'restock',
        'discontinue',
      ]),
      stock: z.number().int().min(1).max(100000).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid control action' });
    }
    const updated = await updateProductControlState(
      req.params.id,
      user._id,
      user.role,
      parsed.data.action as ProductControlAction,
      parsed.data.stock
    );
    if (!updated) {
      return res.status(404).json({ error: 'Product not found or unauthorized' });
    }
    res.json({ product: updated });
  });

  app.delete('/api/products/:id', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || (user.role !== 'SELLER' && user.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'Seller access required.' });
    }
    const result = await removeProductCompletely(req.params.id, user._id, user.role);
    if (result.notFound) {
      return res.status(404).json({ error: result.error });
    }
    if (result.unauthorized) {
      return res.status(403).json({ error: result.error });
    }
    if (result.blockedByActiveOrders) {
      return res.status(409).json({
        error: result.error,
        blockedByActiveOrders: true,
        activeOrderCount: result.activeOrderCount || 0,
      });
    }
    res.json({
      ok: true,
      removedProductId: result.removedProductId,
      purgedImages: result.purgedImages || [],
    });
  });

  // --- Seasonal Sales Campaigns & Flash Sale Countdowns ---
  app.get('/api/campaigns', async (req, res) => {
    const { user } = await resolveActor(req, res);
    const campaigns = await listStorefrontCampaigns();
    const visibleCampaigns = campaigns.map((campaign: any) => ({ ...campaign, products: campaign.products.filter((product: any) => product.visibility !== 'ASSIGNED' || (user && (product.assignedCustomerIds || []).map(String).includes(user._id))) })).filter((campaign: any) => campaign.products.length > 0);
    res.json({ campaigns: visibleCampaigns });
  });

  app.get('/api/seller/campaigns', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || (user.role !== 'SELLER' && user.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'Seller account required.' });
    }
    const campaigns = await listSellerCampaigns(user._id, user.role);
    res.json({ campaigns });
  });

  app.post('/api/campaigns', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || (user.role !== 'SELLER' && user.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'Seller account required to launch campaigns.' });
    }
    const schema = z.object({
      name: z.string().min(3).max(90),
      season: z.enum(['Diwali', 'Christmas', 'New Year', 'Winter', 'Summer']),
      tagline: z.string().max(180).default('Seasonal curated markdowns.'),
      discountPercent: z.number().min(0).max(85).default(20),
      productIds: z.array(z.string()).min(1, 'Select at least one product for this campaign'),
      startsAt: z.string().min(8),
      endsAt: z.string().min(8),
      isActive: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid campaign payload' });
    }
    if (new Date(parsed.data.endsAt).getTime() <= new Date(parsed.data.startsAt).getTime()) {
      return res.status(400).json({ error: 'Campaign end time must be after start time.' });
    }
    const campaign = await createSalesCampaign({
      sellerId: user._id,
      sellerName: user.sellerProfile?.storeName || user.name,
      ...parsed.data,
    });
    res.status(201).json({ campaign });
  });

  app.patch('/api/campaigns/:id', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || (user.role !== 'SELLER' && user.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'Seller access required.' });
    }
    const schema = z.object({
      name: z.string().min(3).max(90).optional(),
      season: z.enum(['Diwali', 'Christmas', 'New Year', 'Winter', 'Summer']).optional(),
      tagline: z.string().max(180).optional(),
      discountPercent: z.number().min(0).max(85).optional(),
      productIds: z.array(z.string()).optional(),
      startsAt: z.string().optional(),
      endsAt: z.string().optional(),
      isActive: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid campaign update' });
    const updated = await updateSalesCampaign(req.params.id, user._id, user.role, parsed.data);
    if (!updated) return res.status(404).json({ error: 'Campaign not found or unauthorized' });
    res.json({ campaign: updated });
  });

  app.delete('/api/campaigns/:id', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || (user.role !== 'SELLER' && user.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'Seller access required.' });
    }
    const ok = await deleteSalesCampaign(req.params.id, user._id, user.role);
    if (!ok) return res.status(404).json({ error: 'Campaign not found or unauthorized' });
    res.json({ ok: true });
  });

  // --- Seller Coupons (Checkout & Direct Product Level + User Assignment) ---
  app.get('/api/coupons/applicable', async (req, res) => {
    const { user } = await resolveActor(req, res);
    const productId = typeof req.query.productId === 'string' ? req.query.productId : undefined;
    const coupons = await listApplicableCoupons({ user, productId });
    res.json({ coupons });
  });

  app.post('/api/coupons/validate', async (req, res) => {
    const { guestToken, user } = await resolveActor(req, res);
    const schema = z.object({
      code: z.string().min(2),
      items: z.array(z.any()).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ valid: false, reason: 'Enter a valid coupon code.', discountAmount: 0, eligibleSubtotal: 0, applicableProductIds: [] });
    }
    const cart = parsed.data.items && parsed.data.items.length > 0
      ? (parsed.data.items as CartItem[])
      : await loadCartForActor({ userId: user?._id || null, guestToken });
    const result = await validateCouponForCart({
      code: parsed.data.code,
      user,
      items: cart,
    });
    res.json(result);
  });

  app.get('/api/seller/coupons', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || (user.role !== 'SELLER' && user.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'Seller access required.' });
    }
    const coupons = await listSellerCoupons(user._id, user.role);
    res.json({ coupons });
  });

  app.get('/api/seller/customers', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || (user.role !== 'SELLER' && user.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'Seller access required.' });
    }
    const customers = await listKnownCustomers();
    res.json({ customers });
  });

  app.post('/api/seller/coupons', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || (user.role !== 'SELLER' && user.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'Seller access required.' });
    }
    const schema = z.object({
      code: z.string().min(3).max(24),
      title: z.string().min(2).max(80),
      discountType: z.enum(['percentage', 'flat']),
      discountValue: z.number().positive(),
      maxDiscountAmount: z.number().positive().optional(),
      minOrderAmount: z.number().min(0).default(0),
      scope: z.enum(['all_seller_products', 'selected_products']).default('all_seller_products'),
      productIds: z.array(z.string()).default([]),
      assignedUserIds: z.array(z.string()).default([]),
      assignedEmails: z.array(z.string()).default([]),
      usageLimit: z.number().int().min(1).optional(),
      expiresAt: z.string().min(8),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid coupon configuration' });
    }
    if (parsed.data.scope === 'selected_products' && parsed.data.productIds.length === 0) {
      return res.status(400).json({ error: 'Select at least one product when using product-specific coupon scope.' });
    }
    try {
      const coupon = await createSellerCoupon({
        sellerId: user._id,
        sellerName: user.sellerProfile?.storeName || user.name,
        ...parsed.data,
      });
      res.status(201).json({ coupon });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.patch('/api/seller/coupons/:id', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || (user.role !== 'SELLER' && user.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'Seller access required.' });
    }
    const updated = await updateSellerCoupon(req.params.id, user._id, user.role, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Coupon not found or unauthorized' });
    res.json({ coupon: updated });
  });

  app.delete('/api/seller/coupons/:id', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || (user.role !== 'SELLER' && user.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'Seller access required.' });
    }
    const ok = await deleteSellerCoupon(req.params.id, user._id, user.role);
    if (!ok) return res.status(404).json({ error: 'Coupon not found or unauthorized' });
    res.json({ ok: true });
  });

  // --- Sharp WebP (<120KB) + Cloudflare R2 / Local Media Upload ---
  app.post('/api/upload', upload.single('image'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Image file is required.' });
    }
    try {
      const processed = await processAndStoreImage(req.file.buffer, req.file.originalname);
      res.json(processed);
    } catch (err) {
      res.status(500).json({ error: `Image compression failed: ${(err as Error).message}` });
    }
  });

  // --- Guest/User Likes with Rate Limiting ---
  app.post('/api/likes/toggle', async (req, res) => {
    const { guestToken, user } = await resolveActor(req, res);
    const rate = await checkRateLimit(`like:${user?._id || guestToken}`, 30, 60);
    if (!rate.allowed) {
      return res.status(429).json({ error: 'Too many like requests. Please wait a moment.' });
    }

    const schema = z.object({ productId: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'productId required' });

    const result = await toggleProductLike(parsed.data.productId, {
      userId: user?._id || null,
      guestToken,
    });
    res.json(result);
  });

  app.get('/api/likes/products', async (req, res) => {
    const { guestToken, user } = await resolveActor(req, res);
    const products = await getLikedProductsForActor({
      userId: user?._id || null,
      guestToken,
    });
    res.json({ products });
  });

  // --- Persistent Cart (Upstash Redis + Local Backup) ---
  app.get('/api/cart', async (req, res) => {
    const { guestToken, user } = await resolveActor(req, res);
    const cart = await loadCartForActor({ userId: user?._id || null, guestToken });
    res.json({ cart });
  });

  app.put('/api/cart', async (req, res) => {
    const { guestToken, user } = await resolveActor(req, res);
    const schema = z.object({
      items: z.array(
        z.object({
          productId: z.string(),
          variantSku: z.string(),
          title: z.string(),
          slug: z.string(),
          category: z.string().min(2).max(60),
          size: z.string(),
          colorName: z.string(),
          colorHex: z.string(),
          imageUrl: z.string(),
          unitPrice: z.number().positive(),
          basePrice: z.number().positive(),
          quantity: z.number().int().min(1).max(20),
          sellerId: z.string(),
        })
      ),
      addedProductId: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid cart payload' });

    await saveCartForActor({ userId: user?._id || null, guestToken }, parsed.data.items);
    if (parsed.data.addedProductId) {
      await incrementCartAddCount(parsed.data.addedProductId);
    }
    res.json({ cart: parsed.data.items });
  });

  // --- Classed Reviews with wink-sentiment ---
  app.post('/api/reviews', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user) return res.status(401).json({ error: 'Sign in to submit a verified purchase review.' });

    const schema = z.object({
      productId: z.string().min(1),
      orderId: z.string().optional(),
      rating: z.number().int().min(1).max(5),
      comment: z.string().min(5).max(800),
      images: z.array(z.string()).default([]),
      reviewClasses: z
        .array(z.enum(['Quality', 'Finish & Shine', 'Value for Money', 'Fit & Sizing', 'Packaging']))
        .min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid review' });
    }

    try {
      const review = await createVerifiedReview({
        ...parsed.data,
        userId: user._id,
        userName: user.name,
        reviewClasses: parsed.data.reviewClasses as ReviewClass[],
      });
      res.status(201).json({ review });
    } catch (err) {
      res.status(403).json({ error: (err as Error).message });
    }
  });

  // --- Orders, Mandatory Checkout Gate, WhatsApp Alerts & Strict limit(5) Pagination ---
  app.get('/api/orders', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user) {
      return res.json({ orders: [], total: 0, hasMore: false, nextSkip: 0 });
    }
    const tab = (req.query.tab as OrderTab) || 'Current';
    const skip = Math.max(0, Number(req.query.skip || 0));
    const scope = req.query.scope === 'seller' && (user.role === 'SELLER' || user.role === 'ADMIN')
      ? user.role
      : 'BUYER';
    const data = await getOrdersForUser(user._id, scope, tab, skip, 5); // Strictly 5 orders per fetch
    res.json(data);
  });

  app.get('/api/orders/summary', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user) return res.json({ buckets: [] });
    const granularity = (req.query.granularity as TimeGranularity) || 'month';
    const scope = req.query.scope === 'seller' && (user.role === 'SELLER' || user.role === 'ADMIN')
      ? user.role
      : 'BUYER';
    const buckets = await aggregateOrderHistoryByDate(user._id, scope, granularity);
    res.json({ buckets });
  });

  app.post('/api/orders', async (req, res) => {
    const { guestToken, user } = await resolveActor(req, res);
    if (user) { const rate = await checkRateLimit('checkout:' + user._id, 10, 60); if (!rate.allowed) return res.status(429).json({ error: 'CHECKOUT_RATE_LIMITED' }); }
    if (!user) {
      return res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Sign in to complete checkout.' });
    }
    if (!user.mobileNumber || user.shippingAddresses.length === 0) {
      return res.status(422).json({
        error: 'CHECKOUT_PROFILE_INCOMPLETE',
        message: 'Mobile number and shipping address are required before placing an order.',
      });
    }

    const cart = await loadCartForActor({ userId: user._id, guestToken });
    const submittedItems = cart.length > 0 ? cart : (req.body?.items as CartItem[]) || [];
    if (submittedItems.length === 0) {
      return res.status(400).json({ error: 'Your shopping bag is empty.' });
    }

    const suppliedIdempotencyKey = String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '').trim();
    if (suppliedIdempotencyKey && (suppliedIdempotencyKey.length < 8 || suppliedIdempotencyKey.length > 120)) {
      return res.status(400).json({ error: 'INVALID_CHECKOUT_IDEMPOTENCY_KEY' });
    }
    const idempotencyKey = suppliedIdempotencyKey || undefined;
    const couponCode = typeof req.body?.couponCode === 'string' ? req.body.couponCode.trim() : undefined;
    const itemProducts = await Promise.all(submittedItems.map((item) => getProductByIdOrSlug(item.productId, { includeControlled: true })));
    if (itemProducts.some((product) => !product)) return res.status(409).json({ error: 'PRODUCT_NO_LONGER_AVAILABLE' });
    if (itemProducts.some((product) => product?.visibility === 'ASSIGNED' && (!product.assignedCustomerIds || !product.assignedCustomerIds.map(String).includes(user._id)))) return res.status(403).json({ error: 'PRODUCT_NOT_ASSIGNED_TO_BUYER' });
    const itemsToOrder = submittedItems.map((item, index) => {
      const product = itemProducts[index]!;
      const variant = (product.variants || []).find((entry) => entry.variantSku === item.variantSku);
      if ((product.variants || []).length && !variant) throw new Error('PRODUCT_VARIANT_UNAVAILABLE');
      return {
        ...item,
        // Persist canonical Mongo product IDs; public slugs are lookup aliases only.
        productId: String(product._id),
        sellerId: String(product.sellerId),
        title: product.title,
        slug: product.slug,
        category: product.category,
        basePrice: product.basePrice,
        unitPrice: variant?.priceOverride ?? product.salePrice,
        size: variant?.size ?? item.size,
        colorName: variant?.colorName ?? item.colorName,
        colorHex: variant?.colorHex ?? item.colorHex,
        imageUrl: variant?.variantImageUrl || product.images?.[0]?.url || item.imageUrl,
      };
    });
    const flags = await getPlatformFlags();
    const requiresPrepaid = itemProducts.some((product) => product && (product.onlinePaymentRequired || product.codAllowed === false));
    const requestedProvider = req.body?.paymentProvider === 'stripe' ? 'stripe' : 'razorpay';
    const rawRequestedPaymentMode = String(req.body?.paymentMode || '').toUpperCase();
    const requestedPaymentMode = ['COD', 'SELLER_COLLECT', 'POS_ON_DELIVERY', 'RAZORPAY', 'STRIPE'].includes(rawRequestedPaymentMode)
      ? (rawRequestedPaymentMode as 'COD' | 'SELLER_COLLECT' | 'POS_ON_DELIVERY' | 'RAZORPAY' | 'STRIPE')
      : undefined;
    const cartSubtotalEstimate = itemsToOrder.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    const checkoutPlan = resolveCheckoutPlan({
      flags,
      cartValueInr: cartSubtotalEstimate,
      requestedPaymentMode,
      requestedProvider,
      requiresPrepaidByProduct: requiresPrepaid,
    });

    const prepaidProviderBySeller = new Map<string, 'razorpay' | 'stripe'>();
    if (flags.onlinePaymentEnabled && ['RAZORPAY', 'STRIPE'].includes(checkoutPlan.effectivePaymentMode)) {
      const prepaidSellerIds = new Set(itemsToOrder.map((item) => item.sellerId));
      for (const sellerId of prepaidSellerIds) {
        const alternateProvider = requestedProvider === 'razorpay' ? 'stripe' : 'razorpay';
        const preferred = await getGatewaySecrets(sellerId, requestedProvider);
        const alternate = preferred ? null : await getGatewaySecrets(sellerId, alternateProvider);
        const activeProvider = preferred ? requestedProvider : alternate ? alternateProvider : null;
        if (!activeProvider) return res.status(409).json({ error: 'PREPAID_REQUIRED_ACTIVE_GATEWAY_MISSING', sellerId });
        prepaidProviderBySeller.set(sellerId, activeProvider);
      }
    }
    // Compute delivery fee per seller; bypass blocking external carrier quotes when shippingQuotesEnabled is flagged off.
    const shippingBySeller: Record<string, { actualCarrierCost: number; sellerMarkup: number; customerCharge: number; insuranceAmount: number; carrierCode: string | null; serviceCode: string | null; estimatedTransitHours: number | null; quoteExpiresAt: string | null; policy: 'SEPARATE' | 'FREE_FLAGGED_OFF' | 'FLAT_FALLBACK' }> = {};
    const sellerLines = new Map<string, typeof itemsToOrder>();
    for (const line of itemsToOrder) sellerLines.set(line.sellerId, [...(sellerLines.get(line.sellerId) || []), line]);

    if (checkoutPlan.skipCarrierRateQuotes) {
      for (const sellerId of sellerLines.keys()) {
        shippingBySeller[sellerId] = {
          actualCarrierCost: 0,
          sellerMarkup: 0,
          customerCharge: checkoutPlan.shippingChargeInr,
          insuranceAmount: 0,
          carrierCode: null,
          serviceCode: null,
          estimatedTransitHours: null,
          quoteExpiresAt: null,
          policy: checkoutPlan.shippingPolicy,
        };
      }
    } else {
      try {
        for (const [sellerId, lines] of sellerLines) {
          const products = lines.map(line => itemProducts.find(product => product && String(product._id) === String(line.productId)) || null);
          const weightGrams = 100 + lines.reduce((sum, line, lineIndex) => {
            const product = products[lineIndex] as any;
            return sum + Math.max(1, Number(product?.shippingWeightGrams) || 500) * line.quantity;
          }, 0);
          const declaredValueMinor = lines.reduce((sum, line) => sum + Math.round(line.unitPrice * line.quantity * 100), 0);
          const seller = await UserModel.findById(sellerId).select('sellerProfile.shippingMarkupPercent').lean() as any;
          const markupPercent = Math.min(100, Math.max(0, Number(seller?.sellerProfile?.shippingMarkupPercent || 0)));
          const quotes = await getSellerRateQuotesViaShippingService({
            sellerId,
            destinationPostalCode: String(user.shippingAddresses?.find(a => a.isDefault)?.pincode || user.shippingAddresses?.[0]?.pincode || ''),
            weightGrams, codAmountMinor: ['RAZORPAY', 'STRIPE'].includes(checkoutPlan.effectivePaymentMode) ? 0 : declaredValueMinor, declaredValueMinor, currency: 'INR',
          });
          const quote = quotes[0];
          if (!quote) return res.status(409).json({ error: 'DELIVERY_QUOTE_UNAVAILABLE', sellerId, retryable: true });
          const carrierCost = Math.max(0, Number(quote.costMinor) || 0);
          const markup = Math.round(carrierCost * markupPercent / 100);
          shippingBySeller[sellerId] = {
            actualCarrierCost: carrierCost / 100,
            sellerMarkup: markup / 100,
            customerCharge: (carrierCost + markup) / 100,
            insuranceAmount: 0,
            carrierCode: quote.providerCode,
            serviceCode: quote.serviceCode,
            estimatedTransitHours: quote.estimatedTransitHours,
            quoteExpiresAt: quote.quote?.expiresAt || null,
            policy: 'SEPARATE',
          };
        }
      } catch (shippingError) {
        const message = (shippingError as Error).message || 'DELIVERY_QUOTE_UNAVAILABLE';
        return res.status(503).json({ error: 'DELIVERY_QUOTE_UNAVAILABLE', detail: message, retryable: true });
      }
    }

    let createdOrders;
    try {
      createdOrders = await createOrder({ buyer: user, items: itemsToOrder, couponCode, idempotencyKey, shippingBySeller });
      for (const order of createdOrders) {
        const gatewayMode = flags.onlinePaymentEnabled && ['RAZORPAY', 'STRIPE'].includes(checkoutPlan.effectivePaymentMode);
        order.items = order.items.map((item: any) => {
          const idx = itemsToOrder.findIndex((cartItem) => cartItem.productId === String(item.productId));
          const product = idx >= 0 ? itemProducts[idx] : null;
          return { ...item, isReturnable: product?.isReturnable !== false, returnWindowDays: product?.returnWindowDays ?? 7 };
        });
        if (order.status === 'Pending') {
          const providerForOrder = prepaidProviderBySeller.get(String(order.sellerId)) || requestedProvider;
          order.paymentMode = gatewayMode
            ? (providerForOrder === 'stripe' ? 'STRIPE' : 'RAZORPAY')
            : checkoutPlan.effectivePaymentMode;
          order.paymentStatus = checkoutPlan.initialPaymentStatus;
          order.posRequested = checkoutPlan.posRequested;
          order.posDemandTriggered = checkoutPlan.posDemandTriggered;
          order.status = 'PENDING_SELLER_CONFIRMATION';
          const modeLabel =
            order.paymentMode === 'POS_ON_DELIVERY'
              ? 'POS Machine on Delivery requested'
              : order.paymentMode === 'SELLER_COLLECT'
                ? 'Seller Direct Collection (UPI / Cash confirm)'
                : order.paymentMode === 'COD'
                  ? 'Cash on Delivery'
                  : `Online checkout (${order.paymentMode})`;
          order.statusTimeline.push({
            status: order.status,
            note: `Order submitted (${modeLabel}) and awaiting seller confirmation.`,
            timestamp: new Date().toISOString(),
          });
          if (dbStatus.mode === 'mongodb') {
            await OrderModel.updateOne(
              { _id: new mongoose.Types.ObjectId(String(order._id)), status: 'Pending' },
              {
                $set: {
                  items: order.items,
                  paymentMode: order.paymentMode,
                  paymentStatus: order.paymentStatus,
                  posRequested: order.posRequested,
                  posDemandTriggered: order.posDemandTriggered,
                  status: order.status,
                  statusTimeline: order.statusTimeline,
                },
              }
            );
          }
        } else {
          if (dbStatus.mode === 'mongodb') {
            await OrderModel.updateOne({ _id: new mongoose.Types.ObjectId(String(order._id)) }, { $set: { items: order.items } });
          }
        }
      }
    } catch (err) {
      const code = (err as Error).message;
      const status = code === 'MONGODB_TRANSACTIONAL_CHECKOUT_REQUIRED' ? 503
        : ['INVENTORY_RESERVATION_CONFLICT', 'COUPON_USAGE_LIMIT_REACHED', 'CART_PRICE_CHANGED', 'CART_SELLER_MISMATCH', 'PRODUCT_VARIANT_UNAVAILABLE', 'IDEMPOTENCY_KEY_CONFLICT'].includes(code) ? 409 : 400;
      return res.status(status).json({ error: code, retryable: status === 503 });
    }

    const buildSellerOrderAlert = (order: Order) => {
      const itemSummary = order.items.map((item) => `${item.title} (x${item.quantity})`).join(', ');
      const confirmationUrl = getAppBaseUrl(req) + '/?orderId=' + encodeURIComponent(order._id);
      const paymentLabel =
        order.paymentMode === 'POS_ON_DELIVERY'
          ? 'POS Machine on Delivery (Bring portable terminal)'
          : order.paymentMode === 'SELLER_COLLECT'
            ? 'Seller Direct Collection (Confirm UPI/Cash)'
            : String(order.paymentMode || 'COD');
      return [
        'New order ' + order.orderNumber,
        'Items: ' + itemSummary,
        'Deliver to: ' + order.shippingAddress.fullName + ', ' + order.shippingAddress.street + ', ' + order.shippingAddress.city + ', ' + order.shippingAddress.state + ' ' + order.shippingAddress.pincode,
        'Contact: ' + order.shippingAddress.phone,
        'Payment: ' + paymentLabel,
        'Total: INR ' + order.totalAmount,
        'Confirm stock & payment collection: ' + confirmationUrl,
      ].join('\n');
    };

    // The durable lease prevents concurrent checkout retries from dispatching twice.
    // Persisting a fallback link also completes the attempt so a replay does not repeat it.
    if (dbStatus.mode === 'mongodb') for (const order of createdOrders) {
      const leaseUntil = new Date(Date.now() + 60_000);
      const claim = await OrderModel.findOneAndUpdate(
        {
          _id: order._id, sellerNotificationSentAt: null,
          $or: [{ sellerNotificationLeaseUntil: null }, { sellerNotificationLeaseUntil: { $lte: new Date() } }],
        },
        { $set: { sellerNotificationLeaseUntil: leaseUntil } },
        { returnDocument: 'after' }
      );
      if (!claim) continue;
      try {
        const seller = await findUserById(order.sellerId);
        const sellerPhone = seller ? getSellerOrderNotificationNumber(seller) : '';
        if (sellerPhone) {
          order.whatsappDispatch = await sendWhatsAppMessage(sellerPhone, buildSellerOrderAlert(order));
          await OrderModel.updateOne(
            { _id: order._id, sellerNotificationLeaseUntil: leaseUntil },
            {
              $set: {
                whatsappDispatch: order.whatsappDispatch,
                sellerNotificationSentAt: new Date(),
              },
              $unset: { sellerNotificationLeaseUntil: 1 },
            }
          );
        } else {
          await OrderModel.updateOne({ _id: order._id, sellerNotificationLeaseUntil: leaseUntil }, { $unset: { sellerNotificationLeaseUntil: 1 } });
        }
      } catch (error) {
        await OrderModel.updateOne({ _id: order._id, sellerNotificationLeaseUntil: leaseUntil }, { $unset: { sellerNotificationLeaseUntil: 1 } });
        console.warn('Seller order notification deferred:', (error as Error).message);
      }
    }
    else {
      for (const order of createdOrders) {
        try {
          const seller = await findUserById(order.sellerId);
          const sellerPhone = seller ? getSellerOrderNotificationNumber(seller) : '';
          if (!sellerPhone) continue;
          order.whatsappDispatch = await sendWhatsAppMessage(sellerPhone, buildSellerOrderAlert(order));
          await saveLocalOrderWhatsAppDispatch(order._id, order.whatsappDispatch);
        } catch (error) {
          console.warn('Seller order notification deferred:', (error as Error).message);
        }
      }
    }

    await saveCartForActor({ userId: user._id, guestToken }, []);
    res.status(201).json({ orders: createdOrders, replayed: Boolean((createdOrders as any).replayed) });
  });

  app.patch('/api/orders/:id/status', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user) return res.status(401).json({ error: 'Authentication required' });

    const schema = z.object({
      status: z.enum([
        'Pending',
        'Confirmed',
        'Packed',
        'Shipped',
        'Out for Delivery',
        'Delivered',
        'Cancelled',
      ]),
      note: z.string().optional(),
      courierTracking: z
        .object({
          companyName: z.string().min(2),
          trackingId: z.string().min(3),
          trackingUrl: z.string().url('Valid tracking URL required (https://...)'),
        })
        .optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid status update' });
    }

    if (parsed.data.status === 'Shipped' && !parsed.data.courierTracking) {
      return res.status(400).json({
        error: 'Courier companyName, trackingId, and trackingUrl are required when marking Shipped.',
      });
    }

    const existingOrder = await OrderModel.findById(req.params.id).lean();
    if (!existingOrder) return res.status(404).json({ error: 'ORDER_NOT_FOUND' });
    if (user.role !== 'ADMIN' && (user.role !== 'SELLER' || !user.isWhatsappVerified || String(existingOrder.sellerId) !== user._id)) {
      return res.status(403).json({ error: 'ORDER_OWNER_REQUIRED' });
    }
    const allowedTransitions: Record<string, string[]> = {
      Pending: ['Confirmed', 'Cancelled'],
      PENDING_SELLER_CONFIRMATION: ['Confirmed', 'CONFIRMED_AWAITING_PAYMENT', 'Cancelled'],
      Confirmed: ['Packed', 'Cancelled'],
      PAID_AND_PROCESSING: ['Packed', 'Cancelled'],
      Packed: ['Shipped', 'Cancelled'],
      Shipped: ['Out for Delivery', 'Delivered'],
      'Out for Delivery': ['Delivered'],
      CANCELLATION_REQUESTED: ['Cancelled', 'Confirmed'],
    };
    if (user.role !== 'ADMIN' && !(allowedTransitions[String(existingOrder.status)] || []).includes(parsed.data.status)) {
      return res.status(409).json({ error: 'INVALID_ORDER_STATUS_TRANSITION' });
    }
    const updated = await updateOrderStatusOrTracking(req.params.id, {
      status: parsed.data.status as OrderStatus,
      note: parsed.data.note,
      courierTracking: parsed.data.courierTracking,
    });
    if (!updated) return res.status(404).json({ error: 'Order not found' });
    if (parsed.data.status === 'Cancelled') await restoreCancelledOrderInventory(String(updated._id));
    if (parsed.data.status === 'Cancelled') await ProviderSettlementModel.updateMany({ orderId: String(updated._id), status: { $in: ['PENDING_CLEARANCE', 'READY_FOR_SETTLEMENT', 'ADJUSTED'] } }, { $set: { status: 'VOID' } });

    if (parsed.data.status === 'Delivered') {
      const deliveredAt = new Date();
      await OrderModel.updateOne({ _id: updated._id }, { $set: { deliveredAt } });
      const orderItems = Array.isArray(updated.items) ? updated.items : [];
      for (const item of orderItems) {
        const retail = await ProductModel.findById(item.productId).select('+providerId +providerProductId +providerBasePricePaise').lean();
        if (!retail?.providerId || !retail?.providerProductId || !Number.isSafeInteger(Number(retail.providerBasePricePaise)) || Number(retail.providerBasePricePaise) <= 0) continue;
        const quantity = Math.max(1, Number(item.quantity || 1));
        const unitBasePricePaise = Number(retail.providerBasePricePaise);
        await ProviderSettlementModel.updateOne(
          { orderId: String(updated._id), orderItemKey: String(item.productId) },
          { $setOnInsert: {
            orderId: String(updated._id), orderItemKey: String(item.productId),
            sellerId: String(updated.sellerId), providerId: String(retail.providerId),
            providerProductId: String(retail.providerProductId), quantity,
            unitBasePricePaise, amountPaise: unitBasePricePaise * quantity,
            status: 'PENDING_CLEARANCE', availableAt: new Date(deliveredAt.getTime() + 24 * 60 * 60 * 1000),
          } },
          { upsert: true }
        );
      }
    }
    if (parsed.data.status === 'Shipped' && updated.courierTracking) {
      const dispatch = await sendWhatsAppMessage(
        updated.shippingAddress.phone,
        `Order ${updated.orderNumber} has shipped via ${updated.courierTracking.companyName} (ID: ${updated.courierTracking.trackingId}). Track: ${updated.courierTracking.trackingUrl}`
      );
      updated.whatsappDispatch = dispatch;
    } else if (parsed.data.status === 'Cancelled') {
      const seller = await findUserById(updated.sellerId);
      const sellerPhone = seller?.whatsappNumber || seller?.mobileNumber;
      if (sellerPhone) updated.whatsappDispatch = await sendWhatsAppMessage(sellerPhone, `Order ${updated.orderNumber} was cancelled. Total INR ${updated.totalAmount}.`);
    }

    res.json({ order: updated });
  });


  // Seller-scoped customer lookup. PUID, name and phone are searchable; response is deliberately minimized.
  app.get('/api/seller/customers/search', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['SELLER', 'ADMIN'].includes(user.role) || (user.role === 'SELLER' && !user.isWhatsappVerified)) return res.status(403).json({ error: 'SELLER_ACCESS_REQUIRED' });
    const searchRate = await checkRateLimit('seller-customer-search:' + user._id, 60, 60);
    if (!searchRate.allowed) return res.status(429).json({ error: 'SEARCH_RATE_LIMITED' });
    const q = String(req.query.q || '').trim().slice(0, 80);
    if (q.length < 2) return res.json({ customers: [] });
    const escaped = q.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
    const docs = await UserModel.find({
      role: 'BUYER',
      $or: [
        { name: { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
        { mobileNumber: { $regex: escaped, $options: 'i' } },
        ...( /^[a-f0-9]{24}$/i.test(q) ? [{ _id: q }] : [] ),
      ],
    }).select('_id name email mobileNumber').limit(20).lean();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ customers: docs.map((d: any) => ({ _id: String(d._id), puid: String(d._id), name: d.name, email: d.email, mobileNumber: d.mobileNumber })) });
  });

  // Gateway secrets are encrypted at rest and never returned by this API.

  // --- Provider supply network: seller invitations, provider KYC, catalog negotiation and payouts ---
  const providerAudit = (actor: any, action: string, providerId = '', resourceId = '', metadata: Record<string, unknown> = {}) =>
    ProviderAuditModel.create({ actorId: String(actor._id), actorRole: actor.role, action, providerId, resourceId, metadata });

  app.post('/api/provider/upload', upload.single('image'), async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'PROVIDER') return res.status(403).json({ error: 'PROVIDER_ACCESS_REQUIRED' });
    const rate = await checkRateLimit('provider-upload:' + user._id, 30, 3600);
    if (!rate.allowed) return res.status(429).json({ error: 'PROVIDER_UPLOAD_RATE_LIMITED' });
    if (!req.file || !['image/jpeg', 'image/png', 'image/webp'].includes(req.file.mimetype)) return res.status(415).json({ error: 'SUPPORTED_PRODUCT_IMAGE_REQUIRED' });
    try {
      const media = await processAndStoreImage(req.file.buffer, req.file.originalname);
      res.status(201).json({ url: media.url, thumbUrl: media.thumbUrl, mimeType: 'image/webp' });
    } catch (err) { res.status(400).json({ error: 'PROVIDER_IMAGE_PROCESSING_FAILED', message: (err as Error).message }); }
  });

  app.patch('/api/admin/providers/:providerId/kyc', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'ADMIN_ACCESS_REQUIRED' });
    const parsed = z.object({ status: z.enum(['VERIFIED', 'REJECTED']), note: z.string().max(500).optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_KYC_DECISION' });
    const profile = await ProviderProfileModel.findOneAndUpdate({ userId: req.params.providerId }, { $set: { kycStatus: parsed.data.status } }, { returnDocument: 'after' }).select('-encryptedTaxId -encryptedSettlementDetails');
    if (!profile) return res.status(404).json({ error: 'PROVIDER_NOT_FOUND' });
    await providerAudit(user, 'PROVIDER_KYC_REVIEWED', req.params.providerId, String(profile._id), { status: parsed.data.status, note: parsed.data.note || '' });
    res.json({ profile });
  });

  app.post('/api/seller/providers/invites', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !canInviteRole(user, 'PROVIDER') || (user.role === 'SELLER' && !user.isWhatsappVerified)) return res.status(403).json({ error: 'VERIFIED_SELLER_REQUIRED' });
    const parsed = z.object({ email: z.string().trim().email().max(254), note: z.string().max(500).optional() }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'PROVIDER_EMAIL_REQUIRED_AND_MUST_BE_VALID' });
    const normalizedEmail = parsed.data.email.toLowerCase();
    const existingUser = await UserModel.findOne({ email: normalizedEmail }).select('_id email role name').lean() as any;
    if (existingUser) {
      if (existingUser.role !== 'PROVIDER') return res.status(409).json({ error: 'EMAIL_ALREADY_REGISTERED_NOT_A_PROVIDER' });
      const profile = await ProviderProfileModel.findOneAndUpdate(
        { userId: String(existingUser._id) },
        { $addToSet: { linkedSellerIds: user._id } },
        { returnDocument: 'after' },
      ).select('-encryptedTaxId -encryptedSettlementDetails').lean() as any;
      if (!profile) return res.status(409).json({ error: 'PROVIDER_PROFILE_NOT_FOUND_FOR_EMAIL' });
      await ProviderProductModel.updateMany({ providerId: String(existingUser._id) }, { $addToSet: { linkedSellerIds: user._id } });
      await providerAudit(user, 'EXISTING_PROVIDER_LINKED_BY_EMAIL', String(existingUser._id), String(profile._id), { email: normalizedEmail });
      return res.status(200).json({ linked: true, provider: { userId: String(existingUser._id), email: normalizedEmail, businessName: profile.businessName, contactPerson: profile.contactPerson, kycStatus: profile.kycStatus } });
    }
    const pendingInvite = await ProviderInviteModel.findOne({ sellerId: user._id, email: normalizedEmail, status: 'PENDING', expiresAt: { $gt: new Date() } }).lean();
    if (pendingInvite) return res.status(409).json({ error: 'PROVIDER_INVITE_ALREADY_PENDING' });
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const invite = await ProviderInviteModel.create({
      tokenHash: crypto.createHash('sha256').update(rawToken).digest('hex'),
      sellerId: user._id, email: normalizedEmail,
      expiresAt, status: 'PENDING',
    });
    const inviteUrl = getAppBaseUrl(req) + '/provider/onboard?token=' + encodeURIComponent(rawToken);
    await providerAudit(user, 'PROVIDER_INVITE_CREATED', '', String(invite._id), { email: normalizedEmail, expiresAt });
    res.status(201).json({ linked: false, invite: { id: String(invite._id), email: invite.email, status: invite.status, expiresAt }, inviteUrl });
  });

  app.get('/api/provider/invites/:token', async (req, res) => {
    const token = String(req.params.token || '');
    if (token.length < 32 || token.length > 128) return res.status(400).json({ error: 'INVALID_INVITE_TOKEN' });
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const invite = await ProviderInviteModel.findOne({ tokenHash }).lean();
    if (!invite) return res.status(404).json({ error: 'INVITE_NOT_FOUND' });
    if (invite.status !== 'PENDING' || new Date(invite.expiresAt).getTime() <= Date.now()) {
      if (invite.status === 'PENDING') await ProviderInviteModel.updateOne({ _id: invite._id, status: 'PENDING' }, { $set: { status: 'EXPIRED' } });
      return res.status(410).json({ error: 'INVITE_EXPIRED_OR_USED' });
    }
    res.json({ sellerId: invite.sellerId, email: invite.email, expiresAt: invite.expiresAt, status: invite.status });
  });

  app.post('/api/provider/onboarding/accept', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['BUYER', 'PROVIDER'].includes(user.role)) return res.status(401).json({ error: 'SIGN_IN_REQUIRED' });
    const parsed = z.object({
      token: z.string().min(32).max(128), businessName: z.string().trim().min(2).max(180),
      contactPerson: z.string().trim().min(2).max(120), mobile: z.string().trim().min(8).max(20),
      whatsapp: z.string().trim().max(20).optional().default(''), warehouseAddress: z.string().trim().min(8).max(1000),
      taxId: z.string().trim().min(4).max(80), settlementDetails: z.string().trim().min(6).max(1000),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'INVALID_PROVIDER_PROFILE' });
    const tokenHash = crypto.createHash('sha256').update(parsed.data.token).digest('hex');
    const invite = await ProviderInviteModel.findOne({ tokenHash, status: 'PENDING', expiresAt: { $gt: new Date() } });
    if (!invite) return res.status(410).json({ error: 'INVITE_EXPIRED_OR_USED' });
    if (invite.email && invite.email.toLowerCase() !== user.email.toLowerCase()) return res.status(403).json({ error: 'INVITE_EMAIL_MISMATCH' });
    if (!process.env.ENCRYPTION_MASTER_KEY) return res.status(503).json({ error: 'PROVIDER_ENCRYPTION_NOT_CONFIGURED' });
    const profile = await ProviderProfileModel.findOneAndUpdate(
      { userId: user._id },
      { $set: {
        businessName: parsed.data.businessName, contactPerson: parsed.data.contactPerson,
        mobile: parsed.data.mobile, whatsapp: parsed.data.whatsapp,
        warehouseAddress: parsed.data.warehouseAddress,
        encryptedTaxId: encryptField(parsed.data.taxId),
        encryptedSettlementDetails: encryptField(parsed.data.settlementDetails),
        settlementDetailsLast4: parsed.data.settlementDetails.slice(-4),
        kycStatus: 'PENDING',
      }, $addToSet: { linkedSellerIds: invite.sellerId } },
      { upsert: true, returnDocument: 'after', runValidators: true }
    );
    const consumed = await ProviderInviteModel.updateOne(
      { _id: invite._id, status: 'PENDING', expiresAt: { $gt: new Date() } },
      { $set: { status: 'ACCEPTED', acceptedProviderId: user._id, acceptedAt: new Date() } }
    );
    if (!consumed.modifiedCount) return res.status(409).json({ error: 'INVITE_ALREADY_CONSUMED' });
    await UserModel.updateOne({ _id: user._id, role: user.role }, { $set: { role: 'PROVIDER', mobileNumber: parsed.data.mobile, whatsappNumber: parsed.data.whatsapp } });
    const updatedUser = await findUserById(user._id);
    if (updatedUser) await issueUserSession(req, res, updatedUser, 'invite');
    await ProviderProductModel.updateMany({ providerId: user._id }, { $addToSet: { linkedSellerIds: invite.sellerId } });
    await providerAudit(user, 'PROVIDER_ONBOARDING_SUBMITTED', user._id, String(profile._id), { sellerId: invite.sellerId });
    res.status(201).json({ ok: true, role: 'PROVIDER', kycStatus: 'PENDING' });
  });

  app.get('/api/provider/profile', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'PROVIDER') return res.status(403).json({ error: 'PROVIDER_ACCESS_REQUIRED' });
    const profile = await ProviderProfileModel.findOne({ userId: user._id }).select('-encryptedTaxId -encryptedSettlementDetails').lean();
    if (!profile) return res.status(404).json({ error: 'PROVIDER_PROFILE_NOT_FOUND' });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ profile: toProviderSafeProfileDto(profile) });
  });

  app.get('/api/provider/products', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'PROVIDER') return res.status(403).json({ error: 'PROVIDER_ACCESS_REQUIRED' });
    const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(5, Number.parseInt(String(req.query.limit || '20'), 10) || 20));
    const query = String(req.query.q || '').trim().slice(0, 120);
    const status = String(req.query.status || '').trim();
    const sortKey = String(req.query.sort || 'updatedAt');
    const sortField = ({ title: 'title', status: 'status', price: 'basePricePaise', createdAt: 'createdAt', updatedAt: 'updatedAt' } as Record<string, string>)[sortKey] || 'updatedAt';
    const direction = String(req.query.direction || 'desc') === 'asc' ? 1 : -1;
    const filter: Record<string, any> = { providerId: user._id };
    const escapedQuery = escapeRegex(query);
    filter.$or = [{ title: { $regex: escapedQuery, $options: 'i' } }, { category: { $regex: escapedQuery, $options: 'i' } }, { brand: { $regex: escapedQuery, $options: 'i' } }];
    if (status && status !== 'ALL') filter.status = status;
    const [total, products] = await Promise.all([
      ProviderProductModel.countDocuments(filter),
      ProviderProductModel.find(filter).sort({ [sortField]: direction, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ products: products.map(toProviderSafeProductDto), total, page, limit, totalPages: Math.ceil(total / limit) });
  });

  app.post('/api/provider/products', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'PROVIDER') return res.status(403).json({ error: 'PROVIDER_ACCESS_REQUIRED' });
    const profile = await ProviderProfileModel.findOne({ userId: user._id });
    if (!profile) return res.status(409).json({ error: 'PROVIDER_ONBOARDING_REQUIRED' });
    if (!profile.linkedSellerIds?.length) return res.status(409).json({ error: 'LINK_TO_A_SELLER_BEFORE_SUBMITTING_PRODUCTS' });
    const parsed = z.object({
      title: z.string().trim().min(2).max(180), category: z.string().trim().min(2).max(100),
      subCategory: z.string().max(100).optional().default(''), description: z.string().trim().min(10).max(5000),
      brand: z.string().max(120).optional().default(''), manufacturerName: z.string().trim().min(2).max(180),
      manufacturingDate: z.string().optional(), sizeVariants: z.array(z.string().max(40)).max(40).optional().default([]),
      colorVariants: z.array(z.string().max(60)).max(40).optional().default([]),
      imageUrls: z.array(z.string().url().max(2048)).min(1).max(12),
      basePricePaise: z.number().int().positive().max(1000000000),
      returnable: z.boolean().default(true), returnWindowDays: z.number().int().min(0).max(90).default(7),
      damageReplacementPolicy: z.string().max(2000).optional().default(''),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'INVALID_PROVIDER_PRODUCT' });
    const product = await ProviderProductModel.create({ ...parsed.data, providerId: user._id, linkedSellerIds: profile.linkedSellerIds, status: 'DRAFT' });
    await providerAudit(user, 'PROVIDER_PRODUCT_DRAFT_CREATED', user._id, String(product._id));
    res.status(201).json({ product: toProviderSafeProductDto(product.toObject()) });
  });

  app.patch('/api/provider/products/:id', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'PROVIDER') return res.status(403).json({ error: 'PROVIDER_ACCESS_REQUIRED' });
    const allowed = ['DRAFT', 'PENDING_REVIEW', 'NEGOTIATION_REQUESTED', 'RESUBMITTED'];
    const product = await ProviderProductModel.findOne({ _id: req.params.id, providerId: user._id });
    if (!product) return res.status(404).json({ error: 'PROVIDER_PRODUCT_NOT_FOUND' });
    if (!allowed.includes(product.status)) return res.status(409).json({ error: 'PRODUCT_FIELDS_LOCKED_AFTER_APPROVAL' });
    const parsed = z.object({
      title: z.string().trim().min(2).max(180).optional(), category: z.string().trim().min(2).max(100).optional(),
      subCategory: z.string().max(100).optional(), description: z.string().trim().min(10).max(5000).optional(),
      brand: z.string().max(120).optional(), manufacturerName: z.string().trim().min(2).max(180).optional(), manufacturingDate: z.string().optional(),
      imageUrls: z.array(z.string().url().max(2048)).min(1).max(12).optional(),
      basePricePaise: z.number().int().positive().max(1000000000).optional(),
      sizeVariants: z.array(z.string().max(40)).max(40).optional(), colorVariants: z.array(z.string().max(60)).max(40).optional(),
      returnable: z.boolean().optional(), returnWindowDays: z.number().int().min(0).max(90).optional(),
      damageReplacementPolicy: z.string().max(2000).optional(),
    }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PROVIDER_PRODUCT_PATCH' });
    product.set(parsed.data);
    if (product.status === 'NEGOTIATION_REQUESTED') product.status = 'RESUBMITTED';
    await product.save();
    await providerAudit(user, 'PROVIDER_PRODUCT_UPDATED', user._id, String(product._id), { fields: Object.keys(parsed.data) });
    res.json({ product: toProviderSafeProductDto(product.toObject()) });
  });

  app.post('/api/provider/products/:id/submit', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'PROVIDER') return res.status(403).json({ error: 'PROVIDER_ACCESS_REQUIRED' });
    const product = await ProviderProductModel.findOne({ _id: req.params.id, providerId: user._id });
    if (!product) return res.status(404).json({ error: 'PROVIDER_PRODUCT_NOT_FOUND' });
    const profile = await ProviderProfileModel.findOne({ userId: user._id }).select('linkedSellerIds').lean() as any;
    if (!profile?.linkedSellerIds?.length || !product.linkedSellerIds?.length) return res.status(409).json({ error: 'LINK_TO_A_SELLER_BEFORE_SUBMITTING_PRODUCTS' });
    if (!['DRAFT', 'NEGOTIATION_REQUESTED', 'RESUBMITTED'].includes(product.status)) return res.status(409).json({ error: 'PRODUCT_CANNOT_BE_SUBMITTED' });
    product.status = 'PENDING_REVIEW';
    await product.save();
    await providerAudit(user, 'PROVIDER_PRODUCT_SUBMITTED', user._id, String(product._id));
    res.json({ product: toProviderSafeProductDto(product.toObject()) });
  });

  app.get('/api/seller/providers', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['SELLER', 'ADMIN'].includes(user.role) || (user.role === 'SELLER' && !user.isWhatsappVerified)) return res.status(403).json({ error: 'VERIFIED_SELLER_REQUIRED' });
    const profiles = await ProviderProfileModel.find(user.role === 'ADMIN' ? {} : { linkedSellerIds: user._id })
      .select('-encryptedTaxId -encryptedSettlementDetails').sort({ updatedAt: -1 }).limit(200).lean();
    res.json({ providers: profiles });
  });

  app.get('/api/seller/providers/:providerId/dashboard', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['SELLER', 'ADMIN'].includes(user.role) || (user.role === 'SELLER' && !user.isWhatsappVerified)) return res.status(403).json({ error: 'VERIFIED_SELLER_REQUIRED' });
    const profile = await ProviderProfileModel.findOne({ userId: req.params.providerId, ...(user.role === 'ADMIN' ? {} : { linkedSellerIds: user._id }) })
      .select('-encryptedTaxId -encryptedSettlementDetails').lean();
    if (!profile) return res.status(404).json({ error: 'LINKED_PROVIDER_NOT_FOUND' });
    const [products, settlements] = await Promise.all([
      ProviderProductModel.find({ providerId: req.params.providerId, linkedSellerIds: user.role === 'ADMIN' ? { $exists: true } : user._id }).select('-basePricePaise').limit(200).lean(),
      ProviderSettlementModel.find({ providerId: req.params.providerId, ...(user.role === 'ADMIN' ? {} : { sellerId: user._id }) }).limit(200).lean(),
    ]);
    await providerAudit(user, 'PROVIDER_READ_ONLY_AUDIT_VIEW', req.params.providerId, req.params.providerId);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      readOnly: true,
      profile: toSellerSafeProviderProfileDto(profile),
      products: products.map(toProviderSafeProductDto),
      settlements: settlements.map(toProviderSafeSettlementDto),
    });
  });

  app.get('/api/seller/providers/products/review-queue', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['SELLER', 'ADMIN'].includes(user.role) || (user.role === 'SELLER' && !user.isWhatsappVerified)) return res.status(403).json({ error: 'VERIFIED_SELLER_REQUIRED' });
    const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(50, Math.max(5, Number.parseInt(String(req.query.limit || '10'), 10) || 10));
    const query = String(req.query.q || '').trim().slice(0, 100);
    const status = String(req.query.status || 'ALL').trim().toUpperCase();
    const sortKey = String(req.query.sort || 'updatedAt');
    const sortField = ({ title: 'title', category: 'category', status: 'status', basePricePaise: 'basePricePaise', createdAt: 'createdAt', updatedAt: 'updatedAt' } as Record<string, string>)[sortKey] || 'updatedAt';
    const direction = String(req.query.direction || 'desc') === 'asc' ? 1 : -1;
    const filter: Record<string, any> = {
      ...(user.role === 'ADMIN' ? {} : { linkedSellerIds: user._id }),
      status: { $in: ['PENDING_REVIEW', 'RESUBMITTED', 'NEGOTIATION_REQUESTED', 'APPROVED'] },
    };
    if (status !== 'ALL' && ['PENDING_REVIEW', 'RESUBMITTED', 'NEGOTIATION_REQUESTED', 'APPROVED'].includes(status)) filter.status = status;
    if (query) {
      const safeQuery = escapeRegex(query);
      filter.$or = [{ title: { $regex: safeQuery, $options: 'i' } }, { category: { $regex: safeQuery, $options: 'i' } }, { brand: { $regex: safeQuery, $options: 'i' } }, { manufacturerName: { $regex: safeQuery, $options: 'i' } }];
    }
    const [total, products] = await Promise.all([
      ProviderProductModel.countDocuments(filter),
      ProviderProductModel.find(filter).sort({ [sortField]: direction, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ products, total, page, limit, totalPages: Math.ceil(total / limit) });
  });

  app.post('/api/seller/providers/products/:id/negotiate', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['SELLER', 'ADMIN'].includes(user.role) || (user.role === 'SELLER' && !user.isWhatsappVerified)) return res.status(403).json({ error: 'VERIFIED_SELLER_REQUIRED' });
    const parsed = z.object({ fields: z.array(z.enum(['basePricePaise', 'description', 'imageUrls', 'returnable', 'returnWindowDays'])).min(1), targetPricePaise: z.number().int().positive().optional(), comment: z.string().trim().min(3).max(1500) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_NEGOTIATION_REQUEST' });
    const product = await ProviderProductModel.findOne({ _id: req.params.id, ...(user.role === 'ADMIN' ? {} : { linkedSellerIds: user._id }) });
    if (!product || !['PENDING_REVIEW', 'RESUBMITTED', 'NEGOTIATION_REQUESTED'].includes(product.status)) return res.status(404).json({ error: 'REVIEWABLE_PROVIDER_PRODUCT_NOT_FOUND' });
    product.status = 'NEGOTIATION_REQUESTED';
    product.negotiationHistory.push({ sellerId: user._id, actorId: user._id, action: 'COUNTER_OR_REVISION_REQUESTED', fields: parsed.data.fields, targetPricePaise: parsed.data.targetPricePaise, comment: parsed.data.comment, createdAt: new Date() });
    await product.save();
    await providerAudit(user, 'PROVIDER_PRODUCT_NEGOTIATION_REQUESTED', product.providerId, String(product._id), { fields: parsed.data.fields });
    res.json({ product });
  });

  app.post('/api/seller/providers/products/:id/approve', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['SELLER', 'ADMIN'].includes(user.role) || (user.role === 'SELLER' && !user.isWhatsappVerified)) return res.status(403).json({ error: 'VERIFIED_SELLER_REQUIRED' });
    const product = await ProviderProductModel.findOne({ _id: req.params.id, ...(user.role === 'ADMIN' ? {} : { linkedSellerIds: user._id }) });
    if (!product || !['PENDING_REVIEW', 'RESUBMITTED'].includes(product.status)) return res.status(404).json({ error: 'REVIEWABLE_PROVIDER_PRODUCT_NOT_FOUND' });
    product.status = 'APPROVED';
    product.approvedBasePricePaise = product.basePricePaise;
    product.approvedAt = new Date();
    product.negotiationHistory.push({ sellerId: user._id, actorId: user._id, action: 'APPROVED_BASE_PRICE', fields: [], targetPricePaise: product.basePricePaise, comment: 'Provider base price approved.', createdAt: new Date() });
    await product.save();
    await providerAudit(user, 'PROVIDER_PRODUCT_APPROVED', product.providerId, String(product._id));
    res.json({ product });
  });

  app.post('/api/seller/providers/products/:id/publish', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['SELLER', 'ADMIN'].includes(user.role) || (user.role === 'SELLER' && !user.isWhatsappVerified)) return res.status(403).json({ error: 'VERIFIED_SELLER_REQUIRED' });
    const parsed = z.object({ mrp: z.number().positive(), sellingPrice: z.number().positive(), totalStock: z.number().int().min(0), codAllowed: z.boolean().default(true), onlinePaymentRequired: z.boolean().default(false), isReturnable: z.boolean().default(true), returnWindowDays: z.number().int().min(0).max(90).default(7), trusted: z.boolean().default(false), qualityChecked: z.boolean().default(false), manufacturerWarrantyVerified: z.boolean().default(false) }).safeParse(req.body);
    if (!parsed.success || (parsed.success && parsed.data.sellingPrice > parsed.data.mrp)) return res.status(400).json({ error: 'INVALID_RETAIL_LISTING' });
    const providerProduct = await ProviderProductModel.findOne({ _id: req.params.id, status: 'APPROVED', ...(user.role === 'ADMIN' ? {} : { linkedSellerIds: user._id }) });
    if (!providerProduct) return res.status(409).json({ error: 'PROVIDER_PRODUCT_MUST_BE_APPROVED_FIRST' });
    if (!mongoose.isValidObjectId(user._id)) return res.status(400).json({ error: 'SELLER_ACCOUNT_ID_INVALID' });
    if (providerProduct.retailProductId) return res.status(409).json({ error: 'PROVIDER_PRODUCT_ALREADY_PUBLISHED' });
    const slug = providerProduct.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + crypto.randomBytes(3).toString('hex');
    const images = providerProduct.imageUrls.map((url: string, i: number) => ({ url, thumbUrl: url, altText: providerProduct.title, sortOrder: i }));
    const listing = await ProductModel.create({
      sellerId: new mongoose.Types.ObjectId(user._id), title: providerProduct.title, slug,
      sku: 'SUP-' + crypto.randomBytes(5).toString('hex').toUpperCase(), category: providerProduct.category,
      subCategory: providerProduct.subCategory || providerProduct.category, description: providerProduct.description,
      basePrice: parsed.data.mrp, salePrice: parsed.data.sellingPrice,
      discountPercent: Math.max(0, Math.round((1 - parsed.data.sellingPrice / parsed.data.mrp) * 100)),
      totalStock: parsed.data.totalStock, images,
      variants: [{ variantSku: 'DEFAULT-' + crypto.randomBytes(3).toString('hex'), size: providerProduct.sizeVariants[0] || 'One Size', colorName: providerProduct.colorVariants[0] || 'Default', colorHex: '#808080', stock: parsed.data.totalStock }],
      isReturnable: parsed.data.isReturnable, returnWindowDays: parsed.data.isReturnable ? parsed.data.returnWindowDays : 0,
      codAllowed: parsed.data.codAllowed, onlinePaymentRequired: parsed.data.onlinePaymentRequired,
      isProductTrusted: parsed.data.trusted, isQualityChecked: parsed.data.qualityChecked, manufacturerWarrantyVerified: parsed.data.manufacturerWarrantyVerified, providerId: providerProduct.providerId,
      providerProductId: String(providerProduct._id), providerBasePricePaise: providerProduct.approvedBasePricePaise || providerProduct.basePricePaise,
    });
    providerProduct.status = 'APPROVED_AND_PUBLISHED';
    providerProduct.retailProductId = String(listing._id);
    await providerProduct.save();
    await providerAudit(user, 'PROVIDER_PRODUCT_PUBLISHED_TO_STOREFRONT', providerProduct.providerId, String(providerProduct._id), { retailProductId: String(listing._id) });
    res.status(201).json({ product: listing });
  });

  // Provider-owned courier accounts and pickup locations.
  app.get('/api/provider/logistics/carriers', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'PROVIDER') return res.status(403).json({ error: 'PROVIDER_ACCESS_REQUIRED' });
    try {
      const [providers, carriers] = await Promise.all([listLogisticsProvidersViaShippingService(), listProviderCarrierConfigs(user._id)]);
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ providers, carriers });
    } catch (error) { const e = error as any; res.status(e.statusCode || 503).json({ error: e.message || 'PROVIDER_CARRIER_LIST_FAILED' }); }
  });

  app.post('/api/provider/logistics/carriers', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'PROVIDER') return res.status(403).json({ error: 'PROVIDER_ACCESS_REQUIRED' });
    const parsed = z.object({ providerId: z.string().uuid(), credentials: z.record(z.string(), z.string()), priorityRank: z.coerce.number().int().min(0).max(10000).default(100) }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PROVIDER_CARRIER_CONFIG' });
    try {
      const carrier = await saveProviderCarrierConfig({ providerUserId: user._id, ...parsed.data });
      await providerAudit(user, 'PROVIDER_CARRIER_CONFIG_SAVED', user._id, carrier.id, { providerId: parsed.data.providerId });
      res.status(201).json({ carrier, message: 'Carrier credentials validated and encrypted. Copy the one-time webhook secret now.' });
    } catch (error) { const e = error as any; res.status(e.statusCode || 503).json({ error: e.message || 'PROVIDER_CARRIER_SAVE_FAILED' }); }
  });

  app.patch('/api/provider/logistics/carriers/:id/active', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'PROVIDER') return res.status(403).json({ error: 'PROVIDER_ACCESS_REQUIRED' });
    const parsed = z.object({ isActive: z.boolean() }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_ACTIVE_FLAG' });
    try {
      const carrier = await setProviderCarrierActive(user._id, req.params.id, parsed.data.isActive);
      if (!carrier) return res.status(404).json({ error: 'PROVIDER_CARRIER_NOT_FOUND' });
      await providerAudit(user, 'PROVIDER_CARRIER_CONFIG_TOGGLED', user._id, req.params.id, { isActive: parsed.data.isActive });
      res.json({ carrier });
    } catch (error) { const e = error as any; res.status(e.statusCode || 503).json({ error: e.message || 'PROVIDER_CARRIER_UPDATE_FAILED' }); }
  });

  app.get('/api/provider/logistics/warehouses', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'PROVIDER') return res.status(403).json({ error: 'PROVIDER_ACCESS_REQUIRED' });
    try { res.setHeader('Cache-Control', 'private, no-store'); res.json({ warehouses: await listProviderWarehouses(user._id) }); }
    catch (error) { const e = error as any; res.status(e.statusCode || 503).json({ error: e.message || 'PROVIDER_WAREHOUSE_LIST_FAILED' }); }
  });

  app.post('/api/provider/logistics/warehouses', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'PROVIDER') return res.status(403).json({ error: 'PROVIDER_ACCESS_REQUIRED' });
    const parsed = z.object({
      warehouseCode: z.string().trim().min(2).max(64), name: z.string().trim().min(2).max(120),
      contactName: z.string().trim().min(2).max(120), contactPhone: z.string().trim().min(8).max(24),
      addressLine1: z.string().trim().min(3).max(180), addressLine2: z.string().max(180).optional(),
      city: z.string().trim().min(2).max(100), state: z.string().trim().min(2).max(100),
      postalCode: z.string().trim().regex(/^\d{5,6}$/), countryCode: z.string().length(2).default('IN'),
      isDefault: z.boolean().default(false),
    }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PROVIDER_WAREHOUSE' });
    try { res.status(201).json({ warehouse: await createProviderWarehouse({ providerUserId: user._id, ...parsed.data }) }); }
    catch (error) { const e = error as any; res.status(e.statusCode || 503).json({ error: e.message || 'PROVIDER_WAREHOUSE_SAVE_FAILED' }); }
  });

  app.get('/api/provider/linked-sellers', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'PROVIDER') return res.status(403).json({ error: 'PROVIDER_ACCESS_REQUIRED' });
    const profile = await ProviderProfileModel.findOne({ userId: user._id }).select('linkedSellerIds').lean();
    const sellers = await UserModel.find({ _id: { $in: profile?.linkedSellerIds || [] }, role: 'SELLER' }).select('name sellerProfile.storeName').lean();
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ sellers: sellers.map((seller: any) => ({ id: String(seller._id), name: seller.sellerProfile?.storeName || seller.name })) });
  });

  app.get('/api/provider/fulfillment-delegations', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'PROVIDER') return res.status(403).json({ error: 'PROVIDER_ACCESS_REQUIRED' });
    const rows = await ProviderFulfillmentDelegationModel.find({ providerId: user._id }).sort({ updatedAt: -1 }).lean();
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ delegations: rows.map((row: any) => ({
      sellerId: row.sellerId, status: row.status, requestedCarrierCodes: row.requestedCarrierCodes,
      allowedCarrierCodes: row.allowedCarrierCodes, requestedDisclosureFields: row.requestedDisclosureFields,
      allowedDisclosureFields: row.allowedDisclosureFields, requestedAt: row.requestedAt,
      approvedAt: row.approvedAt, expiresAt: row.expiresAt,
    })) });
  });

  app.post('/api/provider/fulfillment-delegations', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'PROVIDER') return res.status(403).json({ error: 'PROVIDER_ACCESS_REQUIRED' });
    const parsed = z.object({
      sellerId: z.string().min(1).max(100),
      carrierCodes: z.array(z.string().trim().toLowerCase().min(2).max(48)).min(1).max(10),
      disclosureFields: z.array(z.enum(['recipientName','recipientPhone','recipientAddress','recipientEmail'])).min(3).max(4),
    }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_FULFILLMENT_DELEGATION_REQUEST' });
    const profile = await ProviderProfileModel.findOne({ userId: user._id }).lean();
    if (!profile || !(profile.linkedSellerIds || []).includes(parsed.data.sellerId)) return res.status(403).json({ error: 'SELLER_NOT_LINKED_TO_PROVIDER' });
    const configs = await listProviderCarrierConfigs(user._id);
    const configuredCodes = new Set((configs || []).filter((c: any) => c.is_active).map((c: any) => String(c.logistics_providers?.code || '').toLowerCase()));
    if (parsed.data.carrierCodes.some(code => !configuredCodes.has(code))) return res.status(409).json({ error: 'REQUESTED_CARRIER_NOT_CONFIGURED_BY_PROVIDER' });
    const existing = await ProviderFulfillmentDelegationModel.findOne({ sellerId: parsed.data.sellerId, providerId: user._id });
    if (existing?.status === 'ACTIVE') return res.status(409).json({ error: 'FULFILLMENT_DELEGATION_ALREADY_ACTIVE' });
    const delegation = await ProviderFulfillmentDelegationModel.findOneAndUpdate(
      { sellerId: parsed.data.sellerId, providerId: user._id },
      { $set: { status: 'REQUESTED', requestedCarrierCodes: parsed.data.carrierCodes, requestedDisclosureFields: parsed.data.disclosureFields, allowedCarrierCodes: [], allowedDisclosureFields: [], requestedAt: new Date(), approvedAt: null, approvedBy: '', revokedAt: null, expiresAt: null } },
      { upsert: true, returnDocument: 'after', runValidators: true },
    ).lean();
    await providerAudit(user, 'PROVIDER_FULFILLMENT_DELEGATION_REQUESTED', user._id, parsed.data.sellerId, { carrierCodes: parsed.data.carrierCodes, disclosureFields: parsed.data.disclosureFields });
    res.status(202).json({ delegation: { sellerId: delegation?.sellerId, status: delegation?.status }, message: 'Seller authorization requested.' });
  });

  app.get('/api/seller/providers/fulfillment-delegations', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!requireVerifiedLogisticsSeller(user)) return res.status(403).json({ error: 'VERIFIED_SELLER_REQUIRED' });
    const filter = user!.role === 'ADMIN' ? { status: { $in: ['REQUESTED', 'ACTIVE'] } } : { sellerId: user!._id, status: { $in: ['REQUESTED', 'ACTIVE'] } };
    const rows = await ProviderFulfillmentDelegationModel.find(filter).sort({ requestedAt: 1 }).lean();
    const providerIds = [...new Set(rows.map((row: any) => row.providerId))];
    const profiles = await ProviderProfileModel.find({ userId: { $in: providerIds } }).select('userId businessName contactPerson kycStatus').lean();
    const byId = new Map(profiles.map((p: any) => [p.userId, p]));
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ delegations: rows.map((row: any) => ({
      providerId: row.providerId, provider: byId.get(row.providerId) || null,
      requestedCarrierCodes: row.requestedCarrierCodes, requestedDisclosureFields: row.requestedDisclosureFields,
      requestedAt: row.requestedAt, status: row.status, allowedCarrierCodes: row.allowedCarrierCodes, allowedDisclosureFields: row.allowedDisclosureFields, expiresAt: row.expiresAt,
    })) });
  });

  app.post('/api/seller/providers/fulfillment-delegations/:providerId/approve', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!requireVerifiedLogisticsSeller(user)) return res.status(403).json({ error: 'VERIFIED_SELLER_REQUIRED' });
    if (user!.role !== 'ADMIN' && !mongoose.isValidObjectId(user!._id)) return res.status(400).json({ error: 'INVALID_SELLER_ID' });
    const parsed = z.object({
      carrierCodes: z.array(z.string().trim().toLowerCase().min(2).max(48)).min(1).max(10),
      disclosureFields: z.array(z.enum(['recipientName','recipientPhone','recipientAddress','recipientEmail'])).min(3).max(4),
      expiresAt: z.string().datetime().optional(),
    }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_DELEGATION_APPROVAL' });
    const sellerId = user!._id;
    const filter: any = { providerId: req.params.providerId, status: 'REQUESTED' };
    if (user!.role !== 'ADMIN') filter.sellerId = sellerId;
    const requested = await ProviderFulfillmentDelegationModel.findOne(filter);
    if (!requested) return res.status(404).json({ error: 'FULFILLMENT_REQUEST_NOT_FOUND' });
    const requestedCodes = new Set(requested.requestedCarrierCodes || []);
    if (parsed.data.carrierCodes.some(code => !requestedCodes.has(code))) return res.status(400).json({ error: 'APPROVED_CARRIERS_EXCEED_REQUEST' });
    const requestedFields = new Set(requested.requestedDisclosureFields || []);
    if (parsed.data.disclosureFields.some(field => !requestedFields.has(field))) return res.status(400).json({ error: 'APPROVED_DISCLOSURE_EXCEEDS_REQUEST' });
    const privacy = await SellerPrivacySettingsModel.findOne({ sellerId: requested.sellerId }).lean();
    const policy = normalizeCarrierDisclosurePolicy(privacy?.carrierDisclosure || DEFAULT_CARRIER_DISCLOSURE_POLICY);
    const requiredFields = ['recipientName','recipientPhone','recipientAddress'];
    if (requiredFields.some(field => !parsed.data.disclosureFields.includes(field as any) || !policy[field as keyof typeof policy])) return res.status(403).json({ error: 'SELLER_PRIVACY_POLICY_DOES_NOT_ALLOW_REQUIRED_DISCLOSURE' });
    if (parsed.data.carrierCodes.includes('shiprocket') && (!parsed.data.disclosureFields.includes('recipientEmail') || !policy.recipientEmail)) return res.status(403).json({ error: 'SHIPROCKET_REQUIRES_SEPARATE_EMAIL_DISCLOSURE_PERMISSION' });
    const now = new Date();
    const updated = await ProviderFulfillmentDelegationModel.findOneAndUpdate(
      { _id: requested._id, status: 'REQUESTED' },
      { $set: { status: 'ACTIVE', allowedCarrierCodes: parsed.data.carrierCodes, allowedDisclosureFields: parsed.data.disclosureFields, approvedAt: now, approvedBy: user!._id, expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null } },
      { returnDocument: 'after', runValidators: true },
    ).lean();
    await providerAudit(user!, 'SELLER_APPROVED_PROVIDER_FULFILLMENT', req.params.providerId, String(requested._id), { carrierCodes: parsed.data.carrierCodes, disclosureFields: parsed.data.disclosureFields });
    res.json({ delegation: { providerId: req.params.providerId, status: updated?.status, allowedCarrierCodes: updated?.allowedCarrierCodes, allowedDisclosureFields: updated?.allowedDisclosureFields, expiresAt: updated?.expiresAt } });
  });

  app.post('/api/seller/providers/fulfillment-delegations/:providerId/reject', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!requireVerifiedLogisticsSeller(user)) return res.status(403).json({ error: 'VERIFIED_SELLER_REQUIRED' });
    const filter: any = { providerId: req.params.providerId, status: 'REQUESTED' };
    if (user!.role !== 'ADMIN') filter.sellerId = user!._id;
    const updated = await ProviderFulfillmentDelegationModel.findOneAndUpdate(filter, { $set: { status: 'REVOKED', revokedAt: new Date() } }, { returnDocument: 'after' }).lean();
    if (!updated) return res.status(404).json({ error: 'FULFILLMENT_REQUEST_NOT_FOUND' });
    await providerAudit(user!, 'SELLER_REJECTED_PROVIDER_FULFILLMENT', req.params.providerId, String(updated._id));
    res.json({ delegation: { providerId: req.params.providerId, status: updated.status } });
  });

  app.post('/api/seller/providers/fulfillment-delegations/:providerId/revoke', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!requireVerifiedLogisticsSeller(user)) return res.status(403).json({ error: 'VERIFIED_SELLER_REQUIRED' });
    const filter: any = { providerId: req.params.providerId, status: 'ACTIVE' };
    if (user!.role !== 'ADMIN') filter.sellerId = user!._id;
    const updated = await ProviderFulfillmentDelegationModel.findOneAndUpdate(filter, { $set: { status: 'REVOKED', revokedAt: new Date() } }, { returnDocument: 'after' }).lean();
    if (!updated) return res.status(404).json({ error: 'ACTIVE_FULFILLMENT_DELEGATION_NOT_FOUND' });
    await providerAudit(user!, 'SELLER_REVOKED_PROVIDER_FULFILLMENT', req.params.providerId, String(updated._id));
    res.json({ delegation: { providerId: req.params.providerId, status: updated.status, revokedAt: updated.revokedAt } });
  });

  app.post('/api/provider/shipments/rates', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'PROVIDER') return res.status(403).json({ error: 'PROVIDER_ACCESS_REQUIRED' });
    const parsed = z.object({ orderId: z.string().min(1), carrierConfigId: z.string().uuid(), warehouseId: z.string().uuid(), weightGrams: z.coerce.number().int().min(1).max(100000) }).strict().safeParse(req.body);
    if (!parsed.success || !mongoose.isValidObjectId(parsed.data.orderId)) return res.status(400).json({ error: 'INVALID_PROVIDER_RATE_REQUEST' });
    try {
      const order = await OrderModel.findById(parsed.data.orderId).lean() as any;
      const linkedProfile = await ProviderProfileModel.findOne({ userId: user._id }).select('linkedSellerIds').lean();
      if (!order || !(linkedProfile?.linkedSellerIds || []).includes(String(order.sellerId))) return res.status(404).json({ error: 'LINKED_SELLER_ORDER_NOT_FOUND' });
      if (!order || !['Packed'].includes(order.status) || (!['COD', 'SELLER_COLLECT', 'POS_ON_DELIVERY'].includes(order.paymentMode) && order.paymentStatus !== 'PAID')) return res.status(409).json({ error: 'ORDER_NOT_READY_FOR_PROVIDER_SHIPMENT' });
      const products = await ProductModel.find({ _id: { $in: order.items.map((item: any) => item.productId) }, providerId: user._id }).select('_id').lean();
      if (!order.items.length || products.length !== order.items.length) return res.status(403).json({ error: 'ORDER_NOT_EXCLUSIVELY_FULFILLED_BY_PROVIDER' });
      const delegation = await ProviderFulfillmentDelegationModel.findOne({ sellerId: String(order.sellerId), providerId: user._id, status: 'ACTIVE', $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }).lean();
      if (!delegation) return res.status(403).json({ error: 'SELLER_FULFILLMENT_AUTHORIZATION_REQUIRED' });
      const config = await getProviderCarrierSecret(parsed.data.carrierConfigId, user._id);
      const carrierCode = String(config.logistics_providers.code).toLowerCase();
      if (!(delegation.allowedCarrierCodes || []).includes(carrierCode)) return res.status(403).json({ error: 'CARRIER_NOT_APPROVED_BY_SELLER' });
      if (!(delegation.allowedDisclosureFields || []).includes('recipientAddress')) return res.status(403).json({ error: 'SELLER_ADDRESS_DISCLOSURE_NOT_APPROVED' });
      const privacy = await SellerPrivacySettingsModel.findOne({ sellerId: String(order.sellerId) }).lean();
      if (!privacy?.carrierDisclosure?.recipientAddress) return res.status(403).json({ error: 'SELLER_ADDRESS_DISCLOSURE_REVOKED' });
      const quotes = await getProviderRateQuotes({ providerUserId: user._id, carrierConfigId: parsed.data.carrierConfigId, warehouseId: parsed.data.warehouseId, destinationPostalCode: String(order.shippingAddress?.pincode || ''), weightGrams: parsed.data.weightGrams, codAmountMinor: order.paymentMode === 'COD' ? Math.round(Number(order.totalAmount || 0) * 100) : 0, declaredValueMinor: Math.round(Number(order.totalAmount || 0) * 100), currency: 'INR' });
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ quotes: quotes.map((row: any) => ({ providerCode: row.providerCode, serviceCode: row.quote.serviceCode, amountMinor: row.quote.amountMinor, currency: row.quote.currency, estimatedTransitHours: row.quote.estimatedTransitHours, serviceable: row.quote.serviceable, codSupported: row.quote.codSupported, expiresAt: row.quote.expiresAt })) });
    } catch (error) { const e = error as any; res.status(e.statusCode || 503).json({ error: e.message || 'PROVIDER_RATE_LOOKUP_FAILED' }); }
  });

  app.post('/api/provider/shipments/book', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'PROVIDER') return res.status(403).json({ error: 'PROVIDER_ACCESS_REQUIRED' });
    const parsed = z.object({ orderId: z.string().min(1), carrierConfigId: z.string().uuid(), warehouseId: z.string().uuid(), weightGrams: z.coerce.number().int().min(1).max(100000), serviceCode: z.string().trim().min(1).max(120) }).strict().safeParse(req.body);
    if (!parsed.success || !mongoose.isValidObjectId(parsed.data.orderId)) return res.status(400).json({ error: 'INVALID_PROVIDER_SHIPMENT_BOOKING' });
    let auditId: string | null = null;
    try {
      const order = await OrderModel.findById(parsed.data.orderId).lean() as any;
      const linkedProfile = await ProviderProfileModel.findOne({ userId: user._id }).select('linkedSellerIds').lean();
      if (!order || !(linkedProfile?.linkedSellerIds || []).includes(String(order.sellerId))) return res.status(404).json({ error: 'LINKED_SELLER_ORDER_NOT_FOUND' });
      if (!order || order.status !== 'Packed') return res.status(409).json({ error: 'ORDER_MUST_BE_PACKED_BEFORE_SHIPMENT' });
      if (!['COD', 'SELLER_COLLECT', 'POS_ON_DELIVERY'].includes(order.paymentMode) && order.paymentStatus !== 'PAID') return res.status(409).json({ error: 'PAYMENT_MUST_BE_CONFIRMED_BEFORE_SHIPMENT' });
      const providerProducts = await ProductModel.find({ _id: { $in: order.items.map((item: any) => item.productId) }, providerId: user._id }).select('_id').lean();
      if (!order.items.length || providerProducts.length !== order.items.length) return res.status(403).json({ error: 'ORDER_NOT_EXCLUSIVELY_FULFILLED_BY_PROVIDER' });
      const delegation = await ProviderFulfillmentDelegationModel.findOne({ sellerId: String(order.sellerId), providerId: user._id, status: 'ACTIVE', $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }).lean() as any;
      if (!delegation) return res.status(403).json({ error: 'SELLER_FULFILLMENT_AUTHORIZATION_REQUIRED' });
      const config = await getProviderCarrierSecret(parsed.data.carrierConfigId, user._id);
      const carrierCode = String(config.logistics_providers.code).toLowerCase();
      if (!(delegation.allowedCarrierCodes || []).includes(carrierCode)) return res.status(403).json({ error: 'CARRIER_NOT_APPROVED_BY_SELLER' });
      const buyer = await findUserById(String(order.buyerId));
      const privacy = await SellerPrivacySettingsModel.findOne({ sellerId: String(order.sellerId) }).lean();
      const authorization = authorizeCarrierDisclosure(privacy?.carrierDisclosure, carrierCode, buyer?.email);
      if (!authorization.allowed) return res.status(403).json({ error: 'SELLER_CUSTOMER_DATA_DISCLOSURE_NOT_AUTHORIZED', requiredFields: authorization.missing });
      const fields = authorization.fields.filter((field: string) => (delegation.allowedDisclosureFields || []).includes(field));
      if (!fields.includes('recipientName') || !fields.includes('recipientPhone') || !fields.includes('recipientAddress')) return res.status(403).json({ error: 'DELEGATION_DOES_NOT_ALLOW_REQUIRED_DELIVERY_FIELDS' });
      if (carrierCode === 'shiprocket' && !fields.includes('recipientEmail')) return res.status(403).json({ error: 'SHIPROCKET_EMAIL_DISCLOSURE_NOT_APPROVED' });
      const address = order.shippingAddress || {};
      const pin = String(address.pincode || '').trim();
      if (!pin || !address.street || !address.city || !address.state || !address.fullName || !address.phone) return res.status(422).json({ error: 'ORDER_SHIPPING_ADDRESS_INCOMPLETE' });
      const quoteRows = await getProviderRateQuotes({ providerUserId: user._id, carrierConfigId: parsed.data.carrierConfigId, warehouseId: parsed.data.warehouseId, destinationPostalCode: pin, weightGrams: parsed.data.weightGrams, codAmountMinor: order.paymentMode === 'COD' ? Math.round(Number(order.totalAmount || 0) * 100) : 0, declaredValueMinor: Math.round(Number(order.totalAmount || 0) * 100), currency: 'INR' });
      const chosen = quoteRows.find((row: any) => row.quote.serviceCode === parsed.data.serviceCode && row.quote.serviceable && Date.parse(row.quote.expiresAt) > Date.now());
      if (!chosen) return res.status(409).json({ error: 'SELECTED_CARRIER_SERVICE_QUOTE_EXPIRED_OR_UNAVAILABLE' });
      if (order.paymentMode === 'COD' && !chosen.quote.codSupported) return res.status(409).json({ error: 'CARRIER_SERVICE_DOES_NOT_SUPPORT_COD' });
      if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: 'PRIVACY_POLICY_STORE_UNAVAILABLE' });
      const audit = await PrivacyDisclosureAuditModel.create({ sellerId: String(order.sellerId), orderId: String(order._id), carrierConfigId: parsed.data.carrierConfigId, carrierCode, fieldsAuthorized: fields, actorId: user._id, authorizedAt: new Date(), dispatchStatus: 'AUTHORIZED', purpose: 'SHIPMENT_FULFILLMENT' });
      auditId = String(audit._id);
      const result = await createProviderShipmentIntent({
        orderId: String(order._id), sellerId: String(order.sellerId), providerUserId: user._id,
        providerCarrierConfigId: parsed.data.carrierConfigId, carrierCode, providerWarehouseId: parsed.data.warehouseId,
        weightGrams: parsed.data.weightGrams, serviceCode: parsed.data.serviceCode, destinationPostalCode: pin, destinationCountryCode: 'IN',
        codAmountMinor: order.paymentMode === 'COD' ? Math.round(Number(order.totalAmount || 0) * 100) : 0,
        declaredValueMinor: Math.round(Number(order.totalAmount || 0) * 100), currency: 'INR',
        recipientName: fields.includes('recipientName') ? String(address.fullName) : '',
        recipientPhone: fields.includes('recipientPhone') ? String(address.phone) : '',
        recipientEmail: fields.includes('recipientEmail') ? String(buyer?.email || '') : '',
        disclosureAuthorizedAt: new Date().toISOString(), disclosureFields: fields, disclosureAuditId: auditId,
        destinationAddressLine1: fields.includes('recipientAddress') ? String(address.street) : '',
        destinationCity: fields.includes('recipientAddress') ? String(address.city) : '',
        destinationState: fields.includes('recipientAddress') ? String(address.state) : '',
        orderDate: new Date(order.createdAt || Date.now()).toISOString(),
        items: (order.items || []).map((item: any) => ({ name: String(item.title), sku: String(item.variantSku || item.productId), quantity: Number(item.quantity), unitPrice: Number(item.unitPrice) })),
      });
      await PrivacyDisclosureAuditModel.updateOne({ _id: audit._id }, { $set: result.duplicate ? { jobId: result.jobId || null, dispatchStatus: 'NOT_DISPATCHED', dispatchErrorCode: 'DUPLICATE_SHIPMENT_NO_NEW_DISCLOSURE' } : { jobId: result.jobId || null } });
      await providerAudit(user, 'PROVIDER_SHIPMENT_BOOKING_QUEUED', user._id, String(order._id), { carrierCode, serviceCode: parsed.data.serviceCode });
      res.status(result.duplicate ? 200 : 202).json({ ...result, status: result.duplicate ? 'ALREADY_QUEUED_OR_BOOKED' : 'QUEUED' });
    } catch (error) {
      if (auditId) await PrivacyDisclosureAuditModel.updateOne({ _id: auditId, dispatchStatus: 'AUTHORIZED' }, { $set: { dispatchStatus: 'FAILED', dispatchErrorCode: 'SHIPMENT_QUEUE_FAILED' } }).catch(() => {});
      const e = error as any; res.status(e.statusCode || 503).json({ error: e.message || 'PROVIDER_SHIPMENT_BOOKING_FAILED' });
    }
  });

  app.post('/api/provider/shipments/:id/refresh-tracking', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'PROVIDER') return res.status(403).json({ error: 'PROVIDER_ACCESS_REQUIRED' });
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: 'INVALID_SHIPMENT_ID' });
    try {
      const rows = await listProviderShipments(user._id) as any[];
      const shipment = rows.find(row => String(row.id) === req.params.id);
      if (!shipment) return res.status(404).json({ error: 'PROVIDER_SHIPMENT_NOT_FOUND' });
      const order = await OrderModel.findById(String(shipment.order_id)).select('sellerId').lean() as any;
      const delegation = order ? await ProviderFulfillmentDelegationModel.findOne({ sellerId: String(order.sellerId), providerId: user._id, status: 'ACTIVE', $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }).lean() : null;
      if (!delegation) return res.status(403).json({ error: 'SELLER_FULFILLMENT_AUTHORIZATION_REQUIRED' });
      const tracking = await refreshTrackingViaShippingService(String(shipment.order_id)) as any;
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ tracking: tracking ? { statusCode: tracking.statusCode, eta: tracking.eta, latestCheckpoint: tracking.latestCheckpoint ? { statusCode: tracking.latestCheckpoint.status_code, location: tracking.latestCheckpoint.location_code, occurredAt: tracking.latestCheckpoint.event_timestamp } : null } : null });
    } catch (error) { const e = error as any; res.status(e.statusCode || 503).json({ error: e.message || 'PROVIDER_TRACKING_REFRESH_FAILED' }); }
  });

  app.post('/api/provider/shipments/:id/retry', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'PROVIDER') return res.status(403).json({ error: 'PROVIDER_ACCESS_REQUIRED' });
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: 'INVALID_SHIPMENT_ID' });
    try {
      const rows = await listProviderShipments(user._id) as any[];
      const shipment = rows.find(row => String(row.id) === req.params.id);
      if (!shipment) return res.status(404).json({ error: 'PROVIDER_SHIPMENT_NOT_FOUND' });
      const order = await OrderModel.findById(String(shipment.order_id)).select('sellerId').lean() as any;
      const delegation = order ? await ProviderFulfillmentDelegationModel.findOne({ sellerId: String(order.sellerId), providerId: user._id, status: 'ACTIVE', $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }).lean() : null;
      if (!delegation) return res.status(403).json({ error: 'SELLER_FULFILLMENT_AUTHORIZATION_REQUIRED' });
      const jobId = await retryProviderShipment(user._id, req.params.id);
      res.status(202).json({ jobId, status: 'QUEUED' });
    } catch (error) { const e = error as any; res.status(e.statusCode || 409).json({ error: e.message || 'PROVIDER_SHIPMENT_NOT_RETRYABLE' }); }
  });

  app.get('/api/provider/shipments', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'PROVIDER') return res.status(403).json({ error: 'PROVIDER_ACCESS_REQUIRED' });
    const profile = await ProviderProfileModel.findOne({ userId: user._id }).select('linkedSellerIds').lean();
    if (!profile) return res.status(404).json({ error: 'PROVIDER_PROFILE_NOT_FOUND' });
    const activeDelegations = await ProviderFulfillmentDelegationModel.find({ providerId: user._id, status: 'ACTIVE', $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }).select('sellerId').lean();
    const activeSellerIds = activeDelegations.map((row: any) => row.sellerId);
    const providerProducts = await ProductModel.find({ providerId: user._id }).select('_id title').lean();
    const productIds = providerProducts.map((product: any) => String(product._id));
    if (!productIds.length || !activeSellerIds.length) return res.json({ shipments: [], total: 0, page: 1, limit: 10, totalPages: 0 });
    const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(50, Math.max(5, Number.parseInt(String(req.query.limit || '10'), 10) || 10));
    const query = String(req.query.q || '').trim().slice(0, 100);
    const status = String(req.query.status || '').trim();
    const filter: Record<string, any> = {
      sellerId: { $in: activeSellerIds },
      'items.productId': { $in: productIds },
      status: { $in: ['Packed', 'Shipped', 'Out for Delivery', 'Delivered'] },
    };
    if (status && status !== 'ALL') filter.status = status;
    if (query) {
      const escapedQuery = escapeRegex(query);
      filter.$or = [{ orderNumber: { $regex: escapedQuery, $options: 'i' } }, { _id: { $regex: escapedQuery, $options: 'i' } }];
    }
    const [total, orders] = await Promise.all([
      OrderModel.countDocuments(filter),
      OrderModel.find(filter).select('_id orderNumber sellerId items status courierTracking createdAt updatedAt paymentMode paymentStatus').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);
    let logisticsRows: any[] = [];
    try { logisticsRows = await listProviderShipments(user._id) as any[]; }
    catch (error) { console.warn('Provider app-shipment metadata unavailable; manual fallback remains visible:', (error as Error).message); }
    const owned = new Set(productIds);
    const logisticsByOrder = new Map((logisticsRows as any[]).map(row => [String(row.order_id), row]));
    const shipments = orders.map((order: any) => {
      const logistics = logisticsByOrder.get(String(order._id)) as any;
      return {
        id: String(order._id),
        orderNumber: String(order.orderNumber || order._id),
        status: order.status,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        paymentMode: order.paymentMode,
        paymentStatus: order.paymentStatus,
        items: (order.items || []).filter((item: any) => owned.has(String(item.productId))).map((item: any) => ({
          productId: String(item.productId), title: String(item.title), quantity: Number(item.quantity),
        })),
        courierTracking: order.courierTracking || null,
        appShipment: logistics ? {
          shipmentId: logistics.id, bookingStatus: logistics.booking_status, awbNumber: logistics.awb_number,
          labelUrl: logistics.label_url, manifestUrl: logistics.manifest_url, pickupScheduled: logistics.pickup_scheduled,
          statusCode: logistics.normalized_status, estimatedDeliveryAt: logistics.estimated_delivery_at,
          carrierName: logistics.provider_carrier_configs?.logistics_providers?.name || '',
          trackingEvents: (logistics.tracking_events || []).map((event: any) => ({ statusCode: event.status_code, location: event.location_code, occurredAt: event.event_timestamp })),
        } : null,
        manualDispatchAllowed: (order.items || []).length > 0 && (order.items || []).every((item: any) => owned.has(String(item.productId))) && order.status === 'Packed' && (['COD', 'SELLER_COLLECT', 'POS_ON_DELIVERY'].includes(order.paymentMode) || order.paymentStatus === 'PAID') && (!logistics || (logistics.booking_status === 'FAILED' && !logistics.awb_number)),
      };
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ shipments, total, page, limit, totalPages: Math.ceil(total / limit) });
  });

  app.post('/api/provider/shipments/manual', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'PROVIDER') return res.status(403).json({ error: 'PROVIDER_ACCESS_REQUIRED' });
    const parsed = z.object({
      orderId: z.string().min(1).max(100),
      carrierName: z.string().trim().min(2).max(100),
      trackingId: z.string().trim().min(3).max(120),
      trackingUrl: z.string().url().max(2048).optional().or(z.literal('')),
    }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_MANUAL_SHIPMENT_DETAILS' });
    if (!mongoose.isValidObjectId(parsed.data.orderId)) return res.status(400).json({ error: 'INVALID_ORDER_ID' });
    const profile = await ProviderProfileModel.findOne({ userId: user._id }).select('linkedSellerIds').lean();
    if (!profile) return res.status(404).json({ error: 'PROVIDER_PROFILE_NOT_FOUND' });
    const order = await OrderModel.findById(parsed.data.orderId);
    if (order) {
      const activeAppShipment = process.env.LOGISTICS_SUPABASE_URL && process.env.LOGISTICS_SUPABASE_SERVICE_ROLE_KEY
        ? (await listProviderShipments(user._id) as any[]).find(row => String(row.order_id) === String(order._id))
        : null;
      if (activeAppShipment && (activeAppShipment.booking_status !== 'FAILED' || activeAppShipment.awb_number)) return res.status(409).json({ error: 'APP_SHIPMENT_ALREADY_ACTIVE_OR_BOOKED' });
    }
    if (order) {
      const delegation = await ProviderFulfillmentDelegationModel.findOne({ sellerId: String(order.sellerId), providerId: user._id, status: 'ACTIVE', $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }).lean();
      if (!delegation) return res.status(403).json({ error: 'SELLER_FULFILLMENT_AUTHORIZATION_REQUIRED' });
    }
    if (!order) return res.status(404).json({ error: 'ORDER_NOT_FOUND' });
    if (!(profile.linkedSellerIds || []).some((sellerId: any) => String(sellerId) === String(order.sellerId))) return res.status(403).json({ error: 'ORDER_NOT_LINKED_TO_PROVIDER_SELLER' });
    const orderProductIds = [...new Set((order.items || []).map((item: any) => String(item.productId)))];
    const providerProducts = await ProductModel.find({ _id: { $in: orderProductIds }, providerId: user._id }).select('_id').lean();
    if (!orderProductIds.length || providerProducts.length !== orderProductIds.length) return res.status(403).json({ error: 'ORDER_CONTAINS_PRODUCTS_OUTSIDE_PROVIDER_FULFILMENT_SCOPE' });
    if (order.status !== 'Packed') return res.status(409).json({ error: 'ORDER_MUST_BE_PACKED_BEFORE_PROVIDER_DISPATCH' });
    if (!['COD', 'SELLER_COLLECT', 'POS_ON_DELIVERY'].includes(order.paymentMode) && order.paymentStatus !== 'PAID') return res.status(409).json({ error: 'PAYMENT_MUST_BE_CONFIRMED_BEFORE_SHIPMENT' });
    const shippedAt = new Date();
    const updated = await OrderModel.findOneAndUpdate(
      { _id: order._id, sellerId: order.sellerId, status: 'Packed' },
      {
        $set: { status: 'Shipped', courierTracking: { companyName: parsed.data.carrierName, trackingId: parsed.data.trackingId, trackingUrl: parsed.data.trackingUrl || '', shippedAt: shippedAt.toISOString() } },
        $push: { statusTimeline: { status: 'Shipped', note: 'Shipment dispatched by provider', timestamp: shippedAt.toISOString() } },
      },
      { returnDocument: 'after', runValidators: true },
    ).lean();
    if (!updated) return res.status(409).json({ error: 'ORDER_STATUS_CHANGED_RELOAD_SHIPMENT_QUEUE' });
    await providerAudit(user, 'PROVIDER_MANUAL_SHIPMENT_RECORDED', user._id, String(order._id), { carrierName: parsed.data.carrierName, trackingId: parsed.data.trackingId });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ shipment: { orderId: String(updated._id), orderNumber: updated.orderNumber, status: updated.status, courierTracking: updated.courierTracking } });
  });

  app.get('/api/provider/settlements', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'PROVIDER') return res.status(403).json({ error: 'PROVIDER_ACCESS_REQUIRED' });
    await ProviderSettlementModel.updateMany({ providerId: user._id, status: 'PENDING_CLEARANCE', availableAt: { $lte: new Date() } }, { $set: { status: 'READY_FOR_SETTLEMENT' } });
    const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(5, Number.parseInt(String(req.query.limit || '20'), 10) || 20));
    const query = String(req.query.q || '').trim().slice(0, 120);
    const status = String(req.query.status || '').trim();
    const sortKey = String(req.query.sort || 'createdAt');
    const sortField = ({ amount: 'amountPaise', status: 'status', createdAt: 'createdAt', orderId: 'orderId', quantity: 'quantity' } as Record<string, string>)[sortKey] || 'createdAt';
    const direction = String(req.query.direction || 'desc') === 'asc' ? 1 : -1;
    const filter: Record<string, any> = { providerId: user._id };
    if (query) {
      const escapedQuery = escapeRegex(query);
      filter.$or = [{ orderId: { $regex: escapedQuery, $options: 'i' } }, { utrReference: { $regex: escapedQuery, $options: 'i' } }, { status: { $regex: escapedQuery, $options: 'i' } }];
    }
    if (status && status !== 'ALL') filter.status = status;
    const [total, settlements] = await Promise.all([
      ProviderSettlementModel.countDocuments(filter),
      ProviderSettlementModel.find(filter).sort({ [sortField]: direction, _id: -1 }).skip((page - 1) * limit).limit(limit).select('-encryptedReceipt').lean(),
    ]);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ settlements: settlements.map(toProviderSafeSettlementDto), total, page, limit, totalPages: Math.ceil(total / limit) });
  });

  app.get('/api/seller/provider-settlements', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['SELLER', 'ADMIN'].includes(user.role) || (user.role === 'SELLER' && !user.isWhatsappVerified)) return res.status(403).json({ error: 'VERIFIED_SELLER_REQUIRED' });
    await ProviderSettlementModel.updateMany({ ...(user.role === 'ADMIN' ? {} : { sellerId: user._id }), status: 'PENDING_CLEARANCE', availableAt: { $lte: new Date() } }, { $set: { status: 'READY_FOR_SETTLEMENT' } });
    const settlements = await ProviderSettlementModel.find(user.role === 'ADMIN' ? {} : { sellerId: user._id }).sort({ createdAt: -1 }).limit(500).select('-encryptedReceipt').lean();
    res.json({ settlements });
  });

  app.post('/api/seller/provider-settlements/settle', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['SELLER', 'ADMIN'].includes(user.role) || (user.role === 'SELLER' && !user.isWhatsappVerified)) return res.status(403).json({ error: 'VERIFIED_SELLER_REQUIRED' });
    const parsed = z.object({ settlementIds: z.array(z.string().min(1)).min(1).max(100), utrReference: z.string().trim().min(4).max(120) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_SETTLEMENT_BATCH' });
    const filter = { _id: { $in: parsed.data.settlementIds }, status: 'READY_FOR_SETTLEMENT', ...(user.role === 'ADMIN' ? {} : { sellerId: user._id }) };
    const settledAt = new Date();
    const session = await mongoose.startSession();
    const settledRecords: any[] = [];
    try {
      await session.withTransaction(async () => {
        settledRecords.length = 0;
        const records = await ProviderSettlementModel.find(filter).session(session);
        if (records.length !== parsed.data.settlementIds.length) throw new Error('ONE_OR_MORE_SETTLEMENTS_NOT_PAYABLE');
        for (const record of records) {
          const receipt = JSON.stringify({
            settlementId: String(record._id), orderId: record.orderId, sellerId: record.sellerId,
            providerId: record.providerId, amountPaise: record.amountPaise,
            utrReference: parsed.data.utrReference, settledAt: settledAt.toISOString(),
          });
          const updated = await ProviderSettlementModel.updateOne(
            { _id: record._id, status: 'READY_FOR_SETTLEMENT', ...(user.role === 'ADMIN' ? {} : { sellerId: user._id }) },
            { $set: {
              status: 'SETTLED', utrReference: parsed.data.utrReference, settledAt,
              encryptedReceipt: encryptField(receipt),
            } },
            { session }
          );
          if (updated.modifiedCount !== 1) throw new Error('ONE_OR_MORE_SETTLEMENTS_NOT_PAYABLE');
          settledRecords.push({ ...record.toObject(), status: 'SETTLED' });
        }
      });
    } catch (err) {
      const code = (err as Error).message;
      return res.status(code === 'ONE_OR_MORE_SETTLEMENTS_NOT_PAYABLE' ? 409 : 503).json({ error: code, retryable: code !== 'ONE_OR_MORE_SETTLEMENTS_NOT_PAYABLE' });
    } finally {
      await session.endSession();
    }
    for (const record of settledRecords) {
      try {
        await providerAudit(user, 'PROVIDER_SETTLEMENT_MARKED_SETTLED', record.providerId, String(record._id), { amountPaise: record.amountPaise });
      } catch (error) {
        console.warn('Settlement committed but audit event could not be written:', (error as Error).message);
      }
    }
    res.json({ settledCount: settledRecords.length, utrReference: parsed.data.utrReference });
  });

  app.get('/api/seller/provider-settlements/:id/receipt', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['SELLER', 'ADMIN'].includes(user.role)) return res.status(403).json({ error: 'SELLER_ACCESS_REQUIRED' });
    const record = await ProviderSettlementModel.findOne({ _id: req.params.id, ...(user.role === 'ADMIN' ? {} : { sellerId: user._id }) }).select('+encryptedReceipt').lean();
    if (!record || record.status !== 'SETTLED' || !record.encryptedReceipt) return res.status(404).json({ error: 'SETTLEMENT_RECEIPT_NOT_FOUND' });
    const { decryptField } = await import('./src/server/services/fieldEncryption.js');
    res.json({ receipt: JSON.parse(decryptField(record.encryptedReceipt)) });
  });

  app.get('/api/provider/settlements/:id/receipt', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'PROVIDER') return res.status(403).json({ error: 'PROVIDER_ACCESS_REQUIRED' });
    const record = await ProviderSettlementModel.findOne({ _id: req.params.id, providerId: user._id }).select('+encryptedReceipt').lean();
    if (!record || record.status !== 'SETTLED' || !record.encryptedReceipt) return res.status(404).json({ error: 'SETTLEMENT_RECEIPT_NOT_FOUND' });
    const { decryptField } = await import('./src/server/services/fieldEncryption.js');
    const receipt = JSON.parse(decryptField(record.encryptedReceipt));
    res.json({ receipt });
  });

  app.get('/api/seller/payment-settings', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['SELLER', 'ADMIN'].includes(user.role) || (user.role === 'SELLER' && !user.isWhatsappVerified)) return res.status(403).json({ error: 'SELLER_ACCESS_REQUIRED' });
    const settings = await listGatewayConfigurations(user._id);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ gateways: settings });
  });
  app.get('/api/seller/notification-settings', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['SELLER', 'ADMIN'].includes(user.role) || (user.role === 'SELLER' && !user.isWhatsappVerified)) return res.status(403).json({ error: 'SELLER_ACCESS_REQUIRED' });
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      notificationNumber: user.orderNotificationWhatsAppNumber || '',
      fallbackNumber: user.whatsappNumber || user.mobileNumber || '',
    });
  });
  app.put('/api/seller/notification-settings', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['SELLER', 'ADMIN'].includes(user.role) || (user.role === 'SELLER' && !user.isWhatsappVerified)) return res.status(403).json({ error: 'SELLER_ACCESS_REQUIRED' });
    const parsed = z.object({
      notificationNumber: z.string().trim().max(24).refine(
        (phone) => !phone || isValidE164(phone),
        'Enter a valid WhatsApp number in E.164 format (e.g. +919876543210)',
      ),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'INVALID_NOTIFICATION_NUMBER' });
    const updated = await updateSellerOrderNotificationNumber(user._id, parsed.data.notificationNumber);
    if (!updated) return res.status(404).json({ error: 'USER_NOT_FOUND' });
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      notificationNumber: updated.orderNotificationWhatsAppNumber || '',
      fallbackNumber: updated.whatsappNumber || updated.mobileNumber || '',
    });
  });
  app.put('/api/seller/payment-settings/:provider', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['SELLER', 'ADMIN'].includes(user.role) || (user.role === 'SELLER' && !user.isWhatsappVerified)) return res.status(403).json({ error: 'SELLER_ACCESS_REQUIRED' });
    const provider = z.enum(['razorpay', 'stripe']).safeParse(req.params.provider);
    if (!provider.success) return res.status(400).json({ error: 'UNSUPPORTED_PAYMENT_PROVIDER' });
    const parsed = z.object({
      keyId: z.string().trim().min(4).max(160),
      secret: z.string().max(500).optional().default(''),
      webhookSecret: z.string().max(500).optional().default(''),
      enabled: z.boolean(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'INVALID_GATEWAY_CONFIGURATION' });
    try {
      const gateway = await saveGatewayConfiguration({ sellerId: user._id, provider: provider.data, ...parsed.data });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ gateway });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Buyer wallet is backed by an immutable, idempotent ledger.
  app.get('/api/wallet', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'BUYER') return res.status(403).json({ error: 'BUYER_ACCESS_REQUIRED' });
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getWalletSummary(user._id));
  });
  app.post('/api/wallet/redeem', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'BUYER') return res.status(403).json({ error: 'BUYER_ACCESS_REQUIRED' });
    const parsed = z.object({ orderId: z.string().min(1), amountPaise: z.number().int().positive().max(100000000), idempotencyKey: z.string().min(12).max(120) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_WALLET_REDEMPTION' });
    const order = await OrderModel.findOne({ _id: parsed.data.orderId, buyerId: user._id }).lean();
    if (!order) return res.status(404).json({ error: 'ORDER_NOT_FOUND' });
    if (order.status !== 'CONFIRMED_AWAITING_PAYMENT') return res.status(409).json({ error: 'ORDER_NOT_READY_FOR_WALLET_REDEMPTION' });
    const currentApplied = Number(order.walletAppliedPaise || 0);
    const remaining = Math.max(0, Math.round(Number(order.totalAmount) * 100) - currentApplied);
    if (parsed.data.amountPaise > remaining) return res.status(400).json({ error: 'WALLET_REDEMPTION_EXCEEDS_ORDER_BALANCE' });
    try {
      const transaction = await applyWalletTransaction({
        userId: user._id, idempotencyKey: parsed.data.idempotencyKey,
        type: 'DEBIT_ORDER_REDEMPTION', amountPaise: parsed.data.amountPaise,
        orderId: parsed.data.orderId,
      });
      const newApplied = transaction.replayed ? currentApplied : currentApplied + parsed.data.amountPaise;
      const fullyPaid = newApplied >= Math.round(Number(order.totalAmount) * 100);
      const update = await OrderModel.updateOne(
        { _id: order._id, buyerId: user._id, walletAppliedPaise: currentApplied, status: 'CONFIRMED_AWAITING_PAYMENT' },
        { $set: { walletAppliedPaise: newApplied, paymentMode: fullyPaid ? 'WALLET' : 'MIXED', paymentStatus: fullyPaid ? 'PAID' : 'PENDING', ...(fullyPaid ? { status: 'PAID_AND_PROCESSING' } : {}) } }
      );
      if (!transaction.replayed && !update.modifiedCount) {
        await applyWalletTransaction({ userId: user._id, idempotencyKey: 'compensate:' + parsed.data.idempotencyKey, type: 'CREDIT_REFUND', amountPaise: parsed.data.amountPaise, orderId: parsed.data.orderId, reference: 'Compensation for failed order wallet update' });
        return res.status(409).json({ error: 'ORDER_CHANGED_WALLET_DEBIT_REVERSED' });
      }
      res.json({ transaction, fullyPaid });
    } catch (err) {
      res.status((err as Error).message === 'INSUFFICIENT_WALLET_BALANCE' ? 409 : 400).json({ error: (err as Error).message });
    }
  });


  // Buyer payment intent is created only after the seller has confirmed availability.
  app.post('/api/orders/:id/payment-intent', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'BUYER') return res.status(403).json({ error: 'BUYER_ACCESS_REQUIRED' });
    const paymentRate = await checkRateLimit('order-payment:' + user._id, 10, 60);
    if (!paymentRate.allowed) return res.status(429).json({ error: 'PAYMENT_RATE_LIMITED' });
    const order = await OrderModel.findOne({ _id: req.params.id, buyerId: user._id });
    if (!order) return res.status(404).json({ error: 'ORDER_NOT_FOUND' });
    if (order.status !== 'CONFIRMED_AWAITING_PAYMENT' || order.paymentStatus === 'PAID') return res.status(409).json({ error: 'ORDER_NOT_READY_FOR_PAYMENT' });
    const parsed = z.object({ provider: z.enum(['razorpay', 'stripe']) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PAYMENT_PROVIDER' });
    if (order.paymentStatus === 'PENDING' && order.paymentReference) {
      if (order.paymentProvider !== parsed.data.provider) return res.status(409).json({ error: 'PAYMENT_ATTEMPT_ALREADY_OPEN', provider: order.paymentProvider });
      const existingGateway = parsed.data.provider === 'razorpay' ? await getGatewaySecrets(String(order.sellerId), 'razorpay') : null;
      return res.json({ checkout: {
        provider: parsed.data.provider,
        reference: order.paymentReference,
        amountPaise: Math.max(0, Math.round(Number(order.totalAmount) * 100) - Number(order.walletAppliedPaise || 0)),
        currency: 'INR',
        ...(existingGateway ? { keyId: existingGateway.keyId } : {}),
        ...(order.paymentCheckoutUrl ? { url: order.paymentCheckoutUrl } : {}),
      }});
    }
    const attemptKey = crypto.randomUUID();
    const now = new Date();
    const claimedOrder = await OrderModel.findOneAndUpdate(
      {
        _id: order._id, buyerId: user._id, status: 'CONFIRMED_AWAITING_PAYMENT',
        paymentStatus: { $ne: 'PAID' }, paymentReference: { $in: [null, ''] },
        $or: [{ paymentIntentLeaseUntil: null }, { paymentIntentLeaseUntil: { $lte: now } }],
      },
      { $set: { paymentIntentRequestKey: attemptKey, paymentIntentLeaseUntil: new Date(now.getTime() + 60_000) } },
      { returnDocument: 'after' }
    );
    if (!claimedOrder) {
      const latest = await OrderModel.findOne({ _id: order._id, buyerId: user._id }).lean();
      if (latest?.paymentReference && latest.paymentProvider === parsed.data.provider) {
        const existingGateway = parsed.data.provider === 'razorpay' ? await getGatewaySecrets(String(order.sellerId), 'razorpay') : null;
        return res.json({ checkout: {
          provider: parsed.data.provider, reference: latest.paymentReference,
          amountPaise: Math.max(0, Math.round(Number(latest.totalAmount) * 100) - Number(latest.walletAppliedPaise || 0)),
          currency: 'INR', ...(existingGateway ? { keyId: existingGateway.keyId } : {}),
          ...(latest.paymentCheckoutUrl ? { url: latest.paymentCheckoutUrl } : {}),
        }});
      }
      return res.status(409).json({ error: 'PAYMENT_INTENT_IN_PROGRESS', retryable: true });
    }
    try {
      const checkout = await createCheckoutViaPaymentService({
        sellerId: String(claimedOrder.sellerId), provider: parsed.data.provider,
        orderId: String(claimedOrder._id), orderNumber: claimedOrder.orderNumber,
        amountPaise: Math.max(0, Math.round(Number(claimedOrder.totalAmount) * 100) - Number(claimedOrder.walletAppliedPaise || 0)),
        idempotencyKey: `checkout:${String(claimedOrder._id)}:${parsed.data.provider}`,
      });
      const persisted = await OrderModel.findOneAndUpdate(
        { _id: claimedOrder._id, buyerId: user._id, paymentIntentRequestKey: attemptKey, paymentReference: { $in: [null, ''] } },
        {
          $set: {
            paymentProvider: checkout.provider, paymentReference: checkout.reference,
            paymentCheckoutUrl: checkout.url || null,
            paymentMode: checkout.provider === 'razorpay' ? 'RAZORPAY' : 'STRIPE',
            paymentStatus: 'PENDING',
          },
          $unset: { paymentIntentRequestKey: 1, paymentIntentLeaseUntil: 1 },
        },
        { returnDocument: 'after' }
      );
      if (!persisted) throw new Error('PAYMENT_INTENT_LEASE_LOST');
      res.setHeader('Cache-Control', 'no-store');
      res.json({ checkout });
    } catch (err) {
      // Keep the lease until expiry after an ambiguous provider error; this avoids
      // immediately creating a second external intent when the first response was lost.
      res.status(503).json({ error: (err as Error).message, retryable: true });
    }
  });

  app.post('/api/webhooks/razorpay/:sellerId', async (req, res) => {
    const rawBody = (req as any).rawBody as Buffer | undefined;
    const signature = String(req.headers['x-razorpay-signature'] || '');
    if (!rawBody || !await verifyWebhookViaPaymentService({ sellerId: req.params.sellerId, provider: 'razorpay', signature, rawBody })) {
      return res.status(400).json({ error: 'INVALID_WEBHOOK_SIGNATURE' });
    }
    const event = req.body as any;
    const payment = event.payload?.payment?.entity;
    const refundEntity = event.payload?.refund?.entity;
    const order = event.event === 'payment.captured'
      ? await OrderModel.findOne({ sellerId: req.params.sellerId, paymentReference: payment?.order_id })
      : event.event === 'refund.processed'
        ? await OrderModel.findOne({ sellerId: req.params.sellerId, paymentTransactionId: refundEntity?.payment_id })
        : null;
    if (!order) return res.json({ received: true, ignored: true });
    const eventId = String(event.id || payment?.id || refundEntity?.id || '');
    if (!eventId) return res.status(400).json({ error: 'WEBHOOK_EVENT_ID_REQUIRED' });
    const isCapture = event.event === 'payment.captured';
    const expectedAmount = Math.max(0, Math.round(Number(order.totalAmount) * 100) - Number(order.walletAppliedPaise || 0));
    if (isCapture && (!payment?.id || order.paymentProvider !== 'razorpay' || Number(payment.amount) !== expectedAmount || String(payment.currency).toUpperCase() !== 'INR')) {
      return res.status(400).json({ error: 'PAYMENT_AMOUNT_OR_CURRENCY_MISMATCH' });
    }
    const claimed = await claimPaymentEvent('razorpay', eventId, String(order._id), crypto.createHash('sha256').update(rawBody).digest('hex'));
    if (!claimed) {
      const state = await getPaymentEventState('razorpay', eventId);
      return state === 'PROCESSED'
        ? res.json({ received: true, duplicate: true })
        : res.status(503).json({ error: 'WEBHOOK_PROCESSING_RETRY', retryable: true });
    }
    if (isCapture) {
      if (order.paymentStatus !== 'PAID') {
        order.paymentTransactionId = String(payment.id);
        order.paymentStatus = 'PAID';
        order.status = 'PAID_AND_PROCESSING';
        order.statusTimeline.push({ status: order.status, note: 'Razorpay payment verified by signed webhook.', timestamp: new Date() });
      } else if (String(order.paymentTransactionId) !== String(payment.id)) {
        await releasePaymentEvent('razorpay', eventId, 'Payment order already captured by a different transaction.');
        return res.status(409).json({ error: 'PAYMENT_TRANSACTION_CONFLICT' });
      }
    } else if (event.event === 'refund.processed') {
      const hasReturnRefund = await ReturnRequestModel.exists({ orderId: String(order._id), status: 'REFUND_PENDING' });
      if (hasReturnRefund) {
        order.refundStatus = 'PARTIAL';
        await ReturnRequestModel.updateMany({ orderId: String(order._id), status: 'REFUND_PENDING' }, { $set: { status: 'REFUNDED' } });
      } else {
        order.paymentStatus = 'REFUNDED';
        order.refundStatus = 'REFUNDED';
      }
    }
    await order.save();
    await markPaymentEventProcessed('razorpay', eventId);
    res.json({ received: true });
  });

  app.post('/api/webhooks/stripe/:sellerId', async (req, res) => {
    const rawBody = (req as any).rawBody as Buffer | undefined;
    const signature = String(req.headers['stripe-signature'] || '');
    if (!rawBody || !await verifyWebhookViaPaymentService({ sellerId: req.params.sellerId, provider: 'stripe', signature, rawBody })) {
      return res.status(400).json({ error: 'INVALID_WEBHOOK_SIGNATURE' });
    }
    const event = req.body as any;
    const object = event.data?.object;
    const order = event.type === 'checkout.session.completed'
      ? await OrderModel.findOne({ _id: object?.metadata?.orderId, sellerId: req.params.sellerId, paymentReference: object?.id })
      : event.type === 'charge.refunded'
        ? await OrderModel.findOne({ sellerId: req.params.sellerId, paymentTransactionId: object?.payment_intent })
        : null;
    if (!order) return res.json({ received: true, ignored: true });
    const eventId = String(event.id || '');
    if (!eventId) return res.status(400).json({ error: 'WEBHOOK_EVENT_ID_REQUIRED' });
    const isCheckoutComplete = event.type === 'checkout.session.completed';
    const expectedAmount = Math.max(0, Math.round(Number(order.totalAmount) * 100) - Number(order.walletAppliedPaise || 0));
    if (isCheckoutComplete && (order.paymentProvider !== 'stripe' || Number(object?.amount_total) !== expectedAmount || String(object?.currency).toLowerCase() !== 'inr' || object?.payment_status !== 'paid' || !object?.payment_intent)) {
      return res.status(400).json({ error: 'PAYMENT_AMOUNT_OR_CURRENCY_MISMATCH' });
    }
    const claimed = await claimPaymentEvent('stripe', eventId, String(order._id), crypto.createHash('sha256').update(rawBody).digest('hex'));
    if (!claimed) {
      const state = await getPaymentEventState('stripe', eventId);
      return state === 'PROCESSED'
        ? res.json({ received: true, duplicate: true })
        : res.status(503).json({ error: 'WEBHOOK_PROCESSING_RETRY', retryable: true });
    }
    if (isCheckoutComplete) {
      if (order.paymentStatus !== 'PAID') {
        order.paymentTransactionId = String(object.payment_intent);
        order.paymentStatus = 'PAID';
        order.status = 'PAID_AND_PROCESSING';
        order.statusTimeline.push({ status: order.status, note: 'Stripe Checkout payment verified by signed webhook.', timestamp: new Date() });
      } else if (String(order.paymentTransactionId) !== String(object.payment_intent)) {
        await releasePaymentEvent('stripe', eventId, 'Payment order already captured by a different transaction.');
        return res.status(409).json({ error: 'PAYMENT_TRANSACTION_CONFLICT' });
      }
    } else if (event.type === 'charge.refunded') {
      const hasReturnRefund = await ReturnRequestModel.exists({ orderId: String(order._id), status: 'REFUND_PENDING' });
      if (hasReturnRefund) {
        order.refundStatus = 'PARTIAL';
        await ReturnRequestModel.updateMany({ orderId: String(order._id), status: 'REFUND_PENDING' }, { $set: { status: 'REFUNDED' } });
      } else {
        order.paymentStatus = 'REFUNDED';
        order.refundStatus = 'REFUNDED';
      }
    }
    await order.save();
    await markPaymentEventProcessed('stripe', eventId);
    res.json({ received: true });
  });

  // Buyer cancellation is a request once fulfilment has started; it never silently refunds.
  app.post('/api/orders/:id/cancellation-request', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'BUYER') return res.status(403).json({ error: 'BUYER_ACCESS_REQUIRED' });
    const order = await OrderModel.findOne({ _id: req.params.id, buyerId: user._id });
    if (!order) return res.status(404).json({ error: 'ORDER_NOT_FOUND' });
    if (!['Pending', 'Confirmed', 'Packed', 'Shipped', 'Out for Delivery', 'PENDING_SELLER_CONFIRMATION', 'CONFIRMED_AWAITING_PAYMENT', 'PAID_AND_PROCESSING'].includes(order.status)) {
      return res.status(409).json({ error: 'ORDER_NOT_CANCELLABLE' });
    }
    const previousStatus = order.status;
    order.cancellationPreviousStatus = previousStatus;
    order.status = (['Shipped', 'Out for Delivery'].includes(order.status) || order.paymentStatus === 'PAID') ? 'CANCELLATION_REQUESTED' : 'Cancelled';
    order.cancellationRequestedAt = new Date();
    order.statusTimeline.push({ status: order.status, note: 'Cancellation requested by buyer; seller refund review required where applicable.', timestamp: new Date() });
    await order.save();
    if (order.status === 'Cancelled') await restoreCancelledOrderInventory(String(order._id));
    res.json({ order });
  });

  // Seller confirms stock/availability; offline modes (COD, SELLER_COLLECT, POS_ON_DELIVERY) proceed cleanly without gateway blocking.
  app.post('/api/seller/orders/:id/confirm', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['SELLER', 'ADMIN'].includes(user.role) || (user.role === 'SELLER' && !user.isWhatsappVerified)) return res.status(403).json({ error: 'SELLER_ACCESS_REQUIRED' });
    const flags = await getPlatformFlags();
    const order = await OrderModel.findOne({ _id: req.params.id, ...(user.role === 'ADMIN' ? {} : { sellerId: user._id }) });
    if (!order) return res.status(404).json({ error: 'ORDER_NOT_FOUND' });
    if (!['Pending', 'PENDING_SELLER_CONFIRMATION'].includes(order.status)) return res.status(409).json({ error: 'INVALID_ORDER_TRANSITION' });
    const requiresGatewayCheckout = flags.onlinePaymentEnabled && ['RAZORPAY', 'STRIPE'].includes(String(order.paymentMode || ''));
    order.status = requiresGatewayCheckout ? 'CONFIRMED_AWAITING_PAYMENT' : 'Confirmed';
    order.statusTimeline.push({
      status: order.status,
      note: requiresGatewayCheckout
        ? 'Seller confirmed availability; awaiting online gateway payment.'
        : `Seller confirmed order (${order.paymentMode || 'COD'} collection).`,
      timestamp: new Date(),
    });
    await order.save();
    if (requiresGatewayCheckout) {
      const checkoutUrl = getAppBaseUrl(req) + '/orders';
      await sendWhatsAppMessage(order.shippingAddress.phone, 'Seller confirmed order ' + order.orderNumber + '. Complete secure payment from your order page: ' + checkoutUrl).catch(() => {});
    }
    res.json({ order });
  });

  // Low-complexity Seller/Admin payment collection & POS machine confirmation endpoint.
  app.post('/api/seller/orders/:id/confirm-payment', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['SELLER', 'ADMIN'].includes(user.role) || (user.role === 'SELLER' && !user.isWhatsappVerified)) {
      return res.status(403).json({ error: 'SELLER_ACCESS_REQUIRED' });
    }
    const parsed = z.object({
      collectionMethod: z.enum(['CASH', 'UPI', 'POS_CARD', 'BANK_TRANSFER']).default('UPI'),
      referenceNumber: z.string().trim().max(160).optional().default(''),
      posTerminalId: z.string().trim().max(120).optional().default(''),
      notes: z.string().trim().max(400).optional().default(''),
    }).safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'INVALID_PAYMENT_CONFIRMATION' });
    }
    const order = await OrderModel.findOne({ _id: req.params.id, ...(user.role === 'ADMIN' ? {} : { sellerId: user._id }) });
    if (!order) return res.status(404).json({ error: 'ORDER_NOT_FOUND' });
    if (order.status === 'Cancelled') return res.status(409).json({ error: 'CANNOT_CONFIRM_CANCELLED_ORDER' });

    const now = new Date();
    order.paymentStatus = 'PAID';
    order.paymentReference = parsed.data.referenceNumber || order.paymentReference || `${parsed.data.collectionMethod}-${order.orderNumber}`;
    order.manualPaymentCollection = {
      method: parsed.data.collectionMethod,
      referenceNumber: parsed.data.referenceNumber || null,
      posTerminalId: parsed.data.posTerminalId || null,
      confirmedByUserId: user._id,
      confirmedByName: user.name,
      confirmedAt: now,
      notes: parsed.data.notes || null,
    };
    if (['Pending', 'PENDING_SELLER_CONFIRMATION', 'CONFIRMED_AWAITING_PAYMENT'].includes(order.status)) {
      order.status = 'Confirmed';
    }
    const refNote = parsed.data.referenceNumber ? ` · Ref: ${parsed.data.referenceNumber}` : '';
    const terminalNote = parsed.data.posTerminalId ? ` · Terminal: ${parsed.data.posTerminalId}` : '';
    order.statusTimeline.push({
      status: order.status,
      note: `Payment confirmed by ${user.name} (${parsed.data.collectionMethod}${refNote}${terminalNote})`,
      timestamp: now,
    });
    await order.save();
    res.json({ order });
  });

  app.post('/api/returns/upload', upload.array('media', 8), async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'BUYER') return res.status(403).json({ error: 'BUYER_ACCESS_REQUIRED' });
    const rate = await checkRateLimit('return-upload:' + user._id, 12, 3600);
    if (!rate.allowed) return res.status(429).json({ error: 'RETURN_UPLOAD_RATE_LIMITED' });
    const files = (req.files || []) as Express.Multer.File[];
    if (!files.length || files.length > 8) return res.status(400).json({ error: 'UPLOAD_1_TO_8_RETURN_PHOTOS' });
    if (files.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype))) return res.status(415).json({ error: 'RETURN_PHOTOS_ONLY' });
    try {
      const media = [];
      for (const file of files) media.push(await processAndStoreImage(file.buffer, file.originalname));
      res.status(201).json({ media: media.map((item: any) => ({ url: item.url, mimeType: 'image/webp', durationSeconds: 0 })) });
    } catch (err) {
      res.status(400).json({ error: 'RETURN_MEDIA_PROCESSING_FAILED', message: (err as Error).message });
    }
  });

  app.post('/api/seller/orders/:id/cancellation-forward-provider', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['SELLER', 'ADMIN'].includes(user.role) || (user.role === 'SELLER' && !user.isWhatsappVerified)) return res.status(403).json({ error: 'SELLER_ACCESS_REQUIRED' });
    const order = await OrderModel.findOne({ _id: req.params.id, ...(user.role === 'ADMIN' ? {} : { sellerId: user._id }), status: 'CANCELLATION_REQUESTED' });
    if (!order) return res.status(404).json({ error: 'CANCELLATION_REQUEST_NOT_FOUND' });
    const retailIds = (order.items || []).map((item: any) => String(item.productId));
    const providerProducts = await ProviderProductModel.find({ retailProductId: { $in: retailIds }, ...(user.role === 'ADMIN' ? {} : { linkedSellerIds: user._id }) }).select('providerId retailProductId').lean() as any[];
    const providerIds = [...new Set(providerProducts.map(row => String(row.providerId)))];
    if (providerIds.length !== 1 || providerProducts.length !== retailIds.length) return res.status(409).json({ error: 'CANCELLATION_ORDER_NOT_EXCLUSIVELY_FROM_ONE_LINKED_PROVIDER' });
    const profile = await ProviderProfileModel.findOne({ userId: providerIds[0], ...(user.role === 'ADMIN' ? {} : { linkedSellerIds: user._id }) }).select('userId kycStatus').lean() as any;
    if (!profile || profile.kycStatus !== 'VERIFIED') return res.status(409).json({ error: 'LINKED_PROVIDER_MUST_BE_KYC_VERIFIED' });
    order.providerCancellationReview = { providerId: String(profile.userId), status: 'PENDING', note: '', forwardedAt: new Date(), reviewedAt: null };
    order.statusTimeline.push({ status: 'CANCELLATION_REQUESTED', note: 'Seller forwarded cancellation request to the linked provider for review.', timestamp: new Date() });
    await order.save();
    await providerAudit(user, 'SELLER_FORWARDED_CANCELLATION_TO_PROVIDER', String(profile.userId), String(order._id));
    res.status(202).json({ providerReview: order.providerCancellationReview });
  });

  app.get('/api/provider/cancellations', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'PROVIDER') return res.status(403).json({ error: 'PROVIDER_ACCESS_REQUIRED' });
    const orders = await OrderModel.find({ 'providerCancellationReview.providerId': user._id, 'providerCancellationReview.status': 'PENDING', status: 'CANCELLATION_REQUESTED' })
      .select('_id orderNumber items status createdAt providerCancellationReview').sort({ cancellationRequestedAt: -1 }).limit(100).lean();
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ cancellations: orders.map((order: any) => ({ id: String(order._id), orderNumber: order.orderNumber, items: (order.items || []).map((item: any) => ({ title: item.title, quantity: item.quantity })), status: order.status, forwardedAt: order.providerCancellationReview?.forwardedAt })) });
  });

  app.post('/api/provider/cancellations/:id/review', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'PROVIDER') return res.status(403).json({ error: 'PROVIDER_ACCESS_REQUIRED' });
    const parsed = z.object({ action: z.enum(['approve', 'reject']), note: z.string().trim().max(1000).optional().default('') }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PROVIDER_CANCELLATION_REVIEW' });
    const order = await OrderModel.findOne({ _id: req.params.id, status: 'CANCELLATION_REQUESTED', 'providerCancellationReview.providerId': user._id, 'providerCancellationReview.status': 'PENDING' });
    if (!order) return res.status(404).json({ error: 'PROVIDER_CANCELLATION_REVIEW_NOT_FOUND' });
    order.providerCancellationReview.status = parsed.data.action === 'approve' ? 'APPROVED' : 'REJECTED';
    order.providerCancellationReview.note = parsed.data.note;
    order.providerCancellationReview.reviewedAt = new Date();
    await order.save();
    await providerAudit(user, 'PROVIDER_CANCELLATION_REVIEWED', user._id, String(order._id), { action: parsed.data.action });
    res.json({ review: order.providerCancellationReview });
  });

  app.patch('/api/seller/orders/:id/cancellation-review', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['SELLER', 'ADMIN'].includes(user.role) || (user.role === 'SELLER' && !user.isWhatsappVerified)) return res.status(403).json({ error: 'SELLER_ACCESS_REQUIRED' });
    const parsed = z.object({ action: z.enum(['approve', 'reject']), refundDestination: z.enum(['ORIGINAL_SOURCE', 'WALLET']).default('WALLET') }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_CANCELLATION_REVIEW' });
    const order = await OrderModel.findOne({ _id: req.params.id, ...(user.role === 'ADMIN' ? {} : { sellerId: user._id }) });
    if (!order || order.status !== 'CANCELLATION_REQUESTED') return res.status(404).json({ error: 'CANCELLATION_REQUEST_NOT_FOUND' });
    const providerReviewStatus = order.providerCancellationReview?.status || 'NOT_FORWARDED';
    if (providerReviewStatus === 'PENDING' && parsed.data.action === 'approve') return res.status(409).json({ error: 'PROVIDER_CANCELLATION_REVIEW_PENDING' });
    if (providerReviewStatus === 'REJECTED' && parsed.data.action === 'approve') return res.status(409).json({ error: 'PROVIDER_REJECTED_CANCELLATION' });
    if (parsed.data.action === 'reject') {
      order.status = order.cancellationPreviousStatus || 'Confirmed';
      order.cancellationPreviousStatus = null;
      order.refundStatus = 'REJECTED';
      order.statusTimeline.push({ status: 'Confirmed', note: 'Seller rejected cancellation request.', timestamp: new Date() });
      await order.save();
      return res.json({ order });
    }
    if (order.paymentStatus === 'PAID') {
      const amountPaise = Math.max(0, Math.round(Number(order.totalAmount) * 100));
      if (parsed.data.refundDestination === 'WALLET') {
        await applyWalletTransaction({ userId: String(order.buyerId), idempotencyKey: 'cancel-refund:' + String(order._id), type: 'CREDIT_REFUND', amountPaise, orderId: String(order._id), reference: 'Seller-approved cancellation refund' });
        order.paymentStatus = 'REFUNDED';
        order.refundStatus = 'REFUNDED';
      } else {
        const walletPart = Math.min(amountPaise, Number(order.walletAppliedPaise || 0));
        const externalPart = amountPaise - walletPart;
        if (walletPart > 0) {
          await applyWalletTransaction({ userId: String(order.buyerId), idempotencyKey: 'cancel-wallet-refund:' + String(order._id), type: 'CREDIT_REFUND', amountPaise: walletPart, orderId: String(order._id), reference: 'Restore wallet portion of cancelled order' });
        }
        if (externalPart > 0) {
          if (!order.paymentProvider || !order.paymentTransactionId) return res.status(409).json({ error: 'ORIGINAL_PAYMENT_REFUND_UNAVAILABLE' });
          await refundViaPaymentService({ sellerId: String(order.sellerId), provider: order.paymentProvider, paymentReference: String(order.paymentTransactionId), amountPaise: externalPart, idempotencyKey: 'cancel-refund:' + String(order._id) });
          order.paymentStatus = 'REFUND_PENDING';
          order.refundStatus = 'PROCESSING';
        } else {
          order.paymentStatus = 'REFUNDED';
          order.refundStatus = 'REFUNDED';
        }
      }
    }
    order.status = 'Cancelled';
    order.statusTimeline.push({ status: 'Cancelled', note: 'Seller approved cancellation.', timestamp: new Date() });
    await order.save();
    if (order.status === 'Cancelled') await restoreCancelledOrderInventory(String(order._id));
    res.json({ order });
  });

  // Return eligibility and media are checked server-side; media references must be hosted URLs.
  app.post('/api/orders/:id/returns', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'BUYER') return res.status(403).json({ error: 'BUYER_ACCESS_REQUIRED' });
    const parsed = z.object({
      productId: z.string().min(1), quantity: z.number().int().positive(),
      reason: z.string().trim().min(5).max(1000),
      media: z.array(z.object({ url: z.string().min(1).max(2048), mimeType: z.enum(['image/jpeg','image/png','image/webp']), durationSeconds: z.number().max(0).default(0) })).min(1).max(8),
      selfCourier: z.boolean().default(false), courierName: z.string().max(100).optional(),
      trackingId: z.string().max(120).optional(), trackingUrl: z.string().url().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'INVALID_RETURN_REQUEST' });
    const order = await OrderModel.findOne({ _id: req.params.id, buyerId: user._id });
    if (!order || !['Delivered', 'RETURN_REQUESTED', 'RETURN_RECEIVED'].includes(order.status)) return res.status(409).json({ error: 'ONLY_DELIVERED_ORDERS_CAN_BE_RETURNED' });
    const item = order.items.find((entry: any) => String(entry.productId) === parsed.data.productId);
    if (!item || parsed.data.quantity > item.quantity) return res.status(400).json({ error: 'INVALID_RETURN_ITEM_OR_QUANTITY' });
    if (item.isReturnable === false) return res.status(409).json({ error: 'PRODUCT_NOT_RETURNABLE' });
    const deliveredAt = order.deliveredAt ? new Date(order.deliveredAt).getTime() : new Date(order.updatedAt).getTime();
    const deadline = deliveredAt + Math.max(0, Number(item.returnWindowDays ?? 7)) * 86400000;
    if (Date.now() > deadline) return res.status(409).json({ error: 'RETURN_WINDOW_EXPIRED' });
    if (parsed.data.media.length === 0) return res.status(400).json({ error: 'RETURN_PHOTO_EVIDENCE_REQUIRED' });
    const cdnBase = (process.env.R2_PUBLIC_CDN_URL || '').replace(/\/$/, '');
    if (parsed.data.media.some((item) => !(item.url.startsWith('/uploads/') || (cdnBase && item.url.startsWith(cdnBase + '/products/'))))) return res.status(400).json({ error: 'RETURN_MEDIA_MUST_BE_UPLOADED_TO_STORE' });
    if (parsed.data.selfCourier && (!parsed.data.courierName || !parsed.data.trackingId)) return res.status(400).json({ error: 'SELF_COURIER_DETAILS_REQUIRED' });
    try {
      const request = await ReturnRequestModel.create({
        orderId: String(order._id), buyerId: user._id, sellerId: String(order.sellerId),
        productId: parsed.data.productId, quantity: parsed.data.quantity,
        reason: parsed.data.reason, media: parsed.data.media,
        selfCourier: parsed.data.selfCourier, courierName: parsed.data.courierName,
        trackingId: parsed.data.trackingId, trackingUrl: parsed.data.trackingUrl,
        status: 'REQUESTED',
      });
      order.status = 'RETURN_REQUESTED';
      order.statusTimeline.push({ status: 'RETURN_REQUESTED', note: 'Buyer submitted return evidence for seller review.', timestamp: new Date() });
      await order.save();
      return res.status(201).json({ returnRequest: request });
    } catch (err) {
      return res.status(409).json({ error: 'RETURN_REQUEST_ALREADY_EXISTS_OR_INVALID' });
    }
  });

  app.get('/api/seller/returns', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['SELLER', 'ADMIN'].includes(user.role) || (user.role === 'SELLER' && !user.isWhatsappVerified)) return res.status(403).json({ error: 'SELLER_ACCESS_REQUIRED' });
    const requests = await ReturnRequestModel.find(user.role === 'ADMIN' ? {} : { sellerId: user._id }).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ returns: requests.map((item: any) => ({ ...item, _id: String(item._id) })) });
  });

  app.post('/api/seller/returns/:id/forward-provider', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['SELLER', 'ADMIN'].includes(user.role) || (user.role === 'SELLER' && !user.isWhatsappVerified)) return res.status(403).json({ error: 'SELLER_ACCESS_REQUIRED' });
    const parsed = z.object({ sharePickupAddress: z.boolean() }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'RETURN_PICKUP_DISCLOSURE_CHOICE_REQUIRED' });
    const request = await ReturnRequestModel.findOne({ _id: req.params.id, ...(user.role === 'ADMIN' ? {} : { sellerId: user._id }) });
    if (!request || request.status !== 'REQUESTED') return res.status(409).json({ error: 'RETURN_NOT_READY_TO_FORWARD' });
    const providerProduct = await ProviderProductModel.findOne({ retailProductId: request.productId, ...(user.role === 'ADMIN' ? {} : { linkedSellerIds: user._id }) }).select('providerId').lean() as any;
    if (!providerProduct) return res.status(409).json({ error: 'RETURN_PRODUCT_NOT_LINKED_TO_PROVIDER' });
    const profile = await ProviderProfileModel.findOne({ userId: providerProduct.providerId, ...(user.role === 'ADMIN' ? {} : { linkedSellerIds: user._id }) }).select('userId kycStatus').lean() as any;
    if (!profile || profile.kycStatus !== 'VERIFIED') return res.status(409).json({ error: 'LINKED_PROVIDER_MUST_BE_KYC_VERIFIED' });
    request.providerId = String(profile.userId);
    request.providerReviewStatus = 'PENDING';
    request.providerForwardedAt = new Date();
    request.providerPickupAddressShared = parsed.data.sharePickupAddress;
    request.providerDecisionNote = '';
    await request.save();
    await providerAudit(user, 'SELLER_FORWARDED_RETURN_TO_PROVIDER', String(profile.userId), String(request._id), { sharePickupAddress: parsed.data.sharePickupAddress });
    res.status(202).json({ returnRequest: { id: String(request._id), providerId: request.providerId, providerReviewStatus: request.providerReviewStatus, providerPickupAddressShared: request.providerPickupAddressShared } });
  });

  app.get('/api/provider/returns', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'PROVIDER') return res.status(403).json({ error: 'PROVIDER_ACCESS_REQUIRED' });
    const requests = await ReturnRequestModel.find({ providerId: user._id, providerReviewStatus: { $in: ['PENDING', 'APPROVED'] } }).sort({ providerForwardedAt: -1 }).limit(100).lean() as any[];
    const orderIds = [...new Set(requests.map(row => row.orderId))];
    const orders = await OrderModel.find({ _id: { $in: orderIds } }).select('_id orderNumber shippingAddress').lean() as any[];
    const orderById = new Map(orders.map(order => [String(order._id), order]));
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ returns: requests.map(row => {
      const order = orderById.get(String(row.orderId));
      const address = row.providerPickupAddressShared ? order?.shippingAddress : null;
      return {
        id: String(row._id), orderId: row.orderId, productId: row.productId, quantity: row.quantity,
        reason: row.reason, media: row.media, status: row.status, providerReviewStatus: row.providerReviewStatus,
        providerDecisionNote: row.providerDecisionNote, providerPickupAddressShared: row.providerPickupAddressShared,
        pickupAddress: address ? { fullName: address.fullName, phone: address.phone, street: address.street, city: address.city, state: address.state, pincode: address.pincode } : null,
        providerReturnAddress: row.providerReturnAddress || null,
        returnPickup: { status: row.returnPickupStatus, carrier: row.returnPickupCarrier, trackingId: row.returnPickupTrackingId, trackingUrl: row.returnPickupTrackingUrl, bookedAt: row.returnPickupBookedAt },
        forwardedAt: row.providerForwardedAt,
      };
    }) });
  });

  app.post('/api/provider/returns/:id/review', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'PROVIDER') return res.status(403).json({ error: 'PROVIDER_ACCESS_REQUIRED' });
    const parsed = z.object({
      action: z.enum(['approve', 'reject']),
      warehouseId: z.string().uuid().optional(),
      note: z.string().trim().max(1000).optional().default(''),
    }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PROVIDER_RETURN_REVIEW' });
    const request = await ReturnRequestModel.findOne({ _id: req.params.id, providerId: user._id, providerReviewStatus: 'PENDING' });
    if (!request) return res.status(404).json({ error: 'PROVIDER_RETURN_REVIEW_NOT_FOUND' });
    if (parsed.data.action === 'approve') {
      if (!parsed.data.warehouseId) return res.status(400).json({ error: 'RETURN_WAREHOUSE_REQUIRED' });
      const warehouse = await getProviderWarehouse(user._id, parsed.data.warehouseId) as any;
      request.providerReturnAddress = {
        warehouseId: String(warehouse.id), name: warehouse.name, contactName: warehouse.contact_name,
        contactPhone: warehouse.contact_phone, addressLine1: warehouse.address_line1, addressLine2: warehouse.address_line2 || '',
        city: warehouse.city, state: warehouse.state, postalCode: warehouse.postal_code, countryCode: warehouse.country_code || 'IN',
      };
      request.providerReviewStatus = 'APPROVED';
    } else {
      request.providerReviewStatus = 'REJECTED';
    }
    request.providerDecisionNote = parsed.data.note;
    request.providerReviewedAt = new Date();
    await request.save();
    await providerAudit(user, 'PROVIDER_RETURN_REVIEWED', user._id, String(request._id), { action: parsed.data.action });
    res.json({ returnRequest: { id: String(request._id), providerReviewStatus: request.providerReviewStatus, providerDecisionNote: request.providerDecisionNote, providerReturnAddress: request.providerReturnAddress } });
  });

  app.post('/api/provider/returns/:id/pickup', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'PROVIDER') return res.status(403).json({ error: 'PROVIDER_ACCESS_REQUIRED' });
    const parsed = z.object({ carrierName: z.string().trim().min(2).max(100), trackingId: z.string().trim().min(3).max(120), trackingUrl: z.string().url().max(2048).optional().or(z.literal('')) }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_RETURN_PICKUP_DETAILS' });
    const request = await ReturnRequestModel.findOne({ _id: req.params.id, providerId: user._id, providerReviewStatus: 'APPROVED', providerPickupAddressShared: true });
    if (!request) return res.status(409).json({ error: 'PROVIDER_RETURN_NOT_APPROVED_OR_PICKUP_ADDRESS_NOT_SHARED' });
    request.returnPickupStatus = 'BOOKED';
    request.returnPickupBookedBy = user._id;
    request.returnPickupCarrier = parsed.data.carrierName;
    request.returnPickupTrackingId = parsed.data.trackingId;
    request.returnPickupTrackingUrl = parsed.data.trackingUrl || '';
    request.returnPickupBookedAt = new Date();
    await request.save();
    await providerAudit(user, 'PROVIDER_RECORDED_RETURN_PICKUP', user._id, String(request._id), { carrierName: parsed.data.carrierName });
    res.json({ returnPickup: { status: request.returnPickupStatus, carrier: request.returnPickupCarrier, trackingId: request.returnPickupTrackingId, trackingUrl: request.returnPickupTrackingUrl } });
  });

  app.post('/api/seller/returns/:id/pickup', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['SELLER', 'ADMIN'].includes(user.role) || (user.role === 'SELLER' && !user.isWhatsappVerified)) return res.status(403).json({ error: 'SELLER_ACCESS_REQUIRED' });
    const parsed = z.object({ carrierName: z.string().trim().min(2).max(100), trackingId: z.string().trim().min(3).max(120), trackingUrl: z.string().url().max(2048).optional().or(z.literal('')) }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_RETURN_PICKUP_DETAILS' });
    const request = await ReturnRequestModel.findOne({ _id: req.params.id, ...(user.role === 'ADMIN' ? {} : { sellerId: user._id }), providerReviewStatus: 'APPROVED' });
    if (!request) return res.status(409).json({ error: 'PROVIDER_RETURN_NOT_APPROVED' });
    request.returnPickupStatus = 'BOOKED';
    request.returnPickupBookedBy = user._id;
    request.returnPickupCarrier = parsed.data.carrierName;
    request.returnPickupTrackingId = parsed.data.trackingId;
    request.returnPickupTrackingUrl = parsed.data.trackingUrl || '';
    request.returnPickupBookedAt = new Date();
    await request.save();
    await providerAudit(user, 'SELLER_RECORDED_RETURN_PICKUP', request.providerId || '', String(request._id), { carrierName: parsed.data.carrierName });
    res.json({ returnPickup: { status: request.returnPickupStatus, carrier: request.returnPickupCarrier, trackingId: request.returnPickupTrackingId, trackingUrl: request.returnPickupTrackingUrl } });
  });

  app.patch('/api/seller/returns/:id', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['SELLER', 'ADMIN'].includes(user.role) || (user.role === 'SELLER' && !user.isWhatsappVerified)) return res.status(403).json({ error: 'SELLER_ACCESS_REQUIRED' });
    const parsed = z.object({ action: z.enum(['approve', 'reject', 'mark_received']), refundDestination: z.enum(['ORIGINAL_SOURCE', 'WALLET']).default('WALLET') }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_RETURN_ACTION' });
    const filter = { _id: req.params.id, ...(user.role === 'ADMIN' ? {} : { sellerId: user._id }) };
    const request = await ReturnRequestModel.findOne(filter);
    if (!request) return res.status(404).json({ error: 'RETURN_NOT_FOUND' });
    if (parsed.data.action === 'approve') request.status = request.selfCourier ? 'IN_TRANSIT' : 'APPROVED';
    else if (parsed.data.action === 'reject') request.status = 'REJECTED';
    else {
      if (!['APPROVED', 'IN_TRANSIT'].includes(request.status)) return res.status(409).json({ error: 'RETURN_NOT_READY_FOR_RECEIPT' });
      request.status = parsed.data.refundDestination === 'WALLET' ? 'RECEIVED' : 'REFUND_PENDING';
      request.receivedAt = new Date();
      request.refundDestination = parsed.data.refundDestination;
    }
    await request.save();
    if (parsed.data.action === 'mark_received') {
      const settlement = await ProviderSettlementModel.findOne({ orderId: request.orderId, orderItemKey: request.productId, status: { $in: ['PENDING_CLEARANCE', 'READY_FOR_SETTLEMENT', 'ADJUSTED'] } });
      if (settlement) {
        const remainingQuantity = Math.max(0, Number(settlement.quantity) - Number(request.quantity));
        settlement.quantity = remainingQuantity;
        settlement.amountPaise = remainingQuantity * Number(settlement.unitBasePricePaise);
        settlement.status = remainingQuantity === 0 ? 'VOID' : 'ADJUSTED';
        await settlement.save();
        await providerAudit(user, 'PROVIDER_SETTLEMENT_ADJUSTED_FOR_RETURN', settlement.providerId, String(settlement._id), { returnedQuantity: request.quantity });
      }
    }
    if (parsed.data.action === 'mark_received' && parsed.data.refundDestination === 'ORIGINAL_SOURCE') {
      const order = await OrderModel.findById(request.orderId);
      if (!order || !order.paymentProvider || !order.paymentTransactionId || order.paymentStatus !== 'PAID') {
        return res.status(409).json({ error: 'ORIGINAL_PAYMENT_REFUND_UNAVAILABLE' });
      }
      try {
        const item = order.items.find((entry: any) => String(entry.productId) === request.productId);
        const amountPaise = Math.round(Number(item?.unitPrice || 0) * request.quantity * 100);
        const walletPart = Math.min(amountPaise, Math.round(Number(order.walletAppliedPaise || 0) * (amountPaise / Math.max(1, Math.round(Number(order.totalAmount) * 100)))));
        const externalPart = amountPaise - walletPart;
        if (walletPart > 0) {
          await applyWalletTransaction({ userId: String(order.buyerId), idempotencyKey: 'return-wallet-refund:' + String(request._id), type: 'CREDIT_REFUND', amountPaise: walletPart, orderId: String(order._id), reference: 'Restore wallet portion of returned item' });
        }
        let refund: any = null;
        if (externalPart > 0) {
          if (!order.paymentProvider || !order.paymentTransactionId) return res.status(409).json({ error: 'ORIGINAL_PAYMENT_REFUND_UNAVAILABLE' });
          refund = await refundViaPaymentService({
            sellerId: String(order.sellerId), provider: order.paymentProvider,
            paymentReference: String(order.paymentTransactionId), amountPaise: externalPart,
            idempotencyKey: 'return-refund:' + String(request._id),
          });
          order.refundStatus = 'PARTIAL';
        } else {
          order.refundStatus = 'PARTIAL';
          request.status = 'REFUNDED';
          await request.save();
        }
        await order.save();
        return res.json({ returnRequest: request, refund });
      } catch (err) {
        return res.status(502).json({ error: (err as Error).message });
      }
    }
    if (parsed.data.action === 'mark_received' && parsed.data.refundDestination === 'WALLET') {
      const order = await OrderModel.findById(request.orderId);
      if (!order) return res.status(404).json({ error: 'ORDER_NOT_FOUND' });
      const item = order.items.find((entry: any) => String(entry.productId) === request.productId);
      const amountPaise = Math.round(Number(item?.unitPrice || 0) * request.quantity * 100);
      await applyWalletTransaction({
        userId: request.buyerId, idempotencyKey: 'return-refund:' + String(request._id),
        type: 'CREDIT_REFUND', amountPaise, orderId: request.orderId,
        reference: 'Return refund after seller receipt verification',
      });
      request.status = 'REFUNDED';
      await request.save();
      order.refundStatus = 'PARTIAL';
      order.status = 'RETURN_RECEIVED';
      await order.save();
    }
    res.json({ returnRequest: request });
  });

  // --- Seller Analytics & Trending Cron ---
  app.get('/api/seller/analytics', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || (user.role !== 'SELLER' && user.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'Seller account required.' });
    }
    const granularity = (req.query.granularity as TimeGranularity) || 'month';
    const analytics = await getSellerAnalytics(user._id, granularity);
    res.json(analytics);
  });

  app.post('/api/cron/trending', async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers['x-cron-secret'] !== secret) {
      return res.status(401).json({ error: 'Unauthorized cron call' });
    }
    const result = await recalculateTrendingAndBadges();
    res.json(result);
  });

  app.post('/api/analytics/share', async (req, res) => {
    const { guestToken, user } = await resolveActor(req, res);
    const rate = await checkRateLimit(`share:${user?._id || guestToken}`, 40, 60);
    if (!rate.allowed) {
      return res.status(429).json({ error: 'Too many share requests. Please wait a moment.' });
    }
    const schema = z.object({
      productId: z.string().trim().min(1),
      channel: z.string().trim().min(1).max(32).optional().default('whatsapp'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'productId is required' });
    }
    const logged = await logShareEvent({
      productId: parsed.data.productId,
      channel: 'whatsapp',
      userId: user?._id || null,
      guestToken,
    });
    if (!logged) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.status(201).json({ ok: true, channel: parsed.data.channel, ...logged });
  });

  app.post('/api/products/:id/share', async (req, res) => {
    const { guestToken, user } = await resolveActor(req, res);
    const rate = await checkRateLimit(`share:${user?._id || guestToken}`, 40, 60);
    if (!rate.allowed) {
      return res.status(429).json({ error: 'Too many share requests. Please wait a moment.' });
    }
    const channel = req.body?.channel === 'whatsapp' || !req.body?.channel ? 'whatsapp' : 'whatsapp';
    const logged = await logShareEvent({
      productId: req.params.id,
      channel,
      userId: user?._id || null,
      guestToken,
    });
    if (!logged) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.status(201).json({ ok: true, channel, ...logged });
  });

  app.post('/api/shares', async (req, res) => {
    const { guestToken, user } = await resolveActor(req, res);
    const rate = await checkRateLimit(`share:${user?._id || guestToken}`, 40, 60);
    if (!rate.allowed) {
      return res.status(429).json({ error: 'Too many share requests. Please wait a moment.' });
    }
    const schema = z.object({
      productId: z.string().min(1),
      channel: z.enum(['whatsapp']).optional().default('whatsapp'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'productId is required' });
    }
    const logged = await logShareEvent({
      productId: parsed.data.productId,
      channel: parsed.data.channel,
      userId: user?._id || null,
      guestToken,
    });
    if (!logged) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.status(201).json({ ok: true, channel: parsed.data.channel, ...logged });
  });

  app.post('/api/whatsapp/share', async (req, res) => {
    const schema = z.object({
      toPhone: z.string().optional().default(''),
      message: z.string().min(3).max(1000),
      productId: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Share message is required' });
    }
    if (parsed.data.productId) {
      const { guestToken, user } = await resolveActor(req, res);
      await logShareEvent({
        productId: parsed.data.productId,
        channel: 'whatsapp',
        userId: user?._id || null,
        guestToken,
      }).catch(() => {});
    }
    const result = await sendWhatsAppMessage(parsed.data.toPhone, parsed.data.message);
    res.json(result);
  });

  // Error boundary
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('API Error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  });

  // Vite middleware in dev, static dist in combined production mode, or pure API mode when DISABLE_STATIC_UI=1.
  if (DISABLE_STATIC_UI) {
    app.get('/', (_req, res) => {
      res.json({ service: 'kala-and-karat-api', ok: true, mode: 'lean-api' });
    });
  } else if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir, {
      maxAge: '1y',
      immutable: true,
      setHeaders: (res, filePath) => {
        // The Vite entry HTML references fingerprinted assets and must revalidate.
        if (path.basename(filePath) === 'index.html') {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Kala & Karat server running on http://0.0.0.0:${PORT} (DB mode: ${dbStatus.mode}, staticUI: ${!DISABLE_STATIC_UI})`);
  });

  // Background logistics worker stays off under 512 MB free tier unless both env and Admin flag explicitly enable it.
  const initialFlags = await getPlatformFlags().catch(() => null);
  if (process.env.RUN_LOGISTICS_WORKER === '1' && initialFlags?.backgroundWorkerEnabled) {
    void import('./apps/logistics-worker/src/run.js')
      .then(({ runLogisticsWorker }) => runLogisticsWorker())
      .catch((error) => {
        console.error('Co-located logistics worker stopped unexpectedly:', error);
      });
  }
}

startServer();
