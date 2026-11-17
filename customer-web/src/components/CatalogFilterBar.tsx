import {
  Check,
  Compass,
  Gem,
  LayoutGrid,
  Search,
  Shirt,
  SlidersHorizontal,
  Sparkles,
  Tag,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  CategoryControl,
  OccasionType,
  ProductCategory,
  SeasonType,
  SortOption,
  StorefrontCampaign,
} from '../shared/types';
import { useI18n } from '../lib/i18n';
import { ActionButton } from './ActionButton';

const QUICK_FINISH_SWATCHES = [
  { label: 'Gold', hex: '#D4AF37' },
  { label: 'Silver', hex: '#CBD5E1' },
  { label: 'Rose Gold', hex: '#E1A79E' },
  { label: 'Crimson', hex: '#881337' },
  { label: 'Ivory', hex: '#F3EDE0' },
  { label: 'Emerald', hex: '#166534' },
];

function getCategoryIcon(categoryName: string) {
  const normalized = categoryName.toLowerCase();
  if (normalized.includes('jewel')) return Gem;
  if (normalized.includes('cloth') || normalized.includes('apparel') || normalized.includes('kurta'))
    return Shirt;
  if (normalized.includes('accessor') || normalized.includes('potli') || normalized.includes('bag'))
    return Sparkles;
  return Tag;
}

export interface CatalogFilterBarProps {
  searchInput: string;
  onSearchInputChange: (val: string) => void;
  onClearSearch: () => void;
  suggestions: string[];
  showSuggestions: boolean;
  onShowSuggestionsChange: (open: boolean) => void;
  onSelectSuggestion: (term: string) => void;
  didYouMean: string | null;
  onSelectDidYouMean: (term: string) => void;

  quickSearchChips: string[];
  occasions: Array<OccasionType | 'All'>;
  seasons: Array<SeasonType | 'All'>;
  sortOptions: SortOption[];
  storeCategories: CategoryControl[];

  category: ProductCategory | 'All';
  onCategoryChange: (cat: ProductCategory | 'All') => void;
  occasion: OccasionType | 'All';
  onOccasionChange: (occ: OccasionType | 'All') => void;
  season: SeasonType | 'All';
  onSeasonChange: (ssn: SeasonType | 'All') => void;
  sort: SortOption;
  onSortChange: (sort: SortOption) => void;

  minPrice: string;
  onMinPriceChange: (val: string) => void;
  maxPrice: string;
  onMaxPriceChange: (val: string) => void;
  onApplyPriceRange?: (min: string, max: string) => void;
  minDiscount: string;
  onMinDiscountChange: (val: string) => void;
  inStockOnly: boolean;
  onInStockOnlyChange: (checked: boolean) => void;
  colorFilter: string;
  onColorFilterChange: (val: string) => void;

  showMoreFilters: boolean;
  onToggleMoreFilters: () => void;

  campaigns: StorefrontCampaign[];
  selectedCampaignId: string | null;
  onClearCampaign: () => void;

  shownCount: number;
  totalCount: number;
  page: number;
  totalPages: number;

  onResetAll: () => void;
  onStartTour: () => void;
}

