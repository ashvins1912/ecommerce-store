import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Share2, TrendingUp } from 'lucide-react';
import { formatINR } from '../lib/api';
import { useI18n } from '../lib/i18n';
import type { SellerAnalyticsResponse, TimeGranularity } from '../shared/types';

export interface DashboardKPIProps {
  analytics: SellerAnalyticsResponse;
  granularity: TimeGranularity;
  onGranularityChange: (next: TimeGranularity) => void;
}

export function DashboardKPI({
  analytics,
  granularity,
  onGranularityChange,
}: DashboardKPIProps) {
  const { t } = useI18n();

  const totalUnitsSold = analytics.timeSeries.reduce((sum, b) => sum + (b.unitsSold || 0), 0);

  return (
    <div className="space-y-6 min-w-0">
      {/* Fluid Responsive KPI Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4">
        <div className="min-w-0 rounded-lg border border-[#E8E6E1] bg-white p-4 sm:p-5">
          <div className="text-xs text-[#6B6A65]">{t('seller.kpiRevenue')}</div>
          <div className="mt-1 text-xl sm:text-2xl font-semibold text-[#141413] tabular-nums truncate">
            {formatINR(analytics.overview.totalRevenue)}
          </div>
          <div className="mt-1 text-[11px] text-[#6B6A65] tabular-nums">
            {analytics.overview.totalOrders} {t('orders.colOrders')} · {totalUnitsSold} units
          </div>
        </div>

        <div className="min-w-0 rounded-lg border border-[#E8E6E1] bg-white p-4 sm:p-5">
          <div className="text-xs text-[#6B6A65]">{t('seller.kpiViews')}</div>
          <div className="mt-1 text-xl sm:text-2xl font-semibold text-[#141413] tabular-nums truncate">
            {analytics.overview.totalViews.toLocaleString()}
          </div>
          <div className="mt-1 text-[11px] text-[#6B6A65] tabular-nums">
            {analytics.overview.totalLikes.toLocaleString()} {t('card.likes')} ·{' '}
            {analytics.overview.totalCartAdds} {t('seller.colBag')}
          </div>
        </div>

        <div className="min-w-0 rounded-lg border border-[#E8E6E1] bg-white p-4 sm:p-5">
          <div className="flex items-center justify-between gap-1 text-xs text-[#6B6A65]">
            <span>{t('seller.kpiShares')}</span>
            <Share2 className="h-3.5 w-3.5 text-[#166534] shrink-0" aria-hidden="true" />
          </div>
          <div className="mt-1 text-xl sm:text-2xl font-semibold text-[#141413] tabular-nums truncate">
            {(analytics.overview.totalShares || 0).toLocaleString()}
          </div>
          <div className="mt-1 text-[11px] text-[#166534] tabular-nums truncate">
            {t('seller.mostSharedSub')}
          </div>
        </div>

        <div className="min-w-0 rounded-lg border border-[#E8E6E1] bg-white p-4 sm:p-5">
          <div className="text-xs text-[#6B6A65]">{t('seller.kpiConv')}</div>
          <div className="mt-1 text-xl sm:text-2xl font-semibold text-[#141413] tabular-nums truncate">
            {analytics.overview.conversionRate}%
          </div>
          <div className="mt-1 text-[11px] text-[#6B6A65] inline-flex items-center gap-1">
            <TrendingUp className="h-3 w-3 text-[#881337]" aria-hidden="true" />
            <span>Views → Purchases</span>
          </div>
        </div>

        <div className="min-w-0 rounded-lg border border-[#E8E6E1] bg-white p-4 sm:p-5 sm:col-span-2 lg:col-span-1">
          <div className="text-xs text-[#6B6A65]">{t('seller.kpiTrust')}</div>
          <div className="mt-1 text-xl sm:text-2xl font-semibold text-[#141413] tabular-nums truncate">
            {analytics.overview.trustScore.toFixed(1)} / 5.0
          </div>
          <div className="mt-1 text-[11px] text-[#6B6A65]">
            {analytics.sentimentSummary.Positive} + · {analytics.sentimentSummary.Neutral} =
          </div>
        </div>
      </div>

      {/* Recharts Monthly Sales & Revenue Trends Visualization */}
      <div className="min-w-0 rounded-lg border border-[#E8E6E1] bg-white p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-xl font-semibold text-[#141413]">
              {t('seller.revTrend')}
            </h2>
            <p className="text-xs text-[#6B6A65]">{t('orders.aggDesc')}</p>
          </div>
          <div
            className="inline-flex flex-wrap items-center gap-1 rounded-md bg-[#F0EEE9] p-1"
            role="group"
            aria-label="Analytics time granularity"
          >
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
                aria-pressed={granularity === g.id}
                onClick={() => onGranularityChange(g.id)}
                className={`min-h-[44px] min-w-[44px] rounded px-3 py-1 text-[11px] font-medium cursor-pointer transition-colors ${
                  granularity === g.id
                    ? 'bg-white text-[#141413] shadow-xs font-semibold'
                    : 'text-[#57534E] hover:text-[#141413]'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        {analytics.timeSeries.length === 0 ? (
          <div className="flex h-64 w-full items-center justify-center rounded-md border border-dashed border-[#E8E6E1] bg-[#FAF9F6] text-xs text-[#6B6A65]">
            No completed order data recorded for this period yet.
          </div>
        ) : (
          <div className="h-72 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={analytics.timeSeries}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#F0EEE9" />
                <XAxis dataKey="period" tick={{ fontSize: 11, fill: '#6B6A65' }} />
                <YAxis
                  yAxisId="revenue"
                  tick={{ fontSize: 11, fill: '#6B6A65' }}
                  tickFormatter={(val) =>
                    Number(val) >= 1000 ? `₹${Math.round(Number(val) / 1000)}k` : `₹${val}`
                  }
                />
                <YAxis
                  yAxisId="sales"
                  orientation="right"
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: '#A16207' }}
                />
                <Tooltip
                  contentStyle={{ fontSize: '12px', borderRadius: '8px', borderColor: '#E8E6E1' }}
                  formatter={(val: unknown, name: unknown) => {
                    if (name === 'Revenue') return [formatINR(Number(val)), 'Revenue'];
                    if (name === 'Units Sold') return [`${Number(val)} units`, 'Units Sold'];
                    return [`${Number(val)} orders`, 'Orders'];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Bar
                  yAxisId="revenue"
                  dataKey="revenue"
                  name="Revenue"
                  fill="#881337"
                  radius={[4, 4, 0, 0]}
                  barSize={28}
                />
                <Line
                  yAxisId="sales"
                  type="monotone"
                  dataKey="unitsSold"
                  name="Units Sold"
                  stroke="#A16207"
                  strokeWidth={2.5}
                  dot={{ r: 3.5, fill: '#A16207' }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  yAxisId="sales"
                  type="monotone"
                  dataKey="ordersCount"
                  name="Orders"
                  stroke="#166534"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  dot={{ r: 3, fill: '#166534' }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
