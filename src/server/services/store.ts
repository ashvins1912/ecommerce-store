import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import sentiment from 'wink-sentiment';
import type {
  User,
  Product,
  LikeRecord,
  Review,
  Order,
  CartItem,
  SortOption,
  OrderTab,
  TimeGranularity,
  OrderTimeBucket,
  SellerAnalyticsResponse,
  ProductCategory,
  OccasionType,
  ReviewClass,
  OrderStatus,
  ProductBadge,
  ShippingAddress,
  SellerInvite,
} from '../../shared/types.js';
import { SEED_USERS, SEED_PRODUCTS, SEED_REVIEWS, SEED_ORDERS } from './seed.js';
import {
  UserModel,
  ProductModel,
  LikeModel,
  ReviewModel,
  OrderModel,
  SellerInviteModel,
} from '../models/schemas.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');

interface StoreState {
  users: User[];
  products: Product[];
  likes: LikeRecord[];
  reviews: Review[];
  orders: Order[];
  carts: Record<string, CartItem[]>;
  sellerInvites: SellerInvite[];
}

let mongoConnected = false;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadLocalStore(): StoreState {
  ensureDataDir();
  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as StoreState;
      if (parsed && Array.isArray(parsed.products) && parsed.products.length > 0) {
        if (!Array.isArray(parsed.sellerInvites)) {
          parsed.sellerInvites = [];
        }
        if (!Array.isArray(parsed.users)) {
          parsed.users = [];
        }
        let usersChanged = false;
        for (const seedUser of SEED_USERS) {
          const exists = parsed.users.some(
            (u) => u._id === seedUser._id || u.email.toLowerCase() === seedUser.email.toLowerCase()
          );
          if (!exists) {
            parsed.users.push(structuredClone(seedUser));
            usersChanged = true;
          }
        }
        if (usersChanged) {
          saveLocalStore(parsed);
        }
        return parsed;
      }
    } catch {
      // Fall through to seed
    }
  }
  const initial: StoreState = {
    users: structuredClone(SEED_USERS),
    products: structuredClone(SEED_PRODUCTS),
    likes: [],
    reviews: structuredClone(SEED_REVIEWS),
    orders: structuredClone(SEED_ORDERS),
    carts: {},
    sellerInvites: [],
  };
  saveLocalStore(initial);
  return initial;
}

