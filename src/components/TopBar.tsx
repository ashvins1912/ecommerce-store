import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  Compass,
  Gem,
  Globe,
  Heart,
  LayoutGrid,
  Menu,
  PackageCheck,
  Shirt,
  ShoppingBag,
  Sparkles,
  Store,
  Tag,
  User as UserIcon,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ProductCategory, User } from '../shared/types';
import { useI18n, type Language } from '../lib/i18n';

export type ActivePage = 'store' | 'wishlist' | 'orders' | 'seller' | 'signup';

interface TopBarProps {
  activePage: ActivePage;
  activeCategory: ProductCategory | 'All';
  categories?: ProductCategory[];
  onNavigateStore: (category?: ProductCategory | 'All') => void;
  onNavigateWishlist: () => void;
  onNavigateOrders: () => void;
  onNavigateSeller?: () => void;
  wishlistCount: number;
  cartCount: number;
  onOpenCart: () => void;
  user: User | null;
  onOpenAuth: () => void;
  onStartTour?: () => void;
}

function getCategoryIcon(categoryName: string) {
  const normalized = categoryName.toLowerCase();
  if (normalized.includes('jewel')) return Gem;
  if (normalized.includes('cloth') || normalized.includes('apparel') || normalized.includes('kurta'))
    return Shirt;
  if (normalized.includes('accessor') || normalized.includes('potli') || normalized.includes('bag'))
    return Sparkles;
  return Tag;
}

