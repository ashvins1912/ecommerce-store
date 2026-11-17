import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Package, PackageCheck, Truck, Wallet } from 'lucide-react';
import type {
  CheckoutPaymentMode,
  Order,
  OrderListResponse,
  OrderTab,
  OrderTimeBucket,
  PlatformServiceFlags,
  TimeGranularity,
  User,
} from '../shared/types';
import { apiFetch, formatINR, resolveAssetUrl } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { ActionButton } from './ActionButton';

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, any>) => { open: () => void };
  }
}

interface OrdersViewProps {
  user: User | null;
  onOpenAuth: () => void;
  platformFlags?: PlatformServiceFlags | null;
}

function formatOrderPaymentMode(mode?: CheckoutPaymentMode): string {
  switch (mode) {
    case 'POS_ON_DELIVERY':
      return 'POS Machine on Delivery';
    case 'SELLER_COLLECT':
      return 'Seller Direct Collection';
    case 'RAZORPAY':
    case 'STRIPE':
      return 'Online Gateway';
    case 'WALLET':
    case 'MIXED':
      return 'Store Wallet';
    case 'COD':
    default:
      return 'Cash on Delivery';
  }
}

function OrderItemThumb({ src, alt }: { src: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  const resolvedSrc = resolveAssetUrl(src);
  if (!resolvedSrc || broken) {
    return (
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-[#E8E6E1] bg-[#FAF9F6] text-[#A8A29E]">
        <Package className="h-5 w-5" />
      </div>
    );
  }
  return (
    <img
      src={resolvedSrc}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className="h-14 w-14 shrink-0 rounded-md border border-[#E8E6E1] object-cover bg-[#F2EFE9]"
    />
  );
}

export function OrdersView({ user, onOpenAuth, platformFlags }: OrdersViewProps) {
  const { t, ts, totab, locale } = useI18n();
  const [activeTab, setActiveTab] = useState<OrderTab>('Current');
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextSkip, setNextSkip] = useState(0);
  const [loading, setLoading] = useState(false);

  const [granularity, setGranularity] = useState<TimeGranularity>('month');
  const [buckets, setBuckets] = useState<OrderTimeBucket[]>([]);
  const [walletBalancePaise, setWalletBalancePaise] = useState(0);
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [returnTarget, setReturnTarget] = useState<{ order: Order; productId: string; title: string } | null>(null);
  const [returnReason, setReturnReason] = useState('');
  const [returnFiles, setReturnFiles] = useState<File[]>([]);
  const [returnBusy, setReturnBusy] = useState(false);
  const [returnError, setReturnError] = useState('');
  const [selfCourier, setSelfCourier] = useState(false);
  const [courierName, setCourierName] = useState('');
  const [returnTrackingId, setReturnTrackingId] = useState('');
  const [returnTrackingUrl, setReturnTrackingUrl] = useState('');
  const [walletAmounts, setWalletAmounts] = useState<Record<string, string>>({});
  const [walletBusyOrderId, setWalletBusyOrderId] = useState<string | null>(null);
  const [logisticsTracking, setLogisticsTracking] = useState<Record<string, {status:string;eta:string|null;latestCheckpoint:any}>>({});
  const [trackingLoadingId, setTrackingLoadingId] = useState<string | null>(null);
  const [trackingError, setTrackingError] = useState<string | null>(null);

  const loadLogisticsTracking = async (orderId: string) => {
    setTrackingLoadingId(orderId); setTrackingError(null);
    try {
      const tracking = await apiFetch<{status:string;eta:string|null;latestCheckpoint:{status:string;location?:string;timestamp:string}|null}>('/api/logistics/orders/'+encodeURIComponent(orderId)+'/tracking');
      setLogisticsTracking(prev => ({...prev,[orderId]:tracking}));
    } catch (error) { setTrackingError((error as Error).message); }
    finally { setTrackingLoadingId(null); }
  };

  const fetchOrders = useCallback(
    async (tab: OrderTab, skipVal: number, append: boolean) => {
      if (!user) return;
      setLoading(true);
      try {
        const res = await apiFetch<OrderListResponse>(
          `/api/orders?tab=${tab}&skip=${skipVal}`
        );
        setOrders((prev) => (append ? [...prev, ...res.orders] : res.orders));
        setTotal(res.total);
        setHasMore(res.hasMore);
        setNextSkip(res.nextSkip);
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  const fetchSummary = useCallback(
    async (unit: TimeGranularity) => {
      if (!user) return;
      const res = await apiFetch<{ buckets: OrderTimeBucket[] }>(
        `/api/orders/summary?granularity=${unit}`
      );
      setBuckets(res.buckets);
    },
    [user]
  );

  useEffect(() => {
    if (user) {
      fetchOrders(activeTab, 0, false);
    }
  }, [user, activeTab, fetchOrders]);

  useEffect(() => {
    if (user?.role === 'BUYER') {
      apiFetch<{ balancePaise: number }>('/api/wallet').then((data) => setWalletBalancePaise(data.balancePaise || 0)).catch(() => setWalletBalancePaise(0));
    }
  }, [user?._id, user?.role]);

  const redeemWallet = async (order: Order) => {
    const rupees = Number(walletAmounts[order._id] || 0);
    if (!Number.isFinite(rupees) || rupees <= 0) {
      setPaymentError('Enter a valid wallet amount in rupees.');
      return;
    }
    setWalletBusyOrderId(order._id);
    setPaymentError(null);
    try {
      await apiFetch('/api/wallet/redeem', {
        method: 'POST',
        body: JSON.stringify({ orderId: order._id, amountPaise: Math.round(rupees * 100), idempotencyKey: window.crypto.randomUUID() }),
      });
      setWalletAmounts((prev) => ({ ...prev, [order._id]: '' }));
      await Promise.all([
        fetchOrders(activeTab, 0, false),
        apiFetch<{ balancePaise: number }>('/api/wallet').then((wallet) => setWalletBalancePaise(wallet.balancePaise || 0)),
      ]);
    } catch (err) {
      setPaymentError((err as Error).message);
    } finally {
      setWalletBusyOrderId(null);
    }
  };

  const requestCancellation = async (order: Order) => {
    setBusyOrderId(order._id);
    try {
      await apiFetch('/api/orders/' + encodeURIComponent(order._id) + '/cancellation-request', { method: 'POST', body: JSON.stringify({}) });
      await fetchOrders(activeTab, 0, false);
    } catch (err) {
      setPaymentError((err as Error).message);
    } finally {
      setBusyOrderId(null);
    }
  };

  const submitReturn = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!returnTarget || !returnFiles.length) {
      setReturnError('Upload at least one clear product or packaging photo.');
      return;
    }
    setReturnBusy(true);
    setReturnError('');
    try {
      const form = new FormData();
      returnFiles.forEach((file) => form.append('media', file));
      const upload = await apiFetch<{ media: Array<{ url: string; mimeType: string; durationSeconds: number }> }>('/api/returns/upload', { method: 'POST', body: form });
      await apiFetch('/api/orders/' + encodeURIComponent(returnTarget.order._id) + '/returns', {
        method: 'POST',
        body: JSON.stringify({
          productId: returnTarget.productId, quantity: 1, reason: returnReason,
          media: upload.media, selfCourier, courierName: selfCourier ? courierName : undefined,
          trackingId: selfCourier ? returnTrackingId : undefined, trackingUrl: selfCourier && returnTrackingUrl ? returnTrackingUrl : undefined,
        }),
      });
      setReturnTarget(null); setReturnReason(''); setReturnFiles([]); setSelfCourier(false);
      await fetchOrders(activeTab, 0, false);
    } catch (err) {
      setReturnError((err as Error).message);
    } finally {
      setReturnBusy(false);
    }
  };

  const payOrder = async (order: Order, provider: 'razorpay' | 'stripe') => {
    setPayingOrderId(order._id);
    setPaymentError(null);
    try {
      const result = await apiFetch<{ checkout: { provider: string; reference: string; keyId?: string; amountPaise: number; currency: string; url?: string } }>(
        '/api/orders/' + encodeURIComponent(order._id) + '/payment-intent',
        { method: 'POST', body: JSON.stringify({ provider }) }
      );
      const checkout = result.checkout;
      if (provider === 'stripe') {
        if (!checkout.url) throw new Error('Stripe Checkout URL was not returned.');
        window.location.assign(checkout.url);
        return;
      }
      const scriptUrl = 'https://checkout.razorpay.com/v1/checkout.js';
      if (!document.querySelector('script[src="' + scriptUrl + '"]')) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = scriptUrl;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Unable to load Razorpay Checkout.'));
          document.body.appendChild(script);
        });
      }
      if (!window.Razorpay || !checkout.keyId) throw new Error('Razorpay Checkout is unavailable or not configured.');
      const razorpay = new window.Razorpay({
        key: checkout.keyId,
        amount: checkout.amountPaise,
        currency: checkout.currency,
        order_id: checkout.reference,
        name: 'E-Commerce Store',
        description: 'Order ' + order.orderNumber,
        handler: () => { void fetchOrders(activeTab, 0, false); },
        modal: { ondismiss: () => setPayingOrderId(null) },
      });
      razorpay.open();
    } catch (err) {
      setPaymentError((err as Error).message);
      setPayingOrderId(null);
    }
  };

  useEffect(() => {
    if (user) {
      fetchSummary(granularity);
    }
  }, [user, granularity, fetchSummary]);

  if (!user) {
    return (
      <section className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-16 text-center">
        <div className="mx-auto max-w-md rounded-lg border border-[#E8E6E1] bg-white p-8 space-y-4">
          <h1 className="font-display text-3xl font-semibold text-[#141413]">
            {t('orders.guestTitle')}
          </h1>
          <p className="text-sm text-[#6B6A65]">{t('orders.guestDesc')}</p>
          <button
            type="button"
            onClick={onOpenAuth}
            className="rounded-md bg-[#881337] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#9F1239] cursor-pointer"
          >
            {t('orders.guestCta')}
          </button>
        </div>
      </section>
    );
  }

  return (
    <main className="mx-auto max-w-7xl min-w-0 px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-8 sm:space-y-10">
      {/* Header + Segmented Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[#E8E6E1] pb-6">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[#141413]">
            {t('orders.title')}
          </h1>
          <p className="mt-1 text-xs text-[#6B6A65] max-w-prose">{t('orders.sub')}</p>
        </div>

        <div className="inline-flex max-w-full overflow-x-auto items-center gap-1 rounded-lg bg-[#F0EEE9] p-1 self-start">
          {(['Current', 'Past', 'Completed'] as OrderTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`min-h-[44px] sm:min-h-[36px] inline-flex items-center justify-center rounded-md px-3 sm:px-4 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === tab
                  ? 'bg-white text-[#141413] shadow-xs'
                  : 'text-[#57534E] hover:text-[#141413]'
              }`}
            >
              {totab(tab)}
            </button>
          ))}
        </div>
      </div>

      {user.role === 'BUYER' && (
        <div className="flex items-center justify-between rounded-lg border border-[#E8E6E1] bg-white p-4">
          <div className="flex items-center gap-3"><Wallet className="h-5 w-5 text-[#881337]"/><div><div className="text-xs font-semibold">Store wallet</div><div className="text-[11px] text-[#78716C]">1 point = ₹1</div></div></div>
          <div className="text-lg font-semibold tabular-nums">{formatINR(walletBalancePaise / 100)}</div>
        </div>
      )}
      {paymentError && <p role="alert" className="text-xs text-red-700">{paymentError}</p>}

      {/* Strictly limit(5) Paginated Order List */}
      <section className="space-y-4">
        <div className="flex items-center justify-between text-xs text-[#6B6A65] tabular-nums">
          <span>{t('orders.showing', { shown: orders.length, total })}</span>
        </div>

        {loading && orders.length === 0 ? (
          <div className="rounded-lg border border-[#E8E6E1] bg-white p-8 text-center text-xs text-[#6B6A65]">
            {t('orders.loading')}
          </div>
        ) : orders.length === 0 ? (
          <div className="rounded-lg border border-[#E8E6E1] bg-white p-10 text-center text-sm text-[#6B6A65]">
            {t('orders.noneFound', { name: user.name })}
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => (
              <div
                key={order._id}
                className="rounded-lg border border-[#E8E6E1] bg-white p-5 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#F0EEE9] pb-3">
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <span className="font-mono font-semibold text-[#141413]">
                      {order.orderNumber}
                    </span>
                    <span className="text-[#A8A29E]">·</span>
                    <span className="text-[#6B6A65] tabular-nums">
                      {new Date(order.createdAt).toLocaleDateString(locale, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                    <span className="text-[#A8A29E]">·</span>
                    <span
                      className={`font-semibold ${
                        order.status === 'Delivered'
                          ? 'text-emerald-700'
                          : order.status === 'Cancelled'
                            ? 'text-red-700'
                            : 'text-[#881337]'
                      }`}
                    >
                      {ts(order.status)}
                    </span>
                    <span className="text-[#A8A29E]">·</span>
                    <span className="font-medium text-[#44403C]">
                      {formatOrderPaymentMode(order.paymentMode)}
                    </span>
                    {order.paymentStatus && order.paymentStatus !== 'NOT_REQUIRED' && (
                      <>
                        <span className="text-[#A8A29E]">·</span>
                        <span
                          className={`text-[11px] font-semibold ${
                            order.paymentStatus === 'PAID'
                              ? 'text-emerald-700'
                              : 'text-[#6B6A65]'
                          }`}
                        >
                          {order.paymentStatus === 'PAID' ? 'Paid' : 'Payment pending'}
                        </span>
                      </>
                    )}
                    {order.appliedCoupon && (
                      <>
                        <span className="text-[#A8A29E]">·</span>
                        <span className="font-mono text-[11px] font-medium text-emerald-800">
                          {order.appliedCoupon.code} (-{formatINR(order.appliedCoupon.discountAmount)})
                        </span>
                      </>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto justify-between sm:justify-end">
                    <ActionButton
                      actionKey="track_order"
                      role="CUSTOMER"
                      variant="outline"
                      showHelpIcon
                      fullWidthMobile={false}
                      disabled={trackingLoadingId === order._id}
                      onClick={() => void loadLogisticsTracking(order._id)}
                      icon={<Truck className="h-3.5 w-3.5" aria-hidden="true" />}
                      labelOverride={trackingLoadingId === order._id ? 'Loading…' : undefined}
                    />
                    {order.courierTracking && (
                      <a
                        href={order.courierTracking.trackingUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-[#881337] px-3 py-2 text-xs font-medium text-[#881337] hover:bg-[#881337] hover:text-white transition-colors whitespace-nowrap"
                      >
                        <Truck className="h-3.5 w-3.5" />
                        <span>
                          {t('orders.trackShipment', {
                            company: order.courierTracking.companyName,
                          })}
                        </span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    <span className="text-sm font-semibold text-[#141413] tabular-nums">
                      {formatINR(order.totalAmount)}
                    </span>
                  </div>
                </div>

                {trackingError && <p role="alert" className="text-xs text-red-700">{trackingError}</p>}
                {logisticsTracking[order._id] && (
                  <div className="rounded-md border border-[#E8E6E1] bg-[#FAF9F6] p-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{logisticsTracking[order._id].status.replaceAll('_',' ')}</span>{logisticsTracking[order._id].eta&&<span>ETA: {new Date(logisticsTracking[order._id].eta!).toLocaleDateString(locale)}</span>}</div>
                    {logisticsTracking[order._id].latestCheckpoint&&<p className="mt-1 text-[#78716C]">Latest checkpoint: {logisticsTracking[order._id].latestCheckpoint.status.replaceAll('_',' ')} · {logisticsTracking[order._id].latestCheckpoint.location||'Location unavailable'} · {new Date(logisticsTracking[order._id].latestCheckpoint.timestamp).toLocaleString(locale)}</p>}
                  </div>
                )}
                {/* Order Items */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {order.items.map((item, idx) => (
                    <div key={`${item.variantSku}-${idx}`} className="flex items-center gap-3">
                      <OrderItemThumb src={item.imageUrl} alt={item.title} />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-[#141413] truncate">
                          {item.title}
                        </div>
                        <div className="text-[11px] text-[#6B6A65] tabular-nums">
                          {item.colorName} · {t('detail.sizeLabel')} {item.size} · {t('orders.qty')}{' '}
                          {item.quantity} · {formatINR(item.unitPrice)}
                        </div>
                        {item.catalogStatus && item.catalogStatus !== 'active' && (
                          <div className="text-[10px] font-medium text-[#78716C] mt-0.5">
                            {item.catalogStatus === 'removed'
                              ? t('orders.itemRemoved')
                              : item.catalogStatus === 'discontinued'
                                ? t('orders.itemDiscontinued')
                                : t('orders.itemUnpublished')}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {order.manualPaymentCollection?.confirmedAt ? (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-900">
                    <span className="font-semibold">
                      Collection confirmed ({order.manualPaymentCollection.method.replaceAll('_', ' ')})
                    </span>
                    {order.manualPaymentCollection.referenceNumber && (
                      <span className="font-mono ml-2 tabular-nums">
                        · Ref: {order.manualPaymentCollection.referenceNumber}
                      </span>
                    )}
                    {order.manualPaymentCollection.posTerminalId && (
                      <span className="font-mono ml-2 tabular-nums">
                        · POS: {order.manualPaymentCollection.posTerminalId}
                      </span>
                    )}
                    {order.manualPaymentCollection.notes && (
                      <span className="block text-[11px] text-emerald-800 mt-0.5">
                        {order.manualPaymentCollection.notes}
                      </span>
                    )}
                  </div>
                ) : (
                  order.paymentStatus !== 'PAID' &&
                  order.status !== 'Cancelled' &&
                  (order.paymentMode === 'POS_ON_DELIVERY' || order.paymentMode === 'SELLER_COLLECT') && (
                    <div className="rounded-md border border-[#E8E6E1] bg-[#FAF9F6] px-3 py-2 text-xs text-[#57534E]">
                      {order.paymentMode === 'POS_ON_DELIVERY'
                        ? 'Portable POS machine requested for card / UPI payment at delivery. Seller records your slip/RRN once paid.'
                        : 'Seller Direct Collection active — pay via seller UPI or cash after order confirmation.'}
                    </div>
                  )
                )}

                {(order.status === 'CONFIRMED_AWAITING_PAYMENT' && order.paymentStatus !== 'PAID') && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-[#F0EEE9] pt-3">
                    <span className="text-xs text-[#57534E]">
                      {platformFlags?.onlinePaymentEnabled
                        ? 'Seller confirmed availability. Complete payment:'
                        : 'Seller confirmed availability. Direct collection or wallet available:'}
                    </span>
                    {walletBalancePaise > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-[#57534E]">Wallet balance: {formatINR(walletBalancePaise / 100)}</span>
                        <input type="number" min="1" step="0.01" max={walletBalancePaise / 100} value={walletAmounts[order._id] || ''} onChange={(e) => setWalletAmounts((prev) => ({ ...prev, [order._id]: e.target.value }))} placeholder="Amount ₹" className="w-28 min-h-[44px] rounded-md border border-[#D6D3CD] px-2.5 py-2 text-xs"/>
                        <button type="button" disabled={walletBusyOrderId === order._id} onClick={() => void redeemWallet(order)} className="min-h-[44px] rounded-md border border-[#D6D3CD] px-3 py-2 text-xs font-semibold disabled:opacity-50 cursor-pointer">{walletBusyOrderId === order._id ? 'Applying…' : 'Apply wallet'}</button>
                      </div>
                    )}

                    {platformFlags?.onlinePaymentEnabled && (
                      <>
                        <button type="button" disabled={payingOrderId === order._id} onClick={() => void payOrder(order, 'razorpay')} className="min-h-[44px] rounded-md bg-[#881337] px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-50 cursor-pointer">{payingOrderId === order._id ? 'Opening…' : 'Pay with Razorpay'}</button>
                        <button type="button" disabled={payingOrderId === order._id} onClick={() => void payOrder(order, 'stripe')} className="min-h-[44px] rounded-md border border-[#D6D3CD] px-3.5 py-2 text-xs font-semibold text-[#292524] disabled:opacity-50 cursor-pointer">Pay with Stripe</button>
                      </>
                    )}
                  </div>
                )}

                {(order.status === 'Pending' || order.status === 'Confirmed' || order.status === 'Packed' || order.status === 'Shipped' || order.status === 'Out for Delivery' || order.status === 'PENDING_SELLER_CONFIRMATION' || order.status === 'CONFIRMED_AWAITING_PAYMENT' || order.status === 'PAID_AND_PROCESSING') && (
                  <div className="border-t border-[#F0EEE9] pt-3">
                    <button type="button" disabled={busyOrderId === order._id} onClick={() => void requestCancellation(order)} className="min-h-[44px] rounded-md border border-[#D6D3CD] px-3.5 py-2 text-xs font-medium text-[#57534E] disabled:opacity-50 cursor-pointer">{busyOrderId === order._id ? 'Submitting…' : 'Request cancellation'}</button>
                  </div>
                )}
                {order.status === 'Delivered' && order.items.filter((item) => item.isReturnable !== false && Date.now() <= new Date(order.deliveredAt || order.updatedAt).getTime() + (item.returnWindowDays ?? 7) * 86400000).map((item) => (
                  <div key={item.productId} className="border-t border-[#F0EEE9] pt-2">
                    <button type="button" onClick={() => { setReturnTarget({ order, productId: item.productId, title: item.title }); setReturnError(''); }} className="inline-flex min-h-[44px] items-center text-xs font-semibold text-[#881337] underline underline-offset-2 cursor-pointer">Return {item.title}</button>
                  </div>
                ))}
                {/* Compact Timeline */}
                <div className="flex flex-wrap items-center gap-4 border-t border-[#F0EEE9] pt-3 text-[11px] text-[#6B6A65]">
                  {order.statusTimeline.map((step, i) => (
                    <span key={i} className="inline-flex items-center gap-1">
                      <PackageCheck className="h-3 w-3 text-[#881337]" />
                      <span className="font-medium text-[#141413]">{ts(step.status)}</span>
                      <span>
                        (
                        {new Date(step.timestamp).toLocaleDateString(locale, {
                          day: 'numeric',
                          month: 'short',
                        })}
                        )
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            ))}

            {hasMore && (
              <div className="pt-2 text-center">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => fetchOrders(activeTab, nextSkip, true)}
                  className="rounded-md border border-[#D6D3CD] bg-white px-6 py-2.5 text-xs font-semibold text-[#141413] hover:border-[#881337] cursor-pointer"
                >
                  {loading ? t('orders.loading') : t('orders.loadNext')}
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {returnTarget && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <form onSubmit={submitReturn} className="w-full max-w-lg max-h-[90dvh] overflow-y-auto overscroll-contain rounded-xl bg-white p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-semibold">Return {returnTarget.title}</h2><button type="button" onClick={() => setReturnTarget(null)} className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-md border border-[#E8E6E1] px-3 text-sm text-[#78716C] cursor-pointer">Close</button></div>
            <p className="text-xs text-[#78716C] max-w-prose">Upload clear photos of the product or packaging. The server checks order ownership, delivery status, returnability and the return window.</p>
            <label className="block text-xs font-medium">Reason
              <textarea required minLength={5} maxLength={1000} value={returnReason} onChange={(e) => setReturnReason(e.target.value)} className="mt-1 w-full rounded-md border border-[#D6D3CD] p-2.5 text-sm" rows={3}/>
            </label>
            <label className="block text-xs font-medium">Evidence photos (1–8)
              <input required type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => setReturnFiles(Array.from(e.target.files || []).slice(0, 8))} className="mt-1 block w-full text-xs"/>
            </label>
            <label className="flex min-h-[44px] items-center gap-2 text-xs cursor-pointer"><input type="checkbox" className="h-4 w-4 accent-[#881337]" checked={selfCourier} onChange={(e) => setSelfCourier(e.target.checked)}/> I will self-ship the return</label>
            {selfCourier && <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input required value={courierName} onChange={(e) => setCourierName(e.target.value)} placeholder="Courier name" className="min-h-[44px] rounded-md border border-[#D6D3CD] p-2.5 text-xs"/>
              <input required value={returnTrackingId} onChange={(e) => setReturnTrackingId(e.target.value)} placeholder="Tracking ID" className="min-h-[44px] rounded-md border border-[#D6D3CD] p-2.5 text-xs"/>
              <input type="url" value={returnTrackingUrl} onChange={(e) => setReturnTrackingUrl(e.target.value)} placeholder="Tracking URL (optional)" className="min-h-[44px] sm:col-span-2 rounded-md border border-[#D6D3CD] p-2.5 text-xs"/>
            </div>}
            {returnError && <p role="alert" className="text-xs text-red-700">{returnError}</p>}
            <ActionButton
              type="submit"
              actionKey="request_return"
              role="CUSTOMER"
              showHelpIcon
              disabled={returnBusy}
              labelOverride={returnBusy ? 'Submitting…' : undefined}
            />
          </form>
        </div>
      )}

      {/* Time-Based $dateTrunc Order History Aggregation */}
      <section className="border-t border-[#E8E6E1] pt-8 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-semibold text-[#141413]">
              {t('orders.aggTitle')}
            </h2>
            <p className="text-xs text-[#6B6A65]">{t('orders.aggDesc')}</p>
          </div>
          <div className="inline-flex max-w-full overflow-x-auto items-center gap-1 rounded-lg bg-[#F0EEE9] p-1 self-start">
            {(
              [
                { id: 'day', label: t('orders.granDay') },
                { id: 'week', label: t('orders.granWeek') },
                { id: 'month', label: t('orders.granMonth') },
                { id: 'year', label: t('orders.granYear') },
              ] as const
            ).map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGranularity(g.id)}
                className={`min-h-[44px] sm:min-h-[36px] inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  granularity === g.id
                    ? 'bg-white text-[#141413] shadow-xs'
                    : 'text-[#57534E] hover:text-[#141413]'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <div className="w-full overflow-x-auto rounded-lg border border-[#E8E6E1] bg-white">
          <table className="w-full min-w-[440px] text-left text-xs">
            <thead className="border-b border-[#E8E6E1] bg-[#FAF9F6] text-[#6B6A65]">
              <tr>
                <th className="px-4 py-3 font-medium">{t('orders.colPeriod')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('orders.colOrders')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('orders.colUnits')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('orders.colSpend')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EEE9] tabular-nums">
              {buckets.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-[#6B6A65]">
                    {t('orders.noPeriods')}
                  </td>
                </tr>
              ) : (
                buckets.map((b) => (
                  <tr key={b.period} className="hover:bg-[#FAF9F6]">
                    <td className="px-4 py-3 font-mono font-medium text-[#141413]">{b.period}</td>
                    <td className="px-4 py-3 text-right">{b.ordersCount}</td>
                    <td className="px-4 py-3 text-right">{b.unitsSold}</td>
                    <td className="px-4 py-3 text-right font-semibold text-[#141413]">
                      {formatINR(b.revenue)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
