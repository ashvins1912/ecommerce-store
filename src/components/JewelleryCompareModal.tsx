import { ShoppingBag, Star, Trash2, X } from 'lucide-react';
import type { Product, ProductVariant } from '../shared/types';
import { formatINR } from '../lib/api';
import { useI18n } from '../lib/i18n';

interface JewelleryCompareModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: Product[];
  onRemoveItem: (productId: string) => void;
  onClearAll: () => void;
  onAddToCart: (product: Product, variant: ProductVariant, quantity: number) => void;
  onSelectProduct: (product: Product) => void;
}

export function JewelleryCompareModal({
  isOpen,
  onClose,
  items,
  onRemoveItem,
  onClearAll,
  onAddToCart,
  onSelectProduct,
}: JewelleryCompareModalProps) {
  const { t, to } = useI18n();
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
      key: 'plating',
      label: t('jcmp.platingFinish'),
      render: (p) => p.jewellerySpecs?.plating || '—',
      highlight: true,
    },
    {
      key: 'stoneType',
      label: t('detail.stoneType'),
      render: (p) => p.jewellerySpecs?.stoneType || '—',
      highlight: true,
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

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4 backdrop-blur-xs">
      <div className="mx-auto max-w-[1160px] rounded-xl border border-[#E8E6E1] bg-white shadow-2xl overflow-hidden my-4">
        <div className="flex items-center justify-between border-b border-[#E8E6E1] px-6 py-4">
          <div>
            <h2 className="font-display text-2xl font-semibold text-[#141413]">
              {t('jcmp.title')}
            </h2>
            <p className="text-xs text-[#6B6A65] tabular-nums">
              {t('jcmp.subtitle', { count: items.length })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {items.length > 0 && (
              <button
                type="button"
                onClick={onClearAll}
                className="text-xs font-medium text-[#6B6A65] hover:text-[#881337] cursor-pointer"
              >
                {t('jcmp.clearAll')}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={t('detail.close')}
              className="rounded-md border border-[#E8E6E1] p-1.5 text-[#141413] hover:bg-[#FAF9F6] cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <div className="font-display text-xl text-[#141413]">{t('jcmp.emptyTitle')}</div>
            <p className="text-xs text-[#6B6A65]">{t('jcmp.emptyDesc')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#E8E6E1] bg-[#FAF9F6] align-top">
                  <th className="w-44 px-5 py-5 font-medium text-[#6B6A65]">{t('jcmp.specCol')}</th>
                  {items.map((item) => (
                    <th key={item._id} className="px-5 py-5 font-normal min-w-[220px]">
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
                            aria-label={item.title}
                            onClick={() => onRemoveItem(item._id)}
                            className="absolute right-2 top-2 rounded-full bg-white/90 p-1.5 text-[#44403C] hover:text-red-700 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
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
                          className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-[#881337] px-3 py-2 text-xs font-medium text-white hover:bg-[#9F1239] disabled:opacity-40 cursor-pointer"
                        >
                          <ShoppingBag className="h-3.5 w-3.5" />
                          <span>{item.totalStock > 0 ? t('card.addToBag') : t('card.soldOut')}</span>
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EEE9]">
                {specRows.map((row) => (
                  <tr
                    key={row.key}
                    className={row.highlight ? 'bg-[#FAF9F6]/50' : 'bg-white'}
                  >
                    <td className="px-5 py-3.5 font-medium text-[#57534E]">{row.label}</td>
                    {items.map((item) => (
                      <td
                        key={`${item._id}-${row.key}`}
                        className="px-5 py-3.5 text-[#141413] tabular-nums"
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
      </div>
    </div>
  );
}
