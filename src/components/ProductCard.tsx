import { useState } from 'react';
import { Eye, GitCompare, Heart, Share2, ShoppingBag, Star, Tag, TrendingUp, Zap } from 'lucide-react';
import type { Coupon, Product } from '../shared/types';
import { formatINR, logShareEvent, sendWhatsAppMessage } from '../lib/api';
import { useI18n } from '../lib/i18n';

interface ProductCardProps {
  product: Product;
  isLiked: boolean;
  onToggleLike: (productId: string) => void;
  onSelect: (product: Product) => void;
  onQuickAdd: (product: Product) => void;
  onQuickBuy?: (product: Product) => void;
  onShareWhatsApp?: (payload: {
    product: Product;
    waLink: string;
    messagePreview: string;
    sharesCount?: number;
  }) => void;
  isCompared?: boolean;
  onToggleCompare?: (product: Product) => void;
  isTopTrending?: boolean;
  activeCoupon?: Coupon | null;
}

export function ProductCard({
  product,
  isLiked,
  onToggleLike,
  onSelect,
  onQuickAdd,
  onQuickBuy,
  onShareWhatsApp,
  isCompared = false,
  onToggleCompare,
  isTopTrending = false,
  activeCoupon = null,
}: ProductCardProps) {
  const { t, tc, to, tseason, tb } = useI18n();
  const [imgError, setImgError] = useState(false);
  const [activeImgIdx, setActiveImgIdx] = useState(0);
  const [sharing, setSharing] = useState(false);

  const primaryImg = product.images[activeImgIdx]?.url || product.images[0]?.url;
  const leadBadge = product.badges[0];
  const primaryOccasion = product.occasions[0];
  const primarySeason = product.seasons?.[0];

  const uniqueColors = Array.from(
    new Map(product.variants.map((v) => [v.colorHex, v])).values()
  ).slice(0, 4);
  const uniqueSizesCount = new Set(product.variants.map((v) => v.size)).size;

  const quickSpecLine = product.jewellerySpecs
    ? `${product.jewellerySpecs.baseMetal} · ${product.jewellerySpecs.plating}`
    : product.clothingSpecs
      ? `${product.clothingSpecs.fabric} · ${product.clothingSpecs.fit}`
      : `${tc(product.category)} · ${product.subCategory}`;

  const handleShareClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSharing(true);
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const productUrl = `${origin}/?product=${encodeURIComponent(product.slug)}`;
      const msg = t('card.shareMessage', {
        title: product.title,
        price: formatINR(product.salePrice),
        url: productUrl,
      });
      const [result, logged] = await Promise.all([
        sendWhatsAppMessage('', msg),
        logShareEvent(product._id, 'whatsapp').catch(() => null),
      ]);
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(msg).catch(() => {});
      }
      if (onShareWhatsApp) {
        onShareWhatsApp({
          product,
          waLink: result.waLink,
          messagePreview: result.messagePreview,
          sharesCount: logged?.sharesCount,
        });
      }
    } finally {
      setSharing(false);
    }
  };

  return (
    <article className="group flex flex-col bg-white border border-[#E8E6E1] rounded-lg overflow-hidden transition-transform duration-150 hover:-translate-y-0.5">
      {/* Image Container: 4:3 consistent aspect ratio + Hover Quick Look Overlay */}
      <div
        className="group/img relative aspect-[4/3] w-full overflow-hidden bg-[#F2EFE9] cursor-pointer"
        onClick={() => onSelect(product)}
        onMouseEnter={() => {
          if (product.images.length > 1) setActiveImgIdx(1);
        }}
        onMouseLeave={() => setActiveImgIdx(0)}
      >
        {!imgError && primaryImg ? (
          <img
            src={primaryImg}
            alt={product.title}
            referrerPolicy="no-referrer"
            loading="lazy"
            onError={() => setImgError(true)}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#F2EFE9] to-[#E6E0D6] p-6 text-center">
            <span className="font-display text-lg font-medium text-[#57534E]">
              {tc(product.category)}
            </span>
            <span className="mt-1 text-xs text-[#78716C] line-clamp-2">{product.title}</span>
          </div>
        )}

        {/* Top Bar over Image: Multi-Image Indicator Dots (left) + Share/Like (right) */}
        <div className="relative z-20 flex items-start justify-between gap-2 p-3 pointer-events-none">
          {product.images.length > 1 ? (
            <div
              className="pointer-events-auto inline-flex items-center gap-1 rounded bg-black/45 px-2 py-1.5 backdrop-blur-xs"
              onClick={(e) => e.stopPropagation()}
            >
              {product.images.slice(0, 6).map((img, idx) => (
                <button
                  key={`${img.url}-${idx}`}
                  type="button"
                  aria-label={t('card.photoLabel', {
                    index: idx + 1,
                    total: product.images.length,
                  })}
                  onClick={(e) => {
                    e.stopPropagation();
                    setImgError(false);
                    setActiveImgIdx(idx);
                  }}
                  className={`h-1.5 rounded-full transition-all cursor-pointer ${
                    activeImgIdx === idx ? 'w-4 bg-white' : 'w-1.5 bg-white/60 hover:bg-white'
                  }`}
                />
              ))}
            </div>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-1.5 pointer-events-auto">
            <button
              type="button"
              disabled={sharing}
              title={t('card.shareWhatsapp')}
              aria-label={`${t('card.shareWhatsapp')}: ${product.title}`}
              onClick={handleShareClick}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-[#141413] shadow-sm backdrop-blur-xs transition-colors hover:bg-white hover:text-[#166534] cursor-pointer"
            >
              <Share2 className="h-4 w-4" />
            </button>

            <button
              type="button"
              aria-label={product.title}
              onClick={(e) => {
                e.stopPropagation();
                onToggleLike(product._id);
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-[#141413] shadow-sm backdrop-blur-xs transition-colors hover:bg-white cursor-pointer"
            >
              <Heart
                className={`h-4 w-4 transition-colors ${
                  isLiked ? 'fill-[#881337] text-[#881337]' : 'text-[#44403C]'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Hover-Triggered Quick Look Overlay */}
        <div
          className="absolute inset-0 z-10 flex flex-col justify-end bg-gradient-to-t from-black/90 via-black/65 to-black/25 p-2.5 sm:p-3.5 text-white opacity-0 pointer-events-none transition-opacity duration-200 group-hover/img:opacity-100 group-hover/img:pointer-events-auto group-focus-within/img:opacity-100 group-focus-within/img:pointer-events-auto"
        >
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wider text-white/85">
              <span className="inline-flex items-center gap-1">
                <Eye className="h-3 w-3" />
                {t('card.quickLook')}
              </span>
              <span className="tabular-nums text-white/80">
                {product.totalStock > 0
                  ? t('card.inStock', { count: product.totalStock })
                  : t('card.soldOut')}
              </span>
            </div>
            <div className="text-[11px] font-medium text-[#FDE68A] truncate">{quickSpecLine}</div>
            <p className="text-[11px] leading-snug text-white/90 line-clamp-2">
              {product.description}
            </p>
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-[10px] text-white/75 tabular-nums">
                {t('card.sizesCount', { count: uniqueSizesCount })}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(product);
                }}
                className="inline-flex items-center gap-1 rounded bg-white px-2.5 py-1 text-[11px] font-semibold text-[#141413] hover:bg-[#FAF9F6] transition-colors whitespace-nowrap cursor-pointer"
              >
                {t('card.viewDetails')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Card Body: Clean Zero-Pill Typography */}
      <div className="flex flex-1 flex-col justify-between p-4">
        <div>
          {/* Unboxed quiet metadata kicker + Top-10% Trending Indicator */}
          <div className="flex items-center gap-1.5 text-[12px] text-[#6B6A65] truncate">
            <span>{product.subCategory}</span>
            {primaryOccasion && (
              <>
                <span aria-hidden="true">·</span>
                <span>{to(primaryOccasion)}</span>
              </>
            )}
            {primarySeason && (
              <>
                <span aria-hidden="true">·</span>
                <span>{tseason(primarySeason)}</span>
              </>
            )}
            {isTopTrending ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 font-semibold text-[#881337]">
                  <TrendingUp className="h-3 w-3 shrink-0" />
                  <span>{t('badge.trending')}</span>
                </span>
              </>
            ) : (
              leadBadge && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-medium text-[#881337]">{tb(leadBadge)}</span>
                </>
              )
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] font-medium">
            {product.isReturnable !== false ? <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-800">Returnable · {product.returnWindowDays ?? 7} days</span> : <span className="rounded bg-[#F5F5F4] px-2 py-0.5 text-[#57534E]">Non-returnable</span>}
            {(product.onlinePaymentRequired || product.codAllowed === false) && <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-800">Prepaid only</span>}{product.isQualityChecked && <span className="rounded bg-sky-50 px-2 py-0.5 text-sky-800">Quality checked</span>}{product.manufacturerWarrantyVerified && <span className="rounded bg-indigo-50 px-2 py-0.5 text-indigo-800">Manufacturer warranty verified</span>}
          </div>

          {/* Product Title */}
          <h3
            onClick={() => onSelect(product)}
            className="mt-1.5 text-[15px] font-semibold leading-snug text-[#141413] line-clamp-2 cursor-pointer hover:text-[#881337] transition-colors"
          >
            {product.title}
          </h3>

          {/* Swatches & Rating Row */}
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {uniqueColors.map((v) => (
                <span
                  key={v.variantSku}
                  title={v.colorName}
                  className="h-3 w-3 rounded-full border border-black/15"
                  style={{ backgroundColor: v.colorHex }}
                />
              ))}
            </div>
            <div className="flex items-center gap-1 text-xs text-[#57534E] tabular-nums">
              <Star className="h-3.5 w-3.5 fill-[#A16207] text-[#A16207]" />
              <span className="font-medium text-[#141413]">
                {product.averageRating > 0 ? product.averageRating.toFixed(1) : t('card.new')}
              </span>
              <span className="text-[#A8A29E]">·</span>
              <span>
                {product.likesCount} {t('card.likes')}
              </span>
            </div>
          </div>

          {activeCoupon && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-emerald-800 truncate">
              <Tag className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {t('coupon.cardCodeHint', {
                  code: activeCoupon.code,
                  value:
                    activeCoupon.discountType === 'percentage'
                      ? `${activeCoupon.discountValue}%`
                      : formatINR(activeCoupon.discountValue),
                })}
              </span>
            </div>
          )}
        </div>

        {/* Pricing + Quick Buy / Add / Compare */}
        <div className="mt-4 space-y-2.5 border-t border-[#F0EEE9] pt-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-baseline gap-1.5 tabular-nums min-w-0">
              <span className="text-[15px] font-semibold text-[#141413]">
                {formatINR(product.salePrice)}
              </span>
              {product.discountPercent > 0 && (
                <>
                  <span className="text-xs text-[#A8A29E] line-through">
                    {formatINR(product.basePrice)}
                  </span>
                  <span className="text-xs font-medium text-[#881337] whitespace-nowrap">
                    {product.discountPercent}
                    {t('card.off')}
                  </span>
                </>
              )}
            </div>

            {product.category === 'Artificial Jewellery' && onToggleCompare && (
              <button
                type="button"
                title={t('card.compare')}
                onClick={() => onToggleCompare(product)}
                className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isCompared
                    ? 'border-[#141413] bg-[#141413] text-white'
                    : 'border-[#E8E6E1] bg-white text-[#44403C] hover:border-[#141413]'
                }`}
              >
                <GitCompare className="h-3 w-3" />
                <span>{isCompared ? t('card.added') : t('card.compare')}</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => (onQuickBuy ? onQuickBuy(product) : onSelect(product))}
              disabled={product.totalStock <= 0}
              className="inline-flex items-center justify-center gap-1 rounded-md bg-[#141413] px-2.5 py-2 sm:py-1.5 text-[11px] sm:text-xs font-medium text-white transition-colors hover:bg-[#292524] disabled:opacity-40 whitespace-nowrap cursor-pointer min-w-0"
            >
              <Zap className="h-3 w-3 shrink-0" />
              <span className="truncate">{t('card.quickBuy')}</span>
            </button>

            <button
              type="button"
              onClick={() => onQuickAdd(product)}
              disabled={product.totalStock <= 0}
              className="inline-flex items-center justify-center gap-1 rounded-md border border-[#D6D3CD] bg-white px-2.5 py-2 sm:py-1.5 text-[11px] sm:text-xs font-medium text-[#141413] transition-colors hover:border-[#881337] hover:bg-[#881337] hover:text-white disabled:opacity-40 whitespace-nowrap cursor-pointer min-w-0"
            >
              <ShoppingBag className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {product.totalStock > 0 ? t('card.add') : t('card.soldOut')}
              </span>
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
