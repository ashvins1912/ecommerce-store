import { useCallback, useEffect, useState } from 'react';
import { GitCompare, Heart, ShoppingBag, Trash2 } from 'lucide-react';
import type { Product, ProductVariant } from '../shared/types';
import { apiFetch, formatINR } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { ProductCardSkeleton } from './ProductCardSkeleton';

interface WishlistViewProps {
  likedIds: Set<string>;
  onRemoveFromWishlist: (productId: string) => void;
  onAddToCart: (product: Product, variant: ProductVariant, quantity: number) => void;
  onSelectProduct: (product: Product) => void;
  compareIds: Set<string>;
  onToggleCompare: (product: Product) => void;
  onBrowseCatalog: () => void;
}

export function WishlistView({
  likedIds,
  onRemoveFromWishlist,
  onAddToCart,
  onSelectProduct,
  compareIds,
  onToggleCompare,
  onBrowseCatalog,
}: WishlistViewProps) {
  const { t, tc } = useI18n();
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const loadWishlist = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ products: Product[] }>('/api/likes/products');
      setItems(res.products);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWishlist();
  }, [loadWishlist, likedIds.size]);

  const visibleItems = items.filter((item) => likedIds.has(item._id));

  return (
    <main className="mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[#E8E6E1] pb-6">
        <div>
          <h1 className="font-display text-3xl font-semibold text-[#141413]">
            {t('wishlist.title')}
          </h1>
          <p className="mt-1 text-xs text-[#6B6A65] tabular-nums">
            {t('wishlist.count', {
              count: visibleItems.length,
              unit: visibleItems.length === 1 ? t('wishlist.piece') : t('wishlist.pieces'),
            })}
          </p>
        </div>

        <button
          type="button"
          onClick={onBrowseCatalog}
          className="rounded-md border border-[#D6D3CD] bg-white px-4 py-2 text-xs font-medium text-[#141413] hover:border-[#881337] self-start cursor-pointer"
        >
          {t('wishlist.continue')}
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {Array.from({ length: 4 }).map((_, idx) => (
            <ProductCardSkeleton key={idx} />
          ))}
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="mx-auto max-w-md rounded-lg border border-[#E8E6E1] bg-white p-10 text-center space-y-4">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#FAF9F6] text-[#881337]">
            <Heart className="h-5 w-5" />
          </div>
          <h2 className="font-display text-2xl font-semibold text-[#141413]">
            {t('wishlist.emptyTitle')}
          </h2>
          <p className="text-xs leading-relaxed text-[#6B6A65]">{t('wishlist.emptyDesc')}</p>
          <button
            type="button"
            onClick={onBrowseCatalog}
            className="rounded-md bg-[#881337] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#9F1239] cursor-pointer"
          >
            {t('wishlist.explore')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {visibleItems.map((product) => {
            const defaultVariant = product.variants[0];
            const isCompared = compareIds.has(product._id);

            return (
              <article
                key={product._id}
                className="flex flex-col rounded-lg border border-[#E8E6E1] bg-white overflow-hidden"
              >
                <div
                  onClick={() => onSelectProduct(product)}
                  className="relative aspect-[4/3] w-full bg-[#F2EFE9] overflow-hidden cursor-pointer"
                >
                  <img
                    src={product.images[0]?.url}
                    alt={product.title}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover transition-transform duration-300 hover:scale-[1.03]"
                  />
                </div>

                <div className="flex flex-1 flex-col justify-between p-4 space-y-4">
                  <div>
                    <div className="text-[12px] text-[#6B6A65]">
                      {tc(product.category)} · {product.subCategory}
                    </div>
                    <h3
                      onClick={() => onSelectProduct(product)}
                      className="mt-1 text-[15px] font-semibold leading-snug text-[#141413] line-clamp-2 cursor-pointer hover:text-[#881337]"
                    >
                      {product.title}
                    </h3>
                    <div className="mt-2 flex items-baseline gap-2 tabular-nums">
                      <span className="text-[15px] font-semibold text-[#141413]">
                        {formatINR(product.salePrice)}
                      </span>
                      {product.discountPercent > 0 && (
                        <>
                          <span className="text-xs text-[#A8A29E] line-through">
                            {formatINR(product.basePrice)}
                          </span>
                          <span className="text-xs font-medium text-[#881337]">
                            {product.discountPercent}
                            {t('card.off')}
                          </span>
                        </>
                      )}
                    </div>
                    {defaultVariant && (
                      <div className="mt-1.5 text-[11px] text-[#6B6A65]">
                        {defaultVariant.colorName} · {t('detail.sizeLabel')} {defaultVariant.size}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2 border-t border-[#F0EEE9] pt-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={!defaultVariant || product.totalStock <= 0}
                        onClick={() =>
                          defaultVariant && onAddToCart(product, defaultVariant, 1)
                        }
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-[#881337] px-3 py-2 text-xs font-medium text-white hover:bg-[#9F1239] disabled:opacity-40 cursor-pointer"
                      >
                        <ShoppingBag className="h-3.5 w-3.5" />
                        <span>
                          {product.totalStock > 0 ? t('card.addToBag') : t('card.soldOut')}
                        </span>
                      </button>

                      <button
                        type="button"
                        aria-label={product.title}
                        onClick={() => onRemoveFromWishlist(product._id)}
                        className="inline-flex items-center justify-center rounded-md border border-[#D6D3CD] p-2 text-[#57534E] hover:border-red-300 hover:text-red-700 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {product.category === 'Artificial Jewellery' && (
                      <button
                        type="button"
                        onClick={() => onToggleCompare(product)}
                        className={`w-full inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                          isCompared
                            ? 'border-[#141413] bg-[#141413] text-white'
                            : 'border-[#E8E6E1] text-[#44403C] hover:border-[#141413]'
                        }`}
                      >
                        <GitCompare className="h-3.5 w-3.5" />
                        <span>
                          {isCompared
                            ? t('wishlist.compareSelected')
                            : t('wishlist.compareSpecs')}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
