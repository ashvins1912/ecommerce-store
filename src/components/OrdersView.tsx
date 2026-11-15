import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Package, PackageCheck, Truck } from 'lucide-react';
import type {
  Order,
  OrderListResponse,
  OrderTab,
  OrderTimeBucket,
  TimeGranularity,
  User,
} from '../shared/types';
import { apiFetch, formatINR } from '../lib/api';
import { useI18n } from '../lib/i18n';

interface OrdersViewProps {
  user: User | null;
  onOpenAuth: () => void;
}

function OrderItemThumb({ src, alt }: { src: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-[#E8E6E1] bg-[#FAF9F6] text-[#A8A29E]">
        <Package className="h-5 w-5" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className="h-14 w-14 shrink-0 rounded-md border border-[#E8E6E1] object-cover bg-[#F2EFE9]"
    />
  );
}

export function OrdersView({ user, onOpenAuth }: OrdersViewProps) {
  const { t, ts, totab, locale } = useI18n();
  const [activeTab, setActiveTab] = useState<OrderTab>('Current');
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextSkip, setNextSkip] = useState(0);
  const [loading, setLoading] = useState(false);

  const [granularity, setGranularity] = useState<TimeGranularity>('month');
  const [buckets, setBuckets] = useState<OrderTimeBucket[]>([]);

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
    <main className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-10 space-y-10">
      {/* Header + Segmented Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[#E8E6E1] pb-6">
        <div>
          <h1 className="font-display text-3xl font-semibold text-[#141413]">
            {t('orders.title')}
          </h1>
          <p className="mt-1 text-xs text-[#6B6A65]">{t('orders.sub')}</p>
        </div>

        <div className="inline-flex max-w-full overflow-x-auto items-center gap-1 rounded-lg bg-[#F0EEE9] p-1 self-start">
          {(['Current', 'Past', 'Completed'] as OrderTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`rounded-md px-3 sm:px-4 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
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
                    {order.appliedCoupon && (
                      <>
                        <span className="text-[#A8A29E]">·</span>
                        <span className="font-mono text-[11px] font-medium text-emerald-800">
                          {order.appliedCoupon.code} (-{formatINR(order.appliedCoupon.discountAmount)})
                        </span>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-4">
                    {order.courierTracking && (
                      <a
                        href={order.courierTracking.trackingUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-md border border-[#881337] px-3 py-1.5 text-xs font-medium text-[#881337] hover:bg-[#881337] hover:text-white transition-colors whitespace-nowrap"
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
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
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

        <div className="overflow-x-auto rounded-lg border border-[#E8E6E1] bg-white">
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
