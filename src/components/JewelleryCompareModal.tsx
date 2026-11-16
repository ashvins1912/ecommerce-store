import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, ShoppingBag, Star, Trash2, X } from 'lucide-react';
import type { Product, ProductVariant } from '../shared/types';
import { formatINR } from '../lib/api';
import { useI18n } from '../lib/i18n';

interface JewelleryCompareModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: Product[];
  availableJewellery?: Product[];
  onAddItem?: (product: Product) => void;
  onRemoveItem: (productId: string) => void;
  onClearAll: () => void;
  onAddToCart: (product: Product, variant: ProductVariant, quantity: number) => void;
  onSelectProduct: (product: Product) => void;
}

export function JewelleryCompareModal({
  isOpen,
  onClose,
  items,
  availableJewellery = [],
  onAddItem,
  onRemoveItem,
  onClearAll,
  onAddToCart,
  onSelectProduct,
}: JewelleryCompareModalProps) {
  const { t, to } = useI18n();
  const [diffOnly, setDiffOnly] = useState(false);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    lastFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      lastFocusedRef.current?.focus?.();
    };
  }, [isOpen, onClose]);

  const selectedIds = useMemo(() => new Set(items.map((i) => i._id)), [items]);

  const addableCandidates = useMemo(
    () =>
      availableJewellery
        .filter((p) => p.category === 'Artificial Jewellery' && !selectedIds.has(p._id))
        .slice(0, 6),
    [availableJewellery, selectedIds]
  );

  const metrics = useMemo(() => {
    if (items.length < 2) {
      return { minPrice: null, minWeight: null, maxRating: null };
    }
    const prices = items.map((i) => i.salePrice);
    const weights = items
      .map((i) => i.jewellerySpecs?.weightGrams)
      .filter((w): w is number => typeof w === 'number' && w > 0);
    const ratings = items
      .map((i) => i.averageRating)
      .filter((r) => typeof r === 'number' && r > 0);

    const minPrice = prices.length > 0 && new Set(prices).size > 1 ? Math.min(...prices) : null;
    const minWeight =
      weights.length > 1 && new Set(weights).size > 1 ? Math.min(...weights) : null;
    const maxRating =
      ratings.length > 1 && new Set(ratings).size > 1 ? Math.max(...ratings) : null;

    return { minPrice, minWeight, maxRating };
  }, [items]);

  if (!isOpen) return null;

  const ratingLabel = t('jcmp.ratingReviews');

  const specRows: Array<{
    key: string;
    label: string;
    render: (p: Product) => string;
    highlight?: boolean;
  }> = [
    {
      key: 'baseMetal',
      label: t('detail.baseMetal'),
      render: (p) => p.jewellerySpecs?.baseMetal || '—',
      highlight: true,
    },
    {
      key: 'stoneType',
      label: t('detail.stoneType'),
      render: (p) => p.jewellerySpecs?.stoneType || '—',
      highlight: true,
    },
    {
      key: 'plating',
      label: t('jcmp.platingFinish'),
      render: (p) => p.jewellerySpecs?.plating || '—',
      highlight: true,
    },
    {
      key: 'price',
      label: t('jcmp.priceRow'),
      render: (p) =>
        p.discountPercent > 0
          ? `${formatINR(p.salePrice)} (${p.discountPercent}${t('card.off')})`
          : formatINR(p.salePrice),
    },
    {
      key: 'weight',
      label: t('detail.weight'),
      render: (p) => (p.jewellerySpecs ? `${p.jewellerySpecs.weightGrams} g` : '—'),
    },
    {
      key: 'dimensions',
      label: t('detail.dimensions'),
      render: (p) => p.jewellerySpecs?.dimensions || '—',
    },
    {
      key: 'closureType',
      label: t('detail.closureType'),
      render: (p) => p.jewellerySpecs?.closureType || '—',
    },
    {
      key: 'subCategory',
      label: t('jcmp.subCategory'),
      render: (p) => p.subCategory || '—',
    },
    {
      key: 'availability',
      label: t('jcmp.availability'),
      render: (p) => (p.totalStock > 0 ? t('card.inStock') : t('card.soldOut')),
    },
    {
      key: 'occasions',
      label: t('detail.occasionsLabel'),
      render: (p) => p.occasions.map((o) => to(o)).join(' · '),
    },
    {
      key: 'rating',
      label: ratingLabel,
      render: (p) =>
        p.averageRating > 0
          ? `${p.averageRating.toFixed(1)} / 5 (${p.reviewCount})`
          : t('jcmp.newlyListed'),
    },
    {
      key: 'care',
      label: t('detail.careInstructions'),
      render: (p) => p.careInstructions || '—',
    },
  ];

  const rowsWithDiff = specRows.map((row) => {
    const values = items.map((item) => row.render(item));
    const differs = items.length >= 2 && new Set(values).size > 1;
    return { ...row, differs };
  });

  const visibleRows =
    diffOnly && items.length >= 2
      ? rowsWithDiff.filter((row) => row.differs || row.highlight)
      : rowsWithDiff;

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-3 sm:p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="jewellery-compare-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-6xl max-h-[90dvh] overflow-y-auto overscroll-contain rounded-xl border border-[#E8E6E1] bg-white shadow-2xl"
      >
        <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-[#E8E6E1] bg-white px-4 sm:px-6 py-4">
          <div className="min-w-0">
            <h2
              id="jewellery-compare-title"
              className="font-display text-xl sm:text-2xl font-semibold text-[#141413]"
            >
              {t('jcmp.title')}
            </h2>
            <p className="text-xs text-[#6B6A65] tabular-nums">
              {t('jcmp.subtitle', { count: items.length })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {items.length >= 2 && (
              <div
                role="group"
                aria-label={t('jcmp.specCol')}
                className="inline-flex items-center gap-1 rounded-md bg-[#F0EEE9] p-1"
              >
                <button
                  type="button"
                  onClick={() => setDiffOnly(false)}
                  aria-pressed={!diffOnly}
                  className={`min-h-[44px] sm:min-h-[36px] rounded px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                    !diffOnly
                      ? 'bg-white text-[#141413] shadow-xs'
                      : 'text-[#57534E] hover:text-[#141413]'
                  }`}
                >
                  {t('jcmp.showAll')}
                </button>
                <button
                  type="button"
                  onClick={() => setDiffOnly(true)}
                  aria-pressed={diffOnly}
                  className={`min-h-[44px] sm:min-h-[36px] rounded px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                    diffOnly
                      ? 'bg-white text-[#141413] shadow-xs'
                      : 'text-[#57534E] hover:text-[#141413]'
                  }`}
                >
                  {t('jcmp.diffOnly')}
                </button>
              </div>
            )}
            {items.length > 0 && (
              <button
                type="button"
                onClick={onClearAll}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md px-3 text-xs font-medium text-[#6B6A65] hover:bg-[#FAF9F6] hover:text-[#881337] cursor-pointer"
              >
                {t('jcmp.clearAll')}
              </button>
            )}
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              aria-label={t('detail.close')}
              className="inline-flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-[#E8E6E1] text-[#141413] hover:bg-[#FAF9F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#881337] cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="p-8 sm:p-12 text-center space-y-2">
            <div className="font-display text-xl text-[#141413]">{t('jcmp.emptyTitle')}</div>
            <p className="text-xs text-[#6B6A65]">{t('jcmp.emptyDesc')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#E8E6E1] bg-[#FAF9F6] align-top">
                  <th className="sticky left-0 z-10 w-36 sm:w-44 bg-[#FAF9F6] px-4 sm:px-5 py-5 font-medium text-[#6B6A65] border-r border-[#E8E6E1]/70">
                    {t('jcmp.specCol')}
                  </th>
                  {items.map((item) => {
                    const highlights: string[] = [];
                    if (metrics.minPrice !== null && item.salePrice === metrics.minPrice) {
                      highlights.push(t('jcmp.lowestPrice'));
                    }
                    if (
                      metrics.minWeight !== null &&
                      item.jewellerySpecs?.weightGrams === metrics.minWeight
                    ) {
                      highlights.push(t('jcmp.lightest'));
                    }
                    if (
                      metrics.maxRating !== null &&
                      item.averageRating === metrics.maxRating
                    ) {
                      highlights.push(t('jcmp.topRated'));
                    }

                    return (
                      <th key={item._id} className="px-4 sm:px-5 py-5 font-normal min-w-[210px]">
                        <div className="space-y-3">
                          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md border border-[#E8E6E1] bg-[#F2EFE9]">
                            <img
                              src={item.images[0]?.url}
                              alt={item.title}
                              referrerPolicy="no-referrer"
                              onClick={() => {
                                onClose();
                                onSelectProduct(item);
                              }}
                              className="h-full w-full object-cover cursor-pointer"
                            />
                            <button
                              type="button"
                              aria-label={`${t('jcmp.clearAll')}: ${item.title}`}
                              onClick={() => onRemoveItem(item._id)}
                              className="absolute right-1.5 top-1.5 inline-flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-white/95 text-[#44403C] shadow-xs hover:text-red-700 cursor-pointer"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>

                          <div>
                            <div className="text-[11px] text-[#6B6A65]">{item.subCategory}</div>
                            <button
                              type="button"
                              onClick={() => {
                                onClose();
                                onSelectProduct(item);
                              }}
                              className="mt-0.5 text-left text-sm font-semibold text-[#141413] hover:text-[#881337] line-clamp-2 cursor-pointer"
                            >
                              {item.title}
                            </button>
                            {highlights.length > 0 && (
                              <div className="mt-1 text-[11px] font-medium text-[#881337]">
                                {highlights.join(' · ')}
                              </div>
                            )}
                          </div>

                          <div className="flex items-baseline gap-2 tabular-nums">
                            <span className="text-base font-semibold text-[#141413]">
                              {formatINR(item.salePrice)}
                            </span>
                            {item.discountPercent > 0 && (
                              <span className="text-[11px] text-[#881337] font-medium">
                                {item.discountPercent}
                                {t('card.off')}
                              </span>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              item.variants[0] && onAddToCart(item, item.variants[0], 1)
                            }
                            disabled={item.totalStock <= 0}
                            className="w-full min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-md bg-[#881337] px-3 py-2 text-xs font-medium text-white hover:bg-[#9F1239] disabled:opacity-40 cursor-pointer"
                          >
                            <ShoppingBag className="h-3.5 w-3.5" />
                            <span>
                              {item.totalStock > 0 ? t('card.addToBag') : t('card.soldOut')}
                            </span>
                          </button>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EEE9]">
                {visibleRows.map((row) => (
                  <tr
                    key={row.key}
                    className={
                      row.highlight
                        ? 'bg-[#FAF9F6]/70'
                        : row.differs
                          ? 'bg-[#FFFDF9]'
                          : 'bg-white'
                    }
                  >
                    <td
                      className={`sticky left-0 z-10 px-4 sm:px-5 py-3.5 font-medium text-[#57534E] border-r border-[#E8E6E1]/70 ${
                        row.highlight
                          ? 'bg-[#FAF9F6]'
                          : row.differs
                            ? 'bg-[#FFFDF9]'
                            : 'bg-white'
                      }`}
                    >
                      <div>{row.label}</div>
                      {row.differs && (
                        <div className="mt-0.5 text-[10px] font-medium text-[#881337]">
                          {t('jcmp.differs')}
                        </div>
                      )}
                    </td>
                    {items.map((item) => (
                      <td
                        key={`${item._id}-${row.key}`}
                        className={`px-4 sm:px-5 py-3.5 tabular-nums ${
                          row.highlight ? 'font-medium text-[#141413]' : 'text-[#141413]'
                        }`}
                      >
                        {row.key === 'rating' && item.averageRating > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <Star className="h-3.5 w-3.5 fill-[#A16207] text-[#A16207]" />
                            {row.render(item)}
                          </span>
                        ) : (
                          row.render(item)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Quick-Add More Jewellery Pieces Strip */}
        {items.length > 0 && items.length < 4 && onAddItem && addableCandidates.length > 0 && (
          <div className="border-t border-[#E8E6E1] bg-[#FAF9F6] px-4 sm:px-6 py-4 space-y-2.5">
            <div className="text-xs font-medium text-[#57534E]">{t('jcmp.addMorePrompt')}</div>
            <div className="flex flex-wrap gap-2">
              {addableCandidates.map((cand) => (
                <button
                  key={cand._id}
                  type="button"
                  onClick={() => onAddItem(cand)}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-[#D6D3CD] bg-white px-3 py-1.5 text-left text-xs text-[#141413] hover:border-[#881337] cursor-pointer"
                >
                  {cand.images[0]?.url && (
                    <img
                      src={cand.images[0].thumbUrl || cand.images[0].url}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-7 w-7 rounded object-cover shrink-0 bg-[#F2EFE9]"
                    />
                  )}
                  <span className="max-w-[180px] truncate font-medium">{cand.title}</span>
                  <span className="text-[#6B6A65] tabular-nums shrink-0">
                    {formatINR(cand.salePrice)}
                  </span>
                  <Plus className="h-3.5 w-3.5 text-[#881337] shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
