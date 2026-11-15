import { useCallback, useEffect, useRef, useState } from 'react';
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
  OccasionType,
  Product,
  ProductCategory,
  ProductListResponse,
  ProductVariant,
  SortOption,
  User,
} from './shared/types';
import { apiFetch } from './lib/api';
import { useI18n } from './lib/i18n';
import { TopBar, type ActivePage } from './components/TopBar';
import { ProductCard } from './components/ProductCard';
import { ProductDetailModal } from './components/ProductDetailModal';
import { CartDrawer } from './components/CartDrawer';
import { AuthModal } from './components/AuthModal';
import { OrdersView } from './components/OrdersView';
import { SellerHubView } from './components/SellerHubView';
import { WishlistView } from './components/WishlistView';
import { JewelleryCompareModal } from './components/JewelleryCompareModal';
import { RecentlyViewedCarousel } from './components/RecentlyViewedCarousel';

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

export default function App() {
  const { t, tc, to, tsort } = useI18n();
  const [activePage, setActivePage] = useState<ActivePage>('store');
  const [user, setUser] = useState<User | null>(null);
  const [oauthConfigured, setOauthConfigured] = useState({ google: false, meta: false });
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [cart, setCart] = useState<CartItem[]>([]);
  const [sellerInviteToken, setSellerInviteToken] = useState<string | null>(null);

  // Storefront search, filters & strict limit(20) pagination
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [category, setCategory] = useState<ProductCategory | 'All'>('All');
  const [occasion, setOccasion] = useState<OccasionType | 'All'>('All');
  const [sort, setSort] = useState<SortOption>('most_demanding');
  const [maxPrice, setMaxPrice] = useState<string>('');
  const [colorFilter, setColorFilter] = useState<string>('');
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [page, setPage] = useState(1);

  const [catalog, setCatalog] = useState<ProductListResponse>({
    products: [],
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 1,
    categoryTop10Thresholds: {},
  });
  const [catalogLoading, setCatalogLoading] = useState(true);

  // Recently Viewed (last 5 clicked products persisted in sessionStorage)
  const [recentlyViewed, setRecentlyViewed] = useState<Product[]>(readSessionRecentlyViewed);

  // Overlays & Modals
  const [selectedProductKey, setSelectedProductKey] = useState<string | null>(null);
  const [selectedInitialVariantSku, setSelectedInitialVariantSku] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
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

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 2600);
  }, []);

  const recordRecentlyViewed = useCallback((product: Product) => {
    setRecentlyViewed((prev) => {
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

  // Support shared WhatsApp product deep-links (?product=...), Admin invite links (?sellerInvite=...), and hero scroll tracking
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedProd = params.get('product');
    if (sharedProd) {
      setSelectedProductKey(sharedProd);
    }
    const inviteParam = params.get('sellerInvite');
    if (inviteParam) {
      setSellerInviteToken(inviteParam);
      setActivePage('seller');
    }

    const onScroll = () => {
      const threshold = heroRef.current ? heroRef.current.offsetHeight + 40 : 420;
      setShowScrollTop(window.scrollY > threshold);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Load initial auth/guest session + merge localStorage cart if server cart empty
  useEffect(() => {
    (async () => {
      try {
        const session = await apiFetch<AuthSessionResponse>('/api/auth/me');
        setUser(session.user);
        setOauthConfigured(session.oauthConfigured);
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

  const fetchCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const params = new URLSearchParams({
        category,
        occasion,
        sort,
        page: String(page),
      });
      if (debouncedQuery) params.set('q', debouncedQuery);
      if (maxPrice) params.set('maxPrice', maxPrice);
      if (colorFilter.trim()) params.set('color', colorFilter.trim());

      const data = await apiFetch<ProductListResponse>(`/api/products?${params}`);
      setCatalog(data);
    } finally {
      setCatalogLoading(false);
    }
  }, [category, occasion, sort, page, debouncedQuery, maxPrice, colorFilter]);

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
      setSelectedProductKey(product._id);
    },
    [recordRecentlyViewed]
  );

  const handleQuickBuy = useCallback(
    (product: Product) => {
      recordRecentlyViewed(product);
      setSelectedInitialVariantSku(product.variants[0]?.variantSku || null);
      setSelectedProductKey(product._id);
    },
    [recordRecentlyViewed]
  );

  const handleShareWhatsApp = useCallback(
    (payload: { product: Product; waLink: string; messagePreview: string }) => {
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
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  const compareIds = new Set(compareItems.map((i) => i._id));
  const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF9F6] text-[#141413] overflow-x-clip">
      <TopBar
        activePage={activePage}
        activeCategory={category}
        onNavigateStore={(cat) => {
          setActivePage('store');
          if (cat) {
            setCategory(cat);
            setPage(1);
          }
        }}
        onNavigateWishlist={() => setActivePage('wishlist')}
        onNavigateOrders={() => setActivePage('orders')}
        onNavigateSeller={() => setActivePage('seller')}
        wishlistCount={likedIds.size}
        cartCount={cartCount}
        onOpenCart={() => setCartOpen(true)}
        user={user}
        onOpenAuth={() => setAuthOpen(true)}
      />

      {activePage === 'wishlist' && (
        <div className="flex-1">
          <WishlistView
            likedIds={likedIds}
            onRemoveFromWishlist={handleToggleLike}
            onAddToCart={handleAddToCart}
            onSelectProduct={handleSelectProduct}
            compareIds={compareIds}
            onToggleCompare={handleToggleCompare}
            onBrowseCatalog={() => setActivePage('store')}
          />
        </div>
      )}

      {activePage === 'orders' && (
        <div className="flex-1">
          <OrdersView user={user} onOpenAuth={() => setAuthOpen(true)} />
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
            onOpenAuth={() => setAuthOpen(true)}
            onCatalogMutated={fetchCatalog}
            inviteToken={sellerInviteToken}
            onInviteConsumed={handleInviteConsumed}
            onReturnToStore={() => setActivePage('store')}
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

          {/* Hybrid Search, Occasion Segmented Filters & Strict 20-Item Catalog */}
          <section
            ref={catalogRef}
            className="mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-8 py-10 space-y-6"
          >
            {/* Search + Sort Bar */}
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
                  className="w-full rounded-md border border-[#D6D3CD] bg-white py-2.5 pl-10 pr-9 text-sm text-[#141413] placeholder:text-[#A8A29E] focus:border-[#881337] focus:outline-none"
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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#78716C] hover:text-[#141413] cursor-pointer"
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
                        className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-[#141413] hover:bg-[#FAF9F6] cursor-pointer"
                      >
                        <Search className="h-3 w-3 text-[#881337]" />
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
                  className={`inline-flex items-center gap-1.5 rounded-md border px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    showMoreFilters || maxPrice || colorFilter
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
                  className="rounded-md border border-[#D6D3CD] bg-white px-3.5 py-2 text-xs font-medium text-[#141413] focus:border-[#881337] focus:outline-none cursor-pointer"
                >
                  {SORT_OPTION_VALUES.map((val) => (
                    <option key={val} value={val}>
                      {t('filter.sortPrefix')}: {tsort(val)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Expandable Price / Color Filter Bar */}
            {showMoreFilters && (
              <div className="grid grid-cols-1 sm:flex sm:flex-wrap items-end gap-3 sm:gap-4 rounded-lg border border-[#E8E6E1] bg-white p-4 text-xs">
                <div className="w-full sm:w-auto">
                  <label className="block font-medium text-[#44403C] mb-1">
                    {t('filter.category')}
                  </label>
                  <select
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value as ProductCategory | 'All');
                      setPage(1);
                    }}
                    className="w-full sm:w-auto rounded border border-[#D6D3CD] bg-white px-3 py-2 sm:py-1.5 text-xs"
                  >
                    <option value="All">{t('filter.allCategories')}</option>
                    <option value="Artificial Jewellery">{tc('Artificial Jewellery')}</option>
                    <option value="Clothing">{tc('Clothing')}</option>
                    <option value="Accessories">{tc('Accessories')}</option>
                  </select>
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
                    className="w-full sm:w-32 rounded border border-[#D6D3CD] px-3 py-2 sm:py-1.5 text-xs tabular-nums"
                  />
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
                    className="w-full sm:w-40 rounded border border-[#D6D3CD] px-3 py-2 sm:py-1.5 text-xs"
                  />
                </div>
                {(maxPrice || colorFilter || category !== 'All' || occasion !== 'All') && (
                  <button
                    type="button"
                    onClick={() => {
                      setCategory('All');
                      setOccasion('All');
                      setMaxPrice('');
                      setColorFilter('');
                      setPage(1);
                    }}
                    className="w-full sm:w-auto rounded border border-[#D6D3CD] px-3 py-2 sm:py-1.5 text-xs font-medium text-[#881337] hover:bg-[#FAF9F6] cursor-pointer"
                  >
                    {t('filter.reset')}
                  </button>
                )}
              </div>
            )}

            {/* Category & Interactive Occasion Segmented Filter Tabs */}
            <div className="space-y-3 border-b border-[#E8E6E1] pb-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-[#F0EEE9] p-1">
                  {(['All', 'Artificial Jewellery', 'Clothing', 'Accessories'] as const).map(
                    (cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => {
                          setCategory(cat);
                          setPage(1);
                        }}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          category === cat
                            ? 'bg-white text-[#141413] shadow-xs'
                            : 'text-[#57534E] hover:text-[#141413]'
                        }`}
                      >
                        {cat === 'All' ? t('filter.allCategories') : tc(cat)}
                      </button>
                    )
                  )}
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

              <div className="flex items-center gap-1 overflow-x-auto rounded-lg bg-[#F0EEE9] p-1 w-fit max-w-full">
                {OCCASIONS.map((occ) => (
                  <button
                    key={occ}
                    type="button"
                    onClick={() => {
                      setOccasion(occ);
                      setPage(1);
                    }}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      occasion === occ
                        ? 'bg-white text-[#141413] shadow-xs'
                        : 'text-[#57534E] hover:text-[#141413]'
                    }`}
                  >
                    {occ === 'All' ? t('filter.allOccasions') : to(occ)}
                  </button>
                ))}
              </div>
            </div>

            {/* Product Grid */}
            {catalogLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-80 rounded-lg border border-[#E8E6E1] bg-white animate-pulse"
                  />
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
                    setMaxPrice('');
                    setColorFilter('');
                    setPage(1);
                  }}
                  className="rounded-md bg-[#881337] px-4 py-2 text-xs font-semibold text-white cursor-pointer"
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
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#D6D3CD] bg-white px-4 py-2 text-xs font-medium text-[#141413] hover:border-[#881337] disabled:opacity-40 cursor-pointer"
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
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#D6D3CD] bg-white px-4 py-2 text-xs font-medium text-[#141413] hover:border-[#881337] disabled:opacity-40 cursor-pointer"
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
      <footer className="border-t border-[#E8E6E1] bg-white">
        <div className="mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#6B6A65]">
          <div className="font-display text-lg font-semibold text-[#141413]">{t('brand')}</div>
          <div className="flex flex-wrap items-center gap-6">
            <button
              type="button"
              onClick={() => {
                setActivePage('store');
                setCategory('Artificial Jewellery');
              }}
              className="hover:text-[#141413] cursor-pointer"
            >
              {tc('Artificial Jewellery')}
            </button>
            <button
              type="button"
              onClick={() => {
                setActivePage('store');
                setCategory('Clothing');
              }}
              className="hover:text-[#141413] cursor-pointer"
            >
              {tc('Clothing')}
            </button>
            <button
              type="button"
              onClick={() => {
                setActivePage('store');
                setCategory('Accessories');
              }}
              className="hover:text-[#141413] cursor-pointer"
            >
              {tc('Accessories')}
            </button>
            <button
              type="button"
              onClick={() => setActivePage('orders')}
              className="hover:text-[#141413] cursor-pointer"
            >
              {t('footer.orderHistory')}
            </button>
            <button
              type="button"
              onClick={() => setActivePage('seller')}
              className="hover:text-[#141413] cursor-pointer"
            >
              {t('nav.sellerHub')}
            </button>
          </div>
          <div>© 2026 {t('brand')}</div>
        </div>
      </footer>

      {/* Overlays */}
      <ProductDetailModal
        productIdOrSlug={selectedProductKey}
        initialVariantSku={selectedInitialVariantSku}
        onClose={() => {
          setSelectedProductKey(null);
          setSelectedInitialVariantSku(null);
        }}
        user={user}
        likedProductIds={likedIds}
        onToggleLike={handleToggleLike}
        onAddToCart={handleAddToCart}
        onSelectProduct={handleSelectProduct}
        onQuickBuy={handleQuickBuy}
        onShareWhatsApp={handleShareWhatsApp}
        onOpenAuth={() => setAuthOpen(true)}
        compareIds={compareIds}
        onToggleCompare={handleToggleCompare}
        categoryTop10Thresholds={catalog.categoryTop10Thresholds}
        onProductLoaded={recordRecentlyViewed}
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
        }}
        onRequireAuth={() => {
          setCartOpen(false);
          setAuthOpen(true);
        }}
      />

      <AuthModal
        isOpen={authOpen}
        onClose={() => setAuthOpen(false)}
        user={user}
        oauthConfigured={oauthConfigured}
        onAuthChanged={(payload) => {
          setUser(payload.user);
          if (payload.likedProductIds) setLikedIds(new Set(payload.likedProductIds));
          if (payload.cart) {
            setCart(payload.cart);
            localStorage.setItem('kk_guest_cart', JSON.stringify(payload.cart));
          }
        }}
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
      {shareNotice && (
        <div className="fixed bottom-4 left-4 right-4 sm:bottom-5 sm:left-5 sm:right-auto z-60 flex items-center justify-between gap-3 rounded-lg border border-[#E8E6E1] bg-white px-4 py-3 text-xs text-[#141413] shadow-xl sm:max-w-[420px]">
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
        </div>
      )}

      {/* Non-intrusive bottom toast */}
      {toast && (
        <div className="fixed bottom-20 sm:bottom-18 right-4 sm:right-5 left-4 sm:left-auto z-60 rounded-md bg-[#141413] px-4 py-2.5 text-xs font-medium text-white shadow-lg text-center sm:text-left">
          {toast}
        </div>
      )}
    </div>
  );
}
