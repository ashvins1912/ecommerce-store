import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  GitCompare,
  X,
} from 'lucide-react';
import type {
  AuthSessionResponse,
  CartItem,
  CategoryControl,
  Coupon,
  OccasionType,
  PlatformServiceFlags,
  Product,
  ProductCategory,
  ProductListResponse,
  ProductVariant,
  SeasonType,
  SortOption,
  StorefrontCampaign,
  User,
} from '../../../src/shared/types';
import { apiFetch, clearClientSessionTokens, setClientSessionTokens } from '../../../src/lib/api';
import { useI18n } from '../../../src/lib/i18n';
import { TopBar, type ActivePage } from '../../../src/components/TopBar';
import { ProductCard } from '../../../src/components/ProductCard';
import { ProductCardSkeleton } from '../../../src/components/ProductCardSkeleton';
const ProductDetailModal = lazy(() => import('../../../src/components/ProductDetailModal').then((m) => ({ default: m.ProductDetailModal })));
const CartDrawer = lazy(() => import('../../../src/components/CartDrawer').then((m) => ({ default: m.CartDrawer })));
const AuthModal = lazy(() => import('../../../src/components/AuthModal').then((m) => ({ default: m.AuthModal })));
const RootInviteAcceptance = lazy(() => import('../../../src/components/RootInviteAcceptance').then((m) => ({ default: m.RootInviteAcceptance })));
const OrdersView = lazy(() => import('../../../src/components/OrdersView').then((m) => ({ default: m.OrdersView })));
const SellerHubView = lazy(() => import('../../../src/components/SellerHubView').then((m) => ({ default: m.SellerHubView })));
const WishlistView = lazy(() => import('../../../src/components/WishlistView').then((m) => ({ default: m.WishlistView })));
const AccountSignUpView = lazy(() => import('../../../src/components/CustomerSignUpView').then((m) => ({ default: m.AccountSignUpView })));
const JewelleryCompareModal = lazy(() => import('../../../src/components/JewelleryCompareModal').then((m) => ({ default: m.JewelleryCompareModal })));
const RecentlyViewedCarousel = lazy(() => import('../../../src/components/RecentlyViewedCarousel').then((m) => ({ default: m.RecentlyViewedCarousel })));
import { FlashSaleSection } from '../../../src/components/FlashSaleSection';
import { CatalogFilterBar } from '../../../src/components/CatalogFilterBar';
import { ActionButton } from '../../../src/components/ActionButton';
import { useI18nTutorial } from '../../../src/hooks/useI18nTutorial.js';
const ProviderPortal = lazy(() => import('../../provider-portal/src/ProviderPortal'));

function FeatureLoadingFallback() {
  return <div className="flex min-h-[160px] items-center justify-center text-sm text-[#6B6A65]" role="status">Loading…</div>;
}

const HERO_IMG = '/src/assets/images/hero_kala_karat_1794740129596.jpg';
const RECENT_STORAGE_KEY = 'kk_recently_viewed';

const OCCASIONS: Array<OccasionType | 'All'> = [
  'All',
  'Wedding',
  'Festive',
  'Party',
  'Office Wear',
  'Casual',
  'Daily Wear',
];

const SEASONS: Array<SeasonType | 'All'> = [
  'All',
  'Diwali',
  'Christmas',
  'New Year',
  'Winter',
  'Summer',
];

const QUICK_SEARCH_CHIPS = [
  'Kundan',
  'Diwali',
  'Under 2000',
  'Earring',
  'Linen',
  'Winter Velvet',
];

const SORT_OPTION_VALUES: SortOption[] = [
  'most_demanding',
  'newly_added',
  'special_offers',
  'fast_selling',
  'occasion_favorites',
  'price_asc',
  'price_desc',
  'highest_rated',
];

function findMatchingCouponForProduct(product: Product, coupons: Coupon[]): Coupon | null {
  for (const c of coupons) {
    if (c.scope === 'selected_products') {
      if (c.productIds.includes(product._id)) return c;
    } else if (c.sellerId === product.sellerId || c.sellerId === 'usr_admin_1') {
      return c;
    }
  }
  return null;
}

function readSessionRecentlyViewed(): Product[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
  } catch {
    return [];
  }
}

