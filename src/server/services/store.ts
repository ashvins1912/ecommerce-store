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
  SeasonType,
  ReviewClass,
  OrderStatus,
  ProductBadge,
  ShippingAddress,
  SellerInvite,
  SalesCampaign,
  StorefrontCampaign,
  Coupon,
  CouponValidationResult,
  CouponDiscountType,
  CouponScope,
  CategoryControl,
  ShareEventRecord,
  ProductListingStatus,
  ProductControlAction,
} from '../../shared/types.js';
import {
  SEED_USERS,
  SEED_PRODUCTS,
  SEED_REVIEWS,
  SEED_ORDERS,
  buildSeedCampaigns,
  SEED_COUPONS,
  inferSeedSeasons,
} from './seed.js';
import {
  UserModel,
  ProductModel,
  LikeModel,
  ReviewModel,
  OrderModel,
  SellerInviteModel,
  AuthSessionModel,
  SalesCampaignModel,
  CouponModel,
  CategoryControlModel,
  ShareEventModel,
  SellerPrivacySettingsModel,
  PrivacyDisclosureAuditModel,
} from '../models/schemas.js';
import { ProviderProfileModel, ProviderProductModel } from '../models/providerSchemas.js';
import { encryptField } from './fieldEncryption.js';
import type { AuthSessionRecord } from './session.js';
import { deleteStoredImageAssets } from './storage.js';
import { purgeProductFromCartCaches } from './redis.js';
import { aggregateInventoryLines } from '../../../packages/hybrid-engine/src/index.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');

// Provider demo identities are excluded from every production seed path.
const ACTIVE_SEED_USERS = process.env.NODE_ENV === 'production'
  ? SEED_USERS.filter((user) => user.role !== 'PROVIDER')
  : SEED_USERS;

interface StoreState {
  users: User[];
  products: Product[];
  likes: LikeRecord[];
  reviews: Review[];
  orders: Order[];
  carts: Record<string, CartItem[]>;
  sellerInvites: SellerInvite[];
  sessions: AuthSessionRecord[];
  salesCampaigns: SalesCampaign[];
  coupons: Coupon[];
  categories: CategoryControl[];
  shareEvents: ShareEventRecord[];
}

function buildDefaultCategories(): CategoryControl[] {
  const nowIso = new Date().toISOString();
  return [
    {
      _id: 'cat_jewellery',
      name: 'Artificial Jewellery',
      slug: 'artificial-jewellery',
      description: 'Kundan chokers, jhumkas, meenakari bangles, and ceremonial sets.',
      sellerId: 'usr_admin_1',
      sellerName: 'Kala & Karat Ops',
      isEnabled: true,
      isDefault: true,
      sortOrder: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      _id: 'cat_clothing',
      name: 'Clothing',
      slug: 'clothing',
      description: 'Handloom Chanderi, linen, mulmul, and embroidered ethnic silhouettes.',
      sellerId: 'usr_admin_1',
      sellerName: 'Kala & Karat Ops',
      isEnabled: true,
      isDefault: true,
      sortOrder: 2,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      _id: 'cat_accessories',
      name: 'Accessories',
      slug: 'accessories',
      description: 'Zari potlis, artisanal stoles, clutches, and hair ornaments.',
      sellerId: 'usr_admin_1',
      sellerName: 'Kala & Karat Ops',
      isEnabled: true,
      isDefault: true,
      sortOrder: 3,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ];
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
        let dirty = false;
        if (!Array.isArray(parsed.sellerInvites)) {
          parsed.sellerInvites = [];
          dirty = true;
        }
        if (!Array.isArray(parsed.users)) {
          parsed.users = [];
          dirty = true;
        }
        if (process.env.NODE_ENV === 'production') {
          const safeUsers = parsed.users.filter((user) => user.role !== 'PROVIDER');
          if (safeUsers.length !== parsed.users.length) {
            parsed.users = safeUsers;
            dirty = true;
          }
        }
        if (!Array.isArray(parsed.sessions)) {
          parsed.sessions = [];
          dirty = true;
        }
        if (!Array.isArray(parsed.salesCampaigns) || parsed.salesCampaigns.length === 0) {
          parsed.salesCampaigns = buildSeedCampaigns();
          dirty = true;
        }
        if (!Array.isArray(parsed.coupons) || parsed.coupons.length === 0) {
          parsed.coupons = structuredClone(SEED_COUPONS);
          dirty = true;
        }
        if (!Array.isArray(parsed.categories) || parsed.categories.length === 0) {
          parsed.categories = buildDefaultCategories();
          dirty = true;
        }
        if (!Array.isArray(parsed.shareEvents)) {
          parsed.shareEvents = [];
          dirty = true;
        }
        for (const p of parsed.products) {
          if (typeof p.sharesCount !== 'number') {
            p.sharesCount = 0;
            dirty = true;
          }
          if (typeof p.isPublished !== 'boolean') {
            p.isPublished = p.isActive !== false && !p.isDiscontinued;
            dirty = true;
          }
          if (typeof p.isUnlisted !== 'boolean') {
            p.isUnlisted = false;
            dirty = true;
          }
          if (typeof p.isDiscontinued !== 'boolean') {
            p.isDiscontinued = false;
            dirty = true;
          }
          if (typeof p.isDeleted !== 'boolean') {
            p.isDeleted = false;
            dirty = true;
          }
          if (!p.listingStatus) {
            p.listingStatus = p.isDiscontinued
              ? 'discontinued'
              : p.isPublished === false || p.isUnlisted
                ? 'unpublished'
                : 'published';
            dirty = true;
          }
          if (!Array.isArray(p.seasons) || p.seasons.length === 0) {
            const seedMatch = SEED_PRODUCTS.find((sp) => sp._id === p._id);
            p.seasons = seedMatch?.seasons || inferSeedSeasons(p);
            dirty = true;
          }
        }
        for (const seedUser of ACTIVE_SEED_USERS) {
          const exists = parsed.users.some(
            (u) => u._id === seedUser._id || u.email.toLowerCase() === seedUser.email.toLowerCase()
          );
          if (!exists) {
            parsed.users.push(structuredClone(seedUser));
            dirty = true;
          }
        }
        if (dirty) {
          saveLocalStore(parsed);
        }
        return parsed;
      }
    } catch {
      // Fall through to seed
    }
  }
  const initial: StoreState = {
    users: structuredClone(ACTIVE_SEED_USERS),
    products: structuredClone(SEED_PRODUCTS).map((p) => ({ ...p, sharesCount: p.sharesCount ?? 0 })),
    likes: [],
    reviews: structuredClone(SEED_REVIEWS),
    orders: structuredClone(SEED_ORDERS),
    carts: {},
    sellerInvites: [],
    sessions: [],
    salesCampaigns: buildSeedCampaigns(),
    coupons: structuredClone(SEED_COUPONS),
    categories: buildDefaultCategories(),
    shareEvents: [],
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
  const uri = process.env.MONGODB_URI?.trim();
  if (process.env.NODE_ENV === 'production' && !uri) {
    throw new Error('MONGODB_URI_REQUIRED_IN_PRODUCTION: configure a persistent MongoDB database before starting.');
  }
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
        SellerPrivacySettingsModel.syncIndexes(),
        PrivacyDisclosureAuditModel.syncIndexes(),
      ]);
      // Idempotently ensure one sample account per configured demo identity. The unique
      // email index is the database-level guard; $setOnInsert never overwrites a real
      // account or changes an existing user's role/profile on application restart.
      const idMap = new Map<string, mongoose.Types.ObjectId>();
      for (const u of ACTIVE_SEED_USERS) {
        const email = u.email.trim().toLowerCase();
        let account: any;
        try {
          // Mongoose timestamps manage these fields on upsert. Do not include seed
          // timestamps in $setOnInsert or MongoDB sees conflicting updatedAt paths.
          const seedUser = Object.fromEntries(
            Object.entries(u).filter(([key]) => key !== 'createdAt' && key !== 'updatedAt'),
          ) as Omit<User, 'createdAt' | 'updatedAt'>;
          account = await UserModel.findOneAndUpdate(
            { email },
            { $setOnInsert: { ...seedUser, _id: new mongoose.Types.ObjectId(), email } },
            { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
          ).lean();
        } catch (error) {
          // Concurrent application starts can race on the unique email index.
          // In that case, read the winner rather than failing startup or duplicating it.
          if ((error as { code?: number }).code !== 11000) throw error;
          account = await UserModel.findOne({ email }).lean();
        }
        if (!account) throw new Error(`Unable to ensure demo account for ${email}`);
        idMap.set(u._id, new mongoose.Types.ObjectId(String(account._id)));
      }

      // Seed the sample catalogue only when it is empty. Existing products and users
      // are never replaced; seller references always point at the ensured DB users.
      const productCount = await ProductModel.countDocuments();
      if (productCount === 0) {
        for (const p of SEED_PRODUCTS) {
          const oid = new mongoose.Types.ObjectId();
          idMap.set(p._id, oid);
          const sellerId = idMap.get(p.sellerId);
          if (!sellerId) throw new Error(`Missing seeded seller reference for product ${p._id}`);
          await ProductModel.create({
            ...p,
            _id: oid,
            sellerId,
          });
        }
      }
      console.info(`[seed] Demo identities checked: ${ACTIVE_SEED_USERS.length}; catalogue mode: ${productCount === 0 ? 'initialized' : 'existing'}`);

      // Demo-only provider fixtures: never create synthetic identities or catalog data in production.
      if (process.env.NODE_ENV !== 'production' && process.env.ENCRYPTION_MASTER_KEY) {
        for (const demo of [
          { email: 'provider.aarav@example.com', businessName: 'Aarav Artisan Supply', sellerEmail: 'meera@zaveriatelier.in', mobile: '+919876540001' },
          { email: 'provider.nisha@example.com', businessName: 'Nisha Craft Works', sellerEmail: 'raghav@jaipurloom.in', mobile: '+919876540002' },
        ]) {
          const providerUser = await UserModel.findOne({ email: demo.email }).lean();
          const linkedSeller = await UserModel.findOne({ email: demo.sellerEmail }).lean();
          if (providerUser && linkedSeller) {
            await ProviderProfileModel.updateOne(
              { userId: String(providerUser._id) },
              { $setOnInsert: {
                userId: String(providerUser._id),
                linkedSellerIds: [String(linkedSeller._id)],
                businessName: demo.businessName,
                contactPerson: demo.businessName,
                mobile: demo.mobile,
                whatsapp: demo.mobile,
                warehouseAddress: 'Demo Warehouse, Jaipur, Rajasthan, India',
                encryptedTaxId: encryptField('DEMO-GST-TEST-0001'),
                encryptedSettlementDetails: encryptField('DEMO-ACCOUNT-000000000001'),
                settlementDetailsLast4: '0001',
                kycStatus: 'PENDING',
              } },
              { upsert: true }
            );
          }
        }

        // Seed realistic image-backed catalog rows for the demo provider workspaces.
        // These use existing repository assets and are isolated by providerId.
        const demoCatalog = [
          {
            email: 'provider.aarav@example.com',
            sellerEmail: 'meera@zaveriatelier.in',
            title: 'Demo Kundan Bridal Choker',
            category: 'Artificial Jewellery',
            subCategory: 'Choker Necklaces',
            description: 'Demo provider listing with a local product image for testing the full catalog-to-review mapping.',
            brand: 'Aarav Artisan',
            manufacturerName: 'Aarav Artisan Supply',
            basePricePaise: 185000,
            imageUrls: ['/src/assets/images/jewellery_kundan_choker_1794740131002.jpg', '/src/assets/images/jewellery_jhumka_earrings_1794740130423.jpg'],
          },
          {
            email: 'provider.nisha@example.com',
            sellerEmail: 'raghav@jaipurloom.in',
            title: 'Demo Chanderi Anarkali Set',
            category: 'Clothing',
            subCategory: 'Kurta Sets',
            description: 'Demo provider listing with a local apparel image for validating provider catalog and seller review screens.',
            brand: 'Nisha Craft',
            manufacturerName: 'Nisha Craft Works',
            basePricePaise: 245000,
            imageUrls: ['/src/assets/images/clothing_anarkali_kurta_1794740131627.jpg', '/src/assets/images/clothing_linen_co_ord_1794740132428.jpg'],
          },
        ];
        for (const demo of demoCatalog) {
          const providerUser = await UserModel.findOne({ email: demo.email }).lean();
          const linkedSeller = await UserModel.findOne({ email: demo.sellerEmail }).lean();
          if (!providerUser || !linkedSeller) continue;
          await ProviderProductModel.updateOne(
            { providerId: String(providerUser._id), title: demo.title },
            { $setOnInsert: {
              providerId: String(providerUser._id),
              linkedSellerIds: [String(linkedSeller._id)],
              title: demo.title,
              category: demo.category,
              subCategory: demo.subCategory,
              description: demo.description,
              brand: demo.brand,
              manufacturerName: demo.manufacturerName,
              sizeVariants: ['Free Size'],
              colorVariants: ['Demo Gold'],
              imageUrls: demo.imageUrls,
              basePricePaise: demo.basePricePaise,
              returnable: true,
              returnWindowDays: 7,
              damageReplacementPolicy: 'Demo-only replacement policy.',
              status: 'PENDING_REVIEW',
            } },
            { upsert: true }
          );
        }
      }

      const catCount = await CategoryControlModel.countDocuments();
      if (catCount === 0) {
        for (const cat of buildDefaultCategories()) {
          await CategoryControlModel.create({
            name: cat.name,
            slug: cat.slug,
            description: cat.description,
            sellerId: cat.sellerId,
            sellerName: cat.sellerName,
            isEnabled: cat.isEnabled,
            isDefault: cat.isDefault,
            sortOrder: cat.sortOrder,
          });
        }
      }
      return { mode: 'mongodb' };
    } catch (err) {
      mongoConnected = false;
      if (process.env.NODE_ENV === 'production') {
        console.error('Production MongoDB connection failed; refusing to start with local JSON storage.', err);
        throw new Error('PRODUCTION_DATABASE_CONNECTION_FAILED');
      }
      console.warn('MongoDB connection failed, using the local development store:', err);
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

const SEARCH_SYNONYMS: Record<string, string[]> = {
  earring: ['jhumka', 'jhumkas', 'studs', 'drop', 'chandbali'],
  earrings: ['jhumka', 'jhumkas', 'studs', 'drop', 'chandbali'],
  jumka: ['jhumka'],
  necklace: ['choker', 'haram', 'mala', 'collar'],
  necklaces: ['choker', 'haram', 'mala', 'collar'],
  bangle: ['bangles', 'kadas', 'cuff'],
  bangles: ['kadas', 'cuff'],
  bracelet: ['cuff', 'bangles', 'kadas'],
  bracelets: ['cuff', 'bangles', 'kadas'],
  anklet: ['payal', 'anklets'],
  bag: ['potli', 'clutch', 'clutches'],
  bags: ['potli', 'clutch', 'clutches'],
  purse: ['potli', 'clutch'],
  handbag: ['potli', 'clutch'],
  kurti: ['kurta', 'anarkali', 'tunic'],
  suit: ['kurta', 'anarkali', 'co-ord'],
  dress: ['dresses', 'anarkali', 'midi'],
  bridal: ['wedding', 'kundan', 'polki'],
  xmas: ['christmas'],
  festival: ['festive', 'diwali'],
  work: ['office'],
  shawl: ['stole', 'dupatta'],
  scarf: ['stole', 'dupatta'],
};

function parseFlexibleQuery(rawQuery: string): {
  tokens: string[];
  expandedGroups: string[][];
  extractedMaxPrice?: number;
  extractedMinPrice?: number;
  wantsDiscount?: boolean;
} {
  let working = rawQuery.trim().toLowerCase();
  let extractedMaxPrice: number | undefined;
  let extractedMinPrice: number | undefined;
  let wantsDiscount = false;

  // Natural language price extraction: "under 2000", "below rs 1500", "< 3000"
  const underMatch = working.match(/\b(?:under|below|less than|max|upto)\s*(?:rs\.?|inr|₹)?\s*(\d{2,6})\b/i);
  if (underMatch) {
    extractedMaxPrice = Number(underMatch[1]);
    working = working.replace(underMatch[0], ' ');
  }
  const overMatch = working.match(/\b(?:above|over|min|more than)\s*(?:rs\.?|inr|₹)?\s*(\d{2,6})\b/i);
  if (overMatch) {
    extractedMinPrice = Number(overMatch[1]);
    working = working.replace(overMatch[0], ' ');
  }

  if (/\b(?:sale|offer|offers|discount|discounted|deal|deals)\b/i.test(working)) {
    wantsDiscount = true;
  }

  const rawTokens = working
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !['and', 'for', 'with', 'the', 'in', 'of'].includes(t));

  const expandedGroups = rawTokens.map((tok) => {
    const syns = SEARCH_SYNONYMS[tok] || [];
    return Array.from(new Set([tok, ...syns]));
  });

  return {
    tokens: rawTokens,
    expandedGroups,
    extractedMaxPrice,
    extractedMinPrice,
    wantsDiscount,
  };
}

