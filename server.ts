import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
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
  findOrCreateOAuthUser,
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
} from './src/server/services/store.js';
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
  ReviewClass,
} from './src/shared/types.js';

const PORT = 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'kala-karat-dev-secret-2026';

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
    sameSite: 'none' as const,
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

async function resolveActor(req: Request, res: Response) {
  let guestToken = unsignValue(req.cookies?.kk_guest);
  if (!guestToken) {
    guestToken = `gst_${crypto.randomBytes(10).toString('hex')}`;
    res.cookie('kk_guest', signValue(guestToken), getCookieOpts());
  }
  const userId = unsignValue(req.cookies?.kk_user);
  const user = userId ? await findUserById(userId) : null;
  return { guestToken, user };
}

async function loadCartForActor(actor: { userId?: string | null; guestToken: string }): Promise<CartItem[]> {
  const cacheKey = actor.userId ? `user:${actor.userId}` : `guest:${actor.guestToken}`;
  const cached = await getCartCache(cacheKey);
  if (cached) return cached;
  return getLocalCartBackup(cacheKey);
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
  app.use(express.json({ limit: '4mb' }));
  app.use(cookieParser());

  // Static serving for generated images & Sharp WebP uploads
  app.use('/uploads', express.static(getUploadDir()));
  app.use('/src/assets', express.static(path.resolve(process.cwd(), 'src/assets')));

  // --- Health ---
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, dbMode: dbStatus.mode });
  });

  // --- Auth & Guest Session ---
  app.get('/api/auth/me', async (req, res) => {
    const { guestToken, user } = await resolveActor(req, res);
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
      likedProductIds,
      cart,
      oauthConfigured: {
        google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        meta: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET),
      },
    });
  });

  // Google & Meta OAuth 2.0 Popup URLs
  app.get('/api/auth/oauth/:provider/url', (req, res) => {
    const provider = req.params.provider;
    const baseUrl = getAppBaseUrl(req);
    if (provider === 'google') {
      if (!process.env.GOOGLE_CLIENT_ID) {
        return res.status(400).json({ error: 'GOOGLE_CLIENT_ID is not configured' });
      }
      const params = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        redirect_uri: `${baseUrl}/api/auth/oauth/google/callback`,
        response_type: 'code',
        scope: 'openid email profile',
        prompt: 'select_account',
      });
      return res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
    }
    if (provider === 'meta') {
      if (!process.env.META_APP_ID) {
        return res.status(400).json({ error: 'META_APP_ID is not configured' });
      }
      const params = new URLSearchParams({
        client_id: process.env.META_APP_ID,
        redirect_uri: `${baseUrl}/api/auth/oauth/meta/callback`,
        response_type: 'code',
        scope: 'email,public_profile',
      });
      return res.json({ url: `https://www.facebook.com/v20.0/dialog/oauth?${params}` });
    }
    return res.status(404).json({ error: 'Unknown provider' });
  });

  app.get(
    ['/api/auth/oauth/google/callback', '/api/auth/oauth/google/callback/'],
    async (req, res) => {
      try {
        const code = String(req.query.code || '');
        const baseUrl = getAppBaseUrl(req);
        const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: process.env.GOOGLE_CLIENT_ID || '',
            client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
            redirect_uri: `${baseUrl}/api/auth/oauth/google/callback`,
            grant_type: 'authorization_code',
          }),
        });
        const tokenJson = (await tokenResp.json()) as { access_token?: string };
        if (!tokenJson.access_token) throw new Error('Token exchange failed');
        const profileResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tokenJson.access_token}` },
        });
        const profile = (await profileResp.json()) as {
          id: string;
          email: string;
          name: string;
          picture?: string;
        };
        const user = await findOrCreateOAuthUser({
          provider: 'google',
          providerAccountId: profile.id,
          email: profile.email,
          name: profile.name,
          avatarUrl: profile.picture,
        });
        const { guestToken } = await resolveActor(req, res);
        await mergeGuestIntoUser(guestToken, user._id);
        const guestCart = await loadCartForActor({ userId: null, guestToken });
        if (guestCart.length > 0) {
          const existing = await loadCartForActor({ userId: user._id, guestToken });
          const merged = [...existing];
          for (const item of guestCart) {
            const match = merged.find(
              (m) => m.productId === item.productId && m.variantSku === item.variantSku
            );
            if (match) match.quantity += item.quantity;
            else merged.push(item);
          }
          await saveCartForActor({ userId: user._id, guestToken }, merged);
          await deleteCartCache(`guest:${guestToken}`);
        }
        res.cookie('kk_user', signValue(user._id), getCookieOpts());
        res.send(`<html><body><script>
          if (window.opener) {
            window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
            window.close();
          } else {
            window.location.href = '/';
          }
        </script><p>Signed in via Google. Closing window...</p></body></html>`);
      } catch (err) {
        res.status(400).send(`Google OAuth error: ${(err as Error).message}`);
      }
    }
  );

  app.get(
    ['/api/auth/oauth/meta/callback', '/api/auth/oauth/meta/callback/'],
    async (req, res) => {
      try {
        const code = String(req.query.code || '');
        const baseUrl = getAppBaseUrl(req);
        const tokenParams = new URLSearchParams({
          client_id: process.env.META_APP_ID || '',
          client_secret: process.env.META_APP_SECRET || '',
          redirect_uri: `${baseUrl}/api/auth/oauth/meta/callback`,
          code,
        });
        const tokenResp = await fetch(
          `https://graph.facebook.com/v20.0/oauth/access_token?${tokenParams}`
        );
        const tokenJson = (await tokenResp.json()) as { access_token?: string };
        if (!tokenJson.access_token) throw new Error('Meta token exchange failed');
        const profileResp = await fetch(
          `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${tokenJson.access_token}`
        );
        const profile = (await profileResp.json()) as {
          id: string;
          name: string;
          email?: string;
          picture?: { data?: { url?: string } };
        };
        const user = await findOrCreateOAuthUser({
          provider: 'meta',
          providerAccountId: profile.id,
          email: profile.email || `meta-${profile.id}@users.kalaandkarat.in`,
          name: profile.name,
          avatarUrl: profile.picture?.data?.url,
        });
        const { guestToken } = await resolveActor(req, res);
        await mergeGuestIntoUser(guestToken, user._id);
        res.cookie('kk_user', signValue(user._id), getCookieOpts());
        res.send(`<html><body><script>
          if (window.opener) {
            window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
            window.close();
          } else {
            window.location.href = '/';
          }
        </script><p>Signed in via Meta. Closing window...</p></body></html>`);
      } catch (err) {
        res.status(400).send(`Meta OAuth error: ${(err as Error).message}`);
      }
    }
  );

  // Instant Profile Sign-In & Guest Cart/Likes Merge
  app.post('/api/auth/signin', async (req, res) => {
    const schema = z.object({
      email: z.string().email(),
      name: z.string().min(2).max(80).optional(),
      provider: z.enum(['google', 'meta']).default('google'),
      quickDemoUserId: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid credentials' });
    }
    const { guestToken } = await resolveActor(req, res);
    let user = parsed.data.quickDemoUserId
      ? await findUserById(parsed.data.quickDemoUserId)
      : null;

    if (!user && parsed.data.quickDemoUserId) {
      user = await findUserByEmail(parsed.data.email);
    }

    if (!user) {
      user = await findOrCreateOAuthUser({
        provider: parsed.data.provider,
        providerAccountId: `${parsed.data.provider}-${parsed.data.email}`,
        email: parsed.data.email,
        name: parsed.data.name || parsed.data.email.split('@')[0],
        role: 'BUYER',
      });
    }

    await mergeGuestIntoUser(guestToken, user._id);

    // Merge guest cart into authenticated user cart
    const guestCart = await loadCartForActor({ userId: null, guestToken });
    if (guestCart.length > 0) {
      const userCart = await loadCartForActor({ userId: user._id, guestToken });
      const merged = [...userCart];
      for (const item of guestCart) {
        const match = merged.find(
          (m) => m.productId === item.productId && m.variantSku === item.variantSku
        );
        if (match) match.quantity += item.quantity;
        else merged.push(item);
      }
      await saveCartForActor({ userId: user._id, guestToken }, merged);
      await deleteCartCache(`guest:${guestToken}`);
    }

    res.cookie('kk_user', signValue(user._id), getCookieOpts());
    const likedProductIds = await getLikedProductIds({ userId: user._id, guestToken });
    const cart = await loadCartForActor({ userId: user._id, guestToken });
    res.json({ user, likedProductIds, cart });
  });

  app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('kk_user', getCookieOpts());
    res.json({ ok: true });
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
      email: z.string().email('Valid seller email is required'),
      storeName: z.string().max(80).optional(),
      note: z.string().max(240).optional(),
      expiresInDays: z.number().int().min(1).max(90).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid invite details' });
    }
    const invite = await createSellerInvite({
      adminId: user._id,
      adminName: user.name,
      email: parsed.data.email,
      storeName: parsed.data.storeName,
      note: parsed.data.note,
      expiresInDays: parsed.data.expiresInDays,
    });
    const baseUrl = getAppBaseUrl(req);
    const inviteUrl = `${baseUrl}/?sellerInvite=${encodeURIComponent(invite.token)}`;
    const subject = encodeURIComponent(
      `Invitation to join Kala & Karat as a Seller${invite.storeName ? ` — ${invite.storeName}` : ''}`
    );
    const body = encodeURIComponent(
      `Hello,\n\nYou have been invited by ${user.name} (Kala & Karat Admin) to onboard your atelier${invite.storeName ? ` (${invite.storeName})` : ''} on Kala & Karat.\n\nUse your private onboarding link below to complete WhatsApp verification and activate your Seller Hub:\n${inviteUrl}\n\n${invite.note ? `Admin note: ${invite.note}\n\n` : ''}This invitation expires on ${new Date(invite.expiresAt).toLocaleDateString('en-IN')}.`
    );
    const mailtoUrl = `mailto:${encodeURIComponent(invite.email)}?subject=${subject}&body=${body}`;
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
        whatsappNumber: parsed.data.whatsappNumber,
        storeName: parsed.data.storeName,
        description: parsed.data.description,
        actingUser: user,
      });
      await mergeGuestIntoUser(guestToken, result.user._id);
      res.cookie('kk_user', signValue(result.user._id), getCookieOpts());
      const likedProductIds = await getLikedProductIds({ userId: result.user._id, guestToken });
      const cart = await loadCartForActor({ userId: result.user._id, guestToken });
      res.json({ user: result.user, invite: result.invite, likedProductIds, cart });
    } catch (err) {
      res.status(403).json({ error: (err as Error).message });
    }
  });

  // --- Hybrid Search, Autocomplete & Strict limit(20) Catalog ---
  app.get('/api/products/suggest', async (req, res) => {
    const q = String(req.query.q || '');
    const suggestions = await getSearchSuggestions(q);
    res.json({ suggestions });
  });

  app.get('/api/products', async (req, res) => {
    const result = await queryProducts({
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
      category: (req.query.category as ProductCategory | 'All') || 'All',
      occasion: (req.query.occasion as OccasionType | 'All') || 'All',
      color: typeof req.query.color === 'string' ? req.query.color : undefined,
      minPrice: req.query.minPrice ? Number(req.query.minPrice) : undefined,
      maxPrice: req.query.maxPrice ? Number(req.query.maxPrice) : undefined,
      sort: (req.query.sort as SortOption) || 'most_demanding',
      page: req.query.page ? Number(req.query.page) : 1,
      limit: 20, // Strictly 20 products per page
      sellerId: typeof req.query.sellerId === 'string' ? req.query.sellerId : undefined,
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
      category: z.enum(['Artificial Jewellery', 'Clothing', 'Accessories']),
      subCategory: z.string().min(2),
      description: z.string().min(10),
      careInstructions: z.string().default('Store dry in protective pouch.'),
      basePrice: z.number().positive(),
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

    const created = await createProduct(user._id, {
      ...parsed.data,
      salePrice: Math.round(
        parsed.data.basePrice * (1 - (parsed.data.discountPercent || 0) / 100)
      ),
      isActive: true,
    });
    res.status(201).json({ product: created });
  });

  // Seller Dynamic Discount / Stock Update
  app.patch('/api/products/:id', async (req, res) => {
    const { user } = await resolveActor(req, res);
    if (!user || (user.role !== 'SELLER' && user.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'Seller access required.' });
    }
    const schema = z.object({
      discountPercent: z.number().min(0).max(95).optional(),
      salePrice: z.number().positive().optional(),
      basePrice: z.number().positive().optional(),
      totalStock: z.number().int().min(0).optional(),
      title: z.string().min(3).optional(),
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
    if (!updated) return res.status(404).json({ error: 'Product not found or unauthorized' });
    res.json({ product: updated });
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
          category: z.enum(['Artificial Jewellery', 'Clothing', 'Accessories']),
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

    const createdOrders = await createOrder({ buyer: user, items: itemsToOrder });

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

  app.post('/api/whatsapp/share', async (req, res) => {
    const schema = z.object({
      toPhone: z.string().optional().default(''),
      message: z.string().min(3).max(1000),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Share message is required' });
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
