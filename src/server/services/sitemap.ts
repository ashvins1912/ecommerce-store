import type { CategoryControl, Product, StorefrontCampaign } from '../../shared/types.js';
import {
  listCategories,
  listPublicProductsForSitemap,
  listStorefrontCampaigns,
} from './store.js';

export type SitemapChangeFreq =
  | 'always'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'never';

export interface SitemapStaticPath {
  path: string;
  lastmod?: string | Date;
  changefreq?: SitemapChangeFreq;
  priority?: number;
}

export type SitemapCategoryInput = Pick<
  CategoryControl,
  'name' | 'slug' | 'isEnabled' | 'updatedAt'
>;

export type SitemapProductInput = Pick<
  Product,
  '_id' | 'slug' | 'category' | 'updatedAt' | 'isActive' | 'isDeleted' | 'isPublished' | 'isUnlisted' | 'visibility'
>;

export type SitemapCampaignInput = Pick<
  StorefrontCampaign,
  'name' | 'season' | 'phase' | 'isActive' | 'startsAt' | 'endsAt' | 'updatedAt'
> & {
  products?: Array<SitemapProductInput>;
};

export interface GenerateSitemapXmlOptions {
  baseUrl: string;
  categories?: SitemapCategoryInput[];
  campaigns?: SitemapCampaignInput[];
  products?: SitemapProductInput[];
  staticPaths?: SitemapStaticPath[];
  now?: Date;
}

interface NormalizedSitemapEntry {
  loc: string;
  lastmod: string;
  changefreq: SitemapChangeFreq;
  priority: number;
}

const MAX_SITEMAP_URLS = 50000;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeBaseUrl(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return 'http://localhost:3000';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function toIsoTimestamp(value: string | Date | undefined, fallback: Date): string {
  if (!value) return fallback.toISOString();
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback.toISOString() : parsed.toISOString();
}

function clampPriority(priority: number): string {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(priority) ? priority : 0.5));
  return clamped.toFixed(1);
}

function isProductIndexable(
  product: SitemapProductInput,
  disabledCategories: Set<string>
): boolean {
  if (product.isDeleted || !product.isActive) return false;
  if (product.isPublished === false || product.isUnlisted) return false;
  if (product.visibility === 'ASSIGNED') return false;
  if (disabledCategories.has((product.category || '').toLowerCase())) return false;
  return Boolean(product.slug || product._id);
}

function isCampaignActive(campaign: SitemapCampaignInput, nowMs: number): boolean {
  if (campaign.isActive === false) return false;
  if (campaign.phase === 'ended') return false;
  if (!campaign.phase && campaign.endsAt) {
    const endMs = new Date(campaign.endsAt).getTime();
    if (!Number.isNaN(endMs) && endMs < nowMs) return false;
  }
  return true;
}

function upsertEntry(map: Map<string, NormalizedSitemapEntry>, next: NormalizedSitemapEntry): void {
  const existing = map.get(next.loc);
  if (!existing) {
    map.set(next.loc, next);
    return;
  }
  const latestLastmod =
    new Date(next.lastmod).getTime() > new Date(existing.lastmod).getTime()
      ? next.lastmod
      : existing.lastmod;
  map.set(next.loc, {
    loc: next.loc,
    lastmod: latestLastmod,
    changefreq: next.priority >= existing.priority ? next.changefreq : existing.changefreq,
    priority: Math.max(existing.priority, next.priority),
  });
}

/**
 * Generates a W3C Sitemaps 0.9 XML document from enabled product categories,
 * active seasonal campaigns, and indexable products.
 */
