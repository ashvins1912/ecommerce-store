import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRobotsTxt, generateSitemapXml } from './sitemap.js';

test('generateSitemapXml builds valid XML with enabled categories, active campaigns, and public products', () => {
  const now = new Date('2026-11-16T10:00:00.000Z');
  const xml = generateSitemapXml({
    baseUrl: 'https://kalakarat.example.com/',
    now,
    categories: [
      {
        name: 'Artificial Jewellery',
        slug: 'artificial-jewellery',
        isEnabled: true,
        updatedAt: '2026-11-15T12:00:00.000Z',
      },
      {
        name: 'Clothing',
        slug: 'clothing',
        isEnabled: true,
        updatedAt: '2026-11-14T12:00:00.000Z',
      },
      {
        name: 'Hidden Archive',
        slug: 'hidden-archive',
        isEnabled: false,
        updatedAt: '2026-11-14T12:00:00.000Z',
      },
    ],
    campaigns: [
      {
        name: 'Diwali Heritage Edit',
        season: 'Diwali',
        phase: 'live',
        isActive: true,
        startsAt: '2026-11-01T00:00:00.000Z',
        endsAt: '2026-11-30T23:59:59.000Z',
        updatedAt: '2026-11-16T08:00:00.000Z',
        products: [
          {
            _id: 'prd_1',
            slug: 'emerald-kundan-choker',
            category: 'Artificial Jewellery',
            updatedAt: '2026-11-16T09:00:00.000Z',
            isActive: true,
            isPublished: true,
            visibility: 'PUBLIC',
          },
        ],
      },
      {
        name: 'Ended Summer Sale',
        season: 'Summer',
        phase: 'ended',
        isActive: true,
        startsAt: '2026-05-01T00:00:00.000Z',
        endsAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
        products: [],
      },
    ],
    products: [
      {
        _id: 'prd_1',
        slug: 'emerald-kundan-choker',
        category: 'Artificial Jewellery',
        updatedAt: '2026-11-10T09:00:00.000Z',
        isActive: true,
        isPublished: true,
        visibility: 'PUBLIC',
      },
      {
        _id: 'prd_private',
        slug: 'vip-only-set',
        category: 'Artificial Jewellery',
        updatedAt: '2026-11-16T09:00:00.000Z',
        isActive: true,
        isPublished: true,
        visibility: 'ASSIGNED',
      },
      {
        _id: 'prd_disabled_cat',
        slug: 'archived-item',
        category: 'Hidden Archive',
        updatedAt: '2026-11-16T09:00:00.000Z',
        isActive: true,
        isPublished: true,
        visibility: 'PUBLIC',
      },
    ],
  });

  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(xml, /<loc>https:\/\/kalakarat\.example\.com\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/kalakarat\.example\.com\/\?category=Artificial%20Jewellery<\/loc>/);
  assert.match(xml, /<loc>https:\/\/kalakarat\.example\.com\/\?category=Clothing<\/loc>/);
  assert.doesNotMatch(xml, /Hidden%20Archive/);
  assert.match(xml, /<loc>https:\/\/kalakarat\.example\.com\/\?season=Diwali<\/loc>/);
  assert.doesNotMatch(xml, /\?season=Summer/);
  assert.match(xml, /<loc>https:\/\/kalakarat\.example\.com\/\?product=emerald-kundan-choker<\/loc>/);
  assert.doesNotMatch(xml, /vip-only-set/);
  assert.doesNotMatch(xml, /archived-item/);

  // Deduplicates shared campaign + catalog product and retains higher live priority (0.8) & newer lastmod
  const matches = xml.match(/emerald-kundan-choker/g) ?? [];
  assert.equal(matches.length, 1);
  assert.match(xml, /emerald-kundan-choker<\/loc>\s*<lastmod>2026-11-16T09:00:00\.000Z<\/lastmod>\s*<changefreq>daily<\/changefreq>\s*<priority>0\.8<\/priority>/);
});

test('generateSitemapXml escapes XML special characters safely', () => {
  const xml = generateSitemapXml({
    baseUrl: 'https://shop.example.com',
    categories: [
      {
        name: 'Silk & Organza',
        slug: 'silk-organza',
        isEnabled: true,
        updatedAt: '2026-11-16T00:00:00.000Z',
      },
    ],
    campaigns: [],
  });

  assert.match(xml, /\?category=Silk%20%26%20Organza<\/loc>/);
  assert.doesNotMatch(xml, /&(?!amp;|lt;|gt;|quot;|apos;)/);
});

test('generateRobotsTxt advertises the sitemap URL cleanly', () => {
  const robots = generateRobotsTxt('https://kalakarat.example.com/');
  assert.match(robots, /Sitemap: https:\/\/kalakarat\.example\.com\/sitemap\.xml/);
  assert.match(robots, /Disallow: \/api\//);
});
