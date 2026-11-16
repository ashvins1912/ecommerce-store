import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ExternalLink, Minus, Plus, Tag, Trash2, X } from 'lucide-react';
import type { CartItem, Coupon, CouponValidationResult, Order, User } from '../shared/types';
import { apiFetch, formatINR } from '../lib/api';
import { useI18n } from '../lib/i18n';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  cart: CartItem[];
  onUpdateQty: (variantSku: string, delta: number) => void;
  onRemoveItem: (variantSku: string) => void;
  user: User | null;
  onUserUpdated: (user: User) => void;
  onOrderCompleted: (orders: Order[]) => void;
  onRequireAuth: () => void;
  pendingCouponCode?: string | null;
  onClearPendingCoupon?: () => void;
}

export function CartDrawer({
  isOpen,
  onClose,
  cart,
  onUpdateQty,
  onRemoveItem,
  user,
  onUserUpdated,
  onOrderCompleted,
  onRequireAuth,
  pendingCouponCode,
  onClearPendingCoupon,
}: CartDrawerProps) {
  const { t } = useI18n();
  const [showGateModal, setShowGateModal] = useState(false);
  const [mobileNumber, setMobileNumber] = useState(user?.mobileNumber || '+91');
  const [fullName, setFullName] = useState(user?.name || '');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [stateName, setStateName] = useState('');
  const [pincode, setPincode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedOrders, setConfirmedOrders] = useState<Order[] | null>(null);
  const [rateGroups,setRateGroups]=useState<Array<{sellerId:string;markupPercent?:number;quotes:Array<{providerCode:string;serviceCode:string;costMinor:number;customerChargeMinor?:number;sellerMarkupMinor?:number;currency:string;estimatedTransitHours:number;score:number}>}>>([]);
  const [rateLoading,setRateLoading]=useState(false);
  const [rateError,setRateError]=useState<string|null>(null);
  const checkoutAttempt = useRef<{ fingerprint: string; key: string } | null>(null);

  const checkDeliveryRates=async()=>{
    const destinationPostalCode=user?.shippingAddresses?.find(address=>address.isDefault)?.pincode||user?.shippingAddresses?.[0]?.pincode;
    if(!destinationPostalCode){setRateError('Add a delivery address with pincode to check courier rates.');return;}
    setRateLoading(true);setRateError(null);
    try{
      const result=await apiFetch<{groups:Array<{sellerId:string;quotes:Array<{providerCode:string;serviceCode:string;costMinor:number;currency:string;estimatedTransitHours:number;score:number;expiresAt?:string}>}>}>('/api/logistics/rates',{
        method:'POST',body:JSON.stringify({items:cart.map(item=>({productId:item.productId,quantity:item.quantity}))})
      });
      setRateGroups(result.groups);
      if(!result.groups.some(group=>group.quotes.length))setRateError('No configured carrier rates are available for this delivery address yet.');
    }catch(error){setRateError((error as Error).message);}finally{setRateLoading(false);}
  };

  useEffect(() => {
    if (!isOpen || !user || cart.length === 0) return;
    const postalCode = user.shippingAddresses?.find(address => address.isDefault)?.pincode || user.shippingAddresses?.[0]?.pincode;
    if (!postalCode) return;
    let active = true;
    setRateLoading(true);
    setRateError(null);
    apiFetch<{ groups: Array<{ sellerId: string; markupPercent: number; quotes: Array<{ providerCode: string; serviceCode: string; costMinor: number; customerChargeMinor: number; sellerMarkupMinor: number; currency: string; estimatedTransitHours: number; score: number; expiresAt?: string }> }> }>('/api/logistics/rates', {
      method: 'POST',
      body: JSON.stringify({ items: cart.map(item => ({ productId: item.productId, quantity: item.quantity })) }),
    }).then(result => {
      if (!active) return;
      setRateGroups(result.groups || []);
      if (!result.groups?.some(group => group.quotes.length)) setRateError('Delivery estimate is temporarily unavailable.');
    }).catch(error => { if (active) setRateError((error as Error).message); })
      .finally(() => { if (active) setRateLoading(false); });
    return () => { active = false; };
  }, [isOpen, user?._id, user?.shippingAddresses, cart.map(item => item.productId + ':' + item.variantSku + ':' + item.quantity).join('|')]);

  // Coupon state
  const [couponInput, setCouponInput] = useState('');
  const [availableCoupons, setAvailableCoupons] = useState<Coupon[]>([]);
  const [appliedValidation, setAppliedValidation] = useState<CouponValidationResult | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);

  const subtotal = cart.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  const baseTotal = cart.reduce((sum, i) => sum + i.basePrice * i.quantity, 0);
  const catalogSavings = Math.max(0, baseTotal - subtotal);
  const couponDiscount = appliedValidation?.valid ? appliedValidation.discountAmount : 0;
  const deliveryCharge = rateGroups.reduce((sum, group) => sum + Number(group.quotes[0]?.customerChargeMinor ?? group.quotes[0]?.costMinor ?? 0) / 100, 0);
  const finalTotal = Math.max(1, subtotal - couponDiscount + deliveryCharge);

  const validateAndApplyCoupon = useCallback(
    async (rawCode: string) => {
      const code = rawCode.trim().toUpperCase();
      if (!code || cart.length === 0) return;
      setCouponError(null);
      setValidatingCoupon(true);
      try {
        const res = await apiFetch<CouponValidationResult>('/api/coupons/validate', {
          method: 'POST',
          body: JSON.stringify({ code, items: cart }),
        });
        if (res.valid) {
          setAppliedValidation(res);
          setCouponInput(res.coupon?.code || code);
          setCouponError(null);
        } else {
          setAppliedValidation(null);
          setCouponError(res.reason || 'Coupon is not eligible for your current bag.');
        }
      } catch (err) {
        setAppliedValidation(null);
        setCouponError((err as Error).message);
      } finally {
        setValidatingCoupon(false);
      }
    },
    [cart]
  );

  useEffect(() => {
    if (!isOpen) return;
    apiFetch<{ coupons: Coupon[] }>('/api/coupons/applicable')
      .then((res) => setAvailableCoupons(res.coupons || []))
      .catch(() => setAvailableCoupons([]));
  }, [isOpen, user?._id]);

  useEffect(() => {
    if (isOpen && pendingCouponCode && cart.length > 0) {
      setCouponInput(pendingCouponCode);
      void validateAndApplyCoupon(pendingCouponCode);
      onClearPendingCoupon?.();
    }
  }, [isOpen, pendingCouponCode, cart.length, validateAndApplyCoupon, onClearPendingCoupon]);

  useEffect(() => {
    if (cart.length === 0) {
      setAppliedValidation(null);
      setCouponError(null);
      return;
    }
    if (appliedValidation?.valid && appliedValidation.coupon?.code) {
      void validateAndApplyCoupon(appliedValidation.coupon.code);
    }
  }, [subtotal, cart.length]);

  if (!isOpen) return null;

  const placeOrderNow = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const fingerprint = JSON.stringify({
        items: cart.map((item) => [item.productId, item.variantSku, item.quantity]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        coupon: appliedValidation?.valid ? appliedValidation.coupon?.code || '' : '',
      });
      if (!checkoutAttempt.current || checkoutAttempt.current.fingerprint !== fingerprint) {
        const key = typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        checkoutAttempt.current = { fingerprint, key };
      }
      const data = await apiFetch<{ orders: Order[]; replayed?: boolean }>('/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': checkoutAttempt.current.key },
        body: JSON.stringify({
          idempotencyKey: checkoutAttempt.current.key,
          items: cart,
          ...(appliedValidation?.valid && appliedValidation.coupon?.code
            ? { couponCode: appliedValidation.coupon.code }
            : {}),
        }),
      });
      checkoutAttempt.current = null;
      setConfirmedOrders(data.orders);
      setAppliedValidation(null);
      setCouponInput('');
      onOrderCompleted(data.orders);
    } catch (err: any) {
      if (err.code === 'AUTH_REQUIRED' || err.status === 401) {
        onRequireAuth();
      } else if (err.code === 'CHECKOUT_PROFILE_INCOMPLETE' || err.status === 422) {
        setFullName(user?.name || '');
        setMobileNumber(user?.mobileNumber || '+91');
        setShowGateModal(true);
      } else {
        setError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleProceedClick = async () => {
    if (!user) {
      onRequireAuth();
      return;
    }
    if (!user.mobileNumber || user.shippingAddresses.length === 0) {
      setFullName(user.name || '');
      setMobileNumber(user.mobileNumber || '+91');
      setShowGateModal(true);
      return;
    }
    await placeOrderNow();
  };

  const handleSaveCheckoutGate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { user: updatedUser } = await apiFetch<{ user: User }>('/api/auth/checkout-profile', {
        method: 'POST',
        body: JSON.stringify({
          mobileNumber: mobileNumber.trim(),
          address: {
            label: 'Home',
            fullName: fullName.trim(),
            street: street.trim(),
            city: city.trim(),
            state: stateName.trim(),
            pincode: pincode.trim(),
          },
        }),
      });
      onUserUpdated(updatedUser);
      setShowGateModal(false);
      await placeOrderNow();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-xs">
      <div className="flex h-full w-full max-w-md flex-col bg-white border-l border-[#E8E6E1] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E8E6E1] px-4 sm:px-6 py-4">
          <h2 className="font-display text-2xl font-semibold text-[#141413]">
            {t('cart.title')}
          </h2>
          <button
            type="button"
            onClick={() => {
              setConfirmedOrders(null);
              onClose();
            }}
            aria-label={t('detail.close')}
            className="rounded-md p-1.5 text-[#57534E] hover:bg-[#F5F3EE] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {error}
            </div>
          )}

          {confirmedOrders ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-5 space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                  <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                  <span>{t('cart.confirmedTitle')}</span>
                </div>
                <p className="text-xs text-emerald-800">{t('cart.confirmedDesc')}</p>
              </div>

              {confirmedOrders.map((ord) => (
                <div
                  key={ord._id}
                  className="rounded-lg border border-[#E8E6E1] bg-[#FAF9F6] p-4 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between font-semibold text-[#141413] tabular-nums">
                    <span className="font-mono">{ord.orderNumber}</span>
                    <span>{formatINR(ord.totalAmount)}</span>
                  </div>
                  {ord.appliedCoupon && (
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-800">
                      <Tag className="h-3 w-3" />
                      <span>
                        {ord.appliedCoupon.code} · -{formatINR(ord.appliedCoupon.discountAmount)}
                      </span>
                    </div>
                  )}
                  <div className="text-[#57534E]">
                    {t('cart.deliverTo')}: {ord.shippingAddress.fullName}, {ord.shippingAddress.city}{' '}
                    {ord.shippingAddress.pincode}
                  </div>
                  {ord.whatsappDispatch && (
                    <div className="border-t border-[#E8E6E1] pt-2 mt-2">
                      <div className="text-[#6B6A65] mb-1">
                        {t('cart.sellerWaAlert')} ({ord.whatsappDispatch.channel}):
                      </div>
                      <a
                        href={ord.whatsappDispatch.waLink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-[#881337] hover:underline"
                      >
                        <span>{t('cart.openWaDispatch')}</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : cart.length === 0 ? (
            <div className="py-16 text-center space-y-2">
              <div className="font-display text-xl text-[#141413]">{t('cart.emptyTitle')}</div>
              <p className="text-xs text-[#6B6A65]">{t('cart.emptyDesc')}</p>
            </div>
          ) : (
            cart.map((item) => (
              <div
                key={item.variantSku}
                className="flex gap-4 border-b border-[#F0EEE9] pb-4"
              >
                <img
                  src={item.imageUrl}
                  alt={item.title}
                  referrerPolicy="no-referrer"
                  className="h-20 w-20 shrink-0 rounded-md border border-[#E8E6E1] object-cover bg-[#F2EFE9]"
                />
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-[#141413] truncate">{item.title}</h3>
                  <div className="mt-0.5 text-xs text-[#6B6A65]">
                    {item.colorName} · {t('detail.sizeLabel')} {item.size}
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="inline-flex items-center rounded-md border border-[#D6D3CD]">
                      <button
                        type="button"
                        onClick={() => onUpdateQty(item.variantSku, -1)}
                        className="p-1.5 text-[#44403C] hover:bg-[#F5F3EE] cursor-pointer"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="px-2.5 text-xs font-semibold tabular-nums">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => onUpdateQty(item.variantSku, 1)}
                        className="p-1.5 text-[#44403C] hover:bg-[#F5F3EE] cursor-pointer"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-[#141413] tabular-nums">
                        {formatINR(item.unitPrice * item.quantity)}
                      </span>
                      <button
                        type="button"
                        aria-label={item.title}
                        onClick={() => onRemoveItem(item.variantSku)}
                        className="text-[#A8A29E] hover:text-red-700 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer Coupons, Totals & Proceed Button */}
        {cart.length > 0 && !confirmedOrders && (
          <div className="border-t border-[#E8E6E1] bg-[#FAF9F6] p-5 space-y-4">
            {/* Checkout Coupon Selector & Code Input */}
            <div className="rounded-md border border-[#E8E6E1] bg-white p-3 space-y-2.5">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                  placeholder={t('coupon.codePlaceholder')}
                  className="flex-1 rounded border border-[#D6D3CD] px-2.5 py-1.5 text-xs font-mono uppercase focus:border-[#881337] focus:outline-none"
                />
                {appliedValidation?.valid ? (
                  <button
                    type="button"
                    onClick={() => {
                      setAppliedValidation(null);
                      setCouponInput('');
                      setCouponError(null);
                    }}
                    className="rounded border border-[#D6D3CD] px-3 py-1.5 text-xs font-medium text-[#57534E] hover:bg-[#F5F3EE] cursor-pointer"
                  >
                    {t('coupon.removeBtn')}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={validatingCoupon || !couponInput.trim()}
                    onClick={() => validateAndApplyCoupon(couponInput)}
                    className="rounded bg-[#141413] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#2A2927] disabled:opacity-40 cursor-pointer"
                  >
                    {validatingCoupon ? t('coupon.validating') : t('coupon.applyBtn')}
                  </button>
                )}
              </div>

              {couponError && <p className="text-[11px] text-red-700">{couponError}</p>}

              {availableCoupons.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6A65]">
                    {t('coupon.availableTitle')}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {availableCoupons.map((cpn) => {
                      const isActive = appliedValidation?.coupon?.code === cpn.code;
                      const isPersonal =
                        cpn.assignedUserIds.length > 0 || cpn.assignedEmails.length > 0;
                      return (
                        <button
                          key={cpn._id}
                          type="button"
                          onClick={() => validateAndApplyCoupon(cpn.code)}
                          className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] transition-colors cursor-pointer ${
                            isActive
                              ? 'border-emerald-700 bg-emerald-50 font-semibold text-emerald-900'
                              : 'border-[#E8E6E1] bg-[#FAF9F6] text-[#44403C] hover:border-[#881337]'
                          }`}
                        >
                          <Tag className="h-3 w-3 text-[#881337]" />
                          <span className="font-mono font-semibold">{cpn.code}</span>
                          <span className="text-[#6B6A65]">
                            (
                            {cpn.discountType === 'percentage'
                              ? `${cpn.discountValue}%`
                              : formatINR(cpn.discountValue)}
                            )
                          </span>
                          {isPersonal && (
                            <span className="text-[10px] font-medium text-[#881337]">
                              · {t('coupon.assignedYou')}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-1.5 text-xs tabular-nums">
              <div className="flex justify-between text-[#57534E]">
                <span>{t('cart.subtotal')}</span>
                <span>{formatINR(subtotal)}</span>
              </div>
              {catalogSavings > 0 && (
                <div className="flex justify-between text-emerald-700 font-medium">
                  <span>{t('cart.savings')}</span>
                  <span>-{formatINR(catalogSavings)}</span>
                </div>
              )}
              {appliedValidation?.valid && couponDiscount > 0 && (
                <div className="flex justify-between text-emerald-800 font-semibold">
                  <span>
                    {t('coupon.discountLine', { code: appliedValidation.coupon?.code || '' })}
                  </span>
                  <span>-{formatINR(couponDiscount)}</span>
                </div>
              )}
              <div className="flex justify-between text-xs text-[#57534E]"><span>Delivery fee</span><span>{formatINR(deliveryCharge)}</span></div>
              <div className="flex justify-between text-sm font-semibold text-[#141413] pt-2 border-t border-[#E8E6E1]">
                <span>{t('cart.total')}</span>
                <span>{formatINR(finalTotal)}</span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="rounded-md border border-[#E8E6E1] bg-white p-3 space-y-2">
                <div className="flex justify-between text-xs"><span>Delivery</span><span>{rateLoading ? 'Calculating…' : rateGroups.length ? formatINR(deliveryCharge) : 'Calculating at checkout'}</span></div>
                {rateError && <p role="status" className="text-[11px] text-amber-800">Delivery estimate unavailable. Checkout will revalidate the carrier quote.</p>}
                {rateGroups.map(group => {
                  const quote = group.quotes[0];
                  return quote ? <div key={group.sellerId} className="flex justify-between gap-2 text-[11px] text-[#57534E]"><span>{quote.providerCode} · {quote.serviceCode} · ETA {quote.estimatedTransitHours}h</span><span>{formatINR((quote.customerChargeMinor ?? quote.costMinor)/100)}</span></div> : null;
                })}
                <p className="text-[10px] text-[#78716C]">Separate delivery fee includes carrier cost and seller-configured markup. Final charge is recalculated securely when you place the order.</p>
              </div>
            </div>

            <button
              type="button"
              disabled={submitting}
              onClick={handleProceedClick}
              className="w-full rounded-md bg-[#881337] px-5 py-3 text-xs font-semibold text-white hover:bg-[#9F1239] disabled:opacity-50 transition-colors cursor-pointer"
            >
              {submitting ? t('cart.placing') : t('cart.proceed')}
            </button>
          </div>
        )}
      </div>

      {/* Mandatory Checkout Profile Gate Modal */}
      {showGateModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/55 p-4">
          <div className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-lg border border-[#E8E6E1] bg-white p-4 sm:p-6 shadow-2xl">
            <div className="flex items-start justify-between border-b border-[#F0EEE9] pb-3">
              <div>
                <h3 className="font-display text-2xl font-semibold text-[#141413]">
                  {t('cart.gateTitle')}
                </h3>
                <p className="mt-0.5 text-xs text-[#6B6A65]">{t('cart.gateDesc')}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowGateModal(false)}
                className="p-1 text-[#57534E] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCheckoutGate} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#44403C] mb-1">
                  {t('cart.mobileLabel')}
                </label>
                <input
                  type="tel"
                  required
                  placeholder="+919876543210"
                  value={mobileNumber}
                  onChange={(e) => setMobileNumber(e.target.value)}
                  className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm tabular-nums focus:border-[#881337] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#44403C] mb-1">
                  {t('cart.fullNameLabel')}
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm focus:border-[#881337] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#44403C] mb-1">
                  {t('cart.streetLabel')}
                </label>
                <input
                  type="text"
                  required
                  placeholder={t('cart.streetPlaceholder')}
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm focus:border-[#881337] focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <input
                  type="text"
                  required
                  placeholder={t('cart.city')}
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm focus:border-[#881337] focus:outline-none"
                />
                <input
                  type="text"
                  required
                  placeholder={t('cart.state')}
                  value={stateName}
                  onChange={(e) => setStateName(e.target.value)}
                  className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm focus:border-[#881337] focus:outline-none"
                />
                <input
                  type="text"
                  required
                  placeholder={t('cart.pincode')}
                  value={pincode}
                  onChange={(e) => setPincode(e.target.value)}
                  className="w-full rounded-md border border-[#D6D3CD] px-3 py-2 text-sm tabular-nums focus:border-[#881337] focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-md bg-[#881337] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#9F1239] cursor-pointer"
              >
                {submitting ? t('cart.savingPlace') : t('cart.savePlace')}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