function saveLocalStore(state: StoreState) {
  ensureDataDir();
  fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

const localState: StoreState = loadLocalStore();

export async function initDatabase(): Promise<{ mode: 'mongodb' | 'local' }> {
  const uri = process.env.MONGODB_URI;
  if (uri) {
    try {
      await mongoose.connect(uri);
      mongoConnected = true;
      await Promise.all([
        UserModel.syncIndexes(),
        ProductModel.syncIndexes(),
        LikeModel.syncIndexes(),
        ReviewModel.syncIndexes(),
        OrderModel.syncIndexes(),
        SellerInviteModel.syncIndexes(),
      ]);
      // Seed Atlas M0 if empty
      const productCount = await ProductModel.countDocuments();
      if (productCount === 0) {
        const idMap = new Map<string, mongoose.Types.ObjectId>();
        for (const u of SEED_USERS) {
          const oid = new mongoose.Types.ObjectId();
          idMap.set(u._id, oid);
          await UserModel.create({ ...u, _id: oid });
        }
        for (const p of SEED_PRODUCTS) {
          const oid = new mongoose.Types.ObjectId();
          idMap.set(p._id, oid);
          await ProductModel.create({
            ...p,
            _id: oid,
            sellerId: idMap.get(p.sellerId) || new mongoose.Types.ObjectId(),
          });
        }
      } else {
        // Ensure dummy test users (Buyer, Seller, Admin) always exist for testing
        for (const u of SEED_USERS) {
          const existing = await UserModel.findOne({ email: u.email.toLowerCase() }).lean();
          if (!existing) {
            await UserModel.create({ ...u, _id: new mongoose.Types.ObjectId() });
          }
        }
      }
      return { mode: 'mongodb' };
    } catch (err) {
      console.warn('MongoDB Atlas connection failed, running persistent local store:', err);
      mongoConnected = false;
    }
  }
  return { mode: 'local' };
}

export function isMongoMode(): boolean {
  return mongoConnected;
}

// Typo-tolerant Levenshtein distance for fuzzy search fallback
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function scoreFieldMatch(text: string, tokens: string[], weight: number): number {
  const lower = text.toLowerCase();
  const words = lower.split(/[^a-z0-9]+/).filter(Boolean);
  let score = 0;
  for (const token of tokens) {
    if (!token) continue;
    // Exact or edgeGram prefix match
    if (lower.includes(token)) {
      score += weight * 4;
      continue;
    }
    if (words.some((w) => w.startsWith(token))) {
      score += weight * 3;
      continue;
    }
    // Fuzzy match maxEdits: 2 (prefixLength >= 1)
    if (token.length >= 3) {
      for (const word of words) {
        if (word[0] === token[0] && Math.abs(word.length - token.length) <= 2) {
          const dist = levenshtein(token, word);
          if (dist <= 2) {
            score += weight * (dist === 1 ? 2.5 : 1.5);
            break;
          }
        }
      }
    }
  }
  return score;
}

export async function getSearchSuggestions(query: string): Promise<string[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const all = await getAllProductsRaw();
  const suggestions = new Set<string>();

  for (const occ of ['Wedding', 'Festive', 'Party', 'Office Wear', 'Casual', 'Daily Wear']) {
    if (occ.toLowerCase().startsWith(q) || occ.toLowerCase().includes(q)) {
      suggestions.add(occ);
    }
  }

  for (const p of all) {
    if (!p.isActive) continue;
    const titleLower = p.title.toLowerCase();
    const words = titleLower.split(/\s+/);
    if (titleLower.includes(q) || words.some((w) => w.startsWith(q))) {
      suggestions.add(p.title);
    } else if (q.length >= 3) {
      for (const w of words) {
        if (w[0] === q[0] && levenshtein(q, w) <= 2) {
          suggestions.add(p.title);
          break;
        }
      }
    }
    if (suggestions.size >= 8) break;
  }

  return Array.from(suggestions).slice(0, 7);
}

async function getAllProductsRaw(): Promise<Product[]> {
  if (mongoConnected) {
    const docs = await ProductModel.find({ isActive: true }).lean();
    return docs.map((d: any) => ({ ...d, _id: String(d._id), sellerId: String(d.sellerId) }));
  }
  return localState.products;
}

export interface ProductFilterQuery {
  q?: string;
  category?: ProductCategory | 'All';
  occasion?: OccasionType | 'All';
  color?: string;
  minPrice?: number;
  maxPrice?: number;
  sort?: SortOption;
  page?: number;
  limit?: number;
  sellerId?: string;
  includeInactive?: boolean;
}

function computeCategoryTop10Thresholds(products: Product[]): Record<string, number> {
  const byCategory = new Map<string, number[]>();
  for (const p of products) {
    if (!p.isActive) continue;
    const list = byCategory.get(p.category) || [];
    list.push(p.trendScore || 0);
    byCategory.set(p.category, list);
  }
  const thresholds: Record<string, number> = {};
  for (const [cat, scores] of byCategory.entries()) {
    if (scores.length === 0) continue;
    scores.sort((a, b) => b - a);
    const cutoffIdx = Math.max(0, Math.ceil(scores.length * 0.1) - 1);
    thresholds[cat] = scores[cutoffIdx];
  }
  return thresholds;
}

export async function queryProducts(filters: ProductFilterQuery): Promise<{
  products: Product[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  categoryTop10Thresholds: Record<string, number>;
}> {
  const page = Math.max(1, filters.page || 1);
  // Strict limit(20) pagination rule for storefront listings
  const limit = Math.min(20, Math.max(1, filters.limit || 20));
  const allActiveProducts = await getAllProductsRaw();
  const categoryTop10Thresholds = computeCategoryTop10Thresholds(allActiveProducts);

  // If MongoDB Atlas Search ($search) is enabled & configured, try $search pipeline first
  if (mongoConnected && filters.q && filters.q.trim().length >= 2) {
    try {
      const searchPipeline: any[] = [
        {
          $search: {
            index: 'products_hybrid_search',
            compound: {
              should: [
                {
                  autocomplete: {
                    query: filters.q.trim(),
                    path: 'title',
                    score: { boost: { value: 3 } },
                  },
                },
                {
                  autocomplete: {
                    query: filters.q.trim(),
                    path: 'occasions',
                    score: { boost: { value: 2 } },
                  },
                },
                {
                  text: {
                    query: filters.q.trim(),
                    path: 'title',
                    fuzzy: { maxEdits: 2, prefixLength: 1 },
                    score: { boost: { value: 3 } },
                  },
                },
                {
                  text: {
                    query: filters.q.trim(),
                    path: ['occasions', 'category'],
                    fuzzy: { maxEdits: 2, prefixLength: 1 },
                    score: { boost: { value: 2 } },
                  },
                },
                {
                  text: {
                    query: filters.q.trim(),
                    path: 'description',
                    fuzzy: { maxEdits: 2, prefixLength: 1 },
                    score: { boost: { value: 1 } },
                  },
                },
              ],
              minimumShouldMatch: 1,
            },
          },
        },
        {
          $addFields: {
            hybridScore: {
              $add: [
                { $meta: 'searchScore' },
                { $multiply: [{ $ifNull: ['$trendScore', 0] }, 0.01] },
              ],
            },
          },
        },
        { $match: { isActive: true } },
        { $sort: { hybridScore: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
      ];
      const atlasResults = await ProductModel.aggregate(searchPipeline);
      if (atlasResults.length > 0) {
        return {
          products: atlasResults.map((d: any) => ({ ...d, _id: String(d._id), sellerId: String(d.sellerId) })),
          total: atlasResults.length,
          page,
          limit,
          totalPages: Math.max(1, Math.ceil(atlasResults.length / limit)),
          categoryTop10Thresholds,
        };
      }
    } catch {
      // Fallback to Mongoose / hybrid in-app fuzzy scoring if Atlas Search index isn't provisioned yet
    }
  }

  let items = allActiveProducts.filter((p) =>
    filters.includeInactive ? true : p.isActive
  );

  if (filters.sellerId) {
    items = items.filter((p) => p.sellerId === filters.sellerId);
  }
  if (filters.category && filters.category !== 'All') {
    items = items.filter((p) => p.category === filters.category);
  }
  if (filters.occasion && filters.occasion !== 'All') {
    items = items.filter((p) => p.occasions.includes(filters.occasion as OccasionType));
  }
  if (filters.color && filters.color.trim()) {
    const c = filters.color.toLowerCase();
    items = items.filter((p) =>
      p.variants.some((v) => v.colorName.toLowerCase().includes(c))
    );
  }
  if (typeof filters.minPrice === 'number' && !Number.isNaN(filters.minPrice)) {
    items = items.filter((p) => p.salePrice >= filters.minPrice!);
  }
  if (typeof filters.maxPrice === 'number' && !Number.isNaN(filters.maxPrice)) {
    items = items.filter((p) => p.salePrice <= filters.maxPrice!);
  }

  const searchTokens = (filters.q || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 1);

  const scored = items.map((p) => {
    let relevance = 0;
    if (searchTokens.length > 0) {
      relevance += scoreFieldMatch(p.title, searchTokens, 3);
      relevance += scoreFieldMatch(
        `${p.occasions.join(' ')} ${p.category} ${p.subCategory}`,
        searchTokens,
        2
      );
      relevance += scoreFieldMatch(p.description, searchTokens, 1);
    }
    return {
      product: p,
      relevance,
      hybrid: relevance + p.trendScore * 0.008,
    };
  });

  const filteredScored =
    searchTokens.length > 0 ? scored.filter((s) => s.relevance > 0) : scored;

  const sort = filters.sort || 'most_demanding';
  filteredScored.sort((a, b) => {
    if (searchTokens.length > 0 && Math.abs(b.hybrid - a.hybrid) > 0.25) {
      return b.hybrid - a.hybrid;
    }
    switch (sort) {
      case 'newly_added':
        return new Date(b.product.createdAt).getTime() - new Date(a.product.createdAt).getTime();
      case 'special_offers':
        return b.product.discountPercent - a.product.discountPercent || b.product.trendScore - a.product.trendScore;
      case 'fast_selling':
        return b.product.salesCount - a.product.salesCount;
      case 'occasion_favorites':
        return b.product.likesCount + b.product.salesCount - (a.product.likesCount + a.product.salesCount);
      case 'price_asc':
        return a.product.salePrice - b.product.salePrice;
      case 'price_desc':
        return b.product.salePrice - a.product.salePrice;
      case 'highest_rated':
        return b.product.averageRating - a.product.averageRating || b.product.reviewCount - a.product.reviewCount;
      case 'most_demanding':
      default:
        return b.product.trendScore - a.product.trendScore;
    }
  });

  const total = filteredScored.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * limit;
  const paged = filteredScored.slice(start, start + limit).map((s) => s.product);

  return {
    products: paged,
    total,
    page: safePage,
    limit,
    totalPages,
    categoryTop10Thresholds,
  };
}

export async function getProductByIdOrSlug(idOrSlug: string): Promise<Product | null> {
  if (mongoConnected) {
    const query = mongoose.isValidObjectId(idOrSlug)
      ? { $or: [{ _id: idOrSlug }, { slug: idOrSlug }] }
      : { slug: idOrSlug };
    const doc = await ProductModel.findOne(query).lean();
    if (!doc) return null;
    return { ...(doc as any), _id: String((doc as any)._id), sellerId: String((doc as any).sellerId) };
  }
  return (
    localState.products.find((p) => p._id === idOrSlug || p.slug === idOrSlug) || null
  );
}

export async function incrementProductView(productId: string): Promise<void> {
  if (mongoConnected && mongoose.isValidObjectId(productId)) {
    await ProductModel.updateOne({ _id: productId }, { $inc: { viewsCount: 1 } });
    return;
  }
  const prod = localState.products.find((p) => p._id === productId);
  if (prod) {
    prod.viewsCount += 1;
    saveLocalStore(localState);
  }
}

export async function createProduct(sellerId: string, payload: Omit<Product, '_id' | 'sellerId' | 'slug' | 'likesCount' | 'viewsCount' | 'cartAddsCount' | 'salesCount' | 'trendScore' | 'averageRating' | 'reviewCount' | 'badges' | 'isProductTrusted' | 'createdAt' | 'updatedAt'>): Promise<Product> {
  const seller = await findUserById(sellerId);
  const nowIso = new Date().toISOString();
  const baseSlug = payload.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const slug = `${baseSlug}-${crypto.randomBytes(2).toString('hex')}`;
  const salePrice = Math.round(payload.basePrice * (1 - (payload.discountPercent || 0) / 100));
  const badges: ProductBadge[] = ['Newly Added'];
  if ((payload.discountPercent || 0) >= 15) badges.push('Special Offer');
  if (seller?.sellerProfile?.isTrustedSeller) badges.push('Seller Trusted');

  const newProduct: Product = {
    ...payload,
    _id: `prd_${crypto.randomBytes(5).toString('hex')}`,
    sellerId,
    sellerName: seller?.sellerProfile?.storeName || seller?.name || 'Verified Seller',
    sellerTrusted: Boolean(seller?.sellerProfile?.isTrustedSeller),
    slug,
    salePrice,
    likesCount: 0,
    viewsCount: 1,
    cartAddsCount: 0,
    salesCount: 0,
    trendScore: 0,
    averageRating: 0,
    reviewCount: 0,
    badges,
    isProductTrusted: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  if (mongoConnected && mongoose.isValidObjectId(sellerId)) {
    const doc = await ProductModel.create({
      ...newProduct,
      _id: new mongoose.Types.ObjectId(),
      sellerId: new mongoose.Types.ObjectId(sellerId),
    });
    return { ...newProduct, _id: String(doc._id) };
  }

  localState.products.unshift(newProduct);
  saveLocalStore(localState);
  return newProduct;
}

export async function updateProductDiscountOrStock(
  productId: string,
  sellerId: string,
  updates: {
    discountPercent?: number;
    salePrice?: number;
    basePrice?: number;
    totalStock?: number;
    title?: string;
    occasions?: OccasionType[];
    images?: Product['images'];
  }
): Promise<Product | null> {
  const existing = await getProductByIdOrSlug(productId);
  if (!existing) return null;
  if (existing.sellerId !== sellerId) {
    // Allow admin or owner
    const actor = await findUserById(sellerId);
    if (actor?.role !== 'ADMIN') return null;
  }

  const basePrice = updates.basePrice ?? existing.basePrice;
  let discountPercent = updates.discountPercent ?? existing.discountPercent;
  let salePrice = updates.salePrice ?? existing.salePrice;

  if (typeof updates.discountPercent === 'number') {
    discountPercent = Math.max(0, Math.min(95, updates.discountPercent));
    salePrice = Math.round(basePrice * (1 - discountPercent / 100));
  } else if (typeof updates.salePrice === 'number') {
    salePrice = Math.max(1, Math.min(basePrice, updates.salePrice));
    discountPercent = Math.round(((basePrice - salePrice) / basePrice) * 100);
  }

  const badges = new Set<ProductBadge>(existing.badges);
  if (discountPercent >= 15) badges.add('Special Offer');
  else badges.delete('Special Offer');

  const normalizedImages =
    updates.images && updates.images.length > 0
      ? updates.images.map((img, idx) => ({ ...img, sortOrder: idx }))
      : undefined;

  const patch = {
    ...(updates.title ? { title: updates.title } : {}),
    ...(updates.occasions ? { occasions: updates.occasions } : {}),
    ...(normalizedImages ? { images: normalizedImages } : {}),
    ...(typeof updates.totalStock === 'number' ? { totalStock: updates.totalStock } : {}),
    basePrice,
    discountPercent,
    salePrice,
    badges: Array.from(badges),
    updatedAt: new Date().toISOString(),
  };

  if (mongoConnected && mongoose.isValidObjectId(productId)) {
    const updated = await ProductModel.findByIdAndUpdate(productId, { $set: patch }, { new: true }).lean();
    return updated ? { ...(updated as any), _id: String((updated as any)._id) } : null;
  }

  Object.assign(existing, patch);
  saveLocalStore(localState);
  return existing;
}

// --- Users & Auth ---

export async function findUserById(id: string): Promise<User | null> {
  if (mongoConnected && mongoose.isValidObjectId(id)) {
    const doc = await UserModel.findById(id).lean();
    return doc ? { ...(doc as any), _id: String((doc as any)._id) } : null;
  }
  return localState.users.find((u) => u._id === id) || null;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const emailLower = email.trim().toLowerCase();
  if (mongoConnected) {
    const doc = await UserModel.findOne({ email: emailLower }).lean();
    return doc ? { ...(doc as any), _id: String((doc as any)._id) } : null;
  }
  return localState.users.find((u) => u.email.toLowerCase() === emailLower) || null;
}

export async function findOrCreateOAuthUser(profile: {
  provider: 'google' | 'meta';
  providerAccountId: string;
  email: string;
  name: string;
  avatarUrl?: string;
  role?: 'BUYER' | 'SELLER' | 'ADMIN';
}): Promise<User> {
  const emailLower = profile.email.toLowerCase();
  if (mongoConnected) {
    let doc = await UserModel.findOne({ email: emailLower });
    if (!doc) {
      doc = await UserModel.create({
        role: profile.role || 'BUYER',
        name: profile.name,
        email: emailLower,
        avatarUrl: profile.avatarUrl,
        oauthAccounts: [
          { provider: profile.provider, providerAccountId: profile.providerAccountId },
        ],
        isWhatsappVerified: false,
        shippingAddresses: [],
      });
    } else if (
      !doc.oauthAccounts.some(
        (a: any) => a.provider === profile.provider && a.providerAccountId === profile.providerAccountId
      )
    ) {
      doc.oauthAccounts.push({
        provider: profile.provider,
        providerAccountId: profile.providerAccountId,
      });
      await doc.save();
    }
    const obj = doc.toObject();
    return { ...obj, _id: String(obj._id) };
  }

  let user = localState.users.find((u) => u.email.toLowerCase() === emailLower);
  if (!user) {
    const nowIso = new Date().toISOString();
    user = {
      _id: `usr_${crypto.randomBytes(5).toString('hex')}`,
      role: profile.role || 'BUYER',
      name: profile.name,
      email: emailLower,
      avatarUrl: profile.avatarUrl,
      oauthAccounts: [
        { provider: profile.provider, providerAccountId: profile.providerAccountId },
      ],
      isWhatsappVerified: false,
      shippingAddresses: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    localState.users.push(user);
    saveLocalStore(localState);
  }
  return user;
}

export async function updateUserCheckoutProfile(
  userId: string,
  mobileNumber: string,
  address: Omit<ShippingAddress, '_id' | 'isDefault'> & { label?: string }
): Promise<User | null> {
  const newAddress: ShippingAddress = {
    _id: `addr_${crypto.randomBytes(4).toString('hex')}`,
    label: address.label || 'Home',
    fullName: address.fullName,
    phone: mobileNumber,
    street: address.street,
    city: address.city,
    state: address.state,
    pincode: address.pincode,
    isDefault: true,
  };

  if (mongoConnected && mongoose.isValidObjectId(userId)) {
    const doc = await UserModel.findById(userId);
    if (!doc) return null;
    doc.mobileNumber = mobileNumber;
    doc.shippingAddresses.forEach((a: any) => {
      a.isDefault = false;
    });
    doc.shippingAddresses.unshift(newAddress);
    await doc.save();
    const obj = doc.toObject();
    return { ...obj, _id: String(obj._id) };
  }

  const user = localState.users.find((u) => u._id === userId);
  if (!user) return null;
  user.mobileNumber = mobileNumber;
  user.shippingAddresses = [
    newAddress,
    ...user.shippingAddresses.map((a) => ({ ...a, isDefault: false })),
  ];
  user.updatedAt = new Date().toISOString();
  saveLocalStore(localState);
  return user;
}

export async function activateSellerProfile(
  userId: string,
  whatsappNumber: string,
  storeName: string,
  description: string
): Promise<User | null> {
  const sellerProfile = {
    storeName,
    description,
    trustScore: 4.8,
    isTrustedSeller: true,
    totalOrders: 0,
    cancelledOrders: 0,
  };

  if (mongoConnected && mongoose.isValidObjectId(userId)) {
    const doc = await UserModel.findByIdAndUpdate(
      userId,
      {
        $set: {
          role: 'SELLER',
          whatsappNumber,
          isWhatsappVerified: true,
          sellerProfile,
        },
      },
      { new: true }
    ).lean();
    return doc ? { ...(doc as any), _id: String((doc as any)._id) } : null;
  }

  const user = localState.users.find((u) => u._id === userId);
  if (!user) return null;
  user.role = 'SELLER';
  user.whatsappNumber = whatsappNumber;
  user.isWhatsappVerified = true;
  user.sellerProfile = user.sellerProfile || sellerProfile;
  user.updatedAt = new Date().toISOString();
  saveLocalStore(localState);
  return user;
}

// --- Likes & Guest-to-User Merge ---

export async function getLikedProductIds(actor: {
  userId?: string | null;
  guestToken?: string | null;
}): Promise<string[]> {
  if (mongoConnected) {
    if (actor.userId && mongoose.isValidObjectId(actor.userId)) {
      const docs = await LikeModel.find({ userId: actor.userId }).select('productId').lean();
      return docs.map((d: any) => String(d.productId));
    }
    if (actor.guestToken) {
      const docs = await LikeModel.find({ guestToken: actor.guestToken }).select('productId').lean();
      return docs.map((d: any) => String(d.productId));
    }
    return [];
  }

  return localState.likes
    .filter((l) =>
      actor.userId ? l.userId === actor.userId : Boolean(actor.guestToken && l.guestToken === actor.guestToken)
    )
    .map((l) => l.productId);
}

export async function getLikedProductsForActor(actor: {
  userId?: string | null;
  guestToken?: string | null;
}): Promise<Product[]> {
  const likedIds = await getLikedProductIds(actor);
  if (likedIds.length === 0) return [];
  if (mongoConnected) {
    const validIds = likedIds.filter((id) => mongoose.isValidObjectId(id));
    if (validIds.length === 0) return [];
    const docs = await ProductModel.find({ _id: { $in: validIds }, isActive: true }).lean();
    return docs.map((d: any) => ({ ...d, _id: String(d._id), sellerId: String(d.sellerId) }));
  }
  const idSet = new Set(likedIds);
  return localState.products.filter((p) => p.isActive && idSet.has(p._id));
}

export async function toggleProductLike(
  productId: string,
  actor: { userId?: string | null; guestToken?: string | null }
): Promise<{ liked: boolean; likesCount: number }> {
  if (mongoConnected && mongoose.isValidObjectId(productId)) {
    const filter = actor.userId
      ? { productId, userId: actor.userId }
      : { productId, guestToken: actor.guestToken };
    const existing = await LikeModel.findOne(filter);
    let liked = false;
    if (existing) {
      await LikeModel.deleteOne({ _id: existing._id });
      await ProductModel.updateOne({ _id: productId }, { $inc: { likesCount: -1, trendScore: -1 } });
      liked = false;
    } else {
      await LikeModel.create({
        productId,
        userId: actor.userId || null,
        guestToken: actor.userId ? null : actor.guestToken,
      });
      await ProductModel.updateOne({ _id: productId }, { $inc: { likesCount: 1, trendScore: 1 } });
      liked = true;
    }
    const prod = await ProductModel.findById(productId).select('likesCount').lean();
    return { liked, likesCount: Math.max(0, (prod as any)?.likesCount || 0) };
  }

  const idx = localState.likes.findIndex((l) =>
    l.productId === productId &&
    (actor.userId ? l.userId === actor.userId : l.guestToken === actor.guestToken)
  );
  const prod = localState.products.find((p) => p._id === productId);
  if (!prod) throw new Error('Product not found');

  let liked = false;
  if (idx >= 0) {
    localState.likes.splice(idx, 1);
    prod.likesCount = Math.max(0, prod.likesCount - 1);
    liked = false;
  } else {
    localState.likes.push({
      _id: `lk_${crypto.randomBytes(4).toString('hex')}`,
      productId,
      userId: actor.userId || null,
      guestToken: actor.userId ? null : actor.guestToken || null,
      createdAt: new Date().toISOString(),
    });
    prod.likesCount += 1;
    liked = true;
  }
  prod.trendScore = prod.likesCount + prod.cartAddsCount * 3 + prod.salesCount * 5;
  saveLocalStore(localState);
  return { liked, likesCount: prod.likesCount };
}

export async function mergeGuestIntoUser(guestToken: string, userId: string): Promise<void> {
  if (!guestToken || !userId) return;

  if (mongoConnected && mongoose.isValidObjectId(userId)) {
    const guestLikes = await LikeModel.find({ guestToken }).lean();
    for (const gl of guestLikes) {
      const exists = await LikeModel.findOne({ productId: gl.productId, userId });
      if (!exists) {
        await LikeModel.updateOne({ _id: gl._id }, { $set: { userId, guestToken: null } });
      } else {
        await LikeModel.deleteOne({ _id: gl._id });
      }
    }
    return;
  }

  const userLikeSet = new Set(
    localState.likes.filter((l) => l.userId === userId).map((l) => l.productId)
  );
  const remaining: LikeRecord[] = [];
  for (const like of localState.likes) {
    if (like.guestToken === guestToken) {
      if (!userLikeSet.has(like.productId)) {
        remaining.push({ ...like, userId, guestToken: null });
        userLikeSet.add(like.productId);
      }
    } else {
      remaining.push(like);
    }
  }
  localState.likes = remaining;

  // Merge local cart backup
  const guestCart = localState.carts[`guest:${guestToken}`] || [];
  const userCart = localState.carts[`user:${userId}`] || [];
  if (guestCart.length > 0) {
    const merged = [...userCart];
    for (const item of guestCart) {
      const found = merged.find(
        (m) => m.productId === item.productId && m.variantSku === item.variantSku
      );
      if (found) found.quantity += item.quantity;
      else merged.push(item);
    }
    localState.carts[`user:${userId}`] = merged;
    delete localState.carts[`guest:${guestToken}`];
  }
  saveLocalStore(localState);
}

export async function incrementCartAddCount(productId: string): Promise<void> {
  if (mongoConnected && mongoose.isValidObjectId(productId)) {
    await ProductModel.updateOne({ _id: productId }, { $inc: { cartAddsCount: 1, trendScore: 3 } });
    return;
  }
  const prod = localState.products.find((p) => p._id === productId);
  if (prod) {
    prod.cartAddsCount += 1;
    prod.trendScore = prod.likesCount + prod.cartAddsCount * 3 + prod.salesCount * 5;
    saveLocalStore(localState);
  }
}

// --- Reviews & Classed Sentiment ---

export async function getProductReviews(productId: string): Promise<Review[]> {
  if (mongoConnected && mongoose.isValidObjectId(productId)) {
    const docs = await ReviewModel.find({ productId }).sort({ createdAt: -1 }).lean();
    return docs.map((d: any) => ({ ...d, _id: String(d._id), productId: String(d.productId) }));
  }
  return localState.reviews
    .filter((r) => r.productId === productId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function createVerifiedReview(input: {
  productId: string;
  userId: string;
  userName: string;
  orderId?: string;
  rating: number;
  comment: string;
  images?: string[];
  reviewClasses: ReviewClass[];
}): Promise<Review> {
  // Verify user has a delivered order containing this product (or pick matching delivered order)
  const userOrders = await getOrdersForUser(input.userId, 'BUYER', 'Completed', 0, 50);
  const matchingOrder = userOrders.orders.find(
    (o) =>
      (!input.orderId || o._id === input.orderId) &&
      o.items.some((i) => i.productId === input.productId)
  );
  if (!matchingOrder) {
    throw new Error('Verified purchase required: only buyers with Delivered orders can review.');
  }

  const analysis = sentiment(input.comment);
  const sentimentLabel =
    analysis.score > 0 ? 'Positive' : analysis.score < 0 ? 'Negative' : 'Neutral';

  const newReview: Review = {
    _id: `rev_${crypto.randomBytes(5).toString('hex')}`,
    productId: input.productId,
    userId: input.userId,
    userName: input.userName,
    orderId: matchingOrder._id,
    rating: input.rating,
    comment: input.comment,
    images: input.images || [],
    reviewClasses: input.reviewClasses.length > 0 ? input.reviewClasses : ['Quality'],
    sentiment: sentimentLabel,
    sentimentScore: analysis.score,
    createdAt: new Date().toISOString(),
  };

  if (mongoConnected && mongoose.isValidObjectId(input.productId)) {
    const created = await ReviewModel.create({
      ...newReview,
      _id: new mongoose.Types.ObjectId(),
      productId: new mongoose.Types.ObjectId(input.productId),
      userId: new mongoose.Types.ObjectId(input.userId),
      orderId: new mongoose.Types.ObjectId(matchingOrder._id),
    });
    const allRevs = await ReviewModel.find({ productId: input.productId }).lean();
    const avg =
      allRevs.reduce((s: number, r: any) => s + r.rating, 0) / Math.max(1, allRevs.length);
    await ProductModel.updateOne(
      { _id: input.productId },
      {
        $set: {
          averageRating: Number(avg.toFixed(1)),
          reviewCount: allRevs.length,
          isProductTrusted: avg >= 4.5,
        },
      }
    );
    return { ...newReview, _id: String(created._id) };
  }

  localState.reviews.unshift(newReview);
  const productRevs = localState.reviews.filter((r) => r.productId === input.productId);
  const avg =
    productRevs.reduce((s, r) => s + r.rating, 0) / Math.max(1, productRevs.length);
  const prod = localState.products.find((p) => p._id === input.productId);
  if (prod) {
    prod.averageRating = Number(avg.toFixed(1));
    prod.reviewCount = productRevs.length;
    prod.isProductTrusted = avg >= 4.5;
  }
  saveLocalStore(localState);
  return newReview;
}

// --- Orders, Strict limit(5) Pagination & $dateTrunc Time Reporting ---

function matchesOrderTab(status: OrderStatus, tab: OrderTab): boolean {
  if (tab === 'Current') {
    return ['Pending', 'Confirmed', 'Packed', 'Shipped', 'Out for Delivery'].includes(status);
  }
  if (tab === 'Completed') {
    return status === 'Delivered';
  }
  // 'Past' includes Delivered & Cancelled
  return status === 'Delivered' || status === 'Cancelled';
}

export async function getOrdersForUser(
  actorId: string,
  role: 'BUYER' | 'SELLER' | 'ADMIN',
  tab: OrderTab,
  skip = 0,
  limit = 5
): Promise<{ orders: Order[]; total: number; hasMore: boolean; nextSkip: number }> {
  const safeLimit = Math.min(50, Math.max(1, limit));

  if (mongoConnected && mongoose.isValidObjectId(actorId)) {
    const statusList: OrderStatus[] =
      tab === 'Current'
        ? ['Pending', 'Confirmed', 'Packed', 'Shipped', 'Out for Delivery']
        : tab === 'Completed'
          ? ['Delivered']
          : ['Delivered', 'Cancelled'];

    const match: any = { status: { $in: statusList } };
    if (role === 'BUYER') match.buyerId = actorId;
    else if (role === 'SELLER') match.sellerId = actorId;

    const [docs, total] = await Promise.all([
      OrderModel.find(match).sort({ createdAt: -1 }).skip(skip).limit(safeLimit).lean(),
      OrderModel.countDocuments(match),
    ]);
    const orders = docs.map((d: any) => ({
      ...d,
      _id: String(d._id),
      buyerId: String(d.buyerId),
      sellerId: String(d.sellerId),
    }));
    return {
      orders,
      total,
      hasMore: skip + orders.length < total,
      nextSkip: skip + orders.length,
    };
  }

  const filtered = localState.orders
    .filter((o) => {
      const ownerMatch =
        role === 'ADMIN' ? true : role === 'SELLER' ? o.sellerId === actorId : o.buyerId === actorId;
      return ownerMatch && matchesOrderTab(o.status, tab);
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const slice = filtered.slice(skip, skip + safeLimit);
  return {
    orders: slice,
    total: filtered.length,
    hasMore: skip + slice.length < filtered.length,
    nextSkip: skip + slice.length,
  };
}

export async function createOrder(input: {
  buyer: User;
  items: CartItem[];
}): Promise<Order[]> {
  if (!input.buyer.mobileNumber || input.buyer.shippingAddresses.length === 0) {
    throw new Error('MOBILE_AND_ADDRESS_REQUIRED');
  }
  const addr =
    input.buyer.shippingAddresses.find((a) => a.isDefault) || input.buyer.shippingAddresses[0];

  // Group cart items by sellerId
  const bySeller = new Map<string, CartItem[]>();
  for (const item of input.items) {
    const list = bySeller.get(item.sellerId) || [];
    list.push(item);
    bySeller.set(item.sellerId, list);
  }

  const createdOrders: Order[] = [];
  const nowIso = new Date().toISOString();

  for (const [sellerId, sellerItems] of bySeller.entries()) {
    const orderNumber = `ORD-2026-${Math.floor(10000 + Math.random() * 89999)}`;
    const totalAmount = sellerItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

    const order: Order = {
      _id: `ord_${crypto.randomBytes(5).toString('hex')}`,
      orderNumber,
      buyerId: input.buyer._id,
      buyerName: input.buyer.name,
      sellerId,
      items: sellerItems.map((i) => ({
        productId: i.productId,
        variantSku: i.variantSku,
        title: i.title,
        size: i.size,
        colorName: i.colorName,
        imageUrl: i.imageUrl,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
      totalAmount,
      status: 'Pending',
      shippingAddress: {
        fullName: addr.fullName,
        phone: addr.phone,
        street: addr.street,
        city: addr.city,
        state: addr.state,
        pincode: addr.pincode,
      },
      statusTimeline: [
        {
          status: 'Pending',
          note: 'Order placed via Kala & Karat',
          timestamp: nowIso,
        },
      ],
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    if (mongoConnected && mongoose.isValidObjectId(input.buyer._id)) {
      const doc = await OrderModel.create({
        ...order,
        _id: new mongoose.Types.ObjectId(),
        buyerId: new mongoose.Types.ObjectId(input.buyer._id),
        sellerId: new mongoose.Types.ObjectId(sellerId),
      });
      order._id = String(doc._id);
      for (const item of sellerItems) {
        if (mongoose.isValidObjectId(item.productId)) {
          await ProductModel.updateOne(
            { _id: item.productId },
            { $inc: { salesCount: item.quantity, totalStock: -item.quantity, trendScore: item.quantity * 5 } }
          );
        }
      }
    } else {
      localState.orders.unshift(order);
      for (const item of sellerItems) {
        const prod = localState.products.find((p) => p._id === item.productId);
        if (prod) {
          prod.salesCount += item.quantity;
          prod.totalStock = Math.max(0, prod.totalStock - item.quantity);
          prod.trendScore = prod.likesCount + prod.cartAddsCount * 3 + prod.salesCount * 5;
        }
      }
      saveLocalStore(localState);
    }

    createdOrders.push(order);
  }

  return createdOrders;
}

export async function updateOrderStatusOrTracking(
  orderId: string,
  updates: {
    status: OrderStatus;
    note?: string;
    courierTracking?: { companyName: string; trackingId: string; trackingUrl: string };
  }
): Promise<Order | null> {
  const nowIso = new Date().toISOString();

  if (mongoConnected && mongoose.isValidObjectId(orderId)) {
    const doc = await OrderModel.findById(orderId);
    if (!doc) return null;
    doc.status = updates.status;
    if (updates.courierTracking) {
      doc.courierTracking = {
        ...updates.courierTracking,
        shippedAt: new Date(),
      };
    }
    doc.statusTimeline.push({
      status: updates.status,
      note: updates.note || `Updated to ${updates.status}`,
      timestamp: new Date(),
    });
    await doc.save();
    const obj = doc.toObject();
    return { ...obj, _id: String(obj._id), buyerId: String(obj.buyerId), sellerId: String(obj.sellerId) };
  }

  const order = localState.orders.find((o) => o._id === orderId);
  if (!order) return null;
  order.status = updates.status;
  if (updates.courierTracking) {
    order.courierTracking = {
      ...updates.courierTracking,
      shippedAt: nowIso,
    };
  }
  order.statusTimeline.push({
    status: updates.status,
    note: updates.note || `Updated to ${updates.status}`,
    timestamp: nowIso,
  });
  order.updatedAt = nowIso;
  saveLocalStore(localState);
  return order;
}

function truncateDateBucket(dateStr: string, granularity: TimeGranularity): string {
  const d = new Date(dateStr);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');

  if (granularity === 'year') return `${year}`;
  if (granularity === 'month') return `${year}-${month}`;
  if (granularity === 'week') {
    const tmp = new Date(Date.UTC(year, d.getUTCMonth(), d.getUTCDate()));
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() - dayNum + 1);
    return `${tmp.getUTCFullYear()}-${String(tmp.getUTCMonth() + 1).padStart(2, '0')}-${String(
      tmp.getUTCDate()
    ).padStart(2, '0')}`;
  }
  return `${year}-${month}-${day}`;
}

export async function aggregateOrderHistoryByDate(
  actorId: string,
  role: 'BUYER' | 'SELLER' | 'ADMIN',
  granularity: TimeGranularity
): Promise<OrderTimeBucket[]> {
  if (mongoConnected && mongoose.isValidObjectId(actorId)) {
    const match: any = { status: { $ne: 'Cancelled' } };
    if (role === 'BUYER') match.buyerId = new mongoose.Types.ObjectId(actorId);
    else if (role === 'SELLER') match.sellerId = new mongoose.Types.ObjectId(actorId);

    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: {
            $dateTrunc: {
              date: '$createdAt',
              unit: granularity,
            },
          },
          ordersCount: { $sum: 1 },
          revenue: { $sum: '$totalAmount' },
          unitsSold: { $sum: { $sum: '$items.quantity' } },
        },
      },
      { $sort: { _id: 1 as const } },
    ];
    const rows = await OrderModel.aggregate(pipeline);
    return rows.map((r: any) => ({
      period: truncateDateBucket(new Date(r._id).toISOString(), granularity),
      ordersCount: r.ordersCount,
      revenue: r.revenue,
      unitsSold: r.unitsSold,
    }));
  }

  const relevant = localState.orders.filter((o) => {
    if (o.status === 'Cancelled') return false;
    if (role === 'ADMIN') return true;
    return role === 'SELLER' ? o.sellerId === actorId : o.buyerId === actorId;
  });

  const buckets = new Map<string, OrderTimeBucket>();
  for (const order of relevant) {
    const key = truncateDateBucket(order.createdAt, granularity);
    const prev = buckets.get(key) || { period: key, ordersCount: 0, revenue: 0, unitsSold: 0 };
    prev.ordersCount += 1;
    prev.revenue += order.totalAmount;
    prev.unitsSold += order.items.reduce((s, i) => s + i.quantity, 0);
    buckets.set(key, prev);
  }

  return Array.from(buckets.values()).sort((a, b) => a.period.localeCompare(b.period));
}

// --- Zero-Cost Hybrid Recommendation Engine ---
// Combines Collaborative Filtering (co-purchased items in orders) + Content-Based Filtering (occasion/category/plating/price)

export async function getHybridRecommendations(productId: string, limit = 4): Promise<{
  recommendations: Product[];
  strategySummary: string;
}> {
  const target = await getProductByIdOrSlug(productId);
  if (!target) return { recommendations: [], strategySummary: '' };

  const coPurchaseScores = new Map<string, number>();

  if (mongoConnected && mongoose.isValidObjectId(productId)) {
    const coOccurring = await OrderModel.aggregate([
      { $match: { 'items.productId': new mongoose.Types.ObjectId(productId) } },
      { $unwind: '$items' },
      { $match: { 'items.productId': { $ne: new mongoose.Types.ObjectId(productId) } } },
      { $group: { _id: '$items.productId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);
    for (const row of coOccurring) {
      coPurchaseScores.set(String(row._id), row.count * 25);
    }
  } else {
    for (const order of localState.orders) {
      if (order.items.some((i) => i.productId === productId)) {
        for (const item of order.items) {
          if (item.productId !== productId) {
            coPurchaseScores.set(
              item.productId,
              (coPurchaseScores.get(item.productId) || 0) + 25
            );
          }
        }
      }
    }
  }

  const all = (await getAllProductsRaw()).filter(
    (p) => p.isActive && p._id !== target._id
  );

  const ranked = all.map((cand) => {
    let score = coPurchaseScores.get(cand._id) || 0;
    // Occasion overlap
    const sharedOccasions = cand.occasions.filter((o) => target.occasions.includes(o)).length;
    score += sharedOccasions * 12;

    // Cross-category styling affinity (jewellery + clothing/potli) vs same category
    if (cand.category !== target.category && sharedOccasions > 0) {
      score += 10; // Complete the look bonus
    } else if (cand.category === target.category) {
      score += 6;
    }

    // Color/plating affinity
    const targetColors = new Set(target.variants.map((v) => v.colorName.toLowerCase()));
    if (cand.variants.some((v) => targetColors.has(v.colorName.toLowerCase()))) {
      score += 8;
    }

    // Price proximity
    const priceRatio = Math.min(cand.salePrice, target.salePrice) / Math.max(1, Math.max(cand.salePrice, target.salePrice));
    score += priceRatio * 6;
    score += cand.trendScore * 0.005;

    return { product: cand, score };
  });

  ranked.sort((a, b) => b.score - a.score);
  return {
    recommendations: ranked.slice(0, limit).map((r) => r.product),
    strategySummary:
      coPurchaseScores.size > 0
        ? 'Co-purchased in verified orders & occasion-matched styling'
        : 'Matched by shared occasions, finish, and price band',
  };
}

// --- Seller Analytics Dashboard ---

export async function getSellerAnalytics(
  sellerId: string,
  granularity: TimeGranularity
): Promise<SellerAnalyticsResponse> {
  const user = await findUserById(sellerId);
  const isAdmin = user?.role === 'ADMIN';

  const sellerProducts = (await getAllProductsRaw()).filter((p) =>
    isAdmin ? true : p.sellerId === sellerId
  );
  const sellerOrders = localState.orders.filter(
    (o) => (isAdmin ? true : o.sellerId === sellerId) && o.status !== 'Cancelled'
  );

  const totalViews = sellerProducts.reduce((s, p) => s + p.viewsCount, 0);
  const totalLikes = sellerProducts.reduce((s, p) => s + p.likesCount, 0);
  const totalCartAdds = sellerProducts.reduce((s, p) => s + p.cartAddsCount, 0);
  const totalPurchases = sellerProducts.reduce((s, p) => s + p.salesCount, 0);
  const totalRevenue = sellerOrders.reduce((s, o) => s + o.totalAmount, 0);

  const timeSeries = await aggregateOrderHistoryByDate(
    sellerId,
    isAdmin ? 'ADMIN' : 'SELLER',
    granularity
  );

  // Occasion interest
  const occMap = new Map<string, { interestScore: number; sales: number }>();
  for (const p of sellerProducts) {
    for (const occ of p.occasions) {
      const prev = occMap.get(occ) || { interestScore: 0, sales: 0 };
      prev.interestScore += p.viewsCount + p.likesCount * 2;
      prev.sales += p.salesCount;
      occMap.set(occ, prev);
    }
  }

  // Color / Plating attribute interest
  const attrMap = new Map<string, number>();
  for (const p of sellerProducts) {
    if (p.jewellerySpecs?.plating) {
      attrMap.set(p.jewellerySpecs.plating, (attrMap.get(p.jewellerySpecs.plating) || 0) + p.salesCount);
    }
    if (p.clothingSpecs?.fabric) {
      attrMap.set(p.clothingSpecs.fabric, (attrMap.get(p.clothingSpecs.fabric) || 0) + p.salesCount);
    }
    for (const v of p.variants) {
      attrMap.set(v.colorName, (attrMap.get(v.colorName) || 0) + Math.round(p.likesCount / Math.max(1, p.variants.length)));
    }
  }

  // Classified Review Sentiment
  const sellerProdIds = new Set(sellerProducts.map((p) => p._id));
  const revs = localState.reviews.filter((r) => sellerProdIds.has(r.productId));
  const sentimentCounts = { Positive: 0, Neutral: 0, Negative: 0 };
  const aspectTotals: Record<ReviewClass, { sum: number; count: number }> = {
    Quality: { sum: 0, count: 0 },
    'Finish & Shine': { sum: 0, count: 0 },
    'Value for Money': { sum: 0, count: 0 },
    'Fit & Sizing': { sum: 0, count: 0 },
    Packaging: { sum: 0, count: 0 },
  };
  for (const r of revs) {
    sentimentCounts[r.sentiment] += 1;
    for (const cls of r.reviewClasses) {
      if (aspectTotals[cls]) {
        aspectTotals[cls].sum += r.rating;
        aspectTotals[cls].count += 1;
      }
    }
  }

  const aspectRatings = Object.fromEntries(
    Object.entries(aspectTotals).map(([k, v]) => [
      k,
      { avg: v.count > 0 ? Number((v.sum / v.count).toFixed(1)) : 0, count: v.count },
    ])
  ) as Record<ReviewClass, { avg: number; count: number }>;

  const topProducts = [...sellerProducts]
    .sort((a, b) => b.salesCount - a.salesCount)
    .slice(0, 6)
    .map((p) => ({
      _id: p._id,
      title: p.title,
      viewsCount: p.viewsCount,
      likesCount: p.likesCount,
      cartAddsCount: p.cartAddsCount,
      salesCount: p.salesCount,
      revenue: p.salesCount * p.salePrice,
      conversionRate: p.viewsCount > 0 ? Number(((p.salesCount / p.viewsCount) * 100).toFixed(1)) : 0,
    }));

  return {
    overview: {
      totalRevenue,
      totalOrders: sellerOrders.length,
      totalViews,
      totalLikes,
      totalCartAdds,
      conversionRate: totalViews > 0 ? Number(((totalPurchases / totalViews) * 100).toFixed(2)) : 0,
      trustScore: user?.sellerProfile?.trustScore || 4.8,
    },
    funnel: [
      { stage: 'Product Views', count: totalViews },
      { stage: 'Likes', count: totalLikes },
      { stage: 'Cart Adds', count: totalCartAdds },
      { stage: 'Purchases', count: totalPurchases },
    ],
    timeSeries,
    occasionBreakdown: Array.from(occMap.entries()).map(([occasion, vals]) => ({
      occasion,
      ...vals,
    })),
    attributeBreakdown: Array.from(attrMap.entries())
      .map(([attribute, count]) => ({ attribute, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
    sentimentSummary: {
      ...sentimentCounts,
      aspectRatings,
    },
    topProducts,
  };
}

// --- Cron Job: Trending & Trust Recalculation ---

export async function recalculateTrendingAndBadges(): Promise<{
  updatedCount: number;
  recalculatedAt: string;
}> {
  const nowMs = Date.now();
  const products = await getAllProductsRaw();

  for (const p of products) {
    const trendScore = p.likesCount + p.cartAddsCount * 3 + p.salesCount * 5;
    const ageDays = (nowMs - new Date(p.createdAt).getTime()) / 86400_000;
    const badges: ProductBadge[] = [];
    if (ageDays <= 10) badges.push('Newly Added');
    if (p.discountPercent >= 15) badges.push('Special Offer');
    if (p.salesCount >= 40) badges.push('Fast Selling');
    if (trendScore >= 500) badges.push('Most Demanding');
    if (p.sellerTrusted) badges.push('Seller Trusted');

    const isProductTrusted = p.averageRating >= 4.5 || (p.reviewCount === 0 && Boolean(p.sellerTrusted));

    if (mongoConnected && mongoose.isValidObjectId(p._id)) {
      await ProductModel.updateOne(
        { _id: p._id },
        { $set: { trendScore, badges, isProductTrusted } }
      );
    } else {
      p.trendScore = trendScore;
      p.badges = badges;
      p.isProductTrusted = isProductTrusted;
    }
  }

  if (!mongoConnected) {
    saveLocalStore(localState);
  }

  return { updatedCount: products.length, recalculatedAt: new Date().toISOString() };
}

export async function getLocalCartBackup(key: string): Promise<CartItem[]> {
  return localState.carts[key] || [];
}

export async function setLocalCartBackup(key: string, items: CartItem[]): Promise<void> {
  localState.carts[key] = items;
  saveLocalStore(localState);
}

export async function getSellerRecentOrdersForAdmin(sellerId: string): Promise<Order[]> {
  const user = await findUserById(sellerId);
  const isAdmin = user?.role === 'ADMIN';
  return localState.orders
    .filter((o) => (isAdmin ? true : o.sellerId === sellerId))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// --- Admin-Only Seller Onboarding Invites ---

function computeEffectiveInviteStatus(inv: SellerInvite): SellerInvite {
  if (inv.status === 'pending' && new Date(inv.expiresAt).getTime() <= Date.now()) {
    return { ...inv, status: 'expired' };
  }
  return inv;
}

export async function createSellerInvite(input: {
  adminId: string;
  adminName: string;
  email: string;
  storeName?: string;
  note?: string;
  expiresInDays?: number;
}): Promise<SellerInvite> {
  const emailLower = input.email.trim().toLowerCase();
  const token = `inv_${crypto.randomBytes(16).toString('hex')}`;
  const nowDate = new Date();
  const days = Math.min(90, Math.max(1, input.expiresInDays || 14));
  const expiresAtDate = new Date(nowDate.getTime() + days * 86400_000);

  if (mongoConnected && mongoose.isValidObjectId(input.adminId)) {
    // Revoke earlier pending invites for same email to keep one clean active link
    await SellerInviteModel.updateMany(
      { email: emailLower, status: 'pending' },
      { $set: { status: 'revoked', revokedAt: nowDate } }
    );
    const doc = await SellerInviteModel.create({
      token,
      email: emailLower,
      storeName: input.storeName?.trim() || '',
      note: input.note?.trim() || '',
      invitedByUserId: new mongoose.Types.ObjectId(input.adminId),
      invitedByName: input.adminName,
      status: 'pending',
      expiresAt: expiresAtDate,
    });
    const obj = doc.toObject();
    return {
      ...obj,
      _id: String(obj._id),
      invitedByUserId: String(obj.invitedByUserId),
      expiresAt: new Date(obj.expiresAt).toISOString(),
      createdAt: new Date(obj.createdAt).toISOString(),
    };
  }

  for (const inv of localState.sellerInvites) {
    if (inv.email.toLowerCase() === emailLower && inv.status === 'pending') {
      inv.status = 'revoked';
      inv.revokedAt = nowDate.toISOString();
    }
  }

  const invite: SellerInvite = {
    _id: `sinv_${crypto.randomBytes(5).toString('hex')}`,
    token,
    email: emailLower,
    storeName: input.storeName?.trim() || '',
    note: input.note?.trim() || '',
    invitedByUserId: input.adminId,
    invitedByName: input.adminName,
    status: 'pending',
    acceptedUserId: null,
    acceptedAt: null,
    revokedAt: null,
    expiresAt: expiresAtDate.toISOString(),
    createdAt: nowDate.toISOString(),
  };
  localState.sellerInvites.unshift(invite);
  saveLocalStore(localState);
  return invite;
}

export async function listSellerInvites(): Promise<SellerInvite[]> {
  if (mongoConnected) {
    const docs = await SellerInviteModel.find().sort({ createdAt: -1 }).lean();
    return docs.map((d: any) =>
      computeEffectiveInviteStatus({
        ...d,
        _id: String(d._id),
        invitedByUserId: String(d.invitedByUserId),
        acceptedUserId: d.acceptedUserId ? String(d.acceptedUserId) : null,
        expiresAt: new Date(d.expiresAt).toISOString(),
        createdAt: new Date(d.createdAt).toISOString(),
        acceptedAt: d.acceptedAt ? new Date(d.acceptedAt).toISOString() : null,
        revokedAt: d.revokedAt ? new Date(d.revokedAt).toISOString() : null,
      })
    );
  }
  return localState.sellerInvites
    .map(computeEffectiveInviteStatus)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function revokeSellerInvite(inviteId: string): Promise<SellerInvite | null> {
  const nowIso = new Date().toISOString();
  if (mongoConnected && mongoose.isValidObjectId(inviteId)) {
    const doc = await SellerInviteModel.findByIdAndUpdate(
      inviteId,
      { $set: { status: 'revoked', revokedAt: new Date() } },
      { new: true }
    ).lean();
    if (!doc) return null;
    return {
      ...(doc as any),
      _id: String((doc as any)._id),
      invitedByUserId: String((doc as any).invitedByUserId),
      expiresAt: new Date((doc as any).expiresAt).toISOString(),
      createdAt: new Date((doc as any).createdAt).toISOString(),
    };
  }
  const inv = localState.sellerInvites.find((i) => i._id === inviteId);
  if (!inv) return null;
  if (inv.status === 'pending') {
    inv.status = 'revoked';
    inv.revokedAt = nowIso;
    saveLocalStore(localState);
  }
  return computeEffectiveInviteStatus(inv);
}

export async function validateSellerInviteToken(token: string): Promise<{
  valid: boolean;
  reason?: 'NOT_FOUND' | 'REVOKED' | 'EXPIRED' | 'ALREADY_ACCEPTED';
  invite?: Pick<SellerInvite, '_id' | 'email' | 'storeName' | 'note' | 'invitedByName' | 'status' | 'expiresAt'>;
}> {
  const cleanToken = token.trim();
  if (!cleanToken) return { valid: false, reason: 'NOT_FOUND' };

  let found: SellerInvite | null = null;
  if (mongoConnected) {
    const doc = await SellerInviteModel.findOne({ token: cleanToken }).lean();
    if (doc) {
      found = computeEffectiveInviteStatus({
        ...(doc as any),
        _id: String((doc as any)._id),
        invitedByUserId: String((doc as any).invitedByUserId),
        expiresAt: new Date((doc as any).expiresAt).toISOString(),
        createdAt: new Date((doc as any).createdAt).toISOString(),
      });
    }
  } else {
    const raw = localState.sellerInvites.find((i) => i.token === cleanToken);
    if (raw) found = computeEffectiveInviteStatus(raw);
  }

  if (!found) return { valid: false, reason: 'NOT_FOUND' };
  if (found.status === 'revoked') return { valid: false, reason: 'REVOKED' };
  if (found.status === 'accepted') return { valid: false, reason: 'ALREADY_ACCEPTED' };
  if (found.status === 'expired') return { valid: false, reason: 'EXPIRED' };

  return {
    valid: true,
    invite: {
      _id: found._id,
      email: found.email,
      storeName: found.storeName,
      note: found.note,
      invitedByName: found.invitedByName,
      status: found.status,
      expiresAt: found.expiresAt,
    },
  };
}

export async function acceptSellerInvite(input: {
  token: string;
  name: string;
  whatsappNumber: string;
  storeName: string;
  description: string;
  actingUser?: User | null;
}): Promise<{ user: User; invite: SellerInvite }> {
  const validation = await validateSellerInviteToken(input.token);
  if (!validation.valid || !validation.invite) {
    throw new Error(
      validation.reason === 'REVOKED'
        ? 'This seller invitation has been revoked by an administrator.'
        : validation.reason === 'EXPIRED'
          ? 'This seller invitation link has expired.'
          : validation.reason === 'ALREADY_ACCEPTED'
            ? 'This seller invitation link has already been used.'
            : 'Invalid or missing seller invitation link.'
    );
  }

  const invitedEmail = validation.invite.email.toLowerCase();
  const sellerProfile = {
    storeName: input.storeName.trim(),
    description: input.description.trim() || 'Curated fashion & artificial jewellery atelier.',
    trustScore: 4.8,
    isTrustedSeller: true,
    totalOrders: 0,
    cancelledOrders: 0,
  };
  const nowDate = new Date();
  const nowIso = nowDate.toISOString();

  if (mongoConnected) {
    // Check if an account already exists for the invited email or acting user (must match invited email if signed in with a different email? Allow upgrade if acting user matches email, or find/create by invitedEmail)
    let userDoc = await UserModel.findOne({ email: invitedEmail });
    if (!userDoc && input.actingUser && input.actingUser.email.toLowerCase() === invitedEmail && mongoose.isValidObjectId(input.actingUser._id)) {
      userDoc = await UserModel.findById(input.actingUser._id);
    }
    if (!userDoc) {
      userDoc = await UserModel.create({
        role: 'SELLER',
        name: input.name.trim(),
        email: invitedEmail,
        oauthAccounts: [],
        whatsappNumber: input.whatsappNumber,
        mobileNumber: input.whatsappNumber,
        isWhatsappVerified: true,
        shippingAddresses: [],
        sellerProfile,
      });
    } else {
      userDoc.role = 'SELLER';
      userDoc.name = input.name.trim() || userDoc.name;
      userDoc.whatsappNumber = input.whatsappNumber;
      if (!userDoc.mobileNumber) userDoc.mobileNumber = input.whatsappNumber;
      userDoc.isWhatsappVerified = true;
      userDoc.sellerProfile = sellerProfile;
      await userDoc.save();
    }

    const updatedInvite = await SellerInviteModel.findOneAndUpdate(
      { token: input.token.trim(), status: 'pending' },
      { $set: { status: 'accepted', acceptedAt: nowDate, acceptedUserId: userDoc._id } },
      { new: true }
    ).lean();
    if (!updatedInvite) {
      throw new Error('This seller invitation could not be redeemed.');
    }

    const userObj = userDoc.toObject();
    return {
      user: { ...userObj, _id: String(userObj._id) },
      invite: {
        ...(updatedInvite as any),
        _id: String((updatedInvite as any)._id),
        invitedByUserId: String((updatedInvite as any).invitedByUserId),
        acceptedUserId: String((updatedInvite as any).acceptedUserId),
        expiresAt: new Date((updatedInvite as any).expiresAt).toISOString(),
        createdAt: new Date((updatedInvite as any).createdAt).toISOString(),
        acceptedAt: nowIso,
      },
    };
  }

  let user = localState.users.find((u) => u.email.toLowerCase() === invitedEmail);
  if (!user) {
    user = {
      _id: `usr_${crypto.randomBytes(5).toString('hex')}`,
      role: 'SELLER',
      name: input.name.trim(),
      email: invitedEmail,
      oauthAccounts: [],
      mobileNumber: input.whatsappNumber,
      whatsappNumber: input.whatsappNumber,
      isWhatsappVerified: true,
      shippingAddresses: [],
      sellerProfile,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    localState.users.push(user);
  } else {
    user.role = 'SELLER';
    user.name = input.name.trim() || user.name;
    user.whatsappNumber = input.whatsappNumber;
    if (!user.mobileNumber) user.mobileNumber = input.whatsappNumber;
    user.isWhatsappVerified = true;
    user.sellerProfile = sellerProfile;
    user.updatedAt = nowIso;
  }

  const invite = localState.sellerInvites.find((i) => i.token === input.token.trim());
  if (!invite || invite.status !== 'pending') {
    throw new Error('This seller invitation is no longer active.');
  }
  invite.status = 'accepted';
  invite.acceptedAt = nowIso;
  invite.acceptedUserId = user._id;
  saveLocalStore(localState);

  return { user, invite };
}
