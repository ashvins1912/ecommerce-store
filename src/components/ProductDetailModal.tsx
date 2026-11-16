import { useCallback, useEffect, useRef, useState } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import {
  ChevronLeft,
  ChevronRight,
  Expand,
  GitCompare,
  Heart,
  Ruler,
  ShieldCheck,
  ShoppingBag,
  Star,
  Tag,
  X,
  ZoomIn,
} from 'lucide-react';
import type {
  Coupon,
  Product,
  ProductVariant,
  Review,
  ReviewClass,
  User,
} from '../shared/types';
import { apiFetch, formatINR } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { ProductCard } from './ProductCard';
import { ProductZoomViewer } from './ProductZoomViewer';
import { SizeGuideModal } from './SizeGuideModal';

const REVIEW_CLASSES: ReviewClass[] = [
  'Quality',
  'Finish & Shine',
  'Value for Money',
  'Fit & Sizing',
  'Packaging',
];

interface ProductDetailModalProps {
  productIdOrSlug: string | null;
  initialVariantSku?: string | null;
  onClose: () => void;
  user: User | null;
  likedProductIds: Set<string>;
  onToggleLike: (productId: string) => void;
  onAddToCart: (product: Product, variant: ProductVariant, quantity: number) => void;
  onSelectProduct: (product: Product) => void;
  onQuickBuy?: (product: Product) => void;
  onShareWhatsApp?: (payload: {
    product: Product;
    waLink: string;
    messagePreview: string;
  }) => void;
  onOpenAuth: () => void;
  compareIds?: Set<string>;
  onToggleCompare?: (product: Product) => void;
  categoryTop10Thresholds?: Record<string, number>;
  onProductLoaded?: (product: Product) => void;
  onApplyCoupon?: (code: string) => void;
}