export const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  'Pending',
  'Confirmed',
  'Packed',
  'Shipped',
  'Out for Delivery',
];

export const MONGO_PUBLIC_PRODUCT_FILTER = {
  isActive: true,
  isPublished: { $ne: false },
  isUnlisted: { $ne: true },
  isDiscontinued: { $ne: true },
  isDeleted: { $ne: true },
};

export function isProductPubliclyVisible(p: Product): boolean {
  return (
    p.isActive !== false &&
    p.isPublished !== false &&
    !p.isUnlisted &&
    !p.isDiscontinued &&
    !p.isDeleted
  );
}

function normalizeProductDoc(d: any): Product {
  const isDiscontinued = Boolean(d.isDiscontinued);
  const isPublished = d.isPublished !== false && !isDiscontinued && d.isActive !== false;
  const isUnlisted = Boolean(d.isUnlisted);
  const isDeleted = Boolean(d.isDeleted);
  const listingStatus: ProductListingStatus =
    d.listingStatus ||
    (isDiscontinued ? 'discontinued' : !isPublished || isUnlisted ? 'unpublished' : 'published');
  return {
    ...d,
    _id: String(d._id),
    sellerId: String(d.sellerId),
    isPublished,
    isUnlisted,
    isDiscontinued,
    isDeleted,
    listingStatus,
    disabledAt: d.disabledAt ? new Date(d.disabledAt).toISOString() : null,
  };
}

