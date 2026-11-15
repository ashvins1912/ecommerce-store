import { Globe, ShoppingBag, User as UserIcon } from 'lucide-react';
import type { ProductCategory, User } from '../shared/types';
import { useI18n, type Language } from '../lib/i18n';

export type ActivePage = 'store' | 'wishlist' | 'orders' | 'seller';

interface TopBarProps {
  activePage: ActivePage;
  activeCategory: ProductCategory | 'All';
  onNavigateStore: (category?: ProductCategory | 'All') => void;
  onNavigateWishlist: () => void;
  onNavigateOrders: () => void;
  onNavigateSeller: () => void;
  wishlistCount: number;
  cartCount: number;
  onOpenCart: () => void;
  user: User | null;
  onOpenAuth: () => void;
}

export function TopBar({
  activePage,
  activeCategory,
  onNavigateStore,
  onNavigateWishlist,
  onNavigateOrders,
  onNavigateSeller,
  wishlistCount,
  cartCount,
  onOpenCart,
  user,
  onOpenAuth,
}: TopBarProps) {
  const { lang, setLang, t } = useI18n();

  return (
    <header className="sticky top-0 z-40 border-b border-[#E8E6E1] bg-[#FAF9F6]/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 sm:h-16 max-w-[1360px] items-center justify-between gap-2 sm:gap-6 px-3 sm:px-6 lg:px-8">
        {/* Zone 1: Single-element brand wordmark */}
        <button
          type="button"
          onClick={() => onNavigateStore('All')}
          className="font-display text-xl sm:text-2xl font-semibold tracking-tight text-[#141413] whitespace-nowrap shrink-0 cursor-pointer"
        >
          {t('brand')}
        </button>

        {/* Zone 2: 5 concise single-line navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[#57534E]">
          <button
            type="button"
            onClick={() => onNavigateStore('All')}
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
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
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
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
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors tabular-nums cursor-pointer ${
              activePage === 'wishlist'
                ? 'border-[#881337] text-[#141413]'
                : 'border-transparent hover:text-[#141413]'
            }`}
          >
            {t('nav.wishlist')} ({wishlistCount})
          </button>
          <button
            type="button"
            onClick={onNavigateOrders}
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
              activePage === 'orders'
                ? 'border-[#881337] text-[#141413]'
                : 'border-transparent hover:text-[#141413]'
            }`}
          >
            {t('nav.orders')}
          </button>
          <button
            type="button"
            onClick={onNavigateSeller}
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
              activePage === 'seller'
                ? 'border-[#881337] text-[#141413]'
                : 'border-transparent hover:text-[#141413]'
            }`}
          >
            {t('nav.sellerHub')}
          </button>
        </nav>

        {/* Zone 3: Single compact action group (Language + Account + Bag CTA) */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          <div className="inline-flex items-center gap-1 rounded-md border border-[#E8E6E1] bg-white px-1.5 sm:px-2 py-1 sm:py-1.5 text-xs text-[#44403C]">
            <Globe className="hidden sm:block h-3.5 w-3.5 text-[#78716C] shrink-0" />
            <select
              aria-label={t('nav.language')}
              value={lang}
              onChange={(e) => setLang(e.target.value as Language)}
              className="bg-transparent text-[11px] sm:text-xs font-medium text-[#141413] focus:outline-none cursor-pointer"
            >
              <option value="en">EN</option>
              <option value="hi">हिन्दी</option>
              <option value="bn">বাংলা</option>
            </select>
          </div>

          <button
            type="button"
            onClick={onOpenAuth}
            className="inline-flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2.5 py-1.5 sm:py-2 text-xs font-medium text-[#44403C] hover:text-[#141413] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <UserIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
            <span className="max-w-[82px] sm:max-w-[140px] truncate">
              {user
                ? `${user.name.split(' ')[0]} · ${
                    user.role === 'ADMIN'
                      ? t('auth.roleAdmin')
                      : user.role === 'SELLER'
                      ? t('auth.roleSeller')
                      : t('auth.roleBuyer')
                  }`
                : t('nav.signIn')}
            </span>
          </button>
          <button
            type="button"
            onClick={onOpenCart}
            className="inline-flex items-center gap-1.5 sm:gap-2 rounded-md bg-[#881337] px-2.5 sm:px-3.5 py-1.5 sm:py-2 text-xs font-medium text-white hover:bg-[#9F1239] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ShoppingBag className="h-3.5 w-3.5 shrink-0" />
            <span className="tabular-nums">
              {t('nav.bag')} ({cartCount})
            </span>
          </button>
        </div>
      </div>

      {/* Compact single-line mobile sub-nav only on small screens (<768px) */}
      <div className="flex md:hidden items-center gap-4 overflow-x-auto border-t border-[#E8E6E1] px-4 py-2 text-xs font-medium text-[#57534E]">
        <button
          type="button"
          onClick={() => onNavigateStore('All')}
          className={`whitespace-nowrap shrink-0 ${activePage === 'store' && activeCategory === 'All' ? 'text-[#881337] font-semibold' : ''}`}
        >
          {t('nav.catalog')}
        </button>
        <button
          type="button"
          onClick={() => onNavigateStore('Artificial Jewellery')}
          className={`whitespace-nowrap shrink-0 ${activePage === 'store' && activeCategory === 'Artificial Jewellery' ? 'text-[#881337] font-semibold' : ''}`}
        >
          {t('nav.jewellery')}
        </button>
        <button
          type="button"
          onClick={onNavigateWishlist}
          className={`whitespace-nowrap shrink-0 tabular-nums ${activePage === 'wishlist' ? 'text-[#881337] font-semibold' : ''}`}
        >
          {t('nav.wishlist')} ({wishlistCount})
        </button>
        <button
          type="button"
          onClick={onNavigateOrders}
          className={`whitespace-nowrap shrink-0 ${activePage === 'orders' ? 'text-[#881337] font-semibold' : ''}`}
        >
          {t('nav.orders')}
        </button>
        <button
          type="button"
          onClick={onNavigateSeller}
          className={`whitespace-nowrap shrink-0 ${activePage === 'seller' ? 'text-[#881337] font-semibold' : ''}`}
        >
          {t('nav.sellerHub')}
        </button>
      </div>
    </header>
  );
}