export function ProductDetailModal({
  productIdOrSlug,
  initialVariantSku,
  onClose,
  user,
  likedProductIds,
  onToggleLike,
  onAddToCart,
  onSelectProduct,
  onQuickBuy,
  onShareWhatsApp,
  onOpenAuth,
  compareIds,
  onToggleCompare,
  categoryTop10Thresholds,
  onProductLoaded,
  onApplyCoupon,
}: ProductDetailModalProps) {
  const { t, tc, to, tseason, tr, tsent } = useI18n();
  const [loading, setLoading] = useState(false);
  const [product, setProduct] = useState<Product | null>(null);
  const [productCoupons, setProductCoupons] = useState<Coupon[]>([]);
  const [queuedCouponCode, setQueuedCouponCode] = useState<string | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [recommendations, setRecommendations] = useState<Product[]>([]);
  const [recStrategy, setRecStrategy] = useState('');
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxInitialZoom, setLightboxInitialZoom] = useState(1);
  const [hoverZoom, setHoverZoom] = useState<{
    idx: number;
    xPct: number;
    yPct: number;
  } | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [sizeGuideOpen, setSizeGuideOpen] = useState(false);
  const [supportsHoverZoom, setSupportsHoverZoom] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return true;
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    const onChange = () => setSupportsHoverZoom(mq.matches);
    onChange();
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  // Review composer state
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [selectedClasses, setSelectedClasses] = useState<ReviewClass[]>(['Quality', 'Finish & Shine']);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [submittingReview, setSubmittingReview] = useState(false);

  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: true,
    watchDrag: (_api, evt) => 'touches' in evt,
  });

  const onProductLoadedRef = useRef(onProductLoaded);
  onProductLoadedRef.current = onProductLoaded;

  const initialVariantSkuRef = useRef(initialVariantSku);
  initialVariantSkuRef.current = initialVariantSku;

  const loadProduct = useCallback(async (idOrSlug: string) => {
    setLoading(true);
    setReviewError(null);
    try {
      const data = await apiFetch<{
        product: Product;
        reviews: Review[];
        recommendations: Product[];
        recommendationStrategy: string;
      }>(`/api/products/${encodeURIComponent(idOrSlug)}`);
      setProduct(data.product);
      onProductLoadedRef.current?.(data.product);
      setReviews(data.reviews);
      setRecommendations(data.recommendations);
      setRecStrategy(data.recommendationStrategy);
      const skuToMatch = initialVariantSkuRef.current;
      const matchedInitial = skuToMatch
        ? data.product.variants.find((v) => v.variantSku === skuToMatch)
        : null;
      setSelectedVariant(matchedInitial || data.product.variants[0] || null);
      setQuantity(1);
      setActiveSlide(0);
      try {
        const cRes = await apiFetch<{ coupons: Coupon[] }>(
          `/api/coupons/applicable?productId=${encodeURIComponent(data.product._id)}`
        );
        setProductCoupons(cRes.coupons || []);
      } catch {
        setProductCoupons([]);
      }
    } catch {
      setProduct(null);
      setProductCoupons([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (productIdOrSlug) {
      setQueuedCouponCode(null);
      setHoverZoom(null);
      setLightboxOpen(false);
      loadProduct(productIdOrSlug);
    } else {
      setProduct(null);
      setProductCoupons([]);
      setHoverZoom(null);
      setLightboxOpen(false);
    }
  }, [productIdOrSlug, user?._id, loadProduct]);

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => {
      setActiveSlide(emblaApi.selectedScrollSnap());
      setHoverZoom(null);
    };
    emblaApi.on('select', onSelect);
    return () => {
      emblaApi.off('select', onSelect);
    };
  }, [emblaApi]);

  const openZoomViewer = (idx: number, initialZoomLevel = 1) => {
    setHoverZoom(null);
    setLightboxIndex(idx);
    setLightboxInitialZoom(initialZoomLevel);
    setLightboxOpen(true);
  };

  if (!productIdOrSlug) return null;

  const uniqueColors = product
    ? Array.from(new Map(product.variants.map((v) => [v.colorName, v])).values())
    : [];
  const availableSizes = product
    ? Array.from(new Set(product.variants.map((v) => v.size)))
    : [];

  const unitPrice = selectedVariant?.priceOverride || product?.salePrice || 0;

  // Compute aspect-level rating breakdown from reviews
  const aspectStats = REVIEW_CLASSES.map((cls) => {
    const matching = reviews.filter((r) => r.reviewClasses.includes(cls));
    const avg =
      matching.length > 0
        ? matching.reduce((s, r) => s + r.rating, 0) / matching.length
        : 0;
    return { cls, count: matching.length, avg };
  });

  const sentimentCounts = {
    Positive: reviews.filter((r) => r.sentiment === 'Positive').length,
    Neutral: reviews.filter((r) => r.sentiment === 'Neutral').length,
    Negative: reviews.filter((r) => r.sentiment === 'Negative').length,
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product) return;
    if (!user) {
      onOpenAuth();
      return;
    }
    setReviewError(null);
    setSubmittingReview(true);
    try {
      const { review } = await apiFetch<{ review: Review }>('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({
          productId: product._id,
          rating,
          comment,
          reviewClasses: selectedClasses,
        }),
      });
      setReviews((prev) => [review, ...prev]);
      setComment('');
    } catch (err) {
      setReviewError((err as Error).message);
    } finally {
      setSubmittingReview(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-0 sm:p-4 md:p-6 backdrop-blur-xs">
      <div className="mx-auto min-h-dvh sm:min-h-0 max-w-6xl bg-[#FAF9F6] sm:rounded-xl border border-[#E8E6E1] shadow-2xl overflow-hidden">
        {/* Top Modal Close Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[#E8E6E1] bg-white/95 px-4 sm:px-6 py-3 backdrop-blur-sm">
          <div className="text-xs font-medium text-[#6B6A65] truncate">
            {product ? `${tc(product.category)} · ${product.subCategory}` : t('detail.loadingProduct')}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('detail.close')}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-md border border-[#E8E6E1] bg-white px-3 text-xs font-medium text-[#141413] hover:bg-[#F5F3EE] shrink-0 cursor-pointer"
          >
            <X className="h-4 w-4" />
            <span>{t('detail.close')}</span>
          </button>
        </div>

        {loading || !product ? (
          <div className="p-8 sm:p-12 text-center text-sm text-[#6B6A65]">
            {loading ? t('detail.loadingDossier') : t('detail.loadError')}
          </div>
        ) : (
          <div className="p-4 sm:p-6 md:p-8 space-y-8 sm:space-y-10">
            {/* Contiguous Purchase Module: Sticky Gallery Left + Purchase Module Right */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Left: Embla Carousel + Click-to-Open Zoom Lightbox */}
              <div className="lg:col-span-7 space-y-3">
                <div className="relative overflow-hidden rounded-lg border border-[#E8E6E1] bg-[#F2EFE9]">
                  <div className="overflow-hidden" ref={emblaRef}>
                    <div className="flex">
                      {product.images.map((img, idx) => {
                        const isHoveringThisSlide =
                          supportsHoverZoom && hoverZoom?.idx === idx;
                        return (
                          <div
                            key={`${img.url}-${idx}`}
                            onMouseMove={(e) => {
                              if (!supportsHoverZoom) return;
                              if ((e.target as HTMLElement).closest('button')) {
                                setHoverZoom((prev) => (prev?.idx === idx ? null : prev));
                                return;
                              }
                              const rect = e.currentTarget.getBoundingClientRect();
                              if (rect.width <= 0 || rect.height <= 0) return;
                              const xPct = Math.min(
                                100,
                                Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)
                              );
                              const yPct = Math.min(
                                100,
                                Math.max(0, ((e.clientY - rect.top) / rect.height) * 100)
                              );
                              setHoverZoom({ idx, xPct, yPct });
                            }}
                            onMouseLeave={() => {
                              setHoverZoom((prev) => (prev?.idx === idx ? null : prev));
                            }}
                            onClick={() => openZoomViewer(idx, 1)}
                            className={`relative aspect-[4/3] min-w-full overflow-hidden select-none ${
                              supportsHoverZoom ? 'cursor-zoom-in' : 'cursor-pointer'
                            }`}
                          >
                            {/* Base image always remains visible so hover transitions never blink */}
                            <img
                              src={img.url}
                              alt={img.altText || product.title}
                              referrerPolicy="no-referrer"
                              draggable={false}
                              loading={idx === 0 ? 'eager' : 'lazy'}
                              decoding="async"
                              className="h-full w-full object-cover select-none"
                            />

                            {/* Crisp 2.5x GPU-composited hover loupe overlay on desktop */}
                            {isHoveringThisSlide && hoverZoom && (
                              <>
                                <img
                                  src={img.url}
                                  alt=""
                                  aria-hidden="true"
                                  referrerPolicy="no-referrer"
                                  draggable={false}
                                  style={{
                                    transform: 'scale(2.5)',
                                    transformOrigin: `${hoverZoom.xPct}% ${hoverZoom.yPct}%`,
                                  }}
                                  className="pointer-events-none absolute inset-0 h-full w-full object-cover select-none will-change-transform"
                                />
                                <div
                                  aria-hidden="true"
                                  style={{
                                    left: `${hoverZoom.xPct}%`,
                                    top: `${hoverZoom.yPct}%`,
                                  }}
                                  className="pointer-events-none absolute h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80 shadow-sm ring-1 ring-black/20"
                                />
                              </>
                            )}

                            {/* Interactive Magnifying Glass button: opens viewer zoomed to 2.2x */}
                            <button
                              type="button"
                              onMouseEnter={() => setHoverZoom(null)}
                              onClick={(e) => {
                                e.stopPropagation();
                                openZoomViewer(idx, 2.2);
                              }}
                              aria-label={t('detail.zoomIn')}
                              className="absolute bottom-3 left-3 z-20 inline-flex min-h-[44px] items-center gap-1.5 rounded-md bg-white/95 px-3 py-1.5 text-[11px] font-medium text-[#141413] shadow-xs hover:bg-white cursor-pointer"
                            >
                              <ZoomIn className="h-3.5 w-3.5 text-[#881337]" />
                              <span>
                                {supportsHoverZoom
                                  ? t('detail.hoverZoom')
                                  : t('detail.tapToZoom')}
                              </span>
                            </button>

                            {/* Interactive Fullscreen button */}
                            <button
                              type="button"
                              onMouseEnter={() => setHoverZoom(null)}
                              onClick={(e) => {
                                e.stopPropagation();
                                openZoomViewer(idx, 1);
                              }}
                              aria-label={t('detail.fullscreen')}
                              className="absolute bottom-3 right-3 z-20 inline-flex min-h-[44px] items-center gap-1.5 rounded-md bg-white/95 px-3 py-1.5 text-[11px] font-medium text-[#141413] shadow-xs hover:bg-white cursor-pointer"
                            >
                              <Expand className="h-3.5 w-3.5" />
                              <span>{t('detail.fullscreen')}</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {product.images.length > 1 && (
                    <>
                      <button
                        type="button"
                        aria-label={t('pagination.prev')}
                        onMouseEnter={() => setHoverZoom(null)}
                        onClick={() => emblaApi?.scrollPrev()}
                        className="absolute left-3 top-1/2 -translate-y-1/2 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-[#141413] shadow-sm hover:bg-white cursor-pointer"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={t('pagination.next')}
                        onMouseEnter={() => setHoverZoom(null)}
                        onClick={() => emblaApi?.scrollNext()}
                        className="absolute right-3 top-1/2 -translate-y-1/2 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-[#141413] shadow-sm hover:bg-white cursor-pointer"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>

                {/* Thumbnail Strip */}
                {product.images.length > 1 && (
                  <div className="flex items-center gap-2.5 overflow-x-auto pb-1">
                    {product.images.map((img, idx) => (
                      <button
                        key={`thumb-${idx}`}
                        type="button"
                        onClick={() => emblaApi?.scrollTo(idx)}
                        className={`h-16 w-20 shrink-0 overflow-hidden rounded-md border transition-colors cursor-pointer ${
                          activeSlide === idx
                            ? 'border-[#881337] ring-1 ring-[#881337]'
                            : 'border-[#E8E6E1] opacity-75 hover:opacity-100'
                        }`}
                      >
                        <img
                          src={img.thumbUrl || img.url}
                          alt={`Thumbnail ${idx + 1}`}
                          referrerPolicy="no-referrer"
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Right: Contiguous Purchase Module */}
              <div className="lg:col-span-5 bg-white border border-[#E8E6E1] rounded-lg p-4 sm:p-6 space-y-5">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[#6B6A65]">
                    <span>{product.sellerName || t('brand')}</span>
                    {(product.sellerTrusted || product.isProductTrusted) && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 font-medium text-[#166534]">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          {t('detail.verifiedTrust')}
                        </span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-[11px]">{product.sku}</span>
                  </div>

                  <h1 className="mt-2 font-display text-2xl sm:text-3xl font-semibold leading-tight text-[#141413]">
                    {product.title}
                  </h1>

                  <div className="mt-2 flex items-center gap-2 text-xs text-[#57534E] tabular-nums">
                    <span className="inline-flex items-center gap-1 font-semibold text-[#141413]">
                      <Star className="h-3.5 w-3.5 fill-[#A16207] text-[#A16207]" />
                      {product.averageRating > 0 ? product.averageRating.toFixed(1) : t('card.new')}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{t('detail.verifiedReviewsCount', { count: reviews.length })}</span>
                    <span aria-hidden="true">·</span>
                    <span>{t('detail.sold', { count: product.salesCount })}</span>
                  </div>
                </div>

                {/* Price Block */}
                <div className="border-y border-[#F0EEE9] py-4 flex items-baseline gap-3 tabular-nums">
                  <span className="text-2xl font-semibold text-[#141413]">
                    {formatINR(unitPrice)}
                  </span>
                  {product.discountPercent > 0 && (
                    <>
                      <span className="text-sm text-[#A8A29E] line-through">
                        {formatINR(product.basePrice)}
                      </span>
                      <span className="text-xs font-semibold text-[#881337]">
                        {t('detail.savePercent', { percent: product.discountPercent })}
                      </span>
                    </>
                  )}
                </div>

                {/* Product-Level Seller Coupons (Assigned or Product-Selected) */}
                {productCoupons.length > 0 && (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-3 space-y-2">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-900">
                      <Tag className="h-3.5 w-3.5" />
                      <span>{t('coupon.productOffers')}</span>
                    </div>
                    <div className="space-y-2">
                      {productCoupons.map((cpn) => {
                        const isPersonal =
                          cpn.assignedUserIds.length > 0 || cpn.assignedEmails.length > 0;
                        const isQueued = queuedCouponCode === cpn.code;
                        return (
                          <div
                            key={cpn._id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded border border-emerald-200/80 bg-white px-3 py-2 text-xs"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 font-semibold text-[#141413]">
                                <span className="font-mono text-emerald-800">{cpn.code}</span>
                                <span>·</span>
                                <span>
                                  {cpn.discountType === 'percentage'
                                    ? `${cpn.discountValue}% off`
                                    : `${formatINR(cpn.discountValue)} off`}
                                </span>
                                {isPersonal && (
                                  <span className="text-[10px] font-semibold text-[#881337]">
                                    · {t('coupon.assignedYou')}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-[#57534E]">{cpn.title}</div>
                            </div>
                            {onApplyCoupon && (
                              <button
                                type="button"
                                onClick={() => {
                                  setQueuedCouponCode(cpn.code);
                                  onApplyCoupon(cpn.code);
                                  if (selectedVariant) {
                                    onAddToCart(product, selectedVariant, quantity);
                                  }
                                }}
                                className="rounded border border-emerald-700 bg-emerald-700 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-800 cursor-pointer"
                              >
                                {isQueued ? t('card.added') : t('coupon.applyAtCheckout')}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Occasions & Seasons Line */}
                <div className="space-y-1 text-xs text-[#57534E]">
                  <div>
                    <span className="font-medium text-[#141413]">
                      {t('detail.occasionsLabel')}:{' '}
                    </span>
                    {product.occasions.map((o) => to(o)).join(' · ')}
                  </div>
                  {product.seasons && product.seasons.length > 0 && (
                    <div>
                      <span className="font-medium text-[#141413]">
                        {t('seller.seasonsLabel')}:{' '}
                      </span>
                      {product.seasons.map((s) => tseason(s)).join(' · ')}
                    </div>
                  )}
                </div>

                {/* Color Swatch Selector */}
                {uniqueColors.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-[#141413] mb-2">
                      {t('detail.finishColorLabel')}:{' '}
                      <span className="font-normal text-[#6B6A65]">
                        {selectedVariant?.colorName}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {uniqueColors.map((v) => {
                        const active = selectedVariant?.colorName === v.colorName;
                        return (
                          <button
                            key={v.variantSku}
                            type="button"
                            onClick={() => {
                              const matched =
                                product.variants.find(
                                  (x) =>
                                    x.colorName === v.colorName &&
                                    x.size === (selectedVariant?.size || v.size)
                                ) || v;
                              setSelectedVariant(matched);
                            }}
                            className={`inline-flex min-h-[44px] sm:min-h-[38px] items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                              active
                                ? 'border-[#881337] bg-[#881337]/5 text-[#141413] font-medium'
                                : 'border-[#E8E6E1] text-[#57534E] hover:border-[#A8A29E]'
                            }`}
                          >
                            <span
                              className="h-3 w-3 rounded-full border border-black/15"
                              style={{ backgroundColor: v.colorHex }}
                            />
                            <span>{v.colorName}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Size Selector + Clothing Size Guide Trigger */}
                {availableSizes.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-[#141413]">
                        {t('detail.sizeLabel')}
                      </span>
                      {product.category === 'Clothing' && (
                        <button
                          type="button"
                          onClick={() => setSizeGuideOpen(true)}
                          className="inline-flex min-h-[44px] items-center gap-1 text-xs font-medium text-[#881337] hover:underline cursor-pointer"
                        >
                          <Ruler className="h-3.5 w-3.5" />
                          <span>{t('detail.sizeGuide')}</span>
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {availableSizes.map((sz) => {
                        const active = selectedVariant?.size === sz;
                        return (
                          <button
                            key={sz}
                            type="button"
                            onClick={() => {
                              const matched =
                                product.variants.find(
                                  (x) =>
                                    x.size === sz &&
                                    x.colorName === (selectedVariant?.colorName || x.colorName)
                                ) || product.variants.find((x) => x.size === sz);
                              if (matched) setSelectedVariant(matched);
                            }}
                            className={`min-h-[44px] sm:min-h-[38px] min-w-[44px] rounded-md border px-3 py-1.5 text-xs tabular-nums transition-colors cursor-pointer ${
                              active
                                ? 'border-[#141413] bg-[#141413] text-white font-medium'
                                : 'border-[#E8E6E1] text-[#44403C] hover:border-[#141413]'
                            }`}
                          >
                            {sz}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Quantity & Primary CTAs */}
                <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 pt-1">
                  <div className="inline-flex items-center rounded-md border border-[#D6D3CD]">
                    <button
                      type="button"
                      aria-label="Decrease quantity"
                      onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                      className="inline-flex h-11 w-10 items-center justify-center text-xs font-medium text-[#141413] hover:bg-[#F5F3EE] cursor-pointer"
                    >
                      -
                    </button>
                    <span className="px-3 text-xs font-semibold tabular-nums">{quantity}</span>
                    <button
                      type="button"
                      aria-label="Increase quantity"
                      onClick={() => setQuantity((q) => Math.min(10, q + 1))}
                      className="inline-flex h-11 w-10 items-center justify-center text-xs font-medium text-[#141413] hover:bg-[#F5F3EE] cursor-pointer"
                    >
                      +
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={product.totalStock <= 0}
                    onClick={() =>
                      selectedVariant && onAddToCart(product, selectedVariant, quantity)
                    }
                    className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 rounded-md bg-[#881337] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#9F1239] disabled:opacity-40 transition-colors cursor-pointer"
                  >
                    <ShoppingBag className="h-4 w-4" />
                    <span>
                      {product.totalStock > 0 ? t('card.addToBag') : t('card.outOfStock')}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onToggleLike(product._id)}
                    aria-label={t('nav.wishlist')}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-[#D6D3CD] hover:border-[#881337] cursor-pointer"
                  >
                    <Heart
                      className={`h-4 w-4 ${
                        likedProductIds.has(product._id)
                          ? 'fill-[#881337] text-[#881337]'
                          : 'text-[#44403C]'
                      }`}
                    />
                  </button>
                </div>

                {product.category === 'Artificial Jewellery' && onToggleCompare && (
                  <button
                    type="button"
                    onClick={() => onToggleCompare(product)}
                    className={`w-full inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-xs font-medium transition-colors cursor-pointer ${
                      compareIds?.has(product._id)
                        ? 'border-[#141413] bg-[#141413] text-white'
                        : 'border-[#D6D3CD] bg-white text-[#141413] hover:border-[#141413]'
                    }`}
                  >
                    <GitCompare className="h-3.5 w-3.5" />
                    <span>
                      {compareIds?.has(product._id)
                        ? t('detail.compareSelected')
                        : t('detail.compareCta')}
                    </span>
                  </button>
                )}

                <p className="text-xs leading-relaxed text-[#57534E]">{product.description}</p>
              </div>
            </div>

            {/* Category Specifications */}
            <section className="border-t border-[#E8E6E1] pt-8">
              <h2 className="font-display text-2xl font-semibold text-[#141413]">
                {t('detail.specsTitle')}
              </h2>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4 bg-white border border-[#E8E6E1] rounded-lg p-6 text-xs">
                {product.jewellerySpecs && (
                  <>
                    <div>
                      <div className="text-[#6B6A65]">{t('detail.baseMetal')}</div>
                      <div className="mt-0.5 font-medium text-[#141413]">
                        {product.jewellerySpecs.baseMetal}
                      </div>
                    </div>
                    <div>
                      <div className="text-[#6B6A65]">{t('detail.plating')}</div>
                      <div className="mt-0.5 font-medium text-[#141413]">
                        {product.jewellerySpecs.plating}
                      </div>
                    </div>
                    <div>
                      <div className="text-[#6B6A65]">{t('detail.stoneType')}</div>
                      <div className="mt-0.5 font-medium text-[#141413]">
                        {product.jewellerySpecs.stoneType}
                      </div>
                    </div>
                    <div>
                      <div className="text-[#6B6A65]">{t('detail.weight')}</div>
                      <div className="mt-0.5 font-medium text-[#141413] tabular-nums">
                        {product.jewellerySpecs.weightGrams} g
                      </div>
                    </div>
                    <div>
                      <div className="text-[#6B6A65]">{t('detail.dimensions')}</div>
                      <div className="mt-0.5 font-medium text-[#141413]">
                        {product.jewellerySpecs.dimensions}
                      </div>
                    </div>
                    <div>
                      <div className="text-[#6B6A65]">{t('detail.closureType')}</div>
                      <div className="mt-0.5 font-medium text-[#141413]">
                        {product.jewellerySpecs.closureType}
                      </div>
                    </div>
                  </>
                )}

                {product.clothingSpecs && (
                  <>
                    <div>
                      <div className="text-[#6B6A65]">{t('detail.fabric')}</div>
                      <div className="mt-0.5 font-medium text-[#141413]">
                        {product.clothingSpecs.fabric}
                      </div>
                    </div>
                    <div>
                      <div className="text-[#6B6A65]">{t('detail.fit')}</div>
                      <div className="mt-0.5 font-medium text-[#141413]">
                        {product.clothingSpecs.fit}
                      </div>
                    </div>
                    <div>
                      <div className="text-[#6B6A65]">{t('detail.pattern')}</div>
                      <div className="mt-0.5 font-medium text-[#141413]">
                        {product.clothingSpecs.pattern}
                      </div>
                    </div>
                    <div>
                      <div className="text-[#6B6A65]">{t('detail.sleeveType')}</div>
                      <div className="mt-0.5 font-medium text-[#141413]">
                        {product.clothingSpecs.sleeveType}
                      </div>
                    </div>
                    <div>
                      <div className="text-[#6B6A65]">{t('detail.neckline')}</div>
                      <div className="mt-0.5 font-medium text-[#141413]">
                        {product.clothingSpecs.neckType}
                      </div>
                    </div>
                    <div>
                      <div className="text-[#6B6A65]">{t('detail.washCare')}</div>
                      <div className="mt-0.5 font-medium text-[#141413]">
                        {product.clothingSpecs.washCare}
                      </div>
                    </div>
                  </>
                )}

                <div className="sm:col-span-2 lg:col-span-3 border-t border-[#F0EEE9] pt-3">
                  <div className="text-[#6B6A65]">{t('detail.careInstructions')}</div>
                  <div className="mt-0.5 font-medium text-[#141413]">
                    {product.careInstructions}
                  </div>
                </div>
              </div>
            </section>

            {/* Classed Reviews & Sentiment Analysis */}
            <section className="border-t border-[#E8E6E1] pt-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-5 space-y-5">
                <div>
                  <h2 className="font-display text-2xl font-semibold text-[#141413]">
                    {t('detail.reviewsTitle')}
                  </h2>
                  <p className="mt-1 text-xs text-[#6B6A65] tabular-nums">
                    {t('detail.sentimentLine', {
                      pos: sentimentCounts.Positive,
                      neu: sentimentCounts.Neutral,
                      neg: sentimentCounts.Negative,
                    })}
                  </p>
                </div>

                {/* Aspect Rating Bars */}
                <div className="bg-white border border-[#E8E6E1] rounded-lg p-5 space-y-3">
                  {aspectStats.map(({ cls, count, avg }) => (
                    <div key={cls} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-[#141413]">{tr(cls)}</span>
                        <span className="text-[#6B6A65] tabular-nums">
                          {count > 0 ? `${avg.toFixed(1)} / 5 (${count})` : t('detail.noRatingsYet')}
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-[#F0EEE9] overflow-hidden">
                        <div
                          className="h-full bg-[#881337] transition-all"
                          style={{ width: `${(avg / 5) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Submit Verified Review Form */}
                <form
                  onSubmit={handleSubmitReview}
                  className="bg-white border border-[#E8E6E1] rounded-lg p-5 space-y-3"
                >
                  <div className="text-xs font-semibold text-[#141413]">
                    {t('detail.writeReview')}
                  </div>
                  {reviewError && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      {reviewError}
                    </div>
                  )}
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRating(star)}
                        className="p-1 cursor-pointer"
                      >
                        <Star
                          className={`h-4 w-4 ${
                            star <= rating
                              ? 'fill-[#A16207] text-[#A16207]'
                              : 'text-[#D6D3CD]'
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {REVIEW_CLASSES.map((cls) => {
                      const active = selectedClasses.includes(cls);
                      return (
                        <button
                          key={cls}
                          type="button"
                          onClick={() =>
                            setSelectedClasses((prev) =>
                              prev.includes(cls)
                                ? prev.length > 1
                                  ? prev.filter((x) => x !== cls)
                                  : prev
                                : [...prev, cls]
                            )
                          }
                          className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                            active
                              ? 'border-[#881337] bg-[#881337] text-white'
                              : 'border-[#E8E6E1] text-[#57534E]'
                          }`}
                        >
                          {tr(cls)}
                        </button>
                      );
                    })}
                  </div>
                  <textarea
                    rows={3}
                    required
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder={t('detail.reviewPlaceholder')}
                    className="w-full rounded-md border border-[#D6D3CD] p-2.5 text-xs focus:border-[#881337] focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={submittingReview}
                    className="w-full rounded-md bg-[#141413] px-4 py-2 text-xs font-medium text-white hover:bg-[#292524] cursor-pointer"
                  >
                    {submittingReview ? t('detail.submittingReview') : t('detail.submitReview')}
                  </button>
                </form>
              </div>

              <div className="lg:col-span-7 space-y-3">
                {reviews.length === 0 ? (
                  <div className="rounded-lg border border-[#E8E6E1] bg-white p-8 text-center text-xs text-[#6B6A65]">
                    {t('detail.noReviews')}
                  </div>
                ) : (
                  reviews.map((rev) => (
                    <div
                      key={rev._id}
                      className="rounded-lg border border-[#E8E6E1] bg-white p-5 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <div className="font-semibold text-[#141413]">
                          {rev.userName}{' '}
                          <span className="font-normal text-[#6B6A65]">
                            · {t('detail.verifiedPurchase')} · {tsent(rev.sentiment)}
                          </span>
                        </div>
                        <div className="inline-flex items-center gap-1 tabular-nums font-medium">
                          <Star className="h-3.5 w-3.5 fill-[#A16207] text-[#A16207]" />
                          {rev.rating}.0
                        </div>
                      </div>
                      <p className="text-sm leading-relaxed text-[#292524]">{rev.comment}</p>
                      <div className="text-[11px] text-[#6B6A65]">
                        {t('detail.highlights')}:{' '}
                        {rev.reviewClasses.map((cls) => tr(cls)).join(' · ')}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* Hybrid Recommendation Engine Strip */}
            {recommendations.length > 0 && (
              <section className="border-t border-[#E8E6E1] pt-8">
                <div className="flex items-baseline justify-between gap-4 mb-5">
                  <div>
                    <h2 className="font-display text-2xl font-semibold text-[#141413]">
                      {t('detail.completeLook')}
                    </h2>
                    <p className="text-xs text-[#6B6A65]">{recStrategy}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                  {recommendations.map((rec) => {
                    const threshold = categoryTop10Thresholds?.[rec.category];
                    const isTopTrending =
                      typeof threshold === 'number' && rec.trendScore >= threshold;
                    return (
                      <ProductCard
                        key={rec._id}
                        product={rec}
                        isLiked={likedProductIds.has(rec._id)}
                        onToggleLike={onToggleLike}
                        onSelect={onSelectProduct}
                        onQuickBuy={onQuickBuy}
                        onShareWhatsApp={onShareWhatsApp}
                        onQuickAdd={(p) =>
                          p.variants[0] && onAddToCart(p, p.variants[0], 1)
                        }
                        isCompared={compareIds?.has(rec._id)}
                        onToggleCompare={onToggleCompare}
                        isTopTrending={isTopTrending}
                      />
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {/* Flicker-free Portal Zoom & Fullscreen Viewer */}
      {product && (
        <ProductZoomViewer
          open={lightboxOpen}
          images={product.images}
          initialIndex={lightboxIndex}
          initialZoom={lightboxInitialZoom}
          title={product.title}
          onClose={() => setLightboxOpen(false)}
        />
      )}

      {/* Dynamic Clothing Size Guide Modal */}
      {product && product.category === 'Clothing' && (
        <SizeGuideModal
          isOpen={sizeGuideOpen}
          onClose={() => setSizeGuideOpen(false)}
          productTitle={product.title}
          subCategory={product.subCategory}
          clothingSpecs={product.clothingSpecs}
          availableSizes={availableSizes}
          selectedSize={selectedVariant?.size}
        />
      )}
    </div>
  );
}