export function generateSitemapXml(options: GenerateSitemapXmlOptions): string {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const categories = options.categories ?? [];
  const campaigns = options.campaigns ?? [];
  const products = options.products ?? [];

  const disabledCategories = new Set(
    categories
      .filter((c) => c.isEnabled === false)
      .map((c) => c.name.trim().toLowerCase())
  );

  const entries = new Map<string, NormalizedSitemapEntry>();

  const staticPaths: SitemapStaticPath[] =
    options.staticPaths && options.staticPaths.length > 0
      ? options.staticPaths
      : [{ path: '/', changefreq: 'daily', priority: 1.0, lastmod: now }];

  for (const item of staticPaths) {
    const normalizedPath = item.path.startsWith('/') ? item.path : `/${item.path}`;
    const loc = normalizedPath === '/' ? `${baseUrl}/` : `${baseUrl}${normalizedPath}`;
    upsertEntry(entries, {
      loc,
      lastmod: toIsoTimestamp(item.lastmod, now),
      changefreq: item.changefreq ?? 'daily',
      priority: item.priority ?? 1.0,
    });
  }

  for (const category of categories) {
    if (category.isEnabled === false) continue;
    const categoryName = (category.name || '').trim();
    if (!categoryName) continue;
    upsertEntry(entries, {
      loc: `${baseUrl}/?category=${encodeURIComponent(categoryName)}`,
      lastmod: toIsoTimestamp(category.updatedAt, now),
      changefreq: 'daily',
      priority: 0.8,
    });
  }

  for (const campaign of campaigns) {
    if (!isCampaignActive(campaign, nowMs)) continue;
    const season = (campaign.season || '').trim();
    const isLive = campaign.phase === 'live' || (!campaign.phase && new Date(campaign.startsAt).getTime() <= nowMs);
    if (season) {
      upsertEntry(entries, {
        loc: `${baseUrl}/?season=${encodeURIComponent(season)}`,
        lastmod: toIsoTimestamp(campaign.updatedAt || campaign.startsAt, now),
        changefreq: isLive ? 'hourly' : 'daily',
        priority: isLive ? 0.9 : 0.7,
      });
    }

    for (const prod of campaign.products || []) {
      if (!isProductIndexable(prod, disabledCategories)) continue;
      const key = prod.slug || prod._id;
      upsertEntry(entries, {
        loc: `${baseUrl}/?product=${encodeURIComponent(key)}`,
        lastmod: toIsoTimestamp(prod.updatedAt || campaign.updatedAt, now),
        changefreq: isLive ? 'daily' : 'weekly',
        priority: isLive ? 0.8 : 0.7,
      });
    }
  }

  for (const prod of products) {
    if (!isProductIndexable(prod, disabledCategories)) continue;
    const key = prod.slug || prod._id;
    upsertEntry(entries, {
      loc: `${baseUrl}/?product=${encodeURIComponent(key)}`,
      lastmod: toIsoTimestamp(prod.updatedAt, now),
      changefreq: 'weekly',
      priority: 0.7,
    });
  }

  const ordered = Array.from(entries.values()).slice(0, MAX_SITEMAP_URLS);
  const urlNodes = ordered
    .map(
      (entry) =>
        `  <url>\n` +
        `    <loc>${escapeXml(entry.loc)}</loc>\n` +
        `    <lastmod>${escapeXml(entry.lastmod)}</lastmod>\n` +
        `    <changefreq>${escapeXml(entry.changefreq)}</changefreq>\n` +
        `    <priority>${clampPriority(entry.priority)}</priority>\n` +
        `  </url>`
    )
    .join('\n');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${urlNodes}\n` +
    `</urlset>\n`
  );
}

export function generateRobotsTxt(baseUrl: string): string {
  const origin = normalizeBaseUrl(baseUrl);
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /provider',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
}

export async function buildDynamicStorefrontSitemap(baseUrl: string): Promise<string> {
  const [categories, campaigns, products] = await Promise.all([
    listCategories(false),
    listStorefrontCampaigns(),
    listPublicProductsForSitemap(),
  ]);

  return generateSitemapXml({
    baseUrl,
    categories,
    campaigns,
    products,
  });
}