export async function getSearchSuggestions(query: string): Promise<string[]> {
  const q = query.trim().toLowerCase();
  const [all, allCats] = await Promise.all([getAllProductsRaw(), getAllCategoriesRaw()]);
  const disabledSet = new Set(
    allCats.filter((c) => !c.isEnabled).map((c) => c.name.toLowerCase())
  );
  if (q.length < 1) {
    return ['Diwali', 'Kundan Choker', 'Handloom Linen', 'Winter Velvet', 'Under 2000', 'Jhumka'];
  }
  const suggestions = new Set<string>();

  for (const cat of allCats) {
    if (cat.isEnabled && cat.name.toLowerCase().includes(q)) {
      suggestions.add(cat.name);
    }
  }
  for (const season of ['Diwali', 'Christmas', 'New Year', 'Winter', 'Summer']) {
    if (season.toLowerCase().includes(q)) suggestions.add(season);
  }
  for (const occ of ['Wedding', 'Festive', 'Party', 'Office Wear', 'Casual', 'Daily Wear']) {
    if (occ.toLowerCase().includes(q)) suggestions.add(occ);
  }
  const materialTags = [
    'Kundan',
    'Polki',
    'Meenakari',
    'Brass',
    'Chanderi',
    'Linen',
    'Mulmul',
    'Khadi',
    'Velvet',
    'Silk',
    'Pearl',
    'Oxidized Silver',
  ];
  for (const mat of materialTags) {
    if (mat.toLowerCase().includes(q)) suggestions.add(mat);
  }

  for (const p of all) {
    if (!isProductPubliclyVisible(p) || p.visibility === 'ASSIGNED' || disabledSet.has(p.category.toLowerCase())) continue;
    const titleLower = p.title.toLowerCase();
    const specBlob = [
      p.subCategory,
      p.jewellerySpecs?.stoneType,
      p.jewellerySpecs?.baseMetal,
      p.clothingSpecs?.fabric,
      ...p.variants.map((v) => v.colorName),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const words = titleLower.split(/\s+/);
    if (titleLower.includes(q) || specBlob.includes(q) || words.some((w) => w.startsWith(q))) {
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

  return Array.from(suggestions).slice(0, 8);
}

async function getAllProductsRaw(options?: { includeControlled?: boolean }): Promise<Product[]> {
  if (mongoConnected) {
    const query = options?.includeControlled
      ? { isDeleted: { $ne: true } }
      : MONGO_PUBLIC_PRODUCT_FILTER;
    const docs = await ProductModel.find(query).lean();
    return docs.map(normalizeProductDoc);
  }
  return localState.products
    .filter((p) => (options?.includeControlled ? !p.isDeleted : isProductPubliclyVisible(p)))
    .map(normalizeProductDoc);
}

export interface ProductFilterQuery {
  q?: string;
  category?: ProductCategory | 'All';
  occasion?: OccasionType | 'All';
  season?: SeasonType | 'All';
  campaignId?: string;
  color?: string;
  minPrice?: number;
  maxPrice?: number;
  minDiscount?: number;
  inStockOnly?: boolean;
  sort?: SortOption;
  page?: number;
  limit?: number;
  sellerId?: string;
  includeInactive?: boolean;
  includeDisabled?: boolean;
  viewerId?: string;
  cursor?: string;
}

function computeCategoryTop10Thresholds(products: Product[]): Record<string, number> {
  const byCategory = new Map<string, number[]>();
  for (const p of products) {
    if (!isProductPubliclyVisible(p)) continue;
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

function escapeRegexLiteral(value: string): string {
  return value.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}
function encodeProductCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
function decodeProductCursor(cursor: string): { sort: string; value: number | string; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed.sort !== 'string' ||
      !['createdAt', 'trendScore', 'salesCount', 'salePrice'].includes(parsed.sort) ||
      !mongoose.isValidObjectId(parsed.id) ||
      !(typeof parsed.value === 'number' || typeof parsed.value === 'string')) return null;
    return parsed;
  } catch { return null; }
}
async function queryMongoProductsPage(filters: ProductFilterQuery, page: number, limit: number, disabledSet: Set<string>) {
  const filter: Record<string, any> = filters.includeInactive ? { isDeleted: { $ne: true } } : { ...MONGO_PUBLIC_PRODUCT_FILTER };
  if (filters.sellerId) {
    if (!mongoose.isValidObjectId(filters.sellerId)) return null;
    filter.sellerId = new mongoose.Types.ObjectId(filters.sellerId);
  }
  if (filters.category && filters.category !== 'All') filter.category = new RegExp('^' + escapeRegexLiteral(filters.category) + '$', 'i');
  if (filters.occasion && filters.occasion !== 'All') filter.occasions = filters.occasion;
  if (filters.season && filters.season !== 'All') filter.seasons = filters.season;
  if (filters.inStockOnly) filter.totalStock = { $gt: 0 };
  if (typeof filters.minPrice === 'number' || typeof filters.maxPrice === 'number') {
    filter.salePrice = {
      ...(typeof filters.minPrice === 'number' ? { $gte: filters.minPrice } : {}),
      ...(typeof filters.maxPrice === 'number' ? { $lte: filters.maxPrice } : {}),
    };
  }
  if (typeof filters.minDiscount === 'number' && filters.minDiscount > 0) filter.discountPercent = { $gte: filters.minDiscount };
  filter.visibility = filters.viewerId && mongoose.isValidObjectId(filters.viewerId)
    ? { $ne: 'ASSIGNED' } : { $ne: 'ASSIGNED' };
  if (filters.viewerId && mongoose.isValidObjectId(filters.viewerId)) {
    filter.$or = [{ visibility: { $ne: 'ASSIGNED' } }, { assignedCustomerIds: new mongoose.Types.ObjectId(filters.viewerId) }];
    delete filter.visibility;
  }
  if (!filters.includeDisabled && disabledSet.size) {
    filter.$nor = [...disabledSet].map((name) => ({ category: new RegExp('^' + escapeRegexLiteral(name) + '$', 'i') }));
  }
  const sortMap: Record<string, { field: string; direction: 1 | -1 }> = {
    newly_added: { field: 'createdAt', direction: -1 },
    fast_selling: { field: 'salesCount', direction: -1 },
    price_asc: { field: 'salePrice', direction: 1 },
    price_desc: { field: 'salePrice', direction: -1 },
    most_demanding: { field: 'trendScore', direction: -1 },
  };
  const selectedSort = sortMap[filters.sort || 'most_demanding'] || sortMap.most_demanding;
  const baseFilter = { ...filter };
  let queryFilter = { ...filter };
  if (filters.cursor) {
    const decoded = decodeProductCursor(filters.cursor);
    if (!decoded || decoded.sort !== selectedSort.field) throw new Error('INVALID_PRODUCT_CURSOR');
    const value = selectedSort.field === 'createdAt' ? new Date(decoded.value) : Number(decoded.value);
    if (selectedSort.field === 'createdAt' && !Number.isFinite((value as Date).getTime())) throw new Error('INVALID_PRODUCT_CURSOR');
    const operator = selectedSort.direction === -1 ? '$lt' : '$gt';
    queryFilter = { ...filter, $and: [{ $or: [
      { [selectedSort.field]: { [operator]: value } },
      { [selectedSort.field]: value, _id: { [operator]: new mongoose.Types.ObjectId(decoded.id) } },
    ] }] };
  }
  const [docs, total, thresholdRows] = await Promise.all([
    ProductModel.find(queryFilter).sort({ [selectedSort.field]: selectedSort.direction, _id: selectedSort.direction })
      .skip(filters.cursor ? 0 : (page - 1) * limit).limit(limit + 1).lean(),
    ProductModel.countDocuments(baseFilter),
    ProductModel.aggregate(([
      { $match: MONGO_PUBLIC_PRODUCT_FILTER },
      { $setWindowFields: { partitionBy: '$category', sortBy: { trendScore: -1 }, output: {
        rank: { $documentNumber: {} },
        categoryCount: { $count: {}, window: { documents: ['unbounded', 'unbounded'] } },
      } } },
      { $match: { $expr: { $lte: ['$rank', { $max: [1, { $ceil: { $multiply: ['$categoryCount', 0.1] } }] }] } } },
      { $group: { _id: '$category', threshold: { $min: { $ifNull: ['$trendScore', 0] } } } },
    ] as any)),
  ]);
  const hasMore = docs.length > limit, pageDocs = hasMore ? docs.slice(0, limit) : docs;
  const products = pageDocs.map((doc: any) => normalizeProductDoc(doc));
  const last = pageDocs[pageDocs.length - 1] as any;
  const nextCursor = hasMore && last ? encodeProductCursor({
    sort: selectedSort.field,
    value: selectedSort.field === 'createdAt' ? new Date(last.createdAt).toISOString() : Number(last[selectedSort.field] || 0),
    id: String(last._id),
  }) : null;
  const categoryTop10Thresholds: Record<string, number> = {};
  for (const row of thresholdRows as Array<{ _id: string; threshold: number }>) categoryTop10Thresholds[row._id] = row.threshold;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return { products, total, page: Math.min(page, totalPages), limit, totalPages, didYouMean: null, categoryTop10Thresholds, nextCursor };
}

export async function queryProducts(filters: ProductFilterQuery): Promise<{
  products: Product[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  didYouMean?: string | null;
  categoryTop10Thresholds: Record<string, number>;
  nextCursor?: string | null;
}> {
  const page = Math.max(1, filters.page || 1);
  // Strict limit(20) pagination rule for storefront listings
  const limit = Math.min(20, Math.max(1, filters.limit || 20));
  const allCategories = await getAllCategoriesRaw();
  const disabledSet = new Set(allCategories.filter((c) => !c.isEnabled).map((c) => c.name.toLowerCase()));
  if (filters.cursor && (filters.q?.trim() || filters.color?.trim() || filters.campaignId ||
      ['special_offers', 'occasion_favorites', 'highest_rated'].includes(filters.sort || 'most_demanding'))) {
    throw new Error('CURSOR_UNSUPPORTED_FOR_FILTER');
  }
  if (mongoConnected && !filters.q?.trim() && !filters.color?.trim() && !filters.campaignId &&
      !['special_offers', 'occasion_favorites', 'highest_rated'].includes(filters.sort || 'most_demanding')) {
    const result = await queryMongoProductsPage(filters, page, limit, disabledSet);
    if (result) return result;
  }
  const allProducts = await getAllProductsRaw({ includeControlled: Boolean(filters.includeInactive) });
  const categoryTop10Thresholds = computeCategoryTop10Thresholds(allProducts);

  let items = allProducts.filter((p) => {
    if (!filters.includeInactive && !isProductPubliclyVisible(p)) return false;
    if (!filters.includeDisabled && disabledSet.has(p.category.toLowerCase())) return false;
    if (p.visibility === 'ASSIGNED' && (!filters.viewerId || !(p.assignedCustomerIds || []).map(String).includes(filters.viewerId))) return false;
    return true;
  });

  if (filters.sellerId) {
    items = items.filter((p) => p.sellerId === filters.sellerId);
  }
  if (filters.category && filters.category !== 'All') {
    const targetCat = filters.category.toLowerCase();
    items = items.filter((p) => p.category.toLowerCase() === targetCat);
  }
  if (filters.occasion && filters.occasion !== 'All') {
    items = items.filter((p) => p.occasions.includes(filters.occasion as OccasionType));
  }
  if (filters.season && filters.season !== 'All') {
    items = items.filter((p) => (p.seasons || []).includes(filters.season as SeasonType));
  }
  if (filters.campaignId && filters.campaignId.trim()) {
    const campaign = localState.salesCampaigns.find((c) => c._id === filters.campaignId);
    if (campaign) {
      const idSet = new Set(campaign.productIds);
      items = items.filter((p) => idSet.has(p._id));
    }
  }
  if (filters.color && filters.color.trim()) {
    const c = filters.color.toLowerCase();
    items = items.filter((p) =>
      p.variants.some((v) => v.colorName.toLowerCase().includes(c))
    );
  }
  if (filters.inStockOnly) {
    items = items.filter((p) => p.totalStock > 0);
  }

  const parsedSearch = filters.q ? parseFlexibleQuery(filters.q) : null;
  const effectiveMinPrice =
    typeof filters.minPrice === 'number' && !Number.isNaN(filters.minPrice)
      ? filters.minPrice
      : parsedSearch?.extractedMinPrice;
  const effectiveMaxPrice =
    typeof filters.maxPrice === 'number' && !Number.isNaN(filters.maxPrice)
      ? filters.maxPrice
      : parsedSearch?.extractedMaxPrice;

  if (typeof effectiveMinPrice === 'number') {
    items = items.filter((p) => p.salePrice >= effectiveMinPrice);
  }
  if (typeof effectiveMaxPrice === 'number') {
    items = items.filter((p) => p.salePrice <= effectiveMaxPrice);
  }
  if (typeof filters.minDiscount === 'number' && filters.minDiscount > 0) {
    items = items.filter((p) => p.discountPercent >= filters.minDiscount!);
  } else if (parsedSearch?.wantsDiscount && parsedSearch.tokens.length <= 1) {
    items = items.filter((p) => p.discountPercent > 0);
  }

  const expandedGroups = parsedSearch?.expandedGroups || [];

  const scored = items.map((p) => {
    let relevance = 0;
    let groupsMatched = 0;
    if (expandedGroups.length > 0) {
      const specText = [
        p.jewellerySpecs?.baseMetal,
        p.jewellerySpecs?.plating,
        p.jewellerySpecs?.stoneType,
        p.clothingSpecs?.fabric,
        p.clothingSpecs?.fit,
        p.clothingSpecs?.pattern,
        p.sellerName,
        p.sku,
        ...p.variants.map((v) => `${v.colorName} ${v.size}`),
      ]
        .filter(Boolean)
        .join(' ');
      const metaText = `${p.occasions.join(' ')} ${(p.seasons || []).join(' ')} ${p.category} ${p.subCategory} ${p.badges.join(' ')}`;

      for (const group of expandedGroups) {
        const groupScore = Math.max(
          scoreFieldMatch(p.title, group, 3.2),
          scoreFieldMatch(metaText, group, 2.4),
          scoreFieldMatch(specText, group, 2.0),
          scoreFieldMatch(p.description, group, 1.0)
        );
        if (groupScore > 0) {
          groupsMatched += 1;
          relevance += groupScore;
        }
      }
      // Bonus when all search terms match flexibly
      if (groupsMatched === expandedGroups.length) {
        relevance += 8;
      }
    }
    return {
      product: p,
      relevance,
      groupsMatched,
      hybrid: relevance + p.trendScore * 0.008,
    };
  });

  const filteredScored =
    expandedGroups.length > 0 ? scored.filter((s) => s.relevance > 0) : scored;

  let didYouMean: string | null = null;
  if (filters.q && filters.q.trim().length >= 3 && filteredScored.length <= 1) {
    const cleanQ = filters.q.trim().toLowerCase();
    const vocabulary = Array.from(
      new Set([
        'kundan',
        'jhumka',
        'anarkali',
        'chanderi',
        'meenakari',
        'polki',
        'potli',
        'diwali',
        'christmas',
        'winter',
        'summer',
        'linen',
        'mulmul',
        'velvet',
        'bangles',
        'stole',
        'dupatta',
      ])
    );
    let bestWord: string | null = null;
    let bestDist = 3;
    for (const word of vocabulary) {
      if (word === cleanQ) continue;
      const dist = levenshtein(cleanQ, word);
      if (dist > 0 && dist < bestDist) {
        bestDist = dist;
        bestWord = word;
      }
    }
    if (bestWord) {
      didYouMean = bestWord.charAt(0).toUpperCase() + bestWord.slice(1);
    }
  }

  const sort = filters.sort || 'most_demanding';
  filteredScored.sort((a, b) => {
    if (expandedGroups.length > 0 && Math.abs(b.hybrid - a.hybrid) > 0.25) {
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
    didYouMean,
    categoryTop10Thresholds,
  };
}

export async function getProductByIdOrSlug(
  idOrSlug: string,
  options?: { includeControlled?: boolean }
): Promise<Product | null> {
  if (mongoConnected) {
    const idClause = mongoose.isValidObjectId(idOrSlug)
      ? { $or: [{ _id: idOrSlug }, { slug: idOrSlug }] }
      : { slug: idOrSlug };
    const query = options?.includeControlled
      ? { ...idClause, isDeleted: { $ne: true } }
      : { ...idClause, ...MONGO_PUBLIC_PRODUCT_FILTER };
    const doc = await ProductModel.findOne(query).lean();
    if (!doc) return null;
    return normalizeProductDoc(doc);
  }
  const found = localState.products.find((p) => p._id === idOrSlug || p.slug === idOrSlug);
  if (!found || found.isDeleted) return null;
  if (!options?.includeControlled && !isProductPubliclyVisible(found)) return null;
  return normalizeProductDoc(found);
}

export async function incrementProductView(productId: string): Promise<void> {
  if (mongoConnected && mongoose.isValidObjectId(productId)) {
    await ProductModel.updateOne(
      { _id: productId, ...MONGO_PUBLIC_PRODUCT_FILTER },
      { $inc: { viewsCount: 1 } }
    );
    return;
  }
  const prod = localState.products.find((p) => p._id === productId);
  if (prod && isProductPubliclyVisible(prod)) {
    prod.viewsCount += 1;
    saveLocalStore(localState);
  }
}

export async function createProduct(
  sellerId: string,
  payload: Omit<
    Product,
    | '_id'
    | 'sellerId'
    | 'slug'
    | 'likesCount'
    | 'viewsCount'
    | 'cartAddsCount'
    | 'salesCount'
    | 'trendScore'
    | 'averageRating'
    | 'reviewCount'
    | 'badges'
    | 'isProductTrusted'
    | 'createdAt'
    | 'updatedAt'
  >
): Promise<Product> {
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
    seasons: payload.seasons && payload.seasons.length > 0 ? payload.seasons : ['Diwali', 'New Year'],
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
    isActive: true,
    listingStatus: 'published',
    isPublished: true,
    isUnlisted: false,
    isDiscontinued: false,
    isDeleted: false,
    disabledAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  if (mongoConnected && mongoose.isValidObjectId(sellerId)) {
    const doc = await ProductModel.create({
      ...newProduct,
      _id: new mongoose.Types.ObjectId(),
      sellerId: new mongoose.Types.ObjectId(sellerId),
    });
    return normalizeProductDoc({ ...newProduct, _id: String(doc._id) });
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
    shippingWeightGrams?: number;
    title?: string;
    occasions?: OccasionType[];
    seasons?: SeasonType[];
    images?: Product['images'];
  }
): Promise<Product | null> {
  const existing = await getProductByIdOrSlug(productId, { includeControlled: true });
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

  let nextVariants = existing.variants;
  if (typeof updates.totalStock === 'number') {
    if (updates.totalStock === 0) {
      nextVariants = existing.variants.map((v) => ({ ...v, stock: 0 }));
    } else if (existing.totalStock === 0 && updates.totalStock > 0 && existing.variants.length > 0) {
      const perVariant = Math.max(1, Math.floor(updates.totalStock / existing.variants.length));
      nextVariants = existing.variants.map((v) => ({ ...v, stock: perVariant }));
    }
  }

  const patch = {
    ...(updates.title ? { title: updates.title } : {}),
    ...(updates.occasions ? { occasions: updates.occasions } : {}),
    ...(updates.seasons ? { seasons: updates.seasons } : {}),
    ...(normalizedImages ? { images: normalizedImages } : {}),
    ...(typeof updates.totalStock === 'number'
      ? { totalStock: updates.totalStock, variants: nextVariants }
      : {}),
    ...(typeof updates.shippingWeightGrams === 'number' ? { shippingWeightGrams: updates.shippingWeightGrams } : {}),
    basePrice,
    discountPercent,
    salePrice,
    badges: Array.from(badges),
    updatedAt: new Date().toISOString(),
  };

  if (mongoConnected && mongoose.isValidObjectId(productId)) {
    const updated = await ProductModel.findByIdAndUpdate(productId, { $set: patch }, { returnDocument: 'after' }).lean();
    return updated ? normalizeProductDoc(updated) : null;
  }

  const rawProd = localState.products.find((p) => p._id === productId);
  if (!rawProd) return null;
  Object.assign(rawProd, patch);
  saveLocalStore(localState);
  return normalizeProductDoc(rawProd);
}

// --- Seller Product Lifecycle Control Panel (Unpublish / Unlist / Out of Stock / Discontinue / Full Purge Remove) ---

export async function getActiveOrderCountForProduct(productId: string): Promise<number> {
  if (mongoConnected) {
    const prodMatch = mongoose.isValidObjectId(productId)
      ? { $in: [productId, new mongoose.Types.ObjectId(productId)] }
      : productId;
    return OrderModel.countDocuments({
      status: { $in: ACTIVE_ORDER_STATUSES },
      'items.productId': prodMatch,
    });
  }
  return localState.orders.filter(
    (o) =>
      ACTIVE_ORDER_STATUSES.includes(o.status) &&
      o.items.some((item) => item.productId === productId)
  ).length;
}

async function getActiveOrderCountsByProduct(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (mongoConnected) {
    const activeOrders = await OrderModel.find({
      status: { $in: ACTIVE_ORDER_STATUSES },
    })
      .select('items.productId')
      .lean();
    for (const order of activeOrders as any[]) {
      const seenInOrder = new Set<string>();
      for (const item of order.items || []) {
        const pid = String(item.productId);
        if (!seenInOrder.has(pid)) {
          seenInOrder.add(pid);
          counts.set(pid, (counts.get(pid) || 0) + 1);
        }
      }
    }
    return counts;
  }

  for (const order of localState.orders) {
    if (!ACTIVE_ORDER_STATUSES.includes(order.status)) continue;
    const seenInOrder = new Set<string>();
    for (const item of order.items) {
      if (!seenInOrder.has(item.productId)) {
        seenInOrder.add(item.productId);
        counts.set(item.productId, (counts.get(item.productId) || 0) + 1);
      }
    }
  }
  return counts;
}

export async function listSellerManagedProducts(
  actorId: string,
  role: string,
  filters?: { q?: string; statusFilter?: string }
): Promise<Product[]> {
  const [all, activeCounts] = await Promise.all([
    getAllProductsRaw({ includeControlled: true }),
    getActiveOrderCountsByProduct(),
  ]);

  let items = all
    .filter((p) => (role === 'ADMIN' ? true : p.sellerId === actorId))
    .map((p) => ({
      ...p,
      activeOrderCount: activeCounts.get(p._id) || 0,
    }));

  const q = (filters?.q || '').trim().toLowerCase();
  if (q) {
    items = items.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.occasions.some((o) => o.toLowerCase().includes(q))
    );
  }

  const sf = filters?.statusFilter || 'all';
  if (sf === 'published') {
    items = items.filter((p) => isProductPubliclyVisible(p) && p.totalStock > 0);
  } else if (sf === 'unpublished') {
    items = items.filter((p) => !p.isDiscontinued && (p.isPublished === false || Boolean(p.isUnlisted)));
  } else if (sf === 'unlisted') {
    items = items.filter((p) => !p.isDiscontinued && Boolean(p.isUnlisted));
  } else if (sf === 'out_of_stock') {
    items = items.filter((p) => !p.isDiscontinued && p.totalStock <= 0);
  } else if (sf === 'discontinued') {
    items = items.filter((p) => Boolean(p.isDiscontinued));
  }

  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return items;
}

export async function updateProductControlState(
  productId: string,
  actorId: string,
  role: string,
  action: ProductControlAction,
  stockValue?: number
): Promise<Product | null> {
  const existing = await getProductByIdOrSlug(productId, { includeControlled: true });
  if (!existing) return null;
  if (role !== 'ADMIN' && existing.sellerId !== actorId) return null;

  const nowIso = new Date().toISOString();
  const patch: Record<string, any> = { updatedAt: nowIso };

  switch (action) {
    case 'publish': {
      patch.isActive = true;
      patch.isPublished = true;
      patch.isUnlisted = false;
      patch.isDiscontinued = false;
      patch.listingStatus = 'published';
      patch.disabledAt = null;
      break;
    }
    case 'unpublish': {
      patch.isPublished = false;
      patch.listingStatus = existing.isDiscontinued ? 'discontinued' : 'unpublished';
      patch.disabledAt = nowIso;
      break;
    }
    case 'unlist': {
      patch.isUnlisted = true;
      patch.listingStatus = existing.isDiscontinued ? 'discontinued' : 'unpublished';
      patch.disabledAt = nowIso;
      break;
    }
    case 'relist': {
      patch.isUnlisted = false;
      patch.isPublished = true;
      patch.isActive = true;
      patch.isDiscontinued = false;
      patch.listingStatus = 'published';
      patch.disabledAt = null;
      break;
    }
    case 'mark_out_of_stock': {
      patch.totalStock = 0;
      patch.variants = existing.variants.map((v) => ({ ...v, stock: 0 }));
      break;
    }
    case 'restock': {
      const targetStock = Math.max(1, Math.floor(stockValue ?? 15));
      const count = Math.max(1, existing.variants.length);
      const perVariant = Math.max(1, Math.floor(targetStock / count));
      patch.totalStock = targetStock;
      patch.variants = existing.variants.map((v) => ({ ...v, stock: perVariant }));
      break;
    }
    case 'discontinue': {
      patch.isDiscontinued = true;
      patch.isActive = false;
      patch.isPublished = false;
      patch.isUnlisted = true;
      patch.listingStatus = 'discontinued';
      patch.disabledAt = nowIso;
      break;
    }
  }

  let updated: Product | null = null;
  if (mongoConnected && mongoose.isValidObjectId(productId)) {
    const doc = await ProductModel.findByIdAndUpdate(
      productId,
      { $set: patch },
      { returnDocument: 'after' }
    ).lean();
    updated = doc ? normalizeProductDoc(doc) : null;
  } else {
    const raw = localState.products.find((p) => p._id === productId);
    if (!raw) return null;
    Object.assign(raw, patch);
    saveLocalStore(localState);
    updated = normalizeProductDoc(raw);
  }

  if (!updated) return null;
  const activeOrderCount = await getActiveOrderCountForProduct(updated._id);
  return { ...updated, activeOrderCount };
}

export async function removeProductCompletely(
  productId: string,
  actorId: string,
  role: string
): Promise<{
  ok: boolean;
  notFound?: boolean;
  unauthorized?: boolean;
  blockedByActiveOrders?: boolean;
  activeOrderCount?: number;
  removedProductId?: string;
  purgedImages?: string[];
  error?: string;
}> {
  const existing = await getProductByIdOrSlug(productId, { includeControlled: true });
  if (!existing) {
    return { ok: false, notFound: true, error: 'Product not found or already removed.' };
  }
  if (role !== 'ADMIN' && existing.sellerId !== actorId) {
    return { ok: false, unauthorized: true, error: 'Unauthorized to remove this product.' };
  }

  // Strictly block permanent removal while any active ongoing order exists
  const activeOrderCount = await getActiveOrderCountForProduct(existing._id);
  if (activeOrderCount > 0) {
    return {
      ok: false,
      blockedByActiveOrders: true,
      activeOrderCount,
      error: `Cannot permanently remove "${existing.title}" because ${activeOrderCount} active ongoing order(s) exist. Mark it as Discontinued instead.`,
    };
  }

  // Collect all CDN/uploaded image URLs associated strictly with this product
  const candidateUrls: string[] = [];
  for (const img of existing.images || []) {
    if (img.url) candidateUrls.push(img.url);
    if (img.thumbUrl) candidateUrls.push(img.thumbUrl);
  }
  for (const v of existing.variants || []) {
    if (v.variantImageUrl) candidateUrls.push(v.variantImageUrl);
  }

  // Ensure we don't delete an uploaded file if another catalog product explicitly shares it
  const otherProducts = (await getAllProductsRaw({ includeControlled: true })).filter(
    (p) => p._id !== existing._id
  );
  const sharedUrlSet = new Set<string>();
  for (const op of otherProducts) {
    for (const img of op.images || []) {
      if (img.url) sharedUrlSet.add(img.url);
      if (img.thumbUrl) sharedUrlSet.add(img.thumbUrl);
    }
    for (const v of op.variants || []) {
      if (v.variantImageUrl) sharedUrlSet.add(v.variantImageUrl);
    }
  }
  const urlsToDelete = candidateUrls.filter((u) => !sharedUrlSet.has(u));
  const storagePurge = await deleteStoredImageAssets(urlsToDelete);

  // Mongo-level disable mark + full trace deletion across collections (Orders History preserved!)
  if (mongoConnected && mongoose.isValidObjectId(existing._id)) {
    const objId = new mongoose.Types.ObjectId(existing._id);
    // Explicitly mark disabled at Mongo level before purging the catalog document
    await ProductModel.updateOne(
      { _id: objId },
      {
        $set: {
          isActive: false,
          isPublished: false,
          isUnlisted: true,
          isDiscontinued: true,
          isDeleted: true,
          listingStatus: 'discontinued',
          disabledAt: new Date(),
        },
      }
    );
    await Promise.all([
      ProductModel.deleteOne({ _id: objId }),
      LikeModel.deleteMany({ productId: objId }),
      ReviewModel.deleteMany({ productId: objId }),
      ShareEventModel.deleteMany({ productId: existing._id }),
      SalesCampaignModel.updateMany({}, { $pull: { productIds: existing._id } }),
      CouponModel.updateMany({}, { $pull: { productIds: existing._id } }),
    ]);
  }

  // Local persistent store + Redis carts purge (preserving Orders History untouched)
  localState.products = localState.products.filter((p) => p._id !== existing._id);
  localState.likes = localState.likes.filter((l) => l.productId !== existing._id);
  localState.reviews = localState.reviews.filter((r) => r.productId !== existing._id);
  localState.shareEvents = localState.shareEvents.filter((s) => s.productId !== existing._id);
  for (const cmp of localState.salesCampaigns) {
    cmp.productIds = cmp.productIds.filter((id) => id !== existing._id);
  }
  for (const cpn of localState.coupons) {
    cpn.productIds = cpn.productIds.filter((id) => id !== existing._id);
  }
  const cartKeys = Object.keys(localState.carts);
  for (const ck of cartKeys) {
    localState.carts[ck] = (localState.carts[ck] || []).filter(
      (item) => item.productId !== existing._id
    );
  }
  await purgeProductFromCartCaches(cartKeys, existing._id);
  saveLocalStore(localState);

  return {
    ok: true,
    removedProductId: existing._id,
    purgedImages: storagePurge.deletedKeys,
  };
}

// --- Users & Auth (Supabase + Secure Persistent Fallback) ---

function sanitizeUser(doc: any): User {
  const { passwordHash: _omitted, ...safe } = doc;
  return {
    ...safe,
    _id: String(safe._id),
    oauthAccounts: Array.isArray(safe.oauthAccounts) ? safe.oauthAccounts : [],
    shippingAddresses: Array.isArray(safe.shippingAddresses) ? safe.shippingAddresses : [],
  };
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash?: string): boolean {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, expectedHex] = storedHash.split(':');
  if (!salt || !expectedHex) return false;
  const actualBuf = crypto.scryptSync(password, salt, 64);
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

export async function findUserById(id: string): Promise<User | null> {
  if (mongoConnected && mongoose.isValidObjectId(id)) {
    const doc = await UserModel.findById(id).lean();
    return doc ? sanitizeUser(doc) : null;
  }
  const found = localState.users.find((u) => u._id === id);
  return found ? sanitizeUser(found) : null;
}

export async function ensureRootSuperuser(): Promise<void> {
  const email = (process.env.ROOT_SUPERUSER_EMAIL || 'ashvinsingh25@gmail.com').trim().toLowerCase();
  const initialPassword = process.env.ROOT_SUPERUSER_INITIAL_PASSWORD || '';
  if (!initialPassword) {
    if (process.env.NODE_ENV === 'production') throw new Error('ROOT_SUPERUSER_INITIAL_PASSWORD must be configured with at least 14 characters; refusing to start without secure root provisioning.');
    return;
  }
  if (initialPassword.length < 14) throw new Error('ROOT_SUPERUSER_INITIAL_PASSWORD must contain at least 14 characters.');
  if (mongoConnected) {
    const existing = await UserModel.findOne({ email }).select('+passwordHash');
    if (!existing) {
      await UserModel.create({
        role: 'ADMIN', isRootSuperuser: true, name: 'Root Superuser', email,
        passwordHash: hashPassword(initialPassword), authProvider: 'invite', oauthAccounts: [],
        isWhatsappVerified: false, shippingAddresses: [],
      });
    } else {
      const firstRootProvision = existing.isRootSuperuser !== true;
      existing.role = 'ADMIN';
      existing.isRootSuperuser = true;
      if (firstRootProvision || !(existing as any).passwordHash) (existing as any).passwordHash = hashPassword(initialPassword);
      await existing.save();
    }
    return;
  }
  const existing = localState.users.find((user) => user.email.toLowerCase() === email) as (User & { passwordHash?: string; isRootSuperuser?: boolean }) | undefined;
  if (!existing) {
    const now = new Date().toISOString();
    localState.users.push({
      _id: 'root_' + crypto.randomBytes(12).toString('hex'), role: 'ADMIN', isRootSuperuser: true,
      name: 'Root Superuser', email, passwordHash: hashPassword(initialPassword), authProvider: 'invite',
      oauthAccounts: [], isWhatsappVerified: false, shippingAddresses: [], createdAt: now, updatedAt: now,
    } as any);
  } else {
    const firstRootProvision = existing.isRootSuperuser !== true;
    existing.role = 'ADMIN';
    existing.isRootSuperuser = true;
    if (firstRootProvision || !existing.passwordHash) existing.passwordHash = hashPassword(initialPassword);
  }
  saveLocalStore(localState);
}

export async function updateRootSuperuserPassword(userId: string, currentPassword: string, nextPassword: string): Promise<boolean> {
  if (mongoConnected && mongoose.isValidObjectId(userId)) {
    const doc = await UserModel.findOne({ _id: userId, isRootSuperuser: true }).select('+passwordHash');
    if (!doc || !verifyPassword(currentPassword, (doc as any).passwordHash)) return false;
    (doc as any).passwordHash = hashPassword(nextPassword);
    await doc.save();
    return true;
  }
  const user = localState.users.find((item) => item._id === userId && (item as any).isRootSuperuser) as (User & { passwordHash?: string }) | undefined;
  if (!user || !verifyPassword(currentPassword, user.passwordHash)) return false;
  user.passwordHash = hashPassword(nextPassword);
  saveLocalStore(localState);
  return true;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const emailLower = email.trim().toLowerCase();
  if (mongoConnected) {
    const doc = await UserModel.findOne({ email: emailLower }).lean();
    return doc ? sanitizeUser(doc) : null;
  }
  const found = localState.users.find((u) => u.email.toLowerCase() === emailLower);
  return found ? sanitizeUser(found) : null;
}

export async function syncSupabaseCustomerUser(profile: {
  supabaseUid: string;
  email: string;
  name: string;
  mobileNumber?: string;
}): Promise<User> {
  const emailLower = profile.email.trim().toLowerCase();
  const cleanName = profile.name.trim() || emailLower.split('@')[0];

  if (mongoConnected) {
    let doc = await UserModel.findOne({
      $or: [{ supabaseUid: profile.supabaseUid }, { email: emailLower }],
    });
    if (!doc) {
      doc = await UserModel.create({
        role: 'BUYER',
        name: cleanName,
        email: emailLower,
        supabaseUid: profile.supabaseUid,
        authProvider: 'supabase',
        oauthAccounts: [],
        mobileNumber: profile.mobileNumber || undefined,
        isWhatsappVerified: false,
        shippingAddresses: [],
      });
    } else {
      let dirty = false;
      if (!doc.supabaseUid) {
        doc.supabaseUid = profile.supabaseUid;
        dirty = true;
      }
      if (doc.authProvider !== 'supabase') {
        doc.authProvider = 'supabase';
        dirty = true;
      }
      if (profile.mobileNumber && !doc.mobileNumber) {
        doc.mobileNumber = profile.mobileNumber;
        dirty = true;
      }
      if (cleanName && (!doc.name || doc.name === emailLower.split('@')[0])) {
        doc.name = cleanName;
        dirty = true;
      }
      if (dirty) await doc.save();
    }
    return sanitizeUser(doc.toObject());
  }

  let user = localState.users.find(
    (u) => u.supabaseUid === profile.supabaseUid || u.email.toLowerCase() === emailLower
  );
  const nowIso = new Date().toISOString();
  if (!user) {
    user = {
      _id: `usr_${crypto.randomBytes(5).toString('hex')}`,
      role: 'BUYER',
      name: cleanName,
      email: emailLower,
      supabaseUid: profile.supabaseUid,
      authProvider: 'supabase',
      oauthAccounts: [],
      mobileNumber: profile.mobileNumber || undefined,
      isWhatsappVerified: false,
      shippingAddresses: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    localState.users.push(user);
    saveLocalStore(localState);
  } else {
    let dirty = false;
    if (!user.supabaseUid) {
      user.supabaseUid = profile.supabaseUid;
      dirty = true;
    }
    if (profile.mobileNumber && !user.mobileNumber) {
      user.mobileNumber = profile.mobileNumber;
      dirty = true;
    }
    if (dirty) {
      user.updatedAt = nowIso;
      saveLocalStore(localState);
    }
  }
  return sanitizeUser(user);
}

export async function registerCustomerAccount(input: {
  name: string;
  email: string;
  password: string;
  mobileNumber?: string;
}): Promise<User> {
  const emailLower = input.email.trim().toLowerCase();
  const cleanName = input.name.trim();
  const pwHash = hashPassword(input.password);

  if (mongoConnected) {
    const existing = await UserModel.findOne({ email: emailLower }).lean();
    if (existing) {
      const err = new Error('An account with this email already exists. Please sign in.') as Error & {
        status?: number;
      };
      err.status = 409;
      throw err;
    }
    const created = await UserModel.create({
      role: 'BUYER',
      name: cleanName,
      email: emailLower,
      passwordHash: pwHash,
      authProvider: 'supabase',
      oauthAccounts: [],
      mobileNumber: input.mobileNumber || undefined,
      isWhatsappVerified: false,
      shippingAddresses: [],
    });
    return sanitizeUser(created.toObject());
  }

  const existing = localState.users.find((u) => u.email.toLowerCase() === emailLower);
  if (existing) {
    const err = new Error('An account with this email already exists. Please sign in.') as Error & {
      status?: number;
    };
    err.status = 409;
    throw err;
  }

  const nowIso = new Date().toISOString();
  const newUser = {
    _id: `usr_${crypto.randomBytes(5).toString('hex')}`,
    role: 'BUYER' as const,
    name: cleanName,
    email: emailLower,
    passwordHash: pwHash,
    authProvider: 'supabase' as const,
    oauthAccounts: [],
    mobileNumber: input.mobileNumber || undefined,
    isWhatsappVerified: false,
    shippingAddresses: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  localState.users.push(newUser as User & { passwordHash?: string });
  saveLocalStore(localState);
  return sanitizeUser(newUser);
}

export async function authenticateCustomerAccount(input: {
  email: string;
  password: string;
}): Promise<User> {
  const emailLower = input.email.trim().toLowerCase();

  if (mongoConnected) {
    const doc = await UserModel.findOne({ email: emailLower }).select('+passwordHash').lean();
    if (!doc || !verifyPassword(input.password, (doc as any).passwordHash)) {
      const err = new Error('Invalid email or password.') as Error & { status?: number };
      err.status = 401;
      throw err;
    }
    return sanitizeUser(doc);
  }

  const user = localState.users.find((u) => u.email.toLowerCase() === emailLower) as
    | (User & { passwordHash?: string })
    | undefined;
  if (!user || !verifyPassword(input.password, user.passwordHash)) {
    const err = new Error('Invalid email or password.') as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  return sanitizeUser(user);
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
    return sanitizeUser(doc.toObject());
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
  return sanitizeUser(user);
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
      { returnDocument: 'after' }
    ).lean();
    return doc ? sanitizeUser(doc) : null;
  }

  const user = localState.users.find((u) => u._id === userId);
  if (!user) return null;
  user.role = 'SELLER';
  user.whatsappNumber = whatsappNumber;
  user.isWhatsappVerified = true;
  user.sellerProfile = user.sellerProfile || sellerProfile;
  user.updatedAt = new Date().toISOString();
  saveLocalStore(localState);
  return sanitizeUser(user);
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
    const docs = await ProductModel.find({
      _id: { $in: validIds },
      ...MONGO_PUBLIC_PRODUCT_FILTER,
    }).lean();
    return docs.map(normalizeProductDoc);
  }
  const idSet = new Set(likedIds);
  return localState.products
    .filter((p) => isProductPubliclyVisible(p) && idSet.has(p._id))
    .map(normalizeProductDoc);
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
    prod.trendScore =
      prod.likesCount + (prod.sharesCount || 0) * 2 + prod.cartAddsCount * 3 + prod.salesCount * 5;
    saveLocalStore(localState);
  }
}

export async function logShareEvent(input: {
  productId: string;
  channel?: 'whatsapp';
  userId?: string | null;
  guestToken?: string | null;
}): Promise<{ eventId: string; productId: string; sharesCount: number } | null> {
  const channel: 'whatsapp' = input.channel || 'whatsapp';
  const nowIso = new Date().toISOString();

  if (mongoConnected && mongoose.isValidObjectId(input.productId)) {
    const updated = await ProductModel.findOneAndUpdate(
      { _id: input.productId, ...MONGO_PUBLIC_PRODUCT_FILTER },
      { $inc: { sharesCount: 1, trendScore: 2 } },
      { returnDocument: 'after' }
    ).lean();
    if (!updated) return null;
    const ev = await ShareEventModel.create({
      productId: String((updated as any)._id),
      channel,
      userId: input.userId || null,
      guestToken: input.guestToken || null,
    });
    return {
      eventId: String(ev._id),
      productId: String((updated as any)._id),
      sharesCount: Number((updated as any).sharesCount || 0),
    };
  }

  const prod = localState.products.find(
    (p) => (p._id === input.productId || p.slug === input.productId) && isProductPubliclyVisible(p)
  );
  if (!prod) return null;

  prod.sharesCount = (prod.sharesCount || 0) + 1;
  prod.trendScore =
    prod.likesCount + prod.sharesCount * 2 + prod.cartAddsCount * 3 + prod.salesCount * 5;
  const event: ShareEventRecord = {
    _id: `shr_${crypto.randomBytes(6).toString('hex')}`,
    productId: prod._id,
    channel,
    userId: input.userId || null,
    guestToken: input.guestToken || null,
    createdAt: nowIso,
  };
  localState.shareEvents.unshift(event);
  if (localState.shareEvents.length > 5000) {
    localState.shareEvents = localState.shareEvents.slice(0, 5000);
  }
  saveLocalStore(localState);
  return {
    eventId: event._id,
    productId: prod._id,
    sharesCount: prod.sharesCount,
  };
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
    return ['Pending', 'Confirmed', 'Packed', 'Shipped', 'Out for Delivery', 'PENDING_SELLER_CONFIRMATION', 'CONFIRMED_AWAITING_PAYMENT', 'PAID_AND_PROCESSING', 'CANCELLATION_REQUESTED', 'RETURN_REQUESTED', 'RETURN_RECEIVED'].includes(status);
  }
  if (tab === 'Completed') {
    return status === 'Delivered';
  }
  // 'Past' includes Delivered & Cancelled
  return status === 'Delivered' || status === 'Cancelled';
}

async function enrichOrdersWithCatalogStatus(orders: Order[]): Promise<Order[]> {
  if (orders.length === 0) return orders;
  const allProducts = await getAllProductsRaw({ includeControlled: true });
  const prodMap = new Map(allProducts.map((p) => [p._id, p]));
  return orders.map((order) => ({
    ...order,
    items: order.items.map((item) => {
      const prod = prodMap.get(String(item.productId));
      let catalogStatus: 'active' | 'unpublished' | 'discontinued' | 'removed' = 'removed';
      if (prod && !prod.isDeleted) {
        if (prod.isDiscontinued) catalogStatus = 'discontinued';
        else if (!isProductPubliclyVisible(prod)) catalogStatus = 'unpublished';
        else catalogStatus = 'active';
      }
      return {
        ...item,
        productId: String(item.productId),
        catalogStatus,
      };
    }),
  }));
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
        ? ['Pending', 'Confirmed', 'Packed', 'Shipped', 'Out for Delivery', 'PENDING_SELLER_CONFIRMATION', 'CONFIRMED_AWAITING_PAYMENT', 'PAID_AND_PROCESSING', 'CANCELLATION_REQUESTED', 'RETURN_REQUESTED', 'RETURN_RECEIVED']
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
    const orders = await enrichOrdersWithCatalogStatus(
      docs.map((d: any) => ({
        ...d,
        _id: String(d._id),
        buyerId: String(d.buyerId),
        sellerId: String(d.sellerId),
      }))
    );
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

  const slice = await enrichOrdersWithCatalogStatus(filtered.slice(skip, skip + safeLimit));
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
  couponCode?: string;
  idempotencyKey?: string;
  shippingBySeller?: Record<string, { actualCarrierCost: number; sellerMarkup: number; customerCharge: number; insuranceAmount: number; carrierCode?: string; serviceCode?: string; estimatedTransitHours?: number; quoteExpiresAt?: string | null; policy: 'SEPARATE' }>;
}): Promise<Order[] & { replayed?: boolean }> {
  if (!input.buyer.mobileNumber || input.buyer.shippingAddresses.length === 0) throw new Error('MOBILE_AND_ADDRESS_REQUIRED');
  if (!input.items.length) throw new Error('EMPTY_CART');
  const idempotencyKey = input.idempotencyKey?.trim();
  if (idempotencyKey && (idempotencyKey.length < 8 || idempotencyKey.length > 120)) throw new Error('INVALID_CHECKOUT_IDEMPOTENCY_KEY');

  const buyerObjectId = mongoose.isValidObjectId(input.buyer._id) ? new mongoose.Types.ObjectId(input.buyer._id) : null;
  const checkoutPayloadHash = idempotencyKey ? crypto.createHash('sha256').update(JSON.stringify({
    items: input.items.map((item) => ({
      productId: item.productId, variantSku: item.variantSku, sellerId: item.sellerId,
      quantity: item.quantity, unitPrice: item.unitPrice,
    })).sort((a, b) => a.productId.localeCompare(b.productId) || a.variantSku.localeCompare(b.variantSku)),
    couponCode: input.couponCode?.trim().toUpperCase() || '',
  })).digest('hex') : undefined;

  const replayOrders = async () => {
    if (!buyerObjectId || !idempotencyKey) return null;
    const previous = await OrderModel.find({ buyerId: buyerObjectId, checkoutIdempotencyKey: idempotencyKey }).sort({ createdAt: 1 }).lean();
    if (!previous.length) return null;
    if (previous.some((doc: any) => doc.checkoutPayloadHash !== checkoutPayloadHash)) throw new Error('IDEMPOTENCY_KEY_CONFLICT');
    const replay = previous.map((doc: any) => ({
      ...doc, _id: String(doc._id), buyerId: String(doc.buyerId), sellerId: String(doc.sellerId),
    })) as Order[] & { replayed?: boolean };
    replay.replayed = true;
    return replay;
  };
  if (mongoConnected && buyerObjectId && idempotencyKey) {
    const replay = await replayOrders();
    if (replay) return replay;
  }

  const addr = input.buyer.shippingAddresses.find((a) => a.isDefault) || input.buyer.shippingAddresses[0];
  const products = await Promise.all(input.items.map((item) => getProductByIdOrSlug(item.productId, { includeControlled: true })));
  for (let i = 0; i < input.items.length; i++) {
    const item = input.items[i], prod = products[i];
    if (!prod || !isProductPubliclyVisible(prod)) throw new Error(`"${item.title}" is no longer available for purchase.`);
    if (String(prod.sellerId) !== String(item.sellerId)) throw new Error('CART_SELLER_MISMATCH');
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) throw new Error('INVALID_CART_QUANTITY');
    const variant = (prod.variants || []).find((v) => v.variantSku === item.variantSku);
    if ((prod.variants || []).length && !variant) throw new Error('PRODUCT_VARIANT_UNAVAILABLE');
    if (prod.totalStock < item.quantity || (variant && variant.stock < item.quantity)) throw new Error(`"${item.title}" is currently out of stock or has insufficient units.`);
    const authoritativePrice = variant?.priceOverride ?? prod.salePrice;
    if (Number(item.unitPrice) !== Number(authoritativePrice)) throw new Error('CART_PRICE_CHANGED');
  }

  let appliedCouponRecord: Coupon | null = null, totalCouponDiscount = 0, eligibleTotalBasis = 0;
  if (input.couponCode && input.couponCode.trim()) {
    const validation = await validateCouponForCart({ code: input.couponCode.trim(), user: input.buyer, items: input.items });
    if (!validation.valid || !validation.coupon) throw new Error(validation.reason || 'INVALID_COUPON');
    appliedCouponRecord = validation.coupon;
    totalCouponDiscount = validation.discountAmount;
    eligibleTotalBasis = validation.eligibleSubtotal || 1;
  }

  const bySeller = new Map<string, CartItem[]>();
  for (const item of input.items) {
    const list = bySeller.get(item.sellerId) || [];
    list.push(item);
    bySeller.set(item.sellerId, list);
  }

  const nowIso = new Date().toISOString(), sellerEntries = Array.from(bySeller.entries());
  const orders: Order[] = [];
  let remainingDiscount = totalCouponDiscount;
  for (let idx = 0; idx < sellerEntries.length; idx++) {
    const [sellerId, sellerItems] = sellerEntries[idx];
    const subtotal = sellerItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    let sellerCouponDiscount = 0;
    if (appliedCouponRecord && remainingDiscount > 0) {
      const eligibleSubtotal = sellerItems.filter((item) => isCouponEligibleForProduct(appliedCouponRecord!, item.productId, item.sellerId))
        .reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
      if (eligibleSubtotal > 0) {
        sellerCouponDiscount = idx === sellerEntries.length - 1
          ? Math.min(subtotal, remainingDiscount)
          : Math.min(subtotal, Math.round((eligibleSubtotal / Math.max(1, eligibleTotalBasis)) * totalCouponDiscount));
        remainingDiscount = Math.max(0, remainingDiscount - sellerCouponDiscount);
      }
    }
    orders.push({
      // Local fallback identifier; Mongo mode replaces it with a real ObjectId before insert.
      _id: `local_${crypto.randomBytes(8).toString('hex')}`,
      orderNumber: `ORD-${new Date().getUTCFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      buyerId: input.buyer._id, buyerName: input.buyer.name, sellerId,
      items: sellerItems.map((item) => ({
        productId: item.productId, variantSku: item.variantSku, title: item.title,
        size: item.size, colorName: item.colorName, imageUrl: item.imageUrl,
        quantity: item.quantity, unitPrice: item.unitPrice,
      })),
      totalAmount: Math.max(1, subtotal - sellerCouponDiscount + Number(input.shippingBySeller?.[sellerId]?.customerCharge || 0)),
      ...(input.shippingBySeller?.[sellerId] ? { shipping: input.shippingBySeller[sellerId] } : {}),
      ...(appliedCouponRecord && sellerCouponDiscount > 0 ? {
        appliedCoupon: { couponId: appliedCouponRecord._id, code: appliedCouponRecord.code, discountAmount: sellerCouponDiscount },
      } : {}),
      status: 'Pending',
      shippingAddress: { fullName: addr.fullName, phone: addr.phone, street: addr.street, city: addr.city, state: addr.state, pincode: addr.pincode },
      statusTimeline: [{
        status: 'Pending',
        note: appliedCouponRecord && sellerCouponDiscount > 0
          ? `Order placed via Kala & Karat (Coupon ${appliedCouponRecord.code} saved ₹${sellerCouponDiscount})`
          : 'Order placed via Kala & Karat',
        timestamp: nowIso,
      }],
      createdAt: nowIso, updatedAt: nowIso,
    });
  }

  if (mongoConnected && buyerObjectId) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const reservations = aggregateInventoryLines(input.items).sort((a, b) => a.productId.localeCompare(b.productId));
        for (const reservation of reservations) {
          if (!mongoose.isValidObjectId(reservation.productId)) throw new Error('INVALID_PRODUCT_ID');
          const firstLine = input.items.find((line) => line.productId === reservation.productId)!;
          const filter: Record<string, any> = {
            _id: new mongoose.Types.ObjectId(reservation.productId),
            sellerId: new mongoose.Types.ObjectId(firstLine.sellerId),
            isDeleted: { $ne: true }, isActive: true, isPublished: true,
            isUnlisted: { $ne: true }, isDiscontinued: { $ne: true },
            totalStock: { $gte: reservation.quantity },
          };
          const arrayFilters: Record<string, any>[] = [], and: Record<string, any>[] = [];
          const inc: Record<string, number> = {
            totalStock: -reservation.quantity, salesCount: reservation.quantity, trendScore: reservation.quantity * 5,
          };
          reservation.variants.forEach((variant, index) => {
            const identifier = `variant${index}`;
            and.push({ variants: { $elemMatch: { variantSku: variant.variantSku, stock: { $gte: variant.quantity } } } });
            inc[`variants.$[${identifier}].stock`] = -variant.quantity;
            arrayFilters.push({ [`${identifier}.variantSku`]: variant.variantSku, [`${identifier}.stock`]: { $gte: variant.quantity } });
          });
          if (and.length) filter.$and = and;
          const result = await ProductModel.updateOne(filter, { $inc: inc }, { session, ...(arrayFilters.length ? { arrayFilters } : {}) });
          if (result.modifiedCount !== 1) throw new Error('INVENTORY_RESERVATION_CONFLICT');
        }
        const docs = orders.map((order) => ({
          ...order, _id: new mongoose.Types.ObjectId(), buyerId: buyerObjectId,
          sellerId: new mongoose.Types.ObjectId(order.sellerId),
          ...(idempotencyKey ? { checkoutIdempotencyKey: idempotencyKey, checkoutPayloadHash } : {}),
        }));
        const inserted = await OrderModel.insertMany(docs, { session, ordered: true });
        inserted.forEach((doc: any, index: number) => { orders[index]._id = String(doc._id); });
        if (appliedCouponRecord && totalCouponDiscount > 0) {
          const couponFilter: Record<string, any> = {
            _id: appliedCouponRecord._id, isActive: true, expiresAt: { $gt: new Date() },
            $or: [
              { usageLimit: { $exists: false } }, { usageLimit: null },
              { $expr: { $lt: ['$usedCount', '$usageLimit'] } },
            ],
          };
          const couponUpdate = await CouponModel.updateOne(couponFilter, { $inc: { usedCount: 1 } }, { session });
          if (couponUpdate.modifiedCount !== 1) throw new Error('COUPON_USAGE_LIMIT_REACHED');
        }
      });
      return orders;
    } catch (error) {
      if (idempotencyKey && (error as { code?: number }).code === 11000) {
        const replay = await replayOrders();
        if (replay) return replay;
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  if (process.env.NODE_ENV === 'production') throw new Error('MONGODB_TRANSACTIONAL_CHECKOUT_REQUIRED');
  for (const order of orders) {
    localState.orders.unshift(order);
    for (const item of order.items) {
      const prod = localState.products.find((p) => p._id === item.productId);
      if (prod) {
        prod.salesCount += item.quantity; prod.totalStock -= item.quantity;
        const variant = (prod.variants || []).find((v) => v.variantSku === item.variantSku);
        if (variant) variant.stock -= item.quantity;
        prod.trendScore = prod.likesCount + prod.cartAddsCount * 3 + prod.salesCount * 5;
      }
    }
  }
  saveLocalStore(localState);
  if (appliedCouponRecord && totalCouponDiscount > 0) await incrementCouponUsage(appliedCouponRecord._id);
  return orders;
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
    (p) => isProductPubliclyVisible(p) && p._id !== target._id
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
  const totalShares = sellerProducts.reduce((s, p) => s + (p.sharesCount || 0), 0);
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
      sharesCount: p.sharesCount || 0,
      salesCount: p.salesCount,
      revenue: p.salesCount * p.salePrice,
      conversionRate: p.viewsCount > 0 ? Number(((p.salesCount / p.viewsCount) * 100).toFixed(1)) : 0,
    }));

  const mostSharedProducts = [...sellerProducts]
    .sort((a, b) => (b.sharesCount || 0) - (a.sharesCount || 0) || b.salesCount - a.salesCount)
    .slice(0, 6)
    .map((p) => ({
      _id: p._id,
      title: p.title,
      category: p.category,
      sharesCount: p.sharesCount || 0,
      viewsCount: p.viewsCount,
      salesCount: p.salesCount,
    }));

  return {
    overview: {
      totalRevenue,
      totalOrders: sellerOrders.length,
      totalViews,
      totalLikes,
      totalCartAdds,
      totalShares,
      conversionRate: totalViews > 0 ? Number(((totalPurchases / totalViews) * 100).toFixed(2)) : 0,
      trustScore: user?.sellerProfile?.trustScore || 4.8,
    },
    funnel: [
      { stage: 'Product Views', count: totalViews },
      { stage: 'Likes', count: totalLikes },
      { stage: 'WhatsApp Shares', count: totalShares },
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
    mostSharedProducts,
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
    const trendScore =
      p.likesCount + (p.sharesCount || 0) * 2 + p.cartAddsCount * 3 + p.salesCount * 5;
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
  email?: string;
  storeName?: string;
  note?: string;
  expiresInDays?: number;
}): Promise<SellerInvite> {
  const emailLower = (input.email || '').trim().toLowerCase();
  const token = `inv_${crypto.randomBytes(16).toString('hex')}`;
  const nowDate = new Date();
  const days = Math.min(90, Math.max(1, input.expiresInDays || 14));
  const expiresAtDate = new Date(nowDate.getTime() + days * 86400_000);

  if (mongoConnected && mongoose.isValidObjectId(input.adminId)) {
    if (emailLower) {
      await SellerInviteModel.updateMany(
        { email: emailLower, status: 'pending' },
        { $set: { status: 'revoked', revokedAt: nowDate } }
      );
    }
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

  if (emailLower) {
    for (const inv of localState.sellerInvites) {
      if ((inv.email || '').toLowerCase() === emailLower && inv.status === 'pending') {
        inv.status = 'revoked';
        inv.revokedAt = nowDate.toISOString();
      }
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
      { returnDocument: 'after' }
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
  invite?: Pick<SellerInvite, '_id' | 'email' | 'storeName' | 'note' | 'invitedByName' | 'status' | 'expiresAt'> & {
    hasEmail: boolean;
  };
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
      email: found.email || '',
      hasEmail: Boolean(found.email && found.email.trim()),
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
  email?: string;
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

  const boundEmail = (validation.invite.email || '').trim().toLowerCase();
  const submittedEmail = (input.email || '').trim().toLowerCase();
  const invitedEmail = boundEmail || submittedEmail || input.actingUser?.email?.toLowerCase() || '';

  if (!invitedEmail || !invitedEmail.includes('@')) {
    throw new Error('Please enter a valid work email address to complete seller onboarding.');
  }

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
      { $set: { status: 'accepted', email: invitedEmail, acceptedAt: nowDate, acceptedUserId: userDoc._id } },
      { returnDocument: 'after' }
    ).lean();
    if (!updatedInvite) {
      throw new Error('This seller invitation could not be redeemed.');
    }

    return {
      user: sanitizeUser(userDoc.toObject()),
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
  invite.email = invitedEmail;
  invite.acceptedAt = nowIso;
  invite.acceptedUserId = user._id;
  saveLocalStore(localState);

  return { user: sanitizeUser(user), invite };
}

// --- SSL Token Authentication Session Manager ---

export async function saveAuthSession(session: AuthSessionRecord): Promise<AuthSessionRecord> {
  if (mongoConnected) {
    await AuthSessionModel.create({
      sessionId: session.sessionId,
      userId: session.userId,
      role: session.role,
      provider: session.provider,
      tokenFingerprint: session.tokenFingerprint,
      csrfToken: session.csrfToken,
      tlsSecure: session.tlsSecure,
      protocol: session.protocol,
      userAgent: session.userAgent,
      lastActiveAt: new Date(session.lastActiveAt),
      expiresAt: new Date(session.expiresAt),
      revokedAt: null,
    });
    return session;
  }
  localState.sessions = [
    session,
    ...localState.sessions.filter((s) => s.sessionId !== session.sessionId).slice(0, 120),
  ];
  saveLocalStore(localState);
  return session;
}

export async function findActiveAuthSession(sessionId: string): Promise<AuthSessionRecord | null> {
  const nowMs = Date.now();
  if (mongoConnected) {
    const doc = await AuthSessionModel.findOne({ sessionId, revokedAt: null }).lean();
    if (!doc) return null;
    if (new Date((doc as any).expiresAt).getTime() <= nowMs) return null;
    return {
      sessionId: (doc as any).sessionId,
      userId: String((doc as any).userId),
      role: (doc as any).role,
      provider:
        (doc as any).provider === 'invite' || (doc as any).provider === 'demo'
          ? (doc as any).provider
          : 'supabase',
      tokenFingerprint: (doc as any).tokenFingerprint,
      csrfToken: (doc as any).csrfToken,
      tlsSecure: Boolean((doc as any).tlsSecure),
      protocol: (doc as any).protocol || 'https',
      userAgent: (doc as any).userAgent || 'Browser Session',
      createdAt: new Date((doc as any).createdAt || Date.now()).toISOString(),
      lastActiveAt: new Date((doc as any).lastActiveAt).toISOString(),
      expiresAt: new Date((doc as any).expiresAt).toISOString(),
      revokedAt: null,
    };
  }
  const found = localState.sessions.find((s) => s.sessionId === sessionId && !s.revokedAt);
  if (!found) return null;
  if (new Date(found.expiresAt).getTime() <= nowMs) return null;
  return found;
}

export async function touchAuthSession(sessionId: string): Promise<void> {
  const now = new Date();
  if (mongoConnected) {
    await AuthSessionModel.updateOne({ sessionId }, { $set: { lastActiveAt: now } });
    return;
  }
  const found = localState.sessions.find((s) => s.sessionId === sessionId);
  if (found && now.getTime() - new Date(found.lastActiveAt).getTime() > 60_000) {
    found.lastActiveAt = now.toISOString();
    saveLocalStore(localState);
  }
}

export async function listUserSessions(userId: string): Promise<AuthSessionRecord[]> {
  const nowMs = Date.now();
  if (mongoConnected) {
    const docs = await AuthSessionModel.find({
      userId,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    })
      .sort({ lastActiveAt: -1 })
      .lean();
    return docs.map((d: any) => ({
      sessionId: d.sessionId,
      userId: String(d.userId),
      role: d.role,
      provider: d.provider === 'invite' || d.provider === 'demo' ? d.provider : 'supabase',
      tokenFingerprint: d.tokenFingerprint,
      csrfToken: d.csrfToken,
      tlsSecure: Boolean(d.tlsSecure),
      protocol: d.protocol || 'https',
      userAgent: d.userAgent || 'Browser Session',
      createdAt: new Date(d.createdAt || Date.now()).toISOString(),
      lastActiveAt: new Date(d.lastActiveAt).toISOString(),
      expiresAt: new Date(d.expiresAt).toISOString(),
      revokedAt: null,
    }));
  }
  return localState.sessions
    .filter((s) => s.userId === userId && !s.revokedAt && new Date(s.expiresAt).getTime() > nowMs)
    .sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime());
}

export async function revokeAuthSession(sessionId: string, userId?: string): Promise<boolean> {
  const now = new Date();
  if (mongoConnected) {
    const query: any = { sessionId };
    if (userId) query.userId = userId;
    const res = await AuthSessionModel.updateOne(query, { $set: { revokedAt: now } });
    return res.modifiedCount > 0;
  }
  const found = localState.sessions.find((s) => s.sessionId === sessionId && (!userId || s.userId === userId));
  if (!found) return false;
  found.revokedAt = now.toISOString();
  saveLocalStore(localState);
  return true;
}

export async function revokeOtherUserSessions(userId: string, keepSessionId: string): Promise<number> {
  const now = new Date();
  if (mongoConnected) {
    const res = await AuthSessionModel.updateMany(
      { userId, sessionId: { $ne: keepSessionId }, revokedAt: null },
      { $set: { revokedAt: now } }
    );
    return res.modifiedCount || 0;
  }
  let count = 0;
  for (const s of localState.sessions) {
    if (s.userId === userId && s.sessionId !== keepSessionId && !s.revokedAt) {
      s.revokedAt = now.toISOString();
      count++;
    }
  }
  if (count > 0) saveLocalStore(localState);
  return count;
}

// --- Seasonal Sales Campaigns & Flash Sale Timers ---

function computeCampaignPhase(c: SalesCampaign): 'upcoming' | 'live' | 'ended' {
  const now = Date.now();
  const start = new Date(c.startsAt).getTime();
  const end = new Date(c.endsAt).getTime();
  if (now < start) return 'upcoming';
  if (now <= end) return 'live';
  return 'ended';
}

export async function listStorefrontCampaigns(): Promise<StorefrontCampaign[]> {
  let raw: SalesCampaign[] = [];
  if (mongoConnected) {
    const docs = await SalesCampaignModel.find({ isActive: true }).sort({ startsAt: 1 }).lean();
    raw = docs.map((d: any) => ({
      ...d,
      _id: String(d._id),
      sellerId: String(d.sellerId),
      productIds: (d.productIds || []).map((id: any) => String(id)),
      startsAt: new Date(d.startsAt).toISOString(),
      endsAt: new Date(d.endsAt).toISOString(),
      createdAt: new Date(d.createdAt).toISOString(),
      updatedAt: new Date(d.updatedAt).toISOString(),
    }));
  } else {
    raw = localState.salesCampaigns.filter((c) => c.isActive);
  }

  const allProducts = await getAllProductsRaw();
  const productMap = new Map(allProducts.map((p) => [p._id, p]));

  const enriched: StorefrontCampaign[] = [];
  for (const c of raw) {
    const phase = computeCampaignPhase(c);
    if (phase === 'ended') continue;
    const products = c.productIds
      .map((id) => productMap.get(id))
      .filter((p): p is Product => Boolean(p && isProductPubliclyVisible(p)));
    enriched.push({
      ...c,
      phase,
      products,
    });
  }

  enriched.sort((a, b) => {
    if (a.phase !== b.phase) return a.phase === 'upcoming' ? -1 : 1;
    if (a.phase === 'upcoming') {
      return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
    }
    return new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime();
  });

  return enriched;
}

export async function listSellerCampaigns(sellerId: string, role: string): Promise<StorefrontCampaign[]> {
  let raw: SalesCampaign[] = [];
  if (mongoConnected) {
    const query = role === 'ADMIN' ? {} : { sellerId };
    const docs = await SalesCampaignModel.find(query).sort({ createdAt: -1 }).lean();
    raw = docs.map((d: any) => ({
      ...d,
      _id: String(d._id),
      sellerId: String(d.sellerId),
      productIds: (d.productIds || []).map((id: any) => String(id)),
      startsAt: new Date(d.startsAt).toISOString(),
      endsAt: new Date(d.endsAt).toISOString(),
      createdAt: new Date(d.createdAt).toISOString(),
      updatedAt: new Date(d.updatedAt).toISOString(),
    }));
  } else {
    raw = localState.salesCampaigns
      .filter((c) => (role === 'ADMIN' ? true : c.sellerId === sellerId))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  const allProducts = await getAllProductsRaw({ includeControlled: true });
  const productMap = new Map(allProducts.map((p) => [p._id, p]));

  return raw.map((c) => ({
    ...c,
    phase: computeCampaignPhase(c),
    products: c.productIds.map((id) => productMap.get(id)).filter((p): p is Product => Boolean(p)),
  }));
}

export async function createSalesCampaign(input: {
  sellerId: string;
  sellerName: string;
  name: string;
  season: SeasonType;
  tagline: string;
  discountPercent: number;
  productIds: string[];
  startsAt: string;
  endsAt: string;
  isActive?: boolean;
}): Promise<SalesCampaign> {
  const nowIso = new Date().toISOString();
  const campaign: SalesCampaign = {
    _id: `cmp_${crypto.randomBytes(5).toString('hex')}`,
    sellerId: input.sellerId,
    sellerName: input.sellerName,
    name: input.name.trim(),
    season: input.season,
    tagline: input.tagline.trim(),
    discountPercent: Math.max(0, Math.min(90, input.discountPercent || 0)),
    productIds: Array.from(new Set(input.productIds)),
    startsAt: new Date(input.startsAt).toISOString(),
    endsAt: new Date(input.endsAt).toISOString(),
    isActive: input.isActive !== false,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  if (mongoConnected) {
    const doc = await SalesCampaignModel.create({
      sellerId: campaign.sellerId,
      sellerName: campaign.sellerName,
      name: campaign.name,
      season: campaign.season,
      tagline: campaign.tagline,
      discountPercent: campaign.discountPercent,
      productIds: campaign.productIds,
      startsAt: new Date(campaign.startsAt),
      endsAt: new Date(campaign.endsAt),
      isActive: campaign.isActive,
    });
    for (const pid of campaign.productIds) {
      if (mongoose.isValidObjectId(pid)) {
        await ProductModel.updateOne({ _id: pid }, { $addToSet: { seasons: campaign.season } });
      }
    }
    return { ...campaign, _id: String(doc._id) };
  }

  for (const pid of campaign.productIds) {
    const prod = localState.products.find((p) => p._id === pid);
    if (prod) {
      const set = new Set<SeasonType>(prod.seasons || []);
      set.add(campaign.season);
      prod.seasons = Array.from(set);
    }
  }
  localState.salesCampaigns.unshift(campaign);
  saveLocalStore(localState);
  return campaign;
}

export async function updateSalesCampaign(
  campaignId: string,
  actorId: string,
  role: string,
  updates: Partial<Pick<SalesCampaign, 'name' | 'season' | 'tagline' | 'discountPercent' | 'productIds' | 'startsAt' | 'endsAt' | 'isActive'>>
): Promise<SalesCampaign | null> {
  if (mongoConnected && mongoose.isValidObjectId(campaignId)) {
    const existing = await SalesCampaignModel.findById(campaignId);
    if (!existing) return null;
    if (role !== 'ADMIN' && String(existing.sellerId) !== actorId) return null;
    if (updates.name !== undefined) existing.name = updates.name.trim();
    if (updates.season !== undefined) existing.season = updates.season;
    if (updates.tagline !== undefined) existing.tagline = updates.tagline.trim();
    if (typeof updates.discountPercent === 'number') existing.discountPercent = updates.discountPercent;
    if (updates.productIds !== undefined) existing.productIds = Array.from(new Set(updates.productIds));
    if (updates.startsAt !== undefined) existing.startsAt = new Date(updates.startsAt);
    if (updates.endsAt !== undefined) existing.endsAt = new Date(updates.endsAt);
    if (typeof updates.isActive === 'boolean') existing.isActive = updates.isActive;
    await existing.save();
    const obj = existing.toObject();
    return {
      ...obj,
      _id: String(obj._id),
      sellerId: String(obj.sellerId),
      startsAt: new Date(obj.startsAt).toISOString(),
      endsAt: new Date(obj.endsAt).toISOString(),
      createdAt: new Date(obj.createdAt).toISOString(),
      updatedAt: new Date(obj.updatedAt).toISOString(),
    };
  }

  const found = localState.salesCampaigns.find((c) => c._id === campaignId);
  if (!found) return null;
  if (role !== 'ADMIN' && found.sellerId !== actorId) return null;
  if (updates.name !== undefined) found.name = updates.name.trim();
  if (updates.season !== undefined) found.season = updates.season;
  if (updates.tagline !== undefined) found.tagline = updates.tagline.trim();
  if (typeof updates.discountPercent === 'number') found.discountPercent = updates.discountPercent;
  if (updates.productIds !== undefined) {
    found.productIds = Array.from(new Set(updates.productIds));
    for (const pid of found.productIds) {
      const prod = localState.products.find((p) => p._id === pid);
      if (prod) {
        const set = new Set<SeasonType>(prod.seasons || []);
        set.add(found.season);
        prod.seasons = Array.from(set);
      }
    }
  }
  if (updates.startsAt !== undefined) found.startsAt = new Date(updates.startsAt).toISOString();
  if (updates.endsAt !== undefined) found.endsAt = new Date(updates.endsAt).toISOString();
  if (typeof updates.isActive === 'boolean') found.isActive = updates.isActive;
  found.updatedAt = new Date().toISOString();
  saveLocalStore(localState);
  return found;
}

export async function deleteSalesCampaign(campaignId: string, actorId: string, role: string): Promise<boolean> {
  if (mongoConnected && mongoose.isValidObjectId(campaignId)) {
    const existing = await SalesCampaignModel.findById(campaignId);
    if (!existing) return false;
    if (role !== 'ADMIN' && String(existing.sellerId) !== actorId) return false;
    await SalesCampaignModel.deleteOne({ _id: campaignId });
    return true;
  }
  const idx = localState.salesCampaigns.findIndex((c) => c._id === campaignId);
  if (idx === -1) return false;
  if (role !== 'ADMIN' && localState.salesCampaigns[idx].sellerId !== actorId) return false;
  localState.salesCampaigns.splice(idx, 1);
  saveLocalStore(localState);
  return true;
}

// --- Seller Coupons (Checkout + Direct Product Level + User Assignment) ---

async function getAllCouponsRaw(): Promise<Coupon[]> {
  if (mongoConnected) {
    const docs = await CouponModel.find().sort({ createdAt: -1 }).lean();
    return docs.map((d: any) => ({
      ...d,
      _id: String(d._id),
      sellerId: String(d.sellerId),
      productIds: (d.productIds || []).map((id: any) => String(id)),
      assignedUserIds: (d.assignedUserIds || []).map((id: any) => String(id)),
      assignedEmails: (d.assignedEmails || []).map((e: any) => String(e).toLowerCase()),
      expiresAt: new Date(d.expiresAt).toISOString(),
      createdAt: new Date(d.createdAt).toISOString(),
      updatedAt: new Date(d.updatedAt).toISOString(),
    }));
  }
  return localState.coupons;
}

function isCouponAssignedToUser(coupon: Coupon, user?: User | null): boolean {
  const hasUserFilter =
    (coupon.assignedUserIds && coupon.assignedUserIds.length > 0) ||
    (coupon.assignedEmails && coupon.assignedEmails.length > 0);
  if (!hasUserFilter) return true;
  if (!user) return false;
  if (coupon.assignedUserIds.includes(user._id)) return true;
  if (coupon.assignedEmails.some((e) => e.toLowerCase() === user.email.toLowerCase())) return true;
  return false;
}

export function isCouponEligibleForProduct(coupon: Coupon, productId: string, productSellerId: string): boolean {
  if (coupon.scope === 'selected_products') {
    return coupon.productIds.includes(productId);
  }
  return coupon.sellerId === productSellerId || coupon.sellerId === 'usr_admin_1';
}

export async function listSellerCoupons(sellerId: string, role: string): Promise<Coupon[]> {
  const all = await getAllCouponsRaw();
  return all
    .filter((c) => (role === 'ADMIN' ? true : c.sellerId === sellerId))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function listKnownCustomers(): Promise<Array<{ _id: string; name: string; email: string }>> {
  if (mongoConnected) {
    const docs = await UserModel.find({}, { name: 1, email: 1, role: 1 }).lean();
    return docs
      .filter((u: any) => u.role === 'BUYER' || u.role === 'SELLER')
      .map((u: any) => ({ _id: String(u._id), name: u.name, email: u.email }));
  }
  return localState.users
    .filter((u) => u.role !== 'ADMIN')
    .map((u) => ({ _id: u._id, name: u.name, email: u.email }));
}

export async function listApplicableCoupons(input: {
  user?: User | null;
  productId?: string;
}): Promise<Coupon[]> {
  const now = Date.now();
  const all = await getAllCouponsRaw();
  let targetProduct: Product | null = null;
  if (input.productId) {
    targetProduct = await getProductByIdOrSlug(input.productId);
  }

  return all.filter((c) => {
    if (!c.isActive) return false;
    if (new Date(c.expiresAt).getTime() <= now) return false;
    if (c.usageLimit && c.usedCount >= c.usageLimit) return false;
    if (!isCouponAssignedToUser(c, input.user)) return false;
    if (targetProduct && !isCouponEligibleForProduct(c, targetProduct._id, targetProduct.sellerId)) {
      return false;
    }
    if (input.productId && !targetProduct) return false;
    return true;
  });
}

export async function createSellerCoupon(input: {
  sellerId: string;
  sellerName: string;
  code: string;
  title: string;
  discountType: CouponDiscountType;
  discountValue: number;
  minOrderAmount: number;
  maxDiscountAmount?: number;
  scope: CouponScope;
  productIds: string[];
  assignedEmails: string[];
  assignedUserIds: string[];
  usageLimit?: number;
  expiresAt: string;
}): Promise<Coupon> {
  const code = input.code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!code || code.length < 3) {
    throw new Error('Coupon code must be at least 3 alphanumeric characters.');
  }
  const existingAll = await getAllCouponsRaw();
  if (existingAll.some((c) => c.code.toUpperCase() === code)) {
    throw new Error(`Coupon code ${code} already exists.`);
  }

  const nowIso = new Date().toISOString();
  const coupon: Coupon = {
    _id: `cpn_${crypto.randomBytes(5).toString('hex')}`,
    code,
    sellerId: input.sellerId,
    sellerName: input.sellerName,
    title: input.title.trim() || `${code} Privilege`,
    discountType: input.discountType,
    discountValue:
      input.discountType === 'percentage'
        ? Math.max(1, Math.min(85, input.discountValue))
        : Math.max(10, input.discountValue),
    minOrderAmount: Math.max(0, input.minOrderAmount || 0),
    ...(input.maxDiscountAmount && input.maxDiscountAmount > 0
      ? { maxDiscountAmount: input.maxDiscountAmount }
      : {}),
    scope: input.scope,
    productIds: input.scope === 'selected_products' ? Array.from(new Set(input.productIds)) : [],
    assignedUserIds: Array.from(new Set(input.assignedUserIds)),
    assignedEmails: Array.from(
      new Set(input.assignedEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))
    ),
    usageLimit: Math.max(1, input.usageLimit || 100),
    usedCount: 0,
    expiresAt: new Date(input.expiresAt).toISOString(),
    isActive: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  if (mongoConnected) {
    const doc = await CouponModel.create({
      code: coupon.code,
      sellerId: coupon.sellerId,
      sellerName: coupon.sellerName,
      title: coupon.title,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      maxDiscountAmount: coupon.maxDiscountAmount,
      minOrderAmount: coupon.minOrderAmount,
      scope: coupon.scope,
      productIds: coupon.productIds,
      assignedUserIds: coupon.assignedUserIds,
      assignedEmails: coupon.assignedEmails,
      usageLimit: coupon.usageLimit,
      usedCount: 0,
      expiresAt: new Date(coupon.expiresAt),
      isActive: true,
    });
    return { ...coupon, _id: String(doc._id) };
  }

  localState.coupons.unshift(coupon);
  saveLocalStore(localState);
  return coupon;
}

export async function updateSellerCoupon(
  couponId: string,
  actorId: string,
  role: string,
  updates: Partial<
    Pick<
      Coupon,
      | 'isActive'
      | 'title'
      | 'discountValue'
      | 'minOrderAmount'
      | 'scope'
      | 'productIds'
      | 'assignedEmails'
      | 'assignedUserIds'
      | 'expiresAt'
    >
  >
): Promise<Coupon | null> {
  if (mongoConnected && mongoose.isValidObjectId(couponId)) {
    const doc = await CouponModel.findById(couponId);
    if (!doc) return null;
    if (role !== 'ADMIN' && String(doc.sellerId) !== actorId) return null;
    if (typeof updates.isActive === 'boolean') doc.isActive = updates.isActive;
    if (updates.title !== undefined) doc.title = updates.title.trim();
    if (typeof updates.discountValue === 'number') doc.discountValue = updates.discountValue;
    if (typeof updates.minOrderAmount === 'number') doc.minOrderAmount = updates.minOrderAmount;
    if (updates.scope !== undefined) doc.scope = updates.scope;
    if (updates.productIds !== undefined) doc.productIds = Array.from(new Set(updates.productIds));
    if (updates.assignedEmails !== undefined) {
      doc.assignedEmails = Array.from(
        new Set(updates.assignedEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))
      );
    }
    if (updates.assignedUserIds !== undefined) {
      doc.assignedUserIds = Array.from(new Set(updates.assignedUserIds));
    }
    if (updates.expiresAt !== undefined) doc.expiresAt = new Date(updates.expiresAt);
    await doc.save();
    const obj = doc.toObject();
    return {
      ...obj,
      _id: String(obj._id),
      sellerId: String(obj.sellerId),
      expiresAt: new Date(obj.expiresAt).toISOString(),
      createdAt: new Date(obj.createdAt).toISOString(),
      updatedAt: new Date(obj.updatedAt).toISOString(),
    };
  }

  const found = localState.coupons.find((c) => c._id === couponId);
  if (!found) return null;
  if (role !== 'ADMIN' && found.sellerId !== actorId) return null;
  if (typeof updates.isActive === 'boolean') found.isActive = updates.isActive;
  if (updates.title !== undefined) found.title = updates.title.trim();
  if (typeof updates.discountValue === 'number') found.discountValue = updates.discountValue;
  if (typeof updates.minOrderAmount === 'number') found.minOrderAmount = updates.minOrderAmount;
  if (updates.scope !== undefined) found.scope = updates.scope;
  if (updates.productIds !== undefined) found.productIds = Array.from(new Set(updates.productIds));
  if (updates.assignedEmails !== undefined) {
    found.assignedEmails = Array.from(
      new Set(updates.assignedEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))
    );
  }
  if (updates.assignedUserIds !== undefined) {
    found.assignedUserIds = Array.from(new Set(updates.assignedUserIds));
  }
  if (updates.expiresAt !== undefined) found.expiresAt = new Date(updates.expiresAt).toISOString();
  found.updatedAt = new Date().toISOString();
  saveLocalStore(localState);
  return found;
}

export async function deleteSellerCoupon(couponId: string, actorId: string, role: string): Promise<boolean> {
  if (mongoConnected && mongoose.isValidObjectId(couponId)) {
    const doc = await CouponModel.findById(couponId);
    if (!doc) return false;
    if (role !== 'ADMIN' && String(doc.sellerId) !== actorId) return false;
    await CouponModel.deleteOne({ _id: couponId });
    return true;
  }
  const idx = localState.coupons.findIndex((c) => c._id === couponId);
  if (idx === -1) return false;
  if (role !== 'ADMIN' && localState.coupons[idx].sellerId !== actorId) return false;
  localState.coupons.splice(idx, 1);
  saveLocalStore(localState);
  return true;
}

export async function incrementCouponUsage(couponId: string): Promise<void> {
  if (mongoConnected && mongoose.isValidObjectId(couponId)) {
    await CouponModel.updateOne({ _id: couponId }, { $inc: { usedCount: 1 } });
    return;
  }
  const found = localState.coupons.find((c) => c._id === couponId);
  if (found) {
    found.usedCount += 1;
    saveLocalStore(localState);
  }
}

export async function validateCouponForCart(input: {
  code: string;
  user?: User | null;
  items: CartItem[];
}): Promise<CouponValidationResult> {
  const cleanCode = input.code.trim().toUpperCase();
  if (!cleanCode) {
    return {
      valid: false,
      reason: 'Please enter a coupon code.',
      discountAmount: 0,
      eligibleSubtotal: 0,
      applicableProductIds: [],
    };
  }

  const all = await getAllCouponsRaw();
  const coupon = all.find((c) => c.code.toUpperCase() === cleanCode);
  if (!coupon) {
    return {
      valid: false,
      reason: `Coupon "${cleanCode}" was not found.`,
      discountAmount: 0,
      eligibleSubtotal: 0,
      applicableProductIds: [],
    };
  }
  if (!coupon.isActive) {
    return {
      valid: false,
      reason: 'This coupon is currently paused by the seller.',
      discountAmount: 0,
      eligibleSubtotal: 0,
      applicableProductIds: [],
    };
  }
  if (new Date(coupon.expiresAt).getTime() <= Date.now()) {
    return {
      valid: false,
      reason: 'This coupon has expired.',
      discountAmount: 0,
      eligibleSubtotal: 0,
      applicableProductIds: [],
    };
  }
  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
    return {
      valid: false,
      reason: 'This coupon has reached its redemption limit.',
      discountAmount: 0,
      eligibleSubtotal: 0,
      applicableProductIds: [],
    };
  }
  if (!isCouponAssignedToUser(coupon, input.user)) {
    return {
      valid: false,
      reason:
        'This exclusive coupon is assigned to specific registered customer accounts. Sign in with the invited account to use it.',
      discountAmount: 0,
      eligibleSubtotal: 0,
      applicableProductIds: [],
    };
  }

  const eligibleItems = input.items.filter((item) =>
    isCouponEligibleForProduct(coupon, item.productId, item.sellerId)
  );
  if (eligibleItems.length === 0) {
    return {
      valid: false,
      reason: 'None of the items currently in your bag are included in this coupon.',
      discountAmount: 0,
      eligibleSubtotal: 0,
      applicableProductIds: [],
    };
  }

  const eligibleSubtotal = eligibleItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  if (eligibleSubtotal < coupon.minOrderAmount) {
    return {
      valid: false,
      reason: `Add ₹${(coupon.minOrderAmount - eligibleSubtotal).toLocaleString('en-IN')} more of eligible pieces to unlock ${coupon.code}.`,
      discountAmount: 0,
      eligibleSubtotal,
      applicableProductIds: eligibleItems.map((i) => i.productId),
    };
  }

  let discountAmount =
    coupon.discountType === 'percentage'
      ? Math.round((eligibleSubtotal * coupon.discountValue) / 100)
      : coupon.discountValue;

  if (coupon.maxDiscountAmount && coupon.maxDiscountAmount > 0) {
    discountAmount = Math.min(discountAmount, coupon.maxDiscountAmount);
  }
  discountAmount = Math.min(eligibleSubtotal - 1, Math.max(1, discountAmount));

  return {
    valid: true,
    coupon,
    discountAmount,
    eligibleSubtotal,
    applicableProductIds: Array.from(new Set(eligibleItems.map((i) => i.productId))),
  };
}

// --- Seller Category Control Panel (Add, Enable / Disable, Delete Custom Categories) ---

async function getAllCategoriesRaw(): Promise<CategoryControl[]> {
  if (mongoConnected) {
    const docs = await CategoryControlModel.find().sort({ sortOrder: 1, createdAt: 1 }).lean();
    return docs.map((d: any) => ({
      ...d,
      _id: String(d._id),
      sellerId: String(d.sellerId),
      createdAt: new Date(d.createdAt).toISOString(),
      updatedAt: new Date(d.updatedAt).toISOString(),
    }));
  }
  return localState.categories;
}

export async function listCategories(includeDisabled = false): Promise<CategoryControl[]> {
  const [cats, allProducts] = await Promise.all([getAllCategoriesRaw(), getAllProductsRaw()]);
  const countByCat = new Map<string, number>();
  for (const p of allProducts) {
    if (!isProductPubliclyVisible(p)) continue;
    const key = p.category.toLowerCase();
    countByCat.set(key, (countByCat.get(key) || 0) + 1);
  }

  return cats
    .filter((c) => (includeDisabled ? true : c.isEnabled))
    .map((c) => ({
      ...c,
      productCount: countByCat.get(c.name.toLowerCase()) || 0,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export async function createCategoryControl(input: {
  sellerId: string;
  sellerName: string;
  name: string;
  description?: string;
}): Promise<CategoryControl> {
  const cleanName = input.name.trim().replace(/\s+/g, ' ');
  if (cleanName.length < 2) {
    throw new Error('Category name must be at least 2 characters.');
  }
  const existingAll = await getAllCategoriesRaw();
  if (existingAll.some((c) => c.name.toLowerCase() === cleanName.toLowerCase())) {
    throw new Error(`Category "${cleanName}" already exists.`);
  }

  const slug = cleanName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const nowIso = new Date().toISOString();
  const nextSort =
    existingAll.reduce((max, c) => Math.max(max, c.sortOrder || 0), 0) + 1;

  const created: CategoryControl = {
    _id: `cat_${crypto.randomBytes(4).toString('hex')}`,
    name: cleanName,
    slug: slug || `cat-${crypto.randomBytes(2).toString('hex')}`,
    description: (input.description || '').trim(),
    sellerId: input.sellerId,
    sellerName: input.sellerName,
    isEnabled: true,
    isDefault: false,
    sortOrder: nextSort,
    productCount: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  if (mongoConnected) {
    const doc = await CategoryControlModel.create({
      name: created.name,
      slug: created.slug,
      description: created.description,
      sellerId: created.sellerId,
      sellerName: created.sellerName,
      isEnabled: true,
      isDefault: false,
      sortOrder: created.sortOrder,
    });
    return { ...created, _id: String(doc._id) };
  }

  localState.categories.push(created);
  saveLocalStore(localState);
  return created;
}

export async function updateCategoryControl(
  categoryId: string,
  updates: {
    isEnabled?: boolean;
    name?: string;
    description?: string;
  }
): Promise<CategoryControl | null> {
  const cleanNewName = updates.name?.trim().replace(/\s+/g, ' ');

  if (mongoConnected && mongoose.isValidObjectId(categoryId)) {
    const doc = await CategoryControlModel.findById(categoryId);
    if (!doc) return null;
    const previousName = doc.name;
    if (typeof updates.isEnabled === 'boolean') doc.isEnabled = updates.isEnabled;
    if (cleanNewName && cleanNewName.length >= 2 && cleanNewName.toLowerCase() !== previousName.toLowerCase()) {
      const dupe = await CategoryControlModel.findOne({ name: new RegExp(`^${cleanNewName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
      if (dupe) throw new Error(`Category "${cleanNewName}" already exists.`);
      doc.name = cleanNewName;
      doc.slug = cleanNewName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      await ProductModel.updateMany({ category: previousName }, { $set: { category: cleanNewName } });
    }
    if (updates.description !== undefined) doc.description = updates.description.trim();
    await doc.save();
    const obj = doc.toObject();
    return {
      ...obj,
      _id: String(obj._id),
      sellerId: String(obj.sellerId),
      createdAt: new Date(obj.createdAt).toISOString(),
      updatedAt: new Date(obj.updatedAt).toISOString(),
    };
  }

  const found = localState.categories.find((c) => c._id === categoryId);
  if (!found) return null;
  const previousName = found.name;
  if (typeof updates.isEnabled === 'boolean') found.isEnabled = updates.isEnabled;
  if (cleanNewName && cleanNewName.length >= 2 && cleanNewName.toLowerCase() !== previousName.toLowerCase()) {
    if (localState.categories.some((c) => c._id !== categoryId && c.name.toLowerCase() === cleanNewName.toLowerCase())) {
      throw new Error(`Category "${cleanNewName}" already exists.`);
    }
    found.name = cleanNewName;
    found.slug = cleanNewName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    for (const p of localState.products) {
      if (p.category.toLowerCase() === previousName.toLowerCase()) {
        p.category = cleanNewName;
      }
    }
  }
  if (updates.description !== undefined) found.description = updates.description.trim();
  found.updatedAt = new Date().toISOString();
  saveLocalStore(localState);

  const count = localState.products.filter(
    (p) => isProductPubliclyVisible(p) && p.category.toLowerCase() === found.name.toLowerCase()
  ).length;
  return { ...found, productCount: count };
}

export async function sanitizeCartItems(items: CartItem[]): Promise<CartItem[]> {
  if (!items || items.length === 0) return [];
  const all = await getAllProductsRaw({ includeControlled: true });
  const byId = new Map(all.map((p) => [p._id, p]));
  return items.filter((item) => {
    const prod = byId.get(item.productId);
    return Boolean(prod && isProductPubliclyVisible(prod) && prod.totalStock > 0);
  });
}

export async function deleteCategoryControl(categoryId: string): Promise<{ ok: boolean; error?: string }> {
  const all = await listCategories(true);
  const target = all.find((c) => c._id === categoryId);
  if (!target) return { ok: false, error: 'Category not found.' };
  if (target.isDefault) {
    return {
      ok: false,
      error: 'Core categories cannot be permanently deleted; use Disable to hide them from shoppers.',
    };
  }
  if ((target.productCount || 0) > 0) {
    return {
      ok: false,
      error: `Category "${target.name}" has ${target.productCount} listed product(s). Disable it instead of deleting.`,
    };
  }

  if (mongoConnected && mongoose.isValidObjectId(categoryId)) {
    await CategoryControlModel.deleteOne({ _id: categoryId });
    return { ok: true };
  }

  localState.categories = localState.categories.filter((c) => c._id !== categoryId);
  saveLocalStore(localState);
  return { ok: true };
}