export function CatalogFilterBar({
  searchInput,
  onSearchInputChange,
  onClearSearch,
  suggestions,
  showSuggestions,
  onShowSuggestionsChange,
  onSelectSuggestion,
  didYouMean,
  onSelectDidYouMean,
  quickSearchChips,
  occasions,
  seasons,
  sortOptions,
  storeCategories,
  category,
  onCategoryChange,
  occasion,
  onOccasionChange,
  season,
  onSeasonChange,
  sort,
  onSortChange,
  minPrice,
  onMinPriceChange,
  maxPrice,
  onMaxPriceChange,
  onApplyPriceRange,
  minDiscount,
  onMinDiscountChange,
  inStockOnly,
  onInStockOnlyChange,
  colorFilter,
  onColorFilterChange,
  showMoreFilters,
  onToggleMoreFilters,
  campaigns,
  selectedCampaignId,
  onClearCampaign,
  shownCount,
  totalCount,
  page,
  totalPages,
  onResetAll,
  onStartTour,
}: CatalogFilterBarProps) {
  const { t, tc, to, tseason, tsort } = useI18n();
  const { t: i18nT } = useTranslation();

  const categoryList =
    storeCategories.length > 0
      ? storeCategories.map((c) => c.name)
      : ['Artificial Jewellery', 'Clothing', 'Accessories'];

  const setPriceBounds = (nextMin: string, nextMax: string) => {
    if (onApplyPriceRange) {
      onApplyPriceRange(nextMin, nextMax);
    } else {
      onMinPriceChange(nextMin);
      onMaxPriceChange(nextMax);
    }
  };

  const isUnder2000 = minPrice === '' && maxPrice === '2000';
  const isRange2000To5000 = minPrice === '2000' && maxPrice === '5000';
  const isOnSale = minDiscount === '15';
  const isWedding = occasion === 'Wedding';
  const isFestive = occasion === 'Festive';
  const isDiwali = season === 'Diwali';

  const advancedCount = [
    minPrice,
    maxPrice,
    minDiscount,
    inStockOnly ? 'stock' : '',
    colorFilter,
    occasion !== 'All' ? occasion : '',
    season !== 'All' ? season : '',
  ].filter(Boolean).length;

  const activeFilters: Array<{ id: string; label: string; onRemove: () => void }> = [];
  if (searchInput.trim()) {
    activeFilters.push({
      id: 'q',
      label: `"${searchInput.trim()}"`,
      onRemove: onClearSearch,
    });
  }
  if (category !== 'All') {
    activeFilters.push({
      id: 'category',
      label: tc(category),
      onRemove: () => onCategoryChange('All'),
    });
  }
  if (occasion !== 'All') {
    activeFilters.push({
      id: 'occasion',
      label: to(occasion),
      onRemove: () => onOccasionChange('All'),
    });
  }
  if (season !== 'All') {
    activeFilters.push({
      id: 'season',
      label: tseason(season),
      onRemove: () => onSeasonChange('All'),
    });
  }
  if (minPrice || maxPrice) {
    activeFilters.push({
      id: 'price',
      label: `₹${minPrice || '0'} – ₹${maxPrice || 'Any'}`,
      onRemove: () => setPriceBounds('', ''),
    });
  }
  if (minDiscount) {
    activeFilters.push({
      id: 'discount',
      label: `${minDiscount}%+ off`,
      onRemove: () => onMinDiscountChange(''),
    });
  }
  if (colorFilter.trim()) {
    activeFilters.push({
      id: 'color',
      label: colorFilter.trim(),
      onRemove: () => onColorFilterChange(''),
    });
  }
  if (inStockOnly) {
    activeFilters.push({
      id: 'stock',
      label: t('search.inStockOnly'),
      onRemove: () => onInStockOnlyChange(false),
    });
  }
  if (selectedCampaignId) {
    activeFilters.push({
      id: 'campaign',
      label: campaigns.find((c) => c._id === selectedCampaignId)?.name || selectedCampaignId,
      onRemove: onClearCampaign,
    });
  }

  const quickFacets: Array<{
    id: string;
    label: string;
    active: boolean;
    onToggle: () => void;
  }> = [
    {
      id: 'under_2000',
      label: i18nT('filter_ux.under_2000'),
      active: isUnder2000,
      onToggle: () => (isUnder2000 ? setPriceBounds('', '') : setPriceBounds('', '2000')),
    },
    {
      id: 'range_2000_5000',
      label: i18nT('filter_ux.range_2000_5000'),
      active: isRange2000To5000,
      onToggle: () =>
        isRange2000To5000 ? setPriceBounds('', '') : setPriceBounds('2000', '5000'),
    },
    {
      id: 'in_stock',
      label: i18nT('filter_ux.in_stock'),
      active: inStockOnly,
      onToggle: () => onInStockOnlyChange(!inStockOnly),
    },
    {
      id: 'on_sale',
      label: i18nT('filter_ux.on_sale'),
      active: isOnSale,
      onToggle: () => onMinDiscountChange(isOnSale ? '' : '15'),
    },
    {
      id: 'wedding',
      label: i18nT('filter_ux.wedding'),
      active: isWedding,
      onToggle: () => onOccasionChange(isWedding ? 'All' : 'Wedding'),
    },
    {
      id: 'festive',
      label: i18nT('filter_ux.festive'),
      active: isFestive,
      onToggle: () => onOccasionChange(isFestive ? 'All' : 'Festive'),
    },
    {
      id: 'diwali',
      label: i18nT('filter_ux.diwali'),
      active: isDiwali,
      onToggle: () => onSeasonChange(isDiwali ? 'All' : 'Diwali'),
    },
  ];

  const showPopularOnFocus = showSuggestions && searchInput.trim().length < 2 && quickSearchChips.length > 0;
  const showAutocomplete = showSuggestions && searchInput.trim().length >= 2 && suggestions.length > 0;

  return (
    <div className="rounded-xl border border-[#E8E6E1] bg-white p-3.5 sm:p-5 space-y-4 shadow-xs">
      {/* Row 1: Department / Category Selector ("All Categories" Redesign) */}
      <div className="space-y-2.5 border-b border-[#F0EEE9] pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#57534E]">
            {i18nT('filter_ux.browse_categories')}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-[#57534E] tabular-nums">
              {t('catalog.showing', {
                shown: shownCount,
                total: totalCount,
                page,
                totalPages,
              })}
            </span>
            <button
              type="button"
              data-tour="btn-start_tour-compact"
              onClick={onStartTour}
              className="xl:hidden inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-md border border-[#E8E6E1] bg-[#FAF9F6] px-3 text-xs font-medium text-[#881337] hover:border-[#881337] cursor-pointer"
            >
              <Compass className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{i18nT('actions.start_tour')}</span>
            </button>
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Product categories"
          className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2"
        >
          <button
            type="button"
            role="tab"
            aria-selected={category === 'All'}
            onClick={() => onCategoryChange('All')}
            className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center sm:justify-start gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-all cursor-pointer ${
              category === 'All'
                ? 'border-[#881337] bg-[#881337] text-white shadow-xs'
                : 'border-[#E8E6E1] bg-[#FAF9F6] text-[#141413] hover:border-[#881337]/50 hover:bg-white'
            }`}
          >
            <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{t('filter.allCategories')}</span>
          </button>

          {categoryList.map((cat) => {
            const active = category === cat;
            const Icon = getCategoryIcon(cat);
            return (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onCategoryChange(cat)}
                className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center sm:justify-start gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-all cursor-pointer ${
                  active
                    ? 'border-[#881337] bg-[#881337] text-white shadow-xs'
                    : 'border-[#E8E6E1] bg-[#FAF9F6] text-[#141413] hover:border-[#881337]/50 hover:bg-white'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{tc(cat)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Row 2: Search Input + All Filters Toggle + Sort + Guided Tour */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="relative flex-1 min-w-0">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#78716C]"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label={t('search.placeholder')}
            value={searchInput}
            onFocus={() => onShowSuggestionsChange(true)}
            onBlur={() => setTimeout(() => onShowSuggestionsChange(false), 180)}
            onChange={(e) => {
              onSearchInputChange(e.target.value);
              onShowSuggestionsChange(true);
            }}
            placeholder={t('search.placeholder')}
            className="w-full min-h-[44px] rounded-lg border border-[#D6D3CD] bg-[#FAF9F6] py-2.5 pl-10 pr-12 text-sm text-[#141413] placeholder:text-[#8A857E] focus:border-[#881337] focus:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#881337]/30 transition-colors"
          />
          {searchInput && (
            <button
              type="button"
              aria-label={t('search.clear')}
              onClick={onClearSearch}
              className="absolute right-0 top-1/2 -translate-y-1/2 flex h-[44px] w-[44px] min-h-[44px] min-w-[44px] items-center justify-center text-[#78716C] hover:text-[#141413] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#881337] rounded-r-lg cursor-pointer"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}

          {/* Autocomplete suggestions when typing */}
          {showAutocomplete && (
            <div
              role="listbox"
              aria-label="Search suggestions"
              className="absolute left-0 right-0 top-full z-30 mt-1.5 rounded-lg border border-[#E8E6E1] bg-white py-1 shadow-xl"
            >
              {suggestions.map((sug) => (
                <button
                  key={sug}
                  type="button"
                  role="option"
                  aria-selected={searchInput.toLowerCase() === sug.toLowerCase()}
                  onMouseDown={() => onSelectSuggestion(sug)}
                  className="flex w-full min-h-[44px] min-w-[44px] items-center gap-2.5 px-4 py-2 text-left text-xs font-medium text-[#141413] hover:bg-[#FAF9F6] cursor-pointer"
                >
                  <Search className="h-3.5 w-3.5 text-[#881337] shrink-0" aria-hidden="true" />
                  <span className="truncate">{sug}</span>
                </button>
              ))}
            </div>
          )}

          {/* Popular searches prompt on empty focus */}
          {showPopularOnFocus && (
            <div
              aria-label={i18nT('filter_ux.popular_searches')}
              className="absolute left-0 right-0 top-full z-30 mt-1.5 rounded-lg border border-[#E8E6E1] bg-white p-3 shadow-xl space-y-2"
            >
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#6B6A65]">
                <Sparkles className="h-3 w-3 text-[#881337]" aria-hidden="true" />
                <span>{i18nT('filter_ux.popular_searches')}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {quickSearchChips.map((term) => (
                  <button
                    key={term}
                    type="button"
                    onMouseDown={() => onSelectSuggestion(term)}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-[#E8E6E1] bg-[#FAF9F6] px-3 py-2 text-xs font-medium text-[#141413] hover:border-[#881337] hover:text-[#881337] cursor-pointer"
                  >
                    {term}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Controls: Filters Studio + Sort + Guided Tour */}
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
          <div className="w-full sm:w-auto">
            <ActionButton
              actionKey="toggle_filters"
              role="CUSTOMER"
              variant={showMoreFilters || advancedCount > 0 ? 'secondary' : 'outline'}
              showHelpIcon
              aria-expanded={showMoreFilters}
              aria-controls="catalog-filter-drawer"
              onClick={onToggleMoreFilters}
              icon={<SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />}
              labelOverride={
                advancedCount > 0
                  ? `${t('filter.priceColor')} (${advancedCount})`
                  : t('filter.priceColor')
              }
            />
          </div>

          <div className="w-full sm:w-auto">
            <select
              aria-label={t('filter.sortPrefix')}
              value={sort}
              onChange={(e) => onSortChange(e.target.value as SortOption)}
              className="w-full sm:w-auto min-h-[44px] min-w-[44px] rounded-md border border-[#D6D3CD] bg-white px-3.5 py-2 text-xs font-medium text-[#141413] focus:border-[#881337] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#881337] cursor-pointer"
            >
              {sortOptions.map((val) => (
                <option key={val} value={val}>
                  {t('filter.sortPrefix')}: {tsort(val)}
                </option>
              ))}
            </select>
          </div>

          <div className="hidden xl:block">
            <ActionButton
              actionKey="start_tour"
              role="CUSTOMER"
              variant="ghost"
              fullWidthMobile={false}
              onClick={onStartTour}
              icon={<Compass className="h-3.5 w-3.5 text-[#881337]" aria-hidden="true" />}
            />
          </div>
        </div>
      </div>

      {/* Row 3: True 1-Tap Combinable Quick Filters (Never Overwrite Search) */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[#6B6A65] mr-1">
          <Sparkles className="h-3 w-3 text-[#881337]" aria-hidden="true" />
          <span>{i18nT('filter_ux.quick_label')}</span>
        </span>
        {quickFacets.map((facet) => (
          <button
            key={facet.id}
            type="button"
            aria-pressed={facet.active}
            onClick={facet.onToggle}
            className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
              facet.active
                ? 'border-[#881337] bg-[#881337]/10 text-[#881337] font-semibold shadow-2xs'
                : 'border-[#E8E6E1] bg-[#FAF9F6] text-[#44403C] hover:border-[#881337]/50 hover:bg-white'
            }`}
          >
            {facet.active && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            <span>{facet.label}</span>
          </button>
        ))}
      </div>

      {didYouMean && (
        <div className="text-xs text-[#57534E]">
          <button
            type="button"
            onClick={() => onSelectDidYouMean(didYouMean)}
            className="inline-flex min-h-[44px] min-w-[44px] items-center px-2 font-semibold text-[#881337] hover:underline cursor-pointer"
          >
            {t('search.didYouMean', { term: didYouMean })}
          </button>
        </div>
      )}

      {/* Expandable Unified Filter Studio: Occasion, Season, Price, Discount, Finish/Color, Stock */}
      {showMoreFilters && (
        <div
          id="catalog-filter-drawer"
          className="rounded-lg border border-[#E8E6E1] bg-[#FAF9F6] p-4 space-y-5"
        >
          {/* Occasion & Season Matrix */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2 min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#57534E]">
                Occasion
              </div>
              <div className="flex flex-wrap gap-1.5">
                {occasions.map((occ) => {
                  const selected = occasion === occ;
                  return (
                    <button
                      key={occ}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onOccasionChange(occ)}
                      className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
                        selected
                          ? 'border-[#881337] bg-[#881337] text-white'
                          : 'border-[#E8E6E1] bg-white text-[#44403C] hover:border-[#881337]'
                      }`}
                    >
                      {selected && <Check className="h-3 w-3 shrink-0" aria-hidden="true" />}
                      <span>{occ === 'All' ? t('filter.allOccasions') : to(occ)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2 min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#57534E]">
                Season & Edit
              </div>
              <div className="flex flex-wrap gap-1.5">
                {seasons.map((ssn) => {
                  const selected = season === ssn;
                  return (
                    <button
                      key={ssn}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onSeasonChange(ssn)}
                      className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
                        selected
                          ? 'border-[#141413] bg-[#141413] text-white'
                          : 'border-[#E8E6E1] bg-white text-[#44403C] hover:border-[#141413]'
                      }`}
                    >
                      {selected && <Check className="h-3 w-3 shrink-0" aria-hidden="true" />}
                      <span>{ssn === 'All' ? t('season.all') : tseason(ssn)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Price Bounds, Discount, Finish/Color & Stock Availability */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 border-t border-[#E8E6E1] pt-4 items-end">
            <div className="min-w-0">
              <label
                htmlFor="filter-min-price"
                className="block text-[11px] font-medium text-[#44403C] mb-1"
              >
                {t('search.minPrice')}
              </label>
              <input
                id="filter-min-price"
                type="number"
                placeholder="500"
                value={minPrice}
                onChange={(e) => onMinPriceChange(e.target.value)}
                className="w-full min-h-[44px] rounded-md border border-[#D6D3CD] bg-white px-3 py-2 text-xs tabular-nums focus:border-[#881337] focus:outline-none"
              />
            </div>

            <div className="min-w-0">
              <label
                htmlFor="filter-max-price"
                className="block text-[11px] font-medium text-[#44403C] mb-1"
              >
                {t('filter.maxPrice')}
              </label>
              <input
                id="filter-max-price"
                type="number"
                placeholder="3000"
                value={maxPrice}
                onChange={(e) => onMaxPriceChange(e.target.value)}
                className="w-full min-h-[44px] rounded-md border border-[#D6D3CD] bg-white px-3 py-2 text-xs tabular-nums focus:border-[#881337] focus:outline-none"
              />
            </div>

            <div className="min-w-0">
              <label
                htmlFor="filter-min-discount"
                className="block text-[11px] font-medium text-[#44403C] mb-1"
              >
                {t('search.minDiscount')}
              </label>
              <select
                id="filter-min-discount"
                value={minDiscount}
                onChange={(e) => onMinDiscountChange(e.target.value)}
                className="w-full min-h-[44px] rounded-md border border-[#D6D3CD] bg-white px-3 py-2 text-xs focus:border-[#881337] focus:outline-none"
              >
                <option value="">{t('search.anyDiscount')}</option>
                <option value="10">10%+</option>
                <option value="15">15%+</option>
                <option value="25">25%+</option>
              </select>
            </div>

            <div className="min-w-0 sm:col-span-2 lg:col-span-2">
              <label
                htmlFor="filter-color"
                className="block text-[11px] font-medium text-[#44403C] mb-1"
              >
                {t('filter.finishColor')}
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  id="filter-color"
                  type="text"
                  placeholder={t('filter.colorPlaceholder')}
                  value={colorFilter}
                  onChange={(e) => onColorFilterChange(e.target.value)}
                  className="flex-1 min-w-0 min-h-[44px] rounded-md border border-[#D6D3CD] bg-white px-3 py-2 text-xs focus:border-[#881337] focus:outline-none"
                />
                <label className="inline-flex min-h-[44px] min-w-[44px] items-center gap-2 rounded-md border border-[#E8E6E1] bg-white px-3 py-2 text-xs font-medium text-[#44403C] cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={inStockOnly}
                    onChange={(e) => onInStockOnlyChange(e.target.checked)}
                    className="h-4 w-4 accent-[#881337]"
                  />
                  <span>{t('search.inStockOnly')}</span>
                </label>
              </div>
            </div>
          </div>

          {/* Finish Swatches & Reset Action */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-[#6B6A65] mr-1">Finish:</span>
              {QUICK_FINISH_SWATCHES.map((swatch) => {
                const active = colorFilter.toLowerCase() === swatch.label.toLowerCase();
                return (
                  <button
                    key={swatch.label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onColorFilterChange(active ? '' : swatch.label)}
                    className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
                      active
                        ? 'border-[#881337] bg-white text-[#881337] shadow-xs'
                        : 'border-[#E8E6E1] bg-white/80 text-[#44403C] hover:border-[#141413]'
                    }`}
                  >
                    <span
                      className="h-3 w-3 rounded-full border border-black/15 shrink-0"
                      style={{ backgroundColor: swatch.hex }}
                      aria-hidden="true"
                    />
                    <span>{swatch.label}</span>
                  </button>
                );
              })}
            </div>

            {activeFilters.length > 0 && (
              <ActionButton
                actionKey="clear_filters"
                role="CUSTOMER"
                variant="outline"
                showHelpIcon
                onClick={onResetAll}
              />
            )}
          </div>
        </div>
      )}

      {/* Active Filter Summary Strip with Individual Dismissal */}
      {activeFilters.length > 0 && (
        <div
          aria-label="Active filters"
          className="flex flex-wrap items-center gap-2 border-t border-[#F0EEE9] pt-3 text-xs"
        >
          <span className="text-[11px] font-medium text-[#6B6A65]">Active:</span>
          {activeFilters.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={item.onRemove}
              aria-label={`Remove filter ${item.label}`}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-md border border-[#881337]/25 bg-[#881337]/5 px-3 py-2 text-xs font-medium text-[#881337] hover:bg-[#881337]/10 cursor-pointer"
            >
              <span>{item.label}</span>
              <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </button>
          ))}
          {!showMoreFilters && (
            <div className="ml-auto">
              <ActionButton
                actionKey="clear_filters"
                role="CUSTOMER"
                variant="ghost"
                fullWidthMobile={false}
                onClick={onResetAll}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
