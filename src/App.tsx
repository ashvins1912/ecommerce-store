import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  GitCompare,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type {
  AuthSessionResponse,
  CartItem,
  CategoryControl,
  Coupon,
  OccasionType,
  Product,
  ProductCategory,
  ProductListResponse,
  ProductVariant,
  SeasonType,
  SortOption,
  StorefrontCampaign,
  User,
} from './shared/types';
import { apiFetch, clearClientSessionTokens, setClientSessionTokens } from './lib/api';
import { useI18n } from './lib/i18n';
import { TopBar, type ActivePage } from './components/TopBar';
import { ProductCard } from './components/ProductCard';
import { ProductCardSkeleton } from './components/ProductCardSkeleton';
import { ProductDetailModal } from './components/ProductDetailModal';
import { CartDrawer } from './components/CartDrawer';
import { AuthModal } from './components/AuthModal';
import { RootInviteAcceptance } from './components/RootInviteAcceptance';
import { OrdersView } from './components/OrdersView';
import { SellerHubView } from './components/SellerHubView';
import { WishlistView } from './components/WishlistView';
import { AccountSignUpView } from './components/CustomerSignUpView';
import { JewelleryCompareModal } from './components/JewelleryCompareModal';
import { RecentlyViewedCarousel } from './components/RecentlyViewedCarousel';
import { FlashSaleSection } from './components/FlashSaleSection';
import ProviderPortal from '../apps/provider-portal/src/ProviderPortal';

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
  const { t, tc, to, tseason, tsort } = useI18n();
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
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [shareNotice, setShareNotice] = useState<{
    title: string;
    waLink: string;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const heroRef = useRef<HTMLElement | null>(null);
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
    await apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
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
        const { getSupabaseBrowserClient } = await import('./lib/supabase');
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
      const [catRes, cmpRes, cpnRes] = await Promise.all([
        apiFetch<{ categories: CategoryControl[] }>('/api/categories'),
        apiFetch<{ campaigns: StorefrontCampaign[] }>('/api/campaigns'),
        apiFetch<{ coupons: Coupon[] }>('/api/coupons/applicable'),
      ]);
      const enabledCats = catRes.categories || [];
      setStoreCategories(enabledCats);
      setCampaigns(cmpRes.campaigns || []);
      setApplicableCoupons(cpnRes.coupons || []);

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

  const navigateToStore = useCallback((cat?: ProductCategory | 'All') => {
    setActivePage('store');
    if (cat) {
      setCategory(cat);
      setPage(1);
    }
  }, []);

  const compareIds = new Set(compareItems.map((i) => i._id));
  const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0);
  if (user?.role === 'PROVIDER' || window.location.pathname.startsWith('/provider')) return <ProviderPortal />;
  const isSellerWorkspace = user?.role === 'SELLER' || user?.role === 'ADMIN';
  const isSellerDashboard = isSellerWorkspace && activePage === 'seller';

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF9F6] text-[#141413] overflow-x-clip">
      {!isSellerDashboard && <TopBar
        activePage={activePage}
        activeCategory={category}
        onNavigateStore={navigateToStore}
        onNavigateWishlist={() => setActivePage('wishlist')}
        onNavigateOrders={() => setActivePage('orders')}
        wishlistCount={likedIds.size}
        cartCount={cartCount}
        onOpenCart={() => setCartOpen(true)}
        user={user}
        onOpenAuth={() => {
          setAuthInitialMode('signin');
          setAuthOpen(true);
        }}
      />}

      {activePage === 'signup' && (
        <div className="flex-1">
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
        </div>
      )}

      {activePage === 'wishlist' && (
        <div className="flex-1">
          <WishlistView
            likedIds={likedIds}
            onRemoveFromWishlist={handleToggleLike}
            onAddToCart={handleAddToCart}
            onSelectProduct={handleSelectProduct}
            compareIds={compareIds}
            onToggleCompare={handleToggleCompare}
            onBrowseCatalog={() => navigateToStore()}
          />
        </div>
      )}

      {activePage === 'orders' && (
        <div className="flex-1">
          <OrdersView user={user} onOpenAuth={() => {
            setAuthInitialMode('signin');
            setAuthOpen(true);
          }} />
        </div>
      )}

      {activePage === 'seller' && (
        <div className="flex-1">
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
          />
        </div>
      )}

      {activePage === 'store' && (
        <main className="flex-1">
          {/* Storefront Campaign Hero */}
          <section ref={heroRef} className="border-b border-[#E8E6E1] bg-white">
            <div className="mx-auto max-w-[1360px] grid grid-cols-1 lg:grid-cols-12 items-stretch">
              <div className="lg:col-span-5 flex flex-col justify-center px-4 py-8 sm:px-10 sm:py-10 lg:py-14 space-y-4 sm:space-y-5">
                <div className="text-xs font-medium tracking-wide text-[#881337]">
                  {t('hero.kicker')}
                </div>
                <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-semibold leading-[1.08] text-[#141413] text-balance">
                  {t('hero.title')}
                </h1>
                <p className="text-sm leading-relaxed text-[#57534E] max-w-md">
                  {t('hero.subtitle')}
                </p>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setOccasion('Festive');
                      setPage(1);
                      catalogRef.current?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="rounded-md bg-[#881337] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#9F1239] transition-colors whitespace-nowrap cursor-pointer"
                  >
                    {t('hero.ctaPrimary')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSort('special_offers');
                      setPage(1);
                      catalogRef.current?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="rounded-md border border-[#D6D3CD] bg-white px-5 py-2.5 text-xs font-medium text-[#141413] hover:border-[#141413] transition-colors whitespace-nowrap cursor-pointer"
                  >
                    {t('hero.ctaSecondary')}
                  </button>
                </div>
              </div>

              <div className="lg:col-span-7 relative min-h-[220px] sm:min-h-[340px] lg:min-h-[360px] bg-[#F2EFE9]">
                <img
                  src={HERO_IMG}
                  alt={t('hero.imageAlt')}
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
          </section>

          {/* Seasonal Flash Sales Countdown Section */}
          <FlashSaleSection
            campaigns={campaigns}
            activeCampaignId={selectedCampaignId}
            onSelectCampaign={(campaign) => {
              setSelectedCampaignId((prev) => (prev === campaign._id ? null : campaign._id));
              setPage(1);
              catalogRef.current?.scrollIntoView({ behavior: 'smooth' });
            }}
            onSelectSeason={(ssn) => {
              setSeason(ssn);
              setSelectedCampaignId(null);
              setPage(1);
              catalogRef.current?.scrollIntoView({ behavior: 'smooth' });
            }}
            onOpenProduct={handleSelectProduct}
          />

          {/* Hybrid Search, Occasion & Season Segmented Filters & Strict 20-Item Catalog */}
          <section
            ref={catalogRef}
            className="mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-8 py-10 space-y-6"
          >
            {/* Search + Sort Bar */}
            <div className="space-y-2.5">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="relative flex-1 max-w-xl">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#78716C]" />
                  <input
                    type="search"
                    value={searchInput}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 180)}
                    onChange={(e) => {
                      setSearchInput(e.target.value);
                      setShowSuggestions(true);
                    }}
                    placeholder={t('search.placeholder')}
                    className="w-full min-h-[44px] rounded-md border border-[#D6D3CD] bg-white py-2.5 pl-10 pr-12 text-sm text-[#141413] placeholder:text-[#A8A29E] focus:border-[#881337] focus:outline-none"
                  />
                  {searchInput && (
                    <button
                      type="button"
                      aria-label={t('search.clear')}
                      onClick={() => {
                        setSearchInput('');
                        setDebouncedQuery('');
                        setSuggestions([]);
                      }}
                      className="absolute right-0 top-1/2 -translate-y-1/2 flex min-h-[44px] min-w-[44px] items-center justify-center text-[#78716C] hover:text-[#141413] cursor-pointer"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}

                  {showSuggestions && suggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border border-[#E8E6E1] bg-white py-1 shadow-lg">
                      {suggestions.map((sug) => (
                        <button
                          key={sug}
                          type="button"
                          onMouseDown={() => {
                            setSearchInput(sug);
                            setDebouncedQuery(sug);
                            setShowSuggestions(false);
                          }}
                          className="flex w-full min-h-[44px] items-center gap-2 px-4 py-2.5 text-left text-xs text-[#141413] hover:bg-[#FAF9F6] cursor-pointer"
                        >
                          <Search className="h-3.5 w-3.5 text-[#881337]" />
                          <span>{sug}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Sort & Attribute Filter Toggle */}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setShowMoreFilters((v) => !v)}
                    className={`inline-flex min-h-[44px] min-w-[44px] items-center gap-1.5 rounded-md border px-4 py-2.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      showMoreFilters ||
                      minPrice ||
                      maxPrice ||
                      minDiscount ||
                      inStockOnly ||
                      colorFilter
                        ? 'border-[#881337] bg-[#881337]/5 text-[#881337]'
                        : 'border-[#D6D3CD] bg-white text-[#141413]'
                    }`}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    <span>{t('filter.priceColor')}</span>
                  </button>

                  <select
                    aria-label={t('filter.sortPrefix')}
                    value={sort}
                    onChange={(e) => {
                      setSort(e.target.value as SortOption);
                      setPage(1);
                    }}
                    className="min-h-[44px] rounded-md border border-[#D6D3CD] bg-white px-3.5 py-2.5 text-xs font-medium text-[#141413] focus:border-[#881337] focus:outline-none cursor-pointer"
                  >
                    {SORT_OPTION_VALUES.map((val) => (
                      <option key={val} value={val}>
                        {t('filter.sortPrefix')}: {tsort(val)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Flexible Search Hints & Quick Chips */}
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#6B6A65]">
                <span>{t('search.quickLabel')}</span>
                {QUICK_SEARCH_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => {
                      setSearchInput(chip);
                      setDebouncedQuery(chip);
                      setPage(1);
                    }}
                    className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded border px-3.5 py-2 transition-colors cursor-pointer ${
                      searchInput.toLowerCase() === chip.toLowerCase()
                        ? 'border-[#881337] bg-[#881337]/5 text-[#881337] font-medium'
                        : 'border-[#E8E6E1] bg-white text-[#57534E] hover:border-[#141413]'
                    }`}
                  >
                    {chip}
                  </button>
                ))}
                <span className="hidden sm:inline text-[#A8A29E]">· {t('search.flexibleHint')}</span>
              </div>

              {catalog.didYouMean && (
                <div className="text-xs text-[#57534E]">
                  <button
                    type="button"
                    onClick={() => {
                      setSearchInput(catalog.didYouMean!);
                      setDebouncedQuery(catalog.didYouMean!);
                      setPage(1);
                    }}
                    className="inline-flex min-h-[44px] items-center px-2 font-semibold text-[#881337] hover:underline cursor-pointer"
                  >
                    {t('search.didYouMean', { term: catalog.didYouMean })}
                  </button>
                </div>
              )}

              {selectedCampaignId && (
                <div className="flex items-center justify-between gap-2 rounded-md border border-[#881337]/25 bg-[#881337]/5 px-3.5 py-1.5 text-xs">
                  <span className="font-semibold text-[#881337]">
                    {t('flash.filteringCampaign', {
                      name:
                        campaigns.find((c) => c._id === selectedCampaignId)?.name ||
                        selectedCampaignId,
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCampaignId(null);
                      setPage(1);
                    }}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center px-3 font-medium text-[#141413] hover:underline cursor-pointer"
                  >
                    {t('flash.clearCampaign')}
                  </button>
                </div>
              )}
            </div>

            {/* Expandable Price / Discount / Color / Stock Filter Bar */}
            {showMoreFilters && (
              <div className="grid grid-cols-1 sm:flex sm:flex-wrap items-end gap-3 sm:gap-4 rounded-lg border border-[#E8E6E1] bg-white p-4 text-xs">
                <div className="w-full sm:w-auto">
                  <label className="block font-medium text-[#44403C] mb-1">
                    {t('search.minPrice')}
                  </label>
                  <input
                    type="number"
                    placeholder="500"
                    value={minPrice}
                    onChange={(e) => {
                      setMinPrice(e.target.value);
                      setPage(1);
                    }}
                    className="w-full sm:w-28 min-h-[44px] rounded border border-[#D6D3CD] px-3 py-2 text-xs tabular-nums"
                  />
                </div>
                <div className="w-full sm:w-auto">
                  <label className="block font-medium text-[#44403C] mb-1">
                    {t('filter.maxPrice')}
                  </label>
                  <input
                    type="number"
                    placeholder="3000"
                    value={maxPrice}
                    onChange={(e) => {
                      setMaxPrice(e.target.value);
                      setPage(1);
                    }}
                    className="w-full sm:w-28 min-h-[44px] rounded border border-[#D6D3CD] px-3 py-2 text-xs tabular-nums"
                  />
                </div>
                <div className="w-full sm:w-auto">
                  <label className="block font-medium text-[#44403C] mb-1">
                    {t('search.minDiscount')}
                  </label>
                  <select
                    value={minDiscount}
                    onChange={(e) => {
                      setMinDiscount(e.target.value);
                      setPage(1);
                    }}
                    className="w-full sm:w-auto min-h-[44px] rounded border border-[#D6D3CD] bg-white px-3 py-2 text-xs"
                  >
                    <option value="">{t('search.anyDiscount')}</option>
                    <option value="10">10%+</option>
                    <option value="15">15%+</option>
                    <option value="25">25%+</option>
                  </select>
                </div>
                <div className="w-full sm:w-auto">
                  <label className="block font-medium text-[#44403C] mb-1">
                    {t('filter.finishColor')}
                  </label>
                  <input
                    type="text"
                    placeholder={t('filter.colorPlaceholder')}
                    value={colorFilter}
                    onChange={(e) => {
                      setColorFilter(e.target.value);
                      setPage(1);
                    }}
                    className="w-full sm:w-36 min-h-[44px] rounded border border-[#D6D3CD] px-3 py-2 text-xs"
                  />
                </div>
                <label className="inline-flex min-h-[44px] items-center gap-2 px-1 py-2 text-xs font-medium text-[#44403C] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={inStockOnly}
                    onChange={(e) => {
                      setInStockOnly(e.target.checked);
                      setPage(1);
                    }}
                    className="h-4 w-4"
                  />
                  <span>{t('search.inStockOnly')}</span>
                </label>
                {(minPrice ||
                  maxPrice ||
                  minDiscount ||
                  inStockOnly ||
                  colorFilter ||
                  category !== 'All' ||
                  occasion !== 'All' ||
                  season !== 'All' ||
                  selectedCampaignId) && (
                  <button
                    type="button"
                    onClick={() => {
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
                    className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center rounded border border-[#D6D3CD] px-4 py-2 text-xs font-medium text-[#881337] hover:bg-[#FAF9F6] cursor-pointer"
                  >
                    {t('filter.reset')}
                  </button>
                )}
              </div>
            )}

            {/* Dynamic Category + Occasion + Season Segmented Filter Tabs */}
            <div className="space-y-3 border-b border-[#E8E6E1] pb-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-[#F0EEE9] p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setCategory('All');
                      setPage(1);
                    }}
                    className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      category === 'All'
                        ? 'bg-white text-[#141413] shadow-xs'
                        : 'text-[#57534E] hover:text-[#141413]'
                    }`}
                  >
                    {t('filter.allCategories')}
                  </button>
                  {(storeCategories.length > 0
                    ? storeCategories.map((c) => c.name)
                    : ['Artificial Jewellery', 'Clothing', 'Accessories']
                  ).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => {
                        setCategory(cat);
                        setPage(1);
                      }}
                      className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        category === cat
                          ? 'bg-white text-[#141413] shadow-xs'
                          : 'text-[#57534E] hover:text-[#141413]'
                      }`}
                    >
                      {tc(cat)}
                    </button>
                  ))}
                </div>

                <div className="text-xs text-[#6B6A65] tabular-nums">
                  {t('catalog.showing', {
                    shown: catalog.products.length,
                    total: catalog.total,
                    page: catalog.page,
                    totalPages: catalog.totalPages,
                  })}
                </div>
              </div>

              <section className="rounded-xl border border-[#E8E6E1] bg-white px-3 py-2.5 sm:px-4" aria-label="Quick filters">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="h-3.5 w-3.5 text-[#881337]" />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#78716C]">Quick filters</span>
                    <span className="hidden text-[10px] text-[#A8A29E] sm:inline">Refine your edit</span>
                  </div>
                  <button type="button" onClick={() => { setCategory('All'); setOccasion('All'); setSeason('All'); setPage(1); }} className="text-[11px] font-medium text-[#881337] hover:underline">Clear all</button>
                </div>
                <div className="flex flex-col gap-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <label className="w-[66px] shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[#78716C]">Category</label>
                    <select aria-label="Category quick filter" value={category} onChange={(e) => { setCategory(e.target.value as ProductCategory | 'All'); setPage(1); }} className="h-8 min-w-0 flex-1 rounded-lg border border-[#E7E5E4] bg-[#FAF9F6] px-2.5 text-xs font-medium text-[#292524] focus:border-[#881337] focus:outline-none sm:max-w-[280px]">
                      <option value="All">{t('filter.allCategories')}</option>
                      {(storeCategories.length > 0 ? storeCategories.map((c) => c.name) : ['Artificial Jewellery', 'Clothing', 'Accessories']).map((catName) => <option key={catName} value={catName}>{tc(catName)}</option>)}
                    </select>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="w-[66px] shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[#78716C]">Occasion</span>
                      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-0.5">
                        {OCCASIONS.map((occ) => <button key={occ} type="button" onClick={() => { setOccasion(occ); setPage(1); }} aria-pressed={occasion===occ} className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ${occasion===occ?'border-[#881337] bg-[#881337] text-white':'border-[#E7E5E4] bg-[#FAF9F6] text-[#57534E] hover:border-[#A8A29E]'}`}>{occ === 'All' ? t('filter.allOccasions') : to(occ)}</button>)}
                      </div>
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="w-[66px] shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[#78716C]">Season</span>
                      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-0.5">
                        {SEASONS.map((ssn) => <button key={ssn} type="button" onClick={() => { setSeason(ssn); setPage(1); }} aria-pressed={season===ssn} className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ${season===ssn?'border-[#881337] bg-[#881337] text-white':'border-[#E7E5E4] bg-[#FAF9F6] text-[#57534E] hover:border-[#A8A29E]'}`}>{ssn === 'All' ? t('season.all') : tseason(ssn)}</button>)}
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </div>

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
                    setSearchInput('');
                    setDebouncedQuery('');
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
                  className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-[#881337] px-5 py-2.5 text-xs font-semibold text-white cursor-pointer"
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
          <RecentlyViewedCarousel
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
          />
        </main>
      )}

      {/* Quiet Editorial Footer */}
      {!isSellerDashboard && <footer className="border-t border-[#E8E6E1] bg-white">
        <div className="mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#6B6A65]">
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
      <ProductDetailModal
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
        onToggleCompare={handleToggleCompare}
        categoryTop10Thresholds={catalog.categoryTop10Thresholds}
        onProductLoaded={handleProductLoaded}
        onApplyCoupon={(code) => {
          setPendingCouponCode(code);
          setSelectedProductKey(null);
          setActiveProductMeta(null);
          setCartOpen(true);
        }}
      />

      <JewelleryCompareModal
        isOpen={compareOpen}
        onClose={() => setCompareOpen(false)}
        items={compareItems}
        onRemoveItem={(id) =>
          setCompareItems((prev) => prev.filter((item) => item._id !== id))
        }
        onClearAll={() => {
          setCompareItems([]);
          setCompareOpen(false);
        }}
        onAddToCart={handleAddToCart}
        onSelectProduct={handleSelectProduct}
      />

      <CartDrawer
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
      />

      <AuthModal
        isOpen={authOpen}
        onClose={() => setAuthOpen(false)}
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
      />

      <RootInviteAcceptance
        user={user}
        onRequireAuth={() => { setAuthInitialMode('signin'); setAuthOpen(true); }}
        onAccepted={(acceptedUser) => { setUser(acceptedUser); setActivePage(acceptedUser.role === 'SELLER' || acceptedUser.role === 'ADMIN' ? 'seller' : 'store'); }}
      />

      {/* Floating Artificial Jewellery Comparison Bar */}
      {compareItems.length > 0 && !compareOpen && (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 flex items-center gap-3 rounded-lg border border-[#141413] bg-[#141413] px-4 py-2.5 text-xs text-white shadow-xl max-w-[92vw]">
          <span className="font-medium whitespace-nowrap tabular-nums">
            {t('compare.barLabel', { count: compareItems.length })}
          </span>
          <button
            type="button"
            onClick={() => setCompareOpen(true)}
            className="inline-flex items-center gap-1.5 rounded bg-white px-3 py-1.5 font-semibold text-[#141413] hover:bg-[#FAF9F6] whitespace-nowrap cursor-pointer"
          >
            <GitCompare className="h-3.5 w-3.5" />
            <span>{t('compare.cta')}</span>
          </button>
          <button
            type="button"
            onClick={() => setCompareItems([])}
            aria-label={t('compare.clear')}
            className="p-1 text-white/75 hover:text-white cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
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
  );
}
