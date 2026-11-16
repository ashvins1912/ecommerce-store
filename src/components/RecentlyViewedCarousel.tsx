import useEmblaCarousel from 'embla-carousel-react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Product } from '../shared/types';
import { useI18n } from '../lib/i18n';
import { ProductCard } from './ProductCard';

interface RecentlyViewedCarouselProps {
  items: Product[];
  likedIds: Set<string>;
  onToggleLike: (productId: string) => void;
  onSelect: (product: Product) => void;
  onQuickAdd: (product: Product) => void;
  onQuickBuy: (product: Product) => void;
  onShareWhatsApp: (payload: {
    product: Product;
    waLink: string;
    messagePreview: string;
  }) => void;
  compareIds: Set<string>;
  onToggleCompare: (product: Product) => void;
  categoryTop10Thresholds?: Record<string, number>;
  onClearHistory: () => void;
}

export function RecentlyViewedCarousel({
  items,
  likedIds,
  onToggleLike,
  onSelect,
  onQuickAdd,
  onQuickBuy,
  onShareWhatsApp,
  compareIds,
  onToggleCompare,
  categoryTop10Thresholds,
  onClearHistory,
}: RecentlyViewedCarouselProps) {
  const { t } = useI18n();
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: 'start',
    containScroll: 'trimSnaps',
    dragFree: true,
  });

  if (items.length === 0) return null;

  return (
    <section className="border-t border-[#E8E6E1] bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-[#881337]">
              {t('recent.kicker')}
            </div>
            <h2 className="mt-0.5 font-display text-2xl sm:text-3xl font-semibold text-[#141413]">
              {t('recent.title')}
            </h2>
            <p className="text-xs text-[#6B6A65] tabular-nums">
              {t('recent.subtitle', { count: items.length })}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClearHistory}
              className="min-h-[44px] px-2 text-xs font-medium text-[#6B6A65] hover:text-[#881337] mr-1 cursor-pointer"
            >
              {t('recent.clear')}
            </button>
            <button
              type="button"
              aria-label={t('recent.prev')}
              onClick={() => emblaApi?.scrollPrev()}
              className="flex h-11 w-11 items-center justify-center rounded-md border border-[#D6D3CD] bg-white text-[#141413] hover:border-[#881337] cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label={t('recent.next')}
              onClick={() => emblaApi?.scrollNext()}
              className="flex h-11 w-11 items-center justify-center rounded-md border border-[#D6D3CD] bg-white text-[#141413] hover:border-[#881337] cursor-pointer"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="overflow-hidden" ref={emblaRef}>
          <div className="flex gap-5">
            {items.map((product) => {
              const threshold = categoryTop10Thresholds?.[product.category];
              const isTopTrending =
                typeof threshold === 'number' && product.trendScore >= threshold;

              return (
                <div
                  key={`recent-${product._id}`}
                  className="w-[80vw] max-w-[300px] sm:w-[290px] lg:w-[300px] flex-none"
                >
                  <ProductCard
                    product={product}
                    isLiked={likedIds.has(product._id)}
                    onToggleLike={onToggleLike}
                    onSelect={onSelect}
                    onQuickAdd={onQuickAdd}
                    onQuickBuy={onQuickBuy}
                    onShareWhatsApp={onShareWhatsApp}
                    isCompared={compareIds.has(product._id)}
                    onToggleCompare={onToggleCompare}
                    isTopTrending={isTopTrending}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