export function TopBar({
  activePage,
  activeCategory,
  categories,
  onNavigateStore,
  onNavigateWishlist,
  onNavigateOrders,
  onNavigateSeller,
  wishlistCount,
  cartCount,
  onOpenCart,
  user,
  onOpenAuth,
  onStartTour,
}: TopBarProps) {
  const { lang, setLang, t, tc } = useI18n();
  const { t: i18nT } = useTranslation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerPanelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const categoryList =
    categories && categories.length > 0
      ? categories
      : ['Artificial Jewellery', 'Clothing', 'Accessories'];

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileMenuOpen(false);
        window.requestAnimationFrame(() => menuButtonRef.current?.focus());
        return;
      }

      if (event.key === 'Tab' && drawerPanelRef.current) {
        const focusable = Array.from(
          drawerPanelRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], select:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    const onResize = () => {
      if (window.innerWidth >= 768) {
        setMobileMenuOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize, { passive: true });
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    };
  }, [mobileMenuOpen]);

  const closeDrawer = () => {
    setMobileMenuOpen(false);
    window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  };

  const roleLabel = user
    ? user.role === 'ADMIN'
      ? t('auth.roleAdmin')
      : user.role === 'SELLER'
      ? t('auth.roleSeller')
      : t('auth.roleBuyer')
    : null;

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-[#E8E6E1] bg-[#FAF9F6]/95 backdrop-blur-sm">
        <div className="mx-auto flex min-h-[60px] sm:h-16 max-w-7xl items-center justify-between gap-2 sm:gap-4 px-3 sm:px-6 lg:px-8">
          {/* Left: Hamburger (< 768px) + Brand Wordmark */}
          <div className="flex items-center gap-2 min-w-0">
            <button
              ref={menuButtonRef}
              type="button"
              aria-label={i18nT('a11y.open_menu')}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-nav-drawer"
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-[#E8E6E1] bg-white text-[#141413] hover:border-[#881337] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#881337] shrink-0 cursor-pointer"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => onNavigateStore('All')}
              className="font-display text-lg sm:text-2xl font-semibold tracking-tight text-[#141413] whitespace-nowrap truncate min-h-[44px] inline-flex items-center cursor-pointer"
            >
              {t('brand')}
            </button>
          </div>

          {/* Center: Desktop navigation links (md+) */}
          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-5 lg:gap-7 text-sm font-medium text-[#57534E]"
          >
            <button
              type="button"
              onClick={() => onNavigateStore('All')}
              className={`whitespace-nowrap shrink-0 min-h-[44px] inline-flex items-center border-b-2 transition-colors cursor-pointer ${
                activePage === 'store' && activeCategory === 'All'
                  ? 'border-[#881337] text-[#141413]'
                  : 'border-transparent hover:text-[#141413]'
              }`}
            >
              {t('nav.catalog')}
            </button>
            <button
              type="button"
              onClick={() => onNavigateStore('Artificial Jewellery')}
              className={`whitespace-nowrap shrink-0 min-h-[44px] inline-flex items-center border-b-2 transition-colors cursor-pointer ${
                activePage === 'store' && activeCategory === 'Artificial Jewellery'
                  ? 'border-[#881337] text-[#141413]'
                  : 'border-transparent hover:text-[#141413]'
              }`}
            >
              {t('nav.jewellery')}
            </button>
            <button
              type="button"
              onClick={onNavigateWishlist}
              aria-label={`${t('nav.wishlist')} (${wishlistCount})`}
              className={`inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap shrink-0 border-b-2 transition-colors tabular-nums cursor-pointer ${
                activePage === 'wishlist'
                  ? 'border-[#881337] text-[#141413]'
                  : 'border-transparent hover:text-[#141413]'
              }`}
            >
              <span className="relative inline-flex items-center">
                <Heart
                  className={`h-4 w-4 ${
                    wishlistCount > 0 ? 'fill-[#881337] text-[#881337]' : 'text-[#57534E]'
                  }`}
                />
                <span
                  data-testid="wishlist-count-badge"
                  className={`-top-2 -right-2.5 absolute inline-flex min-w-[17px] h-[17px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none tabular-nums ${
                    wishlistCount > 0
                      ? 'bg-[#881337] text-white'
                      : 'bg-[#E8E6E1] text-[#141413]'
                  }`}
                >
                  {wishlistCount}
                </span>
              </span>
              <span>{t('nav.wishlist')}</span>
            </button>
            <button
              type="button"
              onClick={onNavigateOrders}
              className={`whitespace-nowrap shrink-0 min-h-[44px] inline-flex items-center border-b-2 transition-colors cursor-pointer ${
                activePage === 'orders'
                  ? 'border-[#881337] text-[#141413]'
                  : 'border-transparent hover:text-[#141413]'
              }`}
            >
              {t('nav.orders')}
            </button>
            {onNavigateSeller && (user?.role === 'SELLER' || user?.role === 'ADMIN') && (
              <button
                type="button"
                onClick={onNavigateSeller}
                className={`whitespace-nowrap shrink-0 min-h-[44px] inline-flex items-center border-b-2 transition-colors cursor-pointer ${
                  activePage === 'seller'
                    ? 'border-[#881337] text-[#881337]'
                    : 'border-transparent hover:text-[#881337]'
                }`}
              >
                {t('nav.sellerHub')}
              </button>
            )}
          </nav>

          {/* Right Zone: Language + Mobile Wishlist Icon + Account + Bag CTA */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <div className="hidden sm:inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-[#E8E6E1] bg-white px-2.5 text-xs text-[#44403C]">
              <Globe className="h-3.5 w-3.5 text-[#78716C] shrink-0" aria-hidden="true" />
              <select
                aria-label={t('nav.language')}
                value={lang}
                onChange={(e) => setLang(e.target.value as Language)}
                className="bg-transparent text-xs font-medium text-[#141413] focus:outline-none cursor-pointer"
              >
                <option value="en">EN</option>
                <option value="hi">हिन्दी</option>
                <option value="bn">বাংলা</option>
              </select>
            </div>

            <button
              type="button"
              onClick={onNavigateWishlist}
              aria-label={`${t('nav.wishlist')} (${wishlistCount})`}
              className="md:hidden relative inline-flex h-[44px] w-[44px] items-center justify-center rounded-md border border-[#E8E6E1] bg-white text-[#44403C] hover:text-[#881337] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#881337] cursor-pointer"
            >
              <Heart
                className={`h-4 w-4 ${
                  wishlistCount > 0 ? 'fill-[#881337] text-[#881337]' : 'text-[#44403C]'
                }`}
              />
              <span
                className={`top-1 right-1 absolute inline-flex min-w-[16px] h-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none tabular-nums ${
                  wishlistCount > 0
                    ? 'bg-[#881337] text-white'
                    : 'bg-[#E8E6E1] text-[#141413]'
                }`}
              >
                {wishlistCount}
              </span>
            </button>

            <button
              type="button"
              onClick={onOpenAuth}
              aria-label={user ? user.name : t('nav.signIn')}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-md px-2 sm:px-3 text-xs font-medium text-[#44403C] hover:bg-white hover:text-[#141413] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#881337] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <UserIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="hidden xs:inline max-w-[76px] sm:max-w-[140px] truncate">
                {user ? `${user.name.split(' ')[0]} · ${roleLabel}` : t('nav.signIn')}
              </span>
            </button>

            <button
              type="button"
              onClick={onOpenCart}
              aria-label={`${t('nav.bag')} (${cartCount})`}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 sm:gap-2 rounded-md bg-[#881337] px-2.5 sm:px-3.5 text-xs font-medium text-white hover:bg-[#9F1239] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#881337] focus-visible:ring-offset-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ShoppingBag className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="tabular-nums">
                <span className="hidden sm:inline">{t('nav.bag')} </span>({cartCount})
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Fixed Slide-Over Mobile Navigation Drawer (< 768px) rendered OUTSIDE backdrop-blur header */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 z-[70] md:hidden overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label={t('brand')}
            id="mobile-nav-drawer"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-[1px]"
              aria-hidden="true"
              onClick={closeDrawer}
            />
            <motion.div
              ref={drawerPanelRef}
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="fixed inset-y-0 left-0 z-10 flex h-dvh w-80 max-w-[85vw] flex-col bg-[#FAF9F6] border-r border-[#E8E6E1] shadow-2xl overflow-x-hidden"
            >
            {/* 1. Drawer Header */}
            <div className="flex items-center justify-between gap-2 border-b border-[#E8E6E1] bg-white px-4 py-3">
              <div className="min-w-0">
                <div className="font-display text-lg font-semibold text-[#141413] truncate">
                  {t('brand')}
                </div>
                <div className="text-[11px] text-[#78716C] truncate">
                  {t('hero.kicker')}
                </div>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeDrawer}
                aria-label={i18nT('a11y.close_menu')}
                className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-md border border-[#E8E6E1] bg-white text-[#141413] hover:border-[#881337] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#881337] cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {/* 2. Scrollable Drawer Body with Structured UX Sections */}
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {/* Account Card */}
              <div className="rounded-xl border border-[#E8E6E1] bg-white p-3.5 shadow-2xs">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#881337]/10 text-sm font-semibold text-[#881337]">
                    {user ? user.name.slice(0, 1).toUpperCase() : <UserIcon className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[#141413]">
                      {user ? user.name : i18nT('filter_ux.guest_welcome')}
                    </div>
                    <div className="truncate text-[11px] text-[#6B6A65]">
                      {user ? `${user.email} · ${roleLabel}` : i18nT('filter_ux.guest_sub')}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    closeDrawer();
                    onOpenAuth();
                  }}
                  className="mt-3 flex w-full min-h-[44px] items-center justify-center gap-2 rounded-md border border-[#D6D3CD] bg-[#FAF9F6] px-3 text-xs font-semibold text-[#141413] hover:border-[#881337] hover:text-[#881337] cursor-pointer"
                >
                  <UserIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{user ? t('auth.sessionTitle') : t('nav.signIn')}</span>
                </button>
              </div>

              {/* Section: Shop by Category */}
              <div className="space-y-2">
                <div className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6B6A65]">
                  {i18nT('filter_ux.shop_by_category')}
                </div>
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => {
                      onNavigateStore('All');
                      closeDrawer();
                    }}
                    className={`flex w-full min-h-[44px] items-center justify-between gap-2.5 rounded-lg border px-3.5 text-sm font-medium transition-colors cursor-pointer ${
                      activePage === 'store' && activeCategory === 'All'
                        ? 'border-[#881337] bg-[#881337] text-white'
                        : 'border-transparent bg-white text-[#141413] hover:border-[#E8E6E1]'
                    }`}
                  >
                    <span className="inline-flex items-center gap-2.5 min-w-0">
                      <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{t('filter.allCategories')}</span>
                    </span>
                    {activePage === 'store' && activeCategory === 'All' && (
                      <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
                    )}
                  </button>

                  {categoryList.map((cat) => {
                    const Icon = getCategoryIcon(cat);
                    const isActive = activePage === 'store' && activeCategory === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => {
                          onNavigateStore(cat);
                          closeDrawer();
                        }}
                        className={`flex w-full min-h-[44px] items-center justify-between gap-2.5 rounded-lg border px-3.5 text-sm font-medium transition-colors cursor-pointer ${
                          isActive
                            ? 'border-[#881337] bg-[#881337] text-white'
                            : 'border-transparent bg-white text-[#141413] hover:border-[#E8E6E1]'
                        }`}
                      >
                        <span className="inline-flex items-center gap-2.5 min-w-0">
                          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span className="truncate">{tc(cat)}</span>
                        </span>
                        {isActive && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Section: Pages & Activity */}
              <div className="space-y-2">
                <div className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6B6A65]">
                  {i18nT('filter_ux.my_activity')}
                </div>
                <nav aria-label="Mobile account and activity navigation" className="space-y-1">
                  <button
                    type="button"
                    onClick={() => {
                      onNavigateWishlist();
                      closeDrawer();
                    }}
                    className={`flex w-full min-h-[44px] items-center justify-between gap-2.5 rounded-lg border px-3.5 text-sm font-medium transition-colors cursor-pointer ${
                      activePage === 'wishlist'
                        ? 'border-[#881337] bg-[#881337] text-white'
                        : 'border-transparent bg-white text-[#141413] hover:border-[#E8E6E1]'
                    }`}
                  >
                    <span className="inline-flex items-center gap-2.5">
                      <Heart className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{t('nav.wishlist')}</span>
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                        activePage === 'wishlist'
                          ? 'bg-white/20 text-white'
                          : 'bg-[#F5F3EE] text-[#44403C]'
                      }`}
                    >
                      {wishlistCount}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onNavigateOrders();
                      closeDrawer();
                    }}
                    className={`flex w-full min-h-[44px] items-center justify-between gap-2.5 rounded-lg border px-3.5 text-sm font-medium transition-colors cursor-pointer ${
                      activePage === 'orders'
                        ? 'border-[#881337] bg-[#881337] text-white'
                        : 'border-transparent bg-white text-[#141413] hover:border-[#E8E6E1]'
                    }`}
                  >
                    <span className="inline-flex items-center gap-2.5">
                      <PackageCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{t('nav.orders')}</span>
                    </span>
                  </button>

                  {onNavigateSeller && (user?.role === 'SELLER' || user?.role === 'ADMIN') && (
                    <button
                      type="button"
                      onClick={() => {
                        onNavigateSeller();
                        closeDrawer();
                      }}
                      className={`flex w-full min-h-[44px] items-center justify-between gap-2.5 rounded-lg border px-3.5 text-sm font-medium transition-colors cursor-pointer ${
                        activePage === 'seller'
                          ? 'border-[#881337] bg-[#881337] text-white'
                          : 'border-[#881337]/25 bg-[#881337]/5 text-[#881337]'
                      }`}
                    >
                      <span className="inline-flex items-center gap-2.5">
                        <Store className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>{t('nav.sellerHub')}</span>
                      </span>
                    </button>
                  )}
                </nav>
              </div>
            </div>

            {/* 3. Drawer Footer: Segmented Language Switcher & Interactive Tour */}
            <div className="border-t border-[#E8E6E1] bg-white p-4 space-y-3">
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#6B6A65]">
                  <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{t('nav.language')}</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5" role="group" aria-label={t('nav.language')}>
                  {(
                    [
                      { code: 'en', label: 'English' },
                      { code: 'hi', label: 'हिन्दी' },
                      { code: 'bn', label: 'বাংলা' },
                    ] as Array<{ code: Language; label: string }>
                  ).map((item) => (
                    <button
                      key={item.code}
                      type="button"
                      aria-pressed={lang === item.code}
                      onClick={() => setLang(item.code)}
                      className={`min-h-[44px] rounded-md border text-xs font-medium transition-colors cursor-pointer ${
                        lang === item.code
                          ? 'border-[#881337] bg-[#881337] text-white'
                          : 'border-[#E8E6E1] bg-[#FAF9F6] text-[#141413] hover:border-[#881337]'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {onStartTour && (
                <button
                  type="button"
                  onClick={() => {
                    closeDrawer();
                    window.setTimeout(() => onStartTour(), 80);
                  }}
                  className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-md border border-[#881337]/30 bg-[#FAF9F6] px-4 text-xs font-semibold text-[#881337] hover:border-[#881337] cursor-pointer"
                >
                  <Compass className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{i18nT('actions.start_tour')}</span>
                </button>
              )}
            </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