function resolveAbsoluteUrl(pathOrUrl: string, origin: string): string {
  if (!pathOrUrl) return `${origin}${HERO_IMG}`;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${origin}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

function upsertHeadMeta(
  attrName: 'name' | 'property',
  attrValue: string,
  content: string
): void {
  let el = document.head.querySelector(`meta[${attrName}="${attrValue}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attrName, attrValue);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function removeHeadMeta(attrName: 'name' | 'property', attrValue: string): void {
  const el = document.head.querySelector(`meta[${attrName}="${attrValue}"]`);
  if (el) el.remove();
}

function upsertCanonicalLink(href: string): void {
  let link = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    document.head.appendChild(link);
  }
  link.setAttribute('href', href);
}

function upsertJsonLdScript(payload: Record<string, unknown>): void {
  let script = document.head.querySelector('#kk-structured-data') as HTMLScriptElement | null;
  if (!script) {
    script = document.createElement('script');
    script.id = 'kk-structured-data';
    script.type = 'application/ld+json';
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(payload);
}

export default function App() {
  const { t, tc, tseason } = useI18n();
  const {
    startRoleTour,
    startCustomerTour,
    hasSeenCustomerTour,
    dismissCustomerTourPrompt,
  } = useI18nTutorial('CUSTOMER');
  const [activePage, setActivePage] = useState<ActivePage>('store');
  const [user, setUser] = useState<User | null>(null);
  const [authInitialMode, setAuthInitialMode] = useState<'signin' | 'signup'>('signin');
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [cart, setCart] = useState<CartItem[]>([]);
  const [sellerInviteToken, setSellerInviteToken] = useState<string | null>(null);

  // Storefront search, dynamic categories, seasonal campaigns & strict limit(20) pagination
  const [storeCategories, setStoreCategories] = useState<CategoryControl[]>([]);
  const [campaigns, setCampaigns] = useState<StorefrontCampaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [applicableCoupons, setApplicableCoupons] = useState<Coupon[]>([]);
  const [pendingCouponCode, setPendingCouponCode] = useState<string | null>(null);
  const [platformFlags, setPlatformFlags] = useState<PlatformServiceFlags | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [category, setCategory] = useState<ProductCategory | 'All'>('All');
  const [occasion, setOccasion] = useState<OccasionType | 'All'>('All');
  const [season, setSeason] = useState<SeasonType | 'All'>('All');
  const [sort, setSort] = useState<SortOption>('most_demanding');
  const [minPrice, setMinPrice] = useState<string>('');
  const [maxPrice, setMaxPrice] = useState<string>('');
  const [minDiscount, setMinDiscount] = useState<string>('');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [colorFilter, setColorFilter] = useState<string>('');
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [page, setPage] = useState(1);

  const [catalog, setCatalog] = useState<ProductListResponse>({
    products: [],
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 1,
    didYouMean: null,
    categoryTop10Thresholds: {},
  });
  const [catalogLoading, setCatalogLoading] = useState(true);

  // Recently Viewed (last 5 clicked products persisted in sessionStorage)
  const [recentlyViewed, setRecentlyViewed] = useState<Product[]>(readSessionRecentlyViewed);

  // Overlays & Modals
  const [selectedProductKey, setSelectedProductKey] = useState<string | null>(null);
  const [activeProductMeta, setActiveProductMeta] = useState<Product | null>(null);
  const [selectedInitialVariantSku, setSelectedInitialVariantSku] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  useEffect(() => { if (new URLSearchParams(window.location.search).has('rootInvite')) setAuthOpen(true); }, []);
  const [compareItems, setCompareItems] = useState<Product[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [hasOpenedProductDetail, setHasOpenedProductDetail] = useState(false);
  const [hasOpenedCart, setHasOpenedCart] = useState(false);
  const [hasOpenedAuth, setHasOpenedAuth] = useState(false);
  const [hasOpenedCompare, setHasOpenedCompare] = useState(false);
  useEffect(() => { if (selectedProductKey) setHasOpenedProductDetail(true); }, [selectedProductKey]);
  useEffect(() => { if (cartOpen) setHasOpenedCart(true); }, [cartOpen]);
  useEffect(() => { if (authOpen) setHasOpenedAuth(true); }, [authOpen]);
  useEffect(() => { if (compareOpen) setHasOpenedCompare(true); }, [compareOpen]);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [shareNotice, setShareNotice] = useState<{
    title: string;
    waLink: string;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const heroRef = useRef<HTMLElement | null>(null);
  const flashSaleRef = useRef<HTMLElement | null>(null);
  const catalogRef = useRef<HTMLElement | null>(null);
  const catalogCursorRef = useRef<{ signature: string; cursors: Record<number, string> }>({ signature: '', cursors: {} });

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 2600);
  }, []);

  const handleLogout = useCallback(async () => {
    // Preserve credentials and UI state unless the server confirms session revocation.
    try {
      await apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
    } catch (error) {
      showToast((error as Error).message || 'Unable to sign out. Please try again.');
      throw error;
    }
    clearClientSessionTokens();

    let guestSession: Pick<AuthSessionResponse, 'likedProductIds' | 'cart'> | null = null;
    try {
      guestSession = await apiFetch<Pick<AuthSessionResponse, 'likedProductIds' | 'cart'>>('/api/auth/me');
    } catch {
      // The authenticated session is already revoked; retain the in-memory guest cart.
    }

    setUser(null);
    setActivePage('store');
    setAuthOpen(false);
    setCartOpen(false);
    setSellerInviteToken(null);
    setLikedIds(new Set(guestSession?.likedProductIds || []));
    if (guestSession?.cart) setCart(guestSession.cart);
    try {
      localStorage.setItem('kk_guest_cart', JSON.stringify(guestSession?.cart ?? cart));
    } catch {
      // Browser storage may be unavailable; keep the in-memory cart.
    }
    showToast('You have been signed out.');
  }, [cart, showToast]);

  const recordRecentlyViewed = useCallback((product: Product) => {
    setRecentlyViewed((prev) => {
      const first = prev[0];
      if (
        first &&
        first._id === product._id &&
        first.likesCount === product.likesCount &&
        first.sharesCount === product.sharesCount &&
        first.totalStock === product.totalStock &&
        first.salePrice === product.salePrice
      ) {
        return prev;
      }
      const next = [product, ...prev.filter((p) => p._id !== product._id)].slice(0, 5);
      try {
        sessionStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage quota errors
      }
      return next;
    });
  }, []);

  const clearRecentlyViewed = useCallback(() => {
    setRecentlyViewed([]);
    try {
      sessionStorage.removeItem(RECENT_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }, []);

  // Support shared product/category deep-links (?product=..., ?category=..., ?season=...), Admin invite links (?sellerInvite=... or ?invite=...), and hero scroll tracking
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === '1') { setAuthInitialMode('signin'); setAuthOpen(true); }
    const sharedProd = params.get('product');
    if (sharedProd) {
      setSelectedProductKey(sharedProd);
    }
    const urlCategory = params.get('category');
    if (urlCategory && urlCategory.trim()) {
      setCategory(urlCategory.trim());
    }
    const urlSeason = params.get('season');
    if (
      urlSeason &&
      (SEASONS as readonly string[]).includes(urlSeason)
    ) {
      setSeason(urlSeason as SeasonType | 'All');
    }
    const inviteParam = params.get('sellerInvite') || params.get('invite');
    if (inviteParam) {
      setSellerInviteToken(inviteParam);
      setActivePage('seller');
    } else if (params.get('page') === 'signup' || params.get('signup') === '1') {
      setActivePage('signup');
    } else if (params.get('page') === 'orders') {
      setActivePage('orders');
    }

    const onScroll = () => {
      const threshold = heroRef.current ? heroRef.current.offsetHeight + 40 : 420;
      setShowScrollTop(window.scrollY > threshold);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Dynamically inject canonical links, Open Graph tags, Twitter cards, and Schema.org JSON-LD based on selected product or category
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const origin = window.location.origin;
    const pathname = window.location.pathname || '/';
    const baseCanonical = `${origin}${pathname}`;

    const currentUrl = new URL(window.location.href);
    const preserveInvite = currentUrl.searchParams.get('sellerInvite') || currentUrl.searchParams.get('invite');
    const preserveOAuth = currentUrl.searchParams.get('oauth') === '1';

    if (activeProductMeta && selectedProductKey) {
      const productSlugOrId = activeProductMeta.slug || activeProductMeta._id;
      const canonicalUrl = `${baseCanonical}?product=${encodeURIComponent(productSlugOrId)}`;
      const title = `${activeProductMeta.title} — ${t('brand')}`;
      const rawDesc = activeProductMeta.description?.trim() || t('hero.subtitle');
      const description = rawDesc.length > 158 ? `${rawDesc.slice(0, 155).trim()}...` : rawDesc;
      const primaryImage = resolveAbsoluteUrl(
        activeProductMeta.images[0]?.url || HERO_IMG,
        origin
      );

      document.title = title;
      upsertCanonicalLink(canonicalUrl);
      upsertHeadMeta('name', 'description', description);
      upsertHeadMeta('property', 'og:site_name', t('brand'));
      upsertHeadMeta('property', 'og:type', 'product');
      upsertHeadMeta('property', 'og:title', title);
      upsertHeadMeta('property', 'og:description', description);
      upsertHeadMeta('property', 'og:url', canonicalUrl);
      upsertHeadMeta('property', 'og:image', primaryImage);
      upsertHeadMeta('property', 'product:price:amount', String(activeProductMeta.salePrice));
      upsertHeadMeta('property', 'product:price:currency', 'INR');
      upsertHeadMeta('name', 'twitter:card', 'summary_large_image');
      upsertHeadMeta('name', 'twitter:title', title);
      upsertHeadMeta('name', 'twitter:description', description);
      upsertHeadMeta('name', 'twitter:image', primaryImage);

      upsertJsonLdScript({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: activeProductMeta.title,
        image: activeProductMeta.images.map((img) => resolveAbsoluteUrl(img.url, origin)),
        description,
        sku: activeProductMeta.sku,
        category: activeProductMeta.category,
        brand: {
          '@type': 'Brand',
          name: activeProductMeta.sellerName || t('brand'),
        },
        offers: {
          '@type': 'Offer',
          url: canonicalUrl,
          priceCurrency: 'INR',
          price: activeProductMeta.salePrice,
          availability:
            activeProductMeta.totalStock > 0
              ? 'https://schema.org/InStock'
              : 'https://schema.org/OutOfStock',
        },
      });

      if (!preserveInvite && !preserveOAuth) {
        const nextUrl = new URL(baseCanonical);
        nextUrl.searchParams.set('product', productSlugOrId);
        if (window.location.search !== nextUrl.search) {
          window.history.replaceState({}, '', `${nextUrl.pathname}${nextUrl.search}`);
        }
      }
      return;
    }

    removeHeadMeta('property', 'product:price:amount');
    removeHeadMeta('property', 'product:price:currency');

    const canonicalParams = new URLSearchParams();
    if (activePage === 'store' && category !== 'All') {
      canonicalParams.set('category', String(category));
    }
    if (activePage === 'store' && season !== 'All') {
      canonicalParams.set('season', String(season));
    }
    const querySuffix = canonicalParams.toString() ? `?${canonicalParams.toString()}` : '';
    const canonicalUrl = `${baseCanonical}${querySuffix}`;

    const matchedCategory = storeCategories.find(
      (c) => c.name.toLowerCase() === String(category).toLowerCase()
    );
    const pageLabel =
      activePage === 'wishlist'
        ? t('nav.wishlist')
        : activePage === 'orders'
          ? t('nav.orders')
          : activePage === 'seller'
            ? t('nav.sellerHub')
            : activePage === 'signup'
              ? t('auth.signUpTitle')
              : category !== 'All'
                ? `${tc(category)} Collection`
                : season !== 'All'
                  ? `${tseason(season)} Festive Edit`
                  : 'Artisanal Jewellery, Clothing & Accessories';

    const title = `${pageLabel} — ${t('brand')}`;
    const description =
      matchedCategory?.description?.trim() ||
      (category !== 'All'
        ? `Shop handcrafted ${tc(category)} curated from Jaipur and Banaras artisans on ${t('brand')}.`
        : 'Curated artificial jewellery, handloom clothing, and artisanal accessories with instant search, verified reviews, and seasonal edits.');
    const ogImage = resolveAbsoluteUrl(
      catalog.products[0]?.images[0]?.url || HERO_IMG,
      origin
    );

    document.title = title;
    upsertCanonicalLink(canonicalUrl);
    upsertHeadMeta('name', 'description', description);
    upsertHeadMeta('property', 'og:site_name', t('brand'));
    upsertHeadMeta('property', 'og:type', 'website');
    upsertHeadMeta('property', 'og:title', title);
    upsertHeadMeta('property', 'og:description', description);
    upsertHeadMeta('property', 'og:url', canonicalUrl);
    upsertHeadMeta('property', 'og:image', ogImage);
    upsertHeadMeta('name', 'twitter:card', 'summary_large_image');
    upsertHeadMeta('name', 'twitter:title', title);
    upsertHeadMeta('name', 'twitter:description', description);
    upsertHeadMeta('name', 'twitter:image', ogImage);

    upsertJsonLdScript({
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: title,
      description,
      url: canonicalUrl,
    });

    if (!preserveInvite && !preserveOAuth && activePage === 'store') {
      const nextSearch = canonicalParams.toString() ? `?${canonicalParams.toString()}` : '';
      if (window.location.search !== nextSearch) {
        window.history.replaceState({}, '', `${pathname}${nextSearch}`);
      }
    }
  }, [
    activeProductMeta,
    selectedProductKey,
    category,
    season,
    activePage,
    catalog.products,
    storeCategories,
    t,
    tc,
    tseason,
  ]);

  // Complete Supabase OAuth after the provider redirects back to the storefront.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('oauth') !== '1') return;

    let cancelled = false;
    (async () => {
      try {
        const { getSupabaseBrowserClient } = await import('../../../src/lib/supabase');
        const supabase = getSupabaseBrowserClient();
        if (!supabase) throw new Error('Supabase OAuth is not configured.');
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!data.session?.access_token) throw new Error('The social sign-in session could not be found.');
        const signedIn = await apiFetch<{
          user: User;
          accessToken?: string;
          csrfToken?: string;
          likedProductIds: string[];
          cart: CartItem[];
        }>('/api/auth/oauth', {
          method: 'POST',
          body: JSON.stringify({ accessToken: data.session.access_token }),
        });
        if (cancelled) return;
        setClientSessionTokens(signedIn.accessToken, signedIn.csrfToken);
        setUser(signedIn.user);
        setActivePage(signedIn.user.role === 'SELLER' || signedIn.user.role === 'ADMIN' ? 'seller' : 'store');
        setLikedIds(new Set(signedIn.likedProductIds || []));
        setCart(signedIn.cart || []);
        localStorage.setItem('kk_guest_cart', JSON.stringify(signedIn.cart || []));
        setAuthOpen(false);
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('oauth');
        cleanUrl.hash = '';
        window.history.replaceState({}, '', cleanUrl.toString());
      } catch (err) {
        if (!cancelled) showToast((err as Error).message || 'Social sign-in failed.');
      }
    })();

    return () => { cancelled = true; };
  }, [showToast]);

  // Load initial auth/guest session + merge localStorage cart if server cart empty.
  // OAuth callback exchange owns auth state on callback mounts; never let guest hydration race it.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('oauth') === '1') return;
    (async () => {
      try {
        const session = await apiFetch<AuthSessionResponse>('/api/auth/me');
        setClientSessionTokens(session.accessToken, session.csrfToken);
        setUser(session.user);
        setActivePage(session.user?.role === 'SELLER' || session.user?.role === 'ADMIN' ? 'seller' : 'store');
        setLikedIds(new Set(session.likedProductIds));

        let activeCart = session.cart;
        if (activeCart.length === 0) {
          const saved = localStorage.getItem('kk_guest_cart');
          if (saved) {
            try {
              const parsed = JSON.parse(saved) as CartItem[];
              if (Array.isArray(parsed) && parsed.length > 0) {
                activeCart = parsed;
                await apiFetch('/api/cart', {
                  method: 'PUT',
                  body: JSON.stringify({ items: parsed }),
                });
              }
            } catch {
              // ignore corrupt localStorage
            }
          }
        }
        setCart(activeCart);
      } catch {
        // Fallback silently
      }
    })();
  }, []);

  // Debounce search query + fetch edgeGram/fuzzy suggestions
  useEffect(() => {
    const timer = setTimeout(async () => {
      setDebouncedQuery(searchInput.trim());
      setPage(1);
      if (searchInput.trim().length >= 2) {
        try {
          const res = await apiFetch<{ suggestions: string[] }>(
            `/api/products/suggest?q=${encodeURIComponent(searchInput.trim())}`
          );
          setSuggestions(res.suggestions);
        } catch {
          setSuggestions([]);
        }
      } else {
        setSuggestions([]);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const fetchStoreMeta = useCallback(async () => {
    try {
      const [catRes, cmpRes, cpnRes, platformRes] = await Promise.all([
        apiFetch<{ categories: CategoryControl[] }>('/api/categories'),
        apiFetch<{ campaigns: StorefrontCampaign[] }>('/api/campaigns'),
        apiFetch<{ coupons: Coupon[] }>('/api/coupons/applicable'),
        apiFetch<{ flags: PlatformServiceFlags }>('/api/config/platform').catch(() => ({
          flags: null,
        })),
      ]);
      const enabledCats = catRes.categories || [];
      setStoreCategories(enabledCats);
      setCampaigns(cmpRes.campaigns || []);
      setApplicableCoupons(cpnRes.coupons || []);
      if (platformRes?.flags) {
        setPlatformFlags(platformRes.flags);
      }

      if (
        enabledCats.length > 0 &&
        category !== 'All' &&
        !enabledCats.some((c) => c.name.toLowerCase() === category.toLowerCase())
      ) {
        setCategory('All');
        setPage(1);
      }
    } catch {
      // Non-blocking fallback
    }
  }, [category]);

  useEffect(() => {
    fetchStoreMeta();
  }, [fetchStoreMeta, user?._id]);

  const fetchCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const cursorSignature = JSON.stringify({
        category, occasion, season, sort, debouncedQuery, selectedCampaignId,
        minPrice, maxPrice, minDiscount, inStockOnly, colorFilter, viewerId: user?._id || '',
      });
      if (catalogCursorRef.current.signature !== cursorSignature) {
        catalogCursorRef.current = { signature: cursorSignature, cursors: {} };
      }
      const cursorEligible = !debouncedQuery && !selectedCampaignId && !colorFilter.trim() &&
        ['most_demanding', 'newly_added', 'fast_selling', 'price_asc', 'price_desc'].includes(sort);
      const params = new URLSearchParams({
        category,
        occasion,
        season,
        sort,
        page: String(page),
      });
      if (debouncedQuery) params.set('q', debouncedQuery);
      if (selectedCampaignId) params.set('campaignId', selectedCampaignId);
      if (minPrice) params.set('minPrice', minPrice);
      if (maxPrice) params.set('maxPrice', maxPrice);
      if (minDiscount) params.set('minDiscount', minDiscount);
      if (inStockOnly) params.set('inStockOnly', 'true');
      if (colorFilter.trim()) params.set('color', colorFilter.trim());
      if (cursorEligible && page > 1) {
        const cursor = catalogCursorRef.current.cursors[page];
        if (cursor) params.set('cursor', cursor);
      }

      const data = await apiFetch<ProductListResponse>(`/api/products?${params}`);
      if (cursorEligible && data.nextCursor) {
        catalogCursorRef.current.cursors[page + 1] = data.nextCursor;
      } else {
        delete catalogCursorRef.current.cursors[page + 1];
      }
      setCatalog(data);
    } finally {
      setCatalogLoading(false);
    }
  }, [
    category,
    occasion,
    season,
    selectedCampaignId,
    sort,
    page,
    debouncedQuery,
    minPrice,
    maxPrice,
    minDiscount,
    inStockOnly,
    colorFilter,
    user?._id,
  ]);

  useEffect(() => {
    fetchCatalog();
  }, [fetchCatalog]);

  const syncCart = async (nextCart: CartItem[], addedProductId?: string) => {
    setCart(nextCart);
    localStorage.setItem('kk_guest_cart', JSON.stringify(nextCart));
    try {
      await apiFetch('/api/cart', {
        method: 'PUT',
        body: JSON.stringify({ items: nextCart, addedProductId }),
      });
    } catch {
      // localStorage backup remains intact
    }
  };

  const handleAddToCart = async (
    product: Product,
    variant: ProductVariant,
    quantity = 1
  ) => {
    const unitPrice = variant.priceOverride || product.salePrice;
    const existingIdx = cart.findIndex((c) => c.variantSku === variant.variantSku);
    const next = [...cart];
    if (existingIdx >= 0) {
      next[existingIdx] = {
        ...next[existingIdx],
        quantity: Math.min(20, next[existingIdx].quantity + quantity),
      };
    } else {
      next.push({
        productId: product._id,
        variantSku: variant.variantSku,
        title: product.title,
        slug: product.slug,
        category: product.category,
        size: variant.size,
        colorName: variant.colorName,
        colorHex: variant.colorHex,
        imageUrl: variant.variantImageUrl || product.images[0]?.url || '',
        unitPrice,
        basePrice: product.basePrice,
        quantity,
        sellerId: product.sellerId,
      });
    }
    await syncCart(next, product._id);
    showToast(t('toast.addedToBag', { title: product.title }));
  };

  const handleUpdateCartQty = async (variantSku: string, delta: number) => {
    const next = cart
      .map((item) =>
        item.variantSku === variantSku
          ? { ...item, quantity: item.quantity + delta }
          : item
      )
      .filter((item) => item.quantity > 0);
    await syncCart(next);
  };

  const handleRemoveCartItem = async (variantSku: string) => {
    const next = cart.filter((item) => item.variantSku !== variantSku);
    await syncCart(next);
  };

  const handleToggleLike = async (productId: string) => {
    try {
      const res = await apiFetch<{ liked: boolean; likesCount: number }>(
        '/api/likes/toggle',
        {
          method: 'POST',
          body: JSON.stringify({ productId }),
        }
      );
      setLikedIds((prev) => {
        const next = new Set(prev);
        if (res.liked) next.add(productId);
        else next.delete(productId);
        return next;
      });
      setCatalog((prev) => ({
        ...prev,
        products: prev.products.map((p) =>
          p._id === productId ? { ...p, likesCount: res.likesCount } : p
        ),
      }));
      setRecentlyViewed((prev) =>
        prev.map((p) => (p._id === productId ? { ...p, likesCount: res.likesCount } : p))
      );
    } catch (err) {
      showToast((err as Error).message);
    }
  };

  const handleToggleCompare = useCallback(
    (product: Product) => {
      if (product.category !== 'Artificial Jewellery') return;
      setCompareItems((prev) => {
        const exists = prev.some((item) => item._id === product._id);
        if (exists) {
          return prev.filter((item) => item._id !== product._id);
        }
        if (prev.length >= 4) {
          showToast(t('toast.compareLimit'));
          return prev;
        }
        showToast(t('toast.addedToCompare', { title: product.title }));
        return [...prev, product];
      });
    },
    [showToast, t]
  );

  const handleSelectProduct = useCallback(
    (product: Product) => {
      recordRecentlyViewed(product);
      setSelectedInitialVariantSku(null);
      setActiveProductMeta(product);
      setSelectedProductKey(product._id);
    },
    [recordRecentlyViewed]
  );

  const handleQuickBuy = useCallback(
    (product: Product) => {
      recordRecentlyViewed(product);
      setSelectedInitialVariantSku(product.variants[0]?.variantSku || null);
      setActiveProductMeta(product);
      setSelectedProductKey(product._id);
    },
    [recordRecentlyViewed]
  );

  const handleProductLoaded = useCallback(
    (loaded: Product) => {
      recordRecentlyViewed(loaded);
      setActiveProductMeta((prev) => {
        if (
          prev &&
          prev._id === loaded._id &&
          prev.likesCount === loaded.likesCount &&
          prev.sharesCount === loaded.sharesCount &&
          prev.totalStock === loaded.totalStock &&
          prev.salePrice === loaded.salePrice
        ) {
          return prev;
        }
        return loaded;
      });
    },
    [recordRecentlyViewed]
  );

  const handleShareWhatsApp = useCallback(
    (payload: {
      product: Product;
      waLink: string;
      messagePreview: string;
      sharesCount?: number;
    }) => {
      if (typeof payload.sharesCount === 'number') {
        const nextShares = payload.sharesCount;
        const pid = payload.product._id;
        setCatalog((prev) => ({
          ...prev,
          products: prev.products.map((p) =>
            p._id === pid ? { ...p, sharesCount: nextShares } : p
          ),
        }));
        setRecentlyViewed((prev) =>
          prev.map((p) => (p._id === pid ? { ...p, sharesCount: nextShares } : p))
        );
      }
      setShareNotice({ title: payload.product.title, waLink: payload.waLink });
      setTimeout(() => {
        setShareNotice((prev) => (prev?.waLink === payload.waLink ? null : prev));
      }, 6500);
    },
    []
  );

  const handleInviteConsumed = useCallback(() => {
    setSellerInviteToken(null);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('sellerInvite');
      url.searchParams.delete('invite');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  useEffect(() => {
    const openCustomerSignup = () => setActivePage('signup');
    window.addEventListener('commerce:navigate-signup', openCustomerSignup);
    return () => window.removeEventListener('commerce:navigate-signup', openCustomerSignup);
  }, []);

  const clearCatalogFilters = useCallback(() => {
    setSearchInput('');
    setDebouncedQuery('');
    setSuggestions([]);
    setShowSuggestions(false);
    setCategory('All');
    setOccasion('All');
    setSeason('All');
    setSelectedCampaignId(null);
    setMinPrice('');
    setMaxPrice('');
    setMinDiscount('');
    setInStockOnly(false);
    setColorFilter('');
    setShowMoreFilters(false);
  }, []);

  const scrollToRef = useCallback((ref: { current: HTMLElement | null }) => {
    window.requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const handleExploreFestiveEdit = useCallback(() => {
    setActivePage('store');
    clearCatalogFilters();
    setOccasion('Festive');
    setSort('most_demanding');
    setPage(1);
    scrollToRef(catalogRef);
  }, [clearCatalogFilters, scrollToRef]);

  const handleViewSpecialOffers = useCallback(
    (target: 'auto' | 'catalog' = 'auto') => {
      setActivePage('store');
      clearCatalogFilters();
      setSort('special_offers');
      setMinDiscount('15');
      setPage(1);
      if (target === 'auto' && campaigns.length > 0 && flashSaleRef.current) {
        scrollToRef(flashSaleRef);
      } else {
        scrollToRef(catalogRef);
      }
    },
    [campaigns.length, clearCatalogFilters, scrollToRef]
  );

  const navigateToStore = useCallback((cat?: ProductCategory | 'All') => {
    setActivePage('store');
    if (cat) {
      setCategory(cat);
      setPage(1);
    }
  }, []);

  const compareIds = new Set(compareItems.map((i) => i._id));
  const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0);
  if (user?.role === 'PROVIDER' || window.location.pathname.startsWith('/provider')) return <Suspense fallback={<FeatureLoadingFallback />}><ProviderPortal /></Suspense>;
  const isSellerWorkspace = user?.role === 'SELLER' || user?.role === 'ADMIN';
  const isSellerDashboard = isSellerWorkspace && activePage === 'seller';

  return (
    <Suspense fallback={<FeatureLoadingFallback />}>
    <div className="min-h-dvh w-full flex flex-col bg-[#FAF9F6] text-[#141413] overflow-x-clip">
      {!isSellerDashboard && <TopBar
        activePage={activePage}
        activeCategory={category}
        categories={storeCategories.map((c) => c.name)}
        onNavigateStore={navigateToStore}
        onNavigateWishlist={() => setActivePage('wishlist')}
        onNavigateOrders={() => setActivePage('orders')}
        onNavigateSeller={isSellerWorkspace ? () => setActivePage('seller') : undefined}
        wishlistCount={likedIds.size}
        cartCount={cartCount}
        onOpenCart={() => setCartOpen(true)}
        user={user}
        onOpenAuth={() => {
          setAuthInitialMode('signin');
          setAuthOpen(true);
        }}
        onLogout={handleLogout}
        onStartTour={() => {
          setActivePage('store');
          window.requestAnimationFrame(() => startRoleTour());
        }}
      />}

      {activePage === 'signup' && (
        <div className="flex-1">
          <Suspense fallback={<FeatureLoadingFallback />}>
          <AccountSignUpView
            user={user}
            onAuthChanged={(payload) => {
              setUser(payload.user);
              if (payload.likedProductIds) setLikedIds(new Set(payload.likedProductIds));
              if (payload.cart) {
                setCart(payload.cart);
                localStorage.setItem('kk_guest_cart', JSON.stringify(payload.cart));
              }
            }}
            onOpenSignIn={() => {
              setAuthInitialMode('signin');
              setAuthOpen(true);
            }}
            onNavigateStore={() => navigateToStore()}
          />
          </Suspense>
        </div>
      )}

      {activePage === 'wishlist' && (
        <div className="flex-1">
          <Suspense fallback={<FeatureLoadingFallback />}>
          <WishlistView
            likedIds={likedIds}
            onRemoveFromWishlist={handleToggleLike}
            onAddToCart={handleAddToCart}
            onSelectProduct={handleSelectProduct}
            compareIds={compareIds}
            onToggleCompare={handleToggleCompare}
            onBrowseCatalog={() => navigateToStore()}
          />
          </Suspense>
        </div>
      )}

      {activePage === 'orders' && (
        <div className="flex-1">
          <Suspense fallback={<FeatureLoadingFallback />}>
          <OrdersView
            user={user}
            platformFlags={platformFlags}
            onOpenAuth={() => {
              setAuthInitialMode('signin');
              setAuthOpen(true);
            }}
          />
          </Suspense>
        </div>
      )}

      {activePage === 'seller' && (
        <div className="flex-1">
          <Suspense fallback={<FeatureLoadingFallback />}>
          <SellerHubView
            user={user}
            onUserUpdated={(u) => setUser(u)}
            onAuthSynced={(payload) => {
              setUser(payload.user);
              if (payload.likedProductIds) setLikedIds(new Set(payload.likedProductIds));
              if (payload.cart) {
                setCart(payload.cart);
                localStorage.setItem('kk_guest_cart', JSON.stringify(payload.cart));
              }
            }}
            onOpenAuth={() => {
              setAuthInitialMode('signin');
              setAuthOpen(true);
            }}
            onCatalogMutated={() => {
              fetchCatalog();
              fetchStoreMeta();
            }}
            inviteToken={sellerInviteToken}
            onInviteConsumed={handleInviteConsumed}
            onReturnToStore={() => navigateToStore()}
            onLogout={handleLogout}
            platformFlags={platformFlags}
            onPlatformFlagsUpdated={(flags) => setPlatformFlags(flags)}
          />
          </Suspense>
        </div>
      )}

      {activePage === 'store' && (
        <main className="flex-1 min-w-0">
          {/* Storefront Campaign Hero */}
          <section ref={heroRef} className="border-b border-[#E8E6E1] bg-white">
            <div className="mx-auto max-w-7xl grid grid-cols-1 lg:grid-cols-12 items-stretch">
              <div className="lg:col-span-5 flex flex-col justify-center px-4 py-8 sm:px-8 lg:px-10 sm:py-10 lg:py-14 space-y-4 sm:space-y-5 min-w-0">
                <div className="text-xs font-medium tracking-wide text-[#881337]">
                  {t('hero.kicker')}
                </div>
                <h1 className="font-display text-2xl sm:text-4xl lg:text-5xl font-semibold leading-[1.08] text-[#141413] text-balance">
                  {t('hero.title')}
                </h1>
                <p className="text-sm leading-relaxed text-[#57534E] max-w-prose">
                  {t('hero.subtitle')}
                </p>
                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                  <ActionButton
                    actionKey="explore_festive"
                    role="CUSTOMER"
                    showHelpIcon
                    labelOverride={t('hero.ctaPrimary')}
                    onClick={handleExploreFestiveEdit}
                  />
                  <button
                    type="button"
                    onClick={() => handleViewSpecialOffers('auto')}
                    className="w-full sm:w-auto min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-md border border-[#D6D3CD] bg-white px-5 py-2.5 text-xs font-medium text-[#141413] hover:border-[#141413] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#881337] focus-visible:ring-offset-2 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    {t('hero.ctaSecondary')}
                  </button>
                </div>

                {!hasSeenCustomerTour && (!user || user.role === 'BUYER') && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#E8E6E1] bg-[#FAF9F6] px-3 py-2 text-xs">
                    <span className="text-[#44403C] font-medium">
                      New to {t('brand')}? Take a quick 1-minute guided tour.
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => startCustomerTour()}
                        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-[#881337]/10 px-3 text-xs font-semibold text-[#881337] hover:bg-[#881337]/15 cursor-pointer"
                      >
                        Start Tour
                      </button>
                      <button
                        type="button"
                        aria-label="Dismiss new customer tour prompt"
                        onClick={dismissCustomerTourPrompt}
                        className="inline-flex h-[44px] w-[44px] min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-[#6B6A65] hover:bg-white hover:text-[#141413] cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="lg:col-span-7 relative min-h-[220px] sm:min-h-[340px] lg:min-h-[360px] bg-[#F2EFE9]">
                <img
                  src={HERO_IMG}
                  alt={t('hero.imageAlt')}
                  referrerPolicy="no-referrer"
                  loading="eager"
                  decoding="async"
                  fetchPriority="high"
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
          </section>

          {/* Seasonal Flash Sales Countdown Section */}
          <FlashSaleSection
            sectionRef={flashSaleRef}
            campaigns={campaigns}
            activeCampaignId={selectedCampaignId}
            onSelectCampaign={(campaign) => {
              const nextId = selectedCampaignId === campaign._id ? null : campaign._id;
              clearCatalogFilters();
              setSelectedCampaignId(nextId);
              setPage(1);
              scrollToRef(catalogRef);
            }}
            onSelectSeason={(ssn) => {
              clearCatalogFilters();
              setSeason(ssn);
              setPage(1);
              scrollToRef(catalogRef);
            }}
            onViewOffersCatalog={() => handleViewSpecialOffers('catalog')}
            onOpenProduct={handleSelectProduct}
          />

          {/* Hybrid Search, Unified Filter Studio & Strict 20-Item Catalog */}
          <section
            ref={catalogRef}
            id="catalog-section"
            className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-6 scroll-mt-20"
          >
            <CatalogFilterBar
              searchInput={searchInput}
              onSearchInputChange={setSearchInput}
              onClearSearch={() => {
                setSearchInput('');
                setDebouncedQuery('');
                setSuggestions([]);
                setPage(1);
              }}
              suggestions={suggestions}
              showSuggestions={showSuggestions}
              onShowSuggestionsChange={setShowSuggestions}
              onSelectSuggestion={(sug) => {
                setSearchInput(sug);
                setDebouncedQuery(sug);
                setShowSuggestions(false);
                setPage(1);
              }}
              didYouMean={catalog.didYouMean ?? null}
              onSelectDidYouMean={(term) => {
                setSearchInput(term);
                setDebouncedQuery(term);
                setPage(1);
              }}
              quickSearchChips={QUICK_SEARCH_CHIPS}
              occasions={OCCASIONS}
              seasons={SEASONS}
              sortOptions={SORT_OPTION_VALUES}
              storeCategories={storeCategories}
              category={category}
              onCategoryChange={(cat) => {
                setCategory(cat);
                setPage(1);
              }}
              occasion={occasion}
              onOccasionChange={(occ) => {
                setOccasion(occ);
                setPage(1);
              }}
              season={season}
              onSeasonChange={(ssn) => {
                setSeason(ssn);
                setPage(1);
              }}
              sort={sort}
              onSortChange={(nextSort) => {
                setSort(nextSort);
                setPage(1);
              }}
              minPrice={minPrice}
              onMinPriceChange={(val) => {
                setMinPrice(val);
                setPage(1);
              }}
              maxPrice={maxPrice}
              onMaxPriceChange={(val) => {
                setMaxPrice(val);
                setPage(1);
              }}
              onApplyPriceRange={(nextMin, nextMax) => {
                setMinPrice(nextMin);
                setMaxPrice(nextMax);
                setPage(1);
              }}
              minDiscount={minDiscount}
              onMinDiscountChange={(val) => {
                setMinDiscount(val);
                setPage(1);
              }}
              inStockOnly={inStockOnly}
              onInStockOnlyChange={(checked) => {
                setInStockOnly(checked);
                setPage(1);
              }}
              colorFilter={colorFilter}
              onColorFilterChange={(val) => {
                setColorFilter(val);
                setPage(1);
              }}
              showMoreFilters={showMoreFilters}
              onToggleMoreFilters={() => setShowMoreFilters((v) => !v)}
              campaigns={campaigns}
              selectedCampaignId={selectedCampaignId}
              onClearCampaign={() => {
                setSelectedCampaignId(null);
                setPage(1);
              }}
              shownCount={catalog.products.length}
              totalCount={catalog.total}
              page={catalog.page}
              totalPages={catalog.totalPages}
              onResetAll={() => {
                setSearchInput('');
                setDebouncedQuery('');
                setSuggestions([]);
                setCategory('All');
                setOccasion('All');
                setSeason('All');
                setSelectedCampaignId(null);
                setMinPrice('');
                setMaxPrice('');
                setMinDiscount('');
                setInStockOnly(false);
                setColorFilter('');
                setPage(1);
              }}
              onStartTour={() => startRoleTour()}
            />

            {/* Product Grid */}
            {catalogLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {Array.from({ length: 8 }).map((_, i) => (
                  <ProductCardSkeleton key={i} />
                ))}
              </div>
            ) : catalog.products.length === 0 ? (
              <div className="rounded-lg border border-[#E8E6E1] bg-white p-12 text-center space-y-3">
                <div className="font-display text-2xl font-semibold text-[#141413]">
                  {t('catalog.emptyTitle')}
                </div>
                <p className="text-xs text-[#6B6A65]">{t('catalog.emptySub')}</p>
                <button
                  type="button"
                  onClick={() => {
                    clearCatalogFilters();
                    setSort('most_demanding');
                    setPage(1);
                  }}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-[#881337] px-5 py-2.5 text-xs font-semibold text-white cursor-pointer"
                >
                  {t('catalog.showAll')}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {catalog.products.map((product) => {
                  const threshold = catalog.categoryTop10Thresholds?.[product.category];
                  const isTopTrending =
                    typeof threshold === 'number' && product.trendScore >= threshold;

                  return (
                    <ProductCard
                      key={product._id}
                      product={product}
                      isLiked={likedIds.has(product._id)}
                      onToggleLike={handleToggleLike}
                      onSelect={handleSelectProduct}
                      onQuickBuy={handleQuickBuy}
                      onShareWhatsApp={handleShareWhatsApp}
                      onQuickAdd={(p) =>
                        p.variants[0] && handleAddToCart(p, p.variants[0], 1)
                      }
                      isCompared={compareIds.has(product._id)}
                      onToggleCompare={handleToggleCompare}
                      isTopTrending={isTopTrending}
                      activeCoupon={findMatchingCouponForProduct(product, applicableCoupons)}
                    />
                  );
                })}
              </div>
            )}

            {/* Strict limit(20) Previous / Next Pagination */}
            {catalog.totalPages > 1 && (
              <div className="flex items-center justify-center gap-4 pt-6 border-t border-[#E8E6E1]">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => {
                    setPage((p) => Math.max(1, p - 1));
                    catalogRef.current?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-md border border-[#D6D3CD] bg-white px-4 py-2.5 text-xs font-medium text-[#141413] hover:border-[#881337] disabled:opacity-40 cursor-pointer"
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span>{t('pagination.prev')}</span>
                </button>
                <span className="text-xs font-medium text-[#57534E] tabular-nums">
                  {t('pagination.pageOf', {
                    page: catalog.page,
                    totalPages: catalog.totalPages,
                  })}
                </span>
                <button
                  type="button"
                  disabled={page >= catalog.totalPages}
                  onClick={() => {
                    setPage((p) => Math.min(catalog.totalPages, p + 1));
                    catalogRef.current?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-md border border-[#D6D3CD] bg-white px-4 py-2.5 text-xs font-medium text-[#141413] hover:border-[#881337] disabled:opacity-40 cursor-pointer"
                >
                  <span>{t('pagination.next')}</span>
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </section>

          {/* Recently Viewed Horizontal Carousel (persisted in sessionStorage, last 5 clicked) */}
          {recentlyViewed.length > 0 && <Suspense fallback={null}><RecentlyViewedCarousel
            items={recentlyViewed}
            likedIds={likedIds}
            onToggleLike={handleToggleLike}
            onSelect={handleSelectProduct}
            onQuickBuy={handleQuickBuy}
            onShareWhatsApp={handleShareWhatsApp}
            onQuickAdd={(p) => p.variants[0] && handleAddToCart(p, p.variants[0], 1)}
            compareIds={compareIds}
            onToggleCompare={handleToggleCompare}
            categoryTop10Thresholds={catalog.categoryTop10Thresholds}
            onClearHistory={clearRecentlyViewed}
          /></Suspense>}
        </main>
      )}

      {/* Quiet Editorial Footer */}
      {!isSellerDashboard && <footer className="border-t border-[#E8E6E1] bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#6B6A65]">
          <div className="font-display text-lg font-semibold text-[#141413]">{t('brand')}</div>
          <div className="flex flex-wrap items-center gap-6">
            {(storeCategories.length > 0
              ? storeCategories.map((c) => c.name)
              : ['Artificial Jewellery', 'Clothing', 'Accessories']
            ).map((catName) => (
              <button
                key={catName}
                type="button"
                onClick={() => {
                  setActivePage('store');
                  setCategory(catName);
                  setPage(1);
                }}
                className="hover:text-[#141413] cursor-pointer"
              >
                {tc(catName)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setActivePage('orders')}
              className="hover:text-[#141413] cursor-pointer"
            >
              {t('footer.orderHistory')}
            </button>
          </div>
          <div>© 2026 {t('brand')}</div>
        </div>
      </footer>}

      {/* Overlays */}
      {hasOpenedProductDetail && <Suspense fallback={null}><ProductDetailModal
        productIdOrSlug={selectedProductKey}
        initialVariantSku={selectedInitialVariantSku}
        onClose={() => {
          setSelectedProductKey(null);
          setActiveProductMeta(null);
          setSelectedInitialVariantSku(null);
        }}
        user={user}
        likedProductIds={likedIds}
        onToggleLike={handleToggleLike}
        onAddToCart={handleAddToCart}
        onSelectProduct={handleSelectProduct}
        onQuickBuy={handleQuickBuy}
        onShareWhatsApp={handleShareWhatsApp}
        onOpenAuth={() => { setActivePage('signup'); setAuthOpen(false); }}
        compareIds={compareIds}
        compareCount={compareItems.length}
        onToggleCompare={handleToggleCompare}
        onOpenCompare={() => setCompareOpen(true)}
        categoryTop10Thresholds={catalog.categoryTop10Thresholds}
        onProductLoaded={handleProductLoaded}
        onApplyCoupon={(code) => {
          setPendingCouponCode(code);
          setSelectedProductKey(null);
          setActiveProductMeta(null);
          setCartOpen(true);
        }}
      /></Suspense>}

      {hasOpenedCompare && <Suspense fallback={null}><JewelleryCompareModal
        isOpen={compareOpen}
        onClose={() => setCompareOpen(false)}
        items={compareItems}
        availableJewellery={Array.from(
          new Map(
            [...catalog.products, ...recentlyViewed]
              .filter((p) => p.category === 'Artificial Jewellery')
              .map((p) => [p._id, p])
          ).values()
        )}
        onAddItem={handleToggleCompare}
        onRemoveItem={(id) =>
          setCompareItems((prev) => prev.filter((item) => item._id !== id))
        }
        onClearAll={() => {
          setCompareItems([]);
          setCompareOpen(false);
        }}
        onAddToCart={handleAddToCart}
        onSelectProduct={handleSelectProduct}
      /></Suspense>}

      {hasOpenedCart && <Suspense fallback={null}><CartDrawer
        isOpen={cartOpen}
        onClose={() => setCartOpen(false)}
        cart={cart}
        onUpdateQty={handleUpdateCartQty}
        onRemoveItem={handleRemoveCartItem}
        user={user}
        onUserUpdated={(u) => setUser(u)}
        onOrderCompleted={() => {
          syncCart([]);
          fetchCatalog();
          fetchStoreMeta();
        }}
        onRequireAuth={() => {
          setCartOpen(false);
          setAuthOpen(true);
        }}
        pendingCouponCode={pendingCouponCode}
        onClearPendingCoupon={() => setPendingCouponCode(null)}
        platformFlags={platformFlags}
      /></Suspense>}

      {hasOpenedAuth && <Suspense fallback={null}><AuthModal
        isOpen={authOpen}
        onClose={() => setAuthOpen(false)}
        onLogout={handleLogout}
        user={user}
        initialMode={authInitialMode}
        onAuthChanged={(payload) => {
          setUser(payload.user);
          setActivePage(payload.user?.role === 'SELLER' || payload.user?.role === 'ADMIN' ? 'seller' : 'store');
          const returnTo = new URLSearchParams(window.location.search).get('returnTo');
          if (returnTo && returnTo.startsWith('/')) { const target = new URL(returnTo, window.location.origin); if (target.origin === window.location.origin) window.location.assign(target.pathname + target.search + target.hash); }
          if (payload.likedProductIds) setLikedIds(new Set(payload.likedProductIds));
          if (payload.cart) {
            setCart(payload.cart);
            localStorage.setItem('kk_guest_cart', JSON.stringify(payload.cart));
          }
        }}
      /></Suspense>}

      {new URLSearchParams(window.location.search).has('rootInvite') && <Suspense fallback={null}><RootInviteAcceptance
        user={user}
        onRequireAuth={() => { setAuthInitialMode('signin'); setAuthOpen(true); }}
        onAccepted={(acceptedUser) => { setUser(acceptedUser); setActivePage(acceptedUser.role === 'SELLER' || acceptedUser.role === 'ADMIN' ? 'seller' : 'store'); }}
      /></Suspense>}

      {/* Floating Artificial Jewellery Comparison Bar */}
      {compareItems.length > 0 && !compareOpen && (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 flex items-center justify-between gap-2 sm:gap-3 rounded-lg border border-[#141413] bg-[#141413] px-3.5 py-2 text-xs text-white shadow-xl w-[calc(100vw-1.5rem)] sm:w-auto max-w-2xl">
          <div className="flex items-center gap-2 min-w-0">
            <div className="hidden sm:flex items-center -space-x-1.5 shrink-0">
              {compareItems.slice(0, 4).map((item) => (
                <img
                  key={item._id}
                  src={item.images[0]?.thumbUrl || item.images[0]?.url}
                  alt={item.title}
                  referrerPolicy="no-referrer"
                  className="h-7 w-7 rounded object-cover border border-[#141413] bg-[#292524]"
                />
              ))}
            </div>
            <span className="font-medium truncate tabular-nums">
              {t('compare.barLabel', { count: compareItems.length })}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setCompareOpen(true)}
              className="inline-flex min-h-[44px] sm:min-h-[36px] items-center gap-1.5 rounded bg-white px-3 py-1.5 font-semibold text-[#141413] hover:bg-[#FAF9F6] whitespace-nowrap cursor-pointer"
            >
              <GitCompare className="h-3.5 w-3.5" />
              <span>{t('compare.cta')}</span>
            </button>
            <button
              type="button"
              onClick={() => setCompareItems([])}
              aria-label={t('compare.clear')}
              className="inline-flex h-11 w-11 sm:h-9 sm:w-9 items-center justify-center rounded text-white/75 hover:text-white cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Floating Scroll to Top Button (lifts above compare/share bars on mobile to prevent overlap) */}
      {showScrollTop && (
        <button
          type="button"
          aria-label={t('footer.scrollTop')}
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className={`fixed right-4 sm:right-5 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-[#D6D3CD] bg-white text-[#141413] shadow-lg transition-all duration-150 hover:-translate-y-0.5 hover:border-[#881337] hover:text-[#881337] cursor-pointer ${
            (compareItems.length > 0 && !compareOpen) || shareNotice
              ? 'bottom-20 sm:bottom-5'
              : 'bottom-5'
          }`}
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      )}

      {/* WhatsApp Share Confirmation & Deep Link */}
      <AnimatePresence>
        {shareNotice && (
          <motion.div
            key={shareNotice.waLink}
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.96 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="fixed bottom-4 left-4 right-4 sm:bottom-5 sm:left-5 sm:right-auto z-60 flex items-center justify-between gap-3 rounded-lg border border-[#E8E6E1] bg-white px-4 py-3 text-xs text-[#141413] shadow-xl sm:max-w-[420px]"
          >
            <div className="min-w-0">
              <div className="font-semibold truncate max-w-[180px] sm:max-w-[210px]">
                {t('share.ready', { title: shareNotice.title })}
              </div>
              <div className="text-[11px] text-[#6B6A65]">{t('share.copied')}</div>
            </div>
            <a
              href={shareNotice.waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md bg-[#166534] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#15803d] whitespace-nowrap shrink-0"
            >
              <span>{t('share.openWhatsapp')}</span>
              <ExternalLink className="h-3 w-3" />
            </a>
            <button
              type="button"
              aria-label={t('detail.close')}
              onClick={() => setShareNotice(null)}
              className="p-1 text-[#6B6A65] hover:text-[#141413] cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Non-intrusive bottom toast with Framer Motion slide-in & fade */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast}
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.96 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="fixed bottom-20 sm:bottom-18 right-4 sm:right-5 left-4 sm:left-auto z-60 rounded-md bg-[#141413] px-4 py-2.5 text-xs font-medium text-white shadow-lg text-center sm:text-left"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </Suspense>
  );
}
