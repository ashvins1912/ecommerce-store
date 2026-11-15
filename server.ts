import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import { timingSafeEqual } from 'node:crypto';
import { UserModel, ProductModel, OrderModel, ReturnRequestModel, PaymentEventModel } from './src/server/models/schemas.js';
import { saveGatewayConfiguration, listGatewayConfigurations, getGatewaySecrets, createGatewayCheckout, verifyPaymentWebhook, claimPaymentEvent, getWalletSummary, applyWalletTransaction } from './src/server/services/commerce.js';
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
  syncSupabaseCustomerUser,
  registerCustomerAccount,
  authenticateCustomerAccount,
  updateUserCheckoutProfile,
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
import {
  isValidE164,
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
  User,
} from './src/shared/types.js';

const PORT = 3000;
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
    sameSite: 'lax' as const,
    maxAge: 1000 * 60 * 60 * 24 * 30,
    path: '/',
  };
}

function getAppBaseUrl(req: Request): string {
  if (process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL') {
    return process.env.APP_URL.replace(/\/$/, '');
  }
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
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
      res.clearCookie('kk_session', getSslSessionCookieOpts());
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
  res.clearCookie('kk_user', getCookieOpts());
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
  await recalculateTrendingAndBadges();

  const app = express();
  app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    attachSslSecurityHeaders(res);
    next();
  });
  app.use(express.json({ limit: '4mb', verify: (req: any, _res, buffer) => { req.rawBody = Buffer.from(buffer); } }));
  app.use(cookieParser());

  // Same-origin and synchronized-token CSRF protection for state-changing APIs.
  const configuredOrigins = (process.env.CORS_ALLOWED_ORIGINS || process.env.APP_URL || '')
    .split(',').map((origin) => origin.trim()).filter(Boolean).map((origin) => new URL(origin).origin);
  app.use(async (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || req.path.startsWith('/api/webhooks/')) return next();
    let suppliedOrigin = String(req.headers.origin || '');
    if (!suppliedOrigin && req.headers.referer) { try { suppliedOrigin = new URL(String(req.headers.referer)).origin; } catch { return res.status(403).json({ error: 'INVALID_REFERER' }); } }
    if (suppliedOrigin) {
      const requestOrigin = req.protocol + '://' + req.get('host');
      const allowed = configuredOrigins.length ? configuredOrigins : [requestOrigin];
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

  // Static serving for generated images & Sharp WebP uploads
  app.use('/uploads', express.static(getUploadDir()));
  app.use('/src/assets', express.static(path.resolve(process.cwd(), 'src/assets')));

  // --- Health ---
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, dbMode: dbStatus.mode });
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
        user = await findUserById(parsed.data.quickDemoUserId);
        if (!user && parsed.data.email) {
          user = await findUserByEmail(parsed.data.email);
        }
        if (!user) {
          return res.status(404).json({ error: 'Test account not found.' });
        }
        sessionProvider = 'demo';
      } else {
        if (isSupabaseAuthConfigured()) {
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
    res.clearCookie('kk_session', getSslSessionCookieOpts());
    res.clearCookie('kk_user', getCookieOpts());
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
      res.clearCookie('kk_session', getSslSessionCookieOpts());
      res.clearCookie('kk_user', getCookieOpts());
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
    if (!user || user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only platform Administrators can issue seller invitations.' });
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
        `Hello,\n\nYou have been invited by ${user.name} (Kala & Karat Admin) to onboard your atelier${invite.storeName ? ` (${invite.storeName})` : ''} on Kala & Karat.\n\nUse your private one-time onboarding link below to complete verification and activate your Seller Hub:\n${inviteUrl}\n\n${invite.note ? `Admin note: ${invite.note}\n\n` : ''}This invitation expires on ${new Date(invite.expiresAt).toLocaleDateString('en-IN')}.`
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
      limit: 20, // Strictly 20 products per page
      sellerId: typeof req.query.sellerId === 'string' ? req.query.sellerId : undefined,
      includeDisabled: allowDisabled,
      viewerId: user?._id,
    });
    res.json(result);
  });

  app.get('/api/products/:idOrSlug', async (req, res) => {
    const product = await getProductByIdOrSlug(req.params.idOrSlug);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    await incrementProductView(product._id);
    const [reviews, recData] = await Promise.all([
      getProductReviews(product._id),
      getHybridRecommendations(product._id, 4),
    ]);
    res.json({
      product: { ...product, viewsCount: product.viewsCount + 1 },
      reviews,
      recommendations: recData.recommendations,
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
      onlinePaymentRequired: z.boolean().optional(),
      codAllowed: z.boolean().optional(),
      isReturnable: z.boolean().optional(),
      returnWindowDays: z.number().int().min(0).max(90).optional(),
      salePrice: z.number().positive().optional(),
      basePrice: z.number().positive().optional(),
      totalStock: z.number().int().min(0).optional(),
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
    const updated = await updateProductDiscountOrStock(req.params.id, user._id, parsed.data);
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
  app.get('/api/campaigns', async (_req, res) => {
    const campaigns = await listStorefrontCampaigns();
    res.json({ campaigns });
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
    const itemsToOrder = cart.length > 0 ? cart : (req.body?.items as CartItem[]) || [];
    if (itemsToOrder.length === 0) {
      return res.status(400).json({ error: 'Your shopping bag is empty.' });
    }

    const couponCode = typeof req.body?.couponCode === 'string' ? req.body.couponCode.trim() : undefined;
    const itemProducts = await Promise.all(itemsToOrder.map((item) => getProductByIdOrSlug(item.productId, { includeControlled: true })));
    const requiresPrepaid = itemProducts.some((product) => product && (product.onlinePaymentRequired || product.codAllowed === false));
    const requestedProvider = req.body?.paymentProvider === 'stripe' ? 'stripe' : 'razorpay';
    if (requiresPrepaid) {
      const bySeller = new Set(itemsToOrder.map((item) => item.sellerId));
      for (const sellerId of bySeller) {
        const gateway = await getGatewaySecrets(sellerId, requestedProvider);
        if (!gateway) return res.status(409).json({ error: 'PREPAID_REQUIRED_ACTIVE_GATEWAY_MISSING', sellerId });
      }
    }
    let createdOrders;
    try {
      createdOrders = await createOrder({ buyer: user, items: itemsToOrder, couponCode });
      for (const order of createdOrders) {
        const prepaid = requiresPrepaid && order.items.some((item) => {
          const idx = itemsToOrder.findIndex((cartItem) => cartItem.productId === item.productId);
          return idx >= 0 && itemProducts[idx] && (itemProducts[idx]!.onlinePaymentRequired || itemProducts[idx]!.codAllowed === false);
        });
        order.paymentMode = prepaid ? (requestedProvider === 'stripe' ? 'STRIPE' : 'RAZORPAY') : 'COD';
        order.paymentStatus = prepaid ? 'PENDING' : 'NOT_REQUIRED';
        order.status = 'PENDING_SELLER_CONFIRMATION';
        await OrderModel.updateOne({ _id: order._id }, { $set: { paymentMode: order.paymentMode, paymentStatus: order.paymentStatus, status: order.status } });
      }
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }

    // Trigger automated WhatsApp alert to each seller
    for (const order of createdOrders) {
      const seller = await findUserById(order.sellerId);
      const sellerPhone = seller?.whatsappNumber || seller?.mobileNumber || '+919820112233';
      const itemSummary = order.items.map((i) => `${i.title} (x${i.quantity})`).join(', ');
      const msg = `New Order ${order.orderNumber}! Items: ${itemSummary}. Buyer City: ${order.shippingAddress.city}. Total: INR ${order.totalAmount}.`;
      order.whatsappDispatch = await sendWhatsAppMessage(sellerPhone, msg);
    }

    await saveCartForActor({ userId: user._id, guestToken }, []);
    res.status(201).json({ orders: createdOrders });
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

    const updated = await updateOrderStatusOrTracking(req.params.id, {
      status: parsed.data.status as OrderStatus,
      note: parsed.data.note,
      courierTracking: parsed.data.courierTracking,
    });
    if (!updated) return res.status(404).json({ error: 'Order not found' });

    if (parsed.data.status === 'Shipped' && updated.courierTracking) {
      const dispatch = await sendWhatsAppMessage(
        updated.shippingAddress.phone,
        `Order ${updated.orderNumber} has shipped via ${updated.courierTracking.companyName} (ID: ${updated.courierTracking.trackingId}). Track: ${updated.courierTracking.trackingUrl}`
      );
      updated.whatsappDispatch = dispatch;
    } else if (parsed.data.status === 'Cancelled') {
      const seller = await findUserById(updated.sellerId);
      const sellerPhone = seller?.whatsappNumber || '+919820112233';
      updated.whatsappDispatch = await sendWhatsAppMessage(
        sellerPhone,
        `Order ${updated.orderNumber} was cancelled. Total INR ${updated.totalAmount}.`
      );
    }

    res.json({ order: updated });
  });


  // Seller-scoped customer lookup. PUID, name and phone are searchable; response is deliberately minimized.
  app.get('/api/seller/customers/search', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['SELLER', 'ADMIN'].includes(user.role)) return res.status(403).json({ error: 'SELLER_ACCESS_REQUIRED' });
    const q = String(req.query.q || '').trim().slice(0, 80);
    if (q.length < 2) return res.json({ customers: [] });
    const escaped = q.replace(/[.*+?^$()|[\\]\\\\]/g, '\\\\    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\  // --- Seller Analytics & Trending Cron ---');');
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
  app.get('/api/seller/payment-settings', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['SELLER', 'ADMIN'].includes(user.role)) return res.status(403).json({ error: 'SELLER_ACCESS_REQUIRED' });
    const settings = await listGatewayConfigurations(user._id);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ gateways: settings });
  });
  app.put('/api/seller/payment-settings/:provider', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['SELLER', 'ADMIN'].includes(user.role)) return res.status(403).json({ error: 'SELLER_ACCESS_REQUIRED' });
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
    if (parsed.data.amountPaise > Math.round(Number(order.totalAmount) * 100)) return res.status(400).json({ error: 'WALLET_REDEMPTION_EXCEEDS_ORDER_TOTAL' });
    try {
      const transaction = await applyWalletTransaction({
        userId: user._id, idempotencyKey: parsed.data.idempotencyKey,
        type: 'DEBIT_ORDER_REDEMPTION', amountPaise: parsed.data.amountPaise,
        orderId: parsed.data.orderId,
      });
      await OrderModel.updateOne({ _id: order._id, buyerId: user._id }, { $set: { walletAppliedPaise: transaction.replayed ? order.walletAppliedPaise : parsed.data.amountPaise } });
      res.json({ transaction });
    } catch (err) {
      res.status((err as Error).message === 'INSUFFICIENT_WALLET_BALANCE' ? 409 : 400).json({ error: (err as Error).message });
    }
  });


  // Buyer payment intent is created only after the seller has confirmed availability.
  app.post('/api/orders/:id/payment-intent', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'BUYER') return res.status(403).json({ error: 'BUYER_ACCESS_REQUIRED' });
    const order = await OrderModel.findOne({ _id: req.params.id, buyerId: user._id });
    if (!order) return res.status(404).json({ error: 'ORDER_NOT_FOUND' });
    if (order.status !== 'CONFIRMED_AWAITING_PAYMENT' || order.paymentStatus === 'PAID') return res.status(409).json({ error: 'ORDER_NOT_READY_FOR_PAYMENT' });
    const parsed = z.object({ provider: z.enum(['razorpay', 'stripe']) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PAYMENT_PROVIDER' });
    try {
      const checkout = await createGatewayCheckout({
        sellerId: String(order.sellerId), provider: parsed.data.provider,
        orderId: String(order._id), orderNumber: order.orderNumber,
        amountPaise: Math.max(0, Math.round(Number(order.totalAmount) * 100) - Number(order.walletAppliedPaise || 0)),
      });
      order.paymentProvider = checkout.provider;
      order.paymentReference = checkout.reference;
      order.paymentMode = checkout.provider === 'razorpay' ? 'RAZORPAY' : 'STRIPE';
      order.paymentStatus = 'PENDING';
      await order.save();
      res.setHeader('Cache-Control', 'no-store');
      res.json({ checkout });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/webhooks/razorpay/:sellerId', async (req, res) => {
    const rawBody = (req as any).rawBody as Buffer | undefined;
    const signature = String(req.headers['x-razorpay-signature'] || '');
    if (!rawBody || !await verifyPaymentWebhook({ sellerId: req.params.sellerId, provider: 'razorpay', signature, rawBody })) {
      return res.status(400).json({ error: 'INVALID_WEBHOOK_SIGNATURE' });
    }
    const event = req.body as any;
    if (event?.event !== 'payment.captured') return res.json({ received: true, ignored: true });
    const payment = event.payload?.payment?.entity;
    const order = await OrderModel.findOne({ sellerId: req.params.sellerId, paymentReference: payment?.order_id });
    if (!order || !payment?.id) return res.status(404).json({ error: 'ORDER_NOT_FOUND' });
    const eventId = String(event.id || payment.id);
    const claimed = await claimPaymentEvent('razorpay', eventId, String(order._id), crypto.createHash('sha256').update(rawBody).digest('hex'));
    if (!claimed) return res.json({ received: true, duplicate: true });
    order.paymentTransactionId = String(payment.id);
    order.paymentStatus = 'PAID';
    order.status = 'PAID_AND_PROCESSING';
    order.statusTimeline.push({ status: order.status, note: 'Razorpay payment verified by signed webhook.', timestamp: new Date() });
    await order.save();
    res.json({ received: true });
  });

  app.post('/api/webhooks/stripe/:sellerId', async (req, res) => {
    const rawBody = (req as any).rawBody as Buffer | undefined;
    const signature = String(req.headers['stripe-signature'] || '');
    if (!rawBody || !await verifyPaymentWebhook({ sellerId: req.params.sellerId, provider: 'stripe', signature, rawBody })) {
      return res.status(400).json({ error: 'INVALID_WEBHOOK_SIGNATURE' });
    }
    const event = req.body as any;
    if (event?.type !== 'payment_intent.succeeded') return res.json({ received: true, ignored: true });
    const intent = event.data?.object;
    const order = await OrderModel.findOne({ _id: intent?.metadata?.orderId, sellerId: req.params.sellerId, paymentReference: intent?.id });
    if (!order) return res.status(404).json({ error: 'ORDER_NOT_FOUND' });
    const claimed = await claimPaymentEvent('stripe', String(event.id), String(order._id), crypto.createHash('sha256').update(rawBody).digest('hex'));
    if (!claimed) return res.json({ received: true, duplicate: true });
    order.paymentTransactionId = String(intent.id);
    order.paymentStatus = 'PAID';
    order.status = 'PAID_AND_PROCESSING';
    order.statusTimeline.push({ status: order.status, note: 'Stripe payment verified by signed webhook.', timestamp: new Date() });
    await order.save();
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
    order.status = ['Shipped', 'Out for Delivery'].includes(order.status) ? 'CANCELLATION_REQUESTED' : 'Cancelled';
    order.cancellationRequestedAt = new Date();
    order.statusTimeline.push({ status: order.status, note: 'Cancellation requested by buyer; seller refund review required where applicable.', timestamp: new Date() });
    await order.save();
    res.json({ order });
  });

  // Seller confirms stock/availability before prepaid checkout is enabled.
  app.post('/api/seller/orders/:id/confirm', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['SELLER', 'ADMIN'].includes(user.role)) return res.status(403).json({ error: 'SELLER_ACCESS_REQUIRED' });
    const order = await OrderModel.findOne({ _id: req.params.id, ...(user.role === 'ADMIN' ? {} : { sellerId: user._id }) });
    if (!order) return res.status(404).json({ error: 'ORDER_NOT_FOUND' });
    if (!['Pending', 'PENDING_SELLER_CONFIRMATION'].includes(order.status)) return res.status(409).json({ error: 'INVALID_ORDER_TRANSITION' });
    order.status = order.paymentMode === 'COD' ? 'Confirmed' : 'CONFIRMED_AWAITING_PAYMENT';
    order.statusTimeline.push({ status: order.status, note: 'Seller confirmed product availability.', timestamp: new Date() });
    await order.save();
    res.json({ order });
  });

  // Return eligibility and media are checked server-side; media references must be hosted URLs.
  app.post('/api/orders/:id/returns', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || user.role !== 'BUYER') return res.status(403).json({ error: 'BUYER_ACCESS_REQUIRED' });
    const parsed = z.object({
      productId: z.string().min(1), quantity: z.number().int().positive(),
      reason: z.string().trim().min(5).max(1000),
      media: z.array(z.object({ url: z.string().url(), mimeType: z.enum(['image/jpeg','image/png','image/webp','video/mp4','video/webm']), durationSeconds: z.number().min(0).max(10).default(0) })).min(1).max(8),
      selfCourier: z.boolean().default(false), courierName: z.string().max(100).optional(),
      trackingId: z.string().max(120).optional(), trackingUrl: z.string().url().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'INVALID_RETURN_REQUEST' });
    const order = await OrderModel.findOne({ _id: req.params.id, buyerId: user._id });
    if (!order || order.status !== 'Delivered') return res.status(409).json({ error: 'ONLY_DELIVERED_ORDERS_CAN_BE_RETURNED' });
    const item = order.items.find((entry: any) => String(entry.productId) === parsed.data.productId);
    if (!item || parsed.data.quantity > item.quantity) return res.status(400).json({ error: 'INVALID_RETURN_ITEM_OR_QUANTITY' });
    const product = await ProductModel.findById(parsed.data.productId).select('isReturnable returnWindowDays sellerId').lean();
    if (!product || product.isReturnable === false) return res.status(409).json({ error: 'PRODUCT_NOT_RETURNABLE' });
    const deadline = new Date(order.updatedAt).getTime() + Math.max(0, Number(product.returnWindowDays ?? 7)) * 86400000;
    if (Date.now() > deadline) return res.status(409).json({ error: 'RETURN_WINDOW_EXPIRED' });
    if (parsed.data.media.some((m) => m.mimeType.startsWith('video/') && m.durationSeconds > 10)) return res.status(400).json({ error: 'RETURN_VIDEO_MAX_10_SECONDS' });
    if (parsed.data.selfCourier && (!parsed.data.courierName || !parsed.data.trackingId)) return res.status(400).json({ error: 'SELF_COURIER_DETAILS_REQUIRED' });
    try {
      const request = await ReturnRequestModel.create({
        orderId: String(order._id), buyerId: user._id, sellerId: String(order.sellerId),
        productId: parsed.data.productId, quantity: parsed.data.quantity,
        reason: parsed.data.reason, media: parsed.data.media,
        selfCourier: parsed.data.selfCourier, courierName: parsed.data.courierName,
        trackingId: parsed.data.trackingId, trackingUrl: parsed.data.trackingUrl,
      });
      order.status = 'RETURN_REQUESTED';
      order.statusTimeline.push({ status: 'RETURN_REQUESTED', note: 'Buyer submitted return evidence for seller review.', timestamp: new Date() });
      await order.save();
      return res.status(201).json({ returnRequest: request });
    } catch (err) {
      return res.status(409).json({ error: 'RETURN_REQUEST_ALREADY_EXISTS_OR_INVALID' });
    }
  });

  app.patch('/api/seller/returns/:id', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || !['SELLER', 'ADMIN'].includes(user.role)) return res.status(403).json({ error: 'SELLER_ACCESS_REQUIRED' });
    const parsed = z.object({ action: z.enum(['approve', 'reject', 'mark_received']), refundDestination: z.enum(['ORIGINAL_SOURCE', 'WALLET']).default('WALLET') }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_RETURN_ACTION' });
    const filter = { _id: req.params.id, ...(user.role === 'ADMIN' ? {} : { sellerId: user._id }) };
    const request = await ReturnRequestModel.findOne(filter);
    if (!request) return res.status(404).json({ error: 'RETURN_NOT_FOUND' });
    if (parsed.data.action === 'approve') request.status = 'APPROVED';
    else if (parsed.data.action === 'reject') request.status = 'REJECTED';
    else {
      if (!['APPROVED', 'IN_TRANSIT'].includes(request.status)) return res.status(409).json({ error: 'RETURN_NOT_READY_FOR_RECEIPT' });
      request.status = 'RECEIVED';
      request.receivedAt = new Date();
      request.refundDestination = parsed.data.refundDestination;
    }
    await request.save();
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
      order.refundStatus = 'REFUNDED';
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

  // Vite middleware in dev, static dist in production
  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
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
    console.log(`Kala & Karat server running on http://0.0.0.0:${PORT} (DB mode: ${dbStatus.mode})`);
  });
}

startServer();
