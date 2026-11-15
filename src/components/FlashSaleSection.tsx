import { useEffect, useState } from 'react';
import { ArrowRight, Bell, BellRing, Flame, Sparkles, Timer } from 'lucide-react';
import { formatINR } from '../lib/api';
import { useI18n } from '../lib/i18n';
import type { Product, SeasonType, StorefrontCampaign } from '../shared/types';

interface FlashSaleSectionProps {
  campaigns: StorefrontCampaign[];
  activeCampaignId: string | null;
  onSelectCampaign: (campaign: StorefrontCampaign) => void;
  onSelectSeason: (season: SeasonType) => void;
  onOpenProduct: (product: Product) => void;
}

interface TimeBreakdown {
  days: string;
  hrs: string;
  min: string;
  sec: string;
  expired: boolean;
}

function getTimeBreakdown(targetIso: string, nowMs: number): TimeBreakdown {
  const diff = Math.max(0, new Date(targetIso).getTime() - nowMs);
  if (diff <= 0) {
    return { days: '00', hrs: '00', min: '00', sec: '00', expired: true };
  }
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hrs = Math.floor((totalSec % 86400) / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  return {
    days: String(days).padStart(2, '0'),
    hrs: String(hrs).padStart(2, '0'),
    min: String(min).padStart(2, '0'),
    sec: String(sec).padStart(2, '0'),
    expired: false,
  };
}

const SEASON_THEMES: Record<
  SeasonType,
  {
    surface: string;
    border: string;
    accent: string;
    tileBg: string;
    tileText: string;
    btnBg: string;
  }
> = {
  Diwali: {
    surface: 'bg-gradient-to-br from-[#231917] via-[#34181F] to-[#1D1716] text-white',
    border: 'border-[#5C3A2E]',
    accent: 'text-[#F3CE84]',
    tileBg: 'bg-white/10 border border-white/15',
    tileText: 'text-[#FAF5EC]',
    btnBg: 'bg-[#F3CE84] text-[#1C1615] hover:bg-[#F7D99C]',
  },
  Christmas: {
    surface: 'bg-gradient-to-br from-[#172821] via-[#1B332A] to-[#141E19] text-white',
    border: 'border-[#2D4F40]',
    accent: 'text-[#F2C97D]',
    tileBg: 'bg-white/10 border border-white/15',
    tileText: 'text-[#FAF5EC]',
    btnBg: 'bg-[#F2C97D] text-[#141E19] hover:bg-[#F6D79A]',
  },
  'New Year': {
    surface: 'bg-gradient-to-br from-[#16161B] via-[#261D24] to-[#141413] text-white',
    border: 'border-[#3E3339]',
    accent: 'text-[#E9C478]',
    tileBg: 'bg-white/10 border border-white/15',
    tileText: 'text-white',
    btnBg: 'bg-white text-[#141413] hover:bg-[#FAF9F6]',
  },
  Winter: {
    surface: 'bg-[#FBF9F5] text-[#141413]',
    border: 'border-[#DED9D0]',
    accent: 'text-[#881337]',
    tileBg: 'bg-white border border-[#E6E2DA]',
    tileText: 'text-[#141413]',
    btnBg: 'bg-[#881337] text-white hover:bg-[#9F1239]',
  },
  Summer: {
    surface: 'bg-[#FDFCF9] text-[#141413]',
    border: 'border-[#E6E1D6]',
    accent: 'text-[#925814]',
    tileBg: 'bg-[#F6F2EA] border border-[#E5DEC9]',
    tileText: 'text-[#141413]',
    btnBg: 'bg-[#141413] text-white hover:bg-[#2C2B29]',
  },
};

export function FlashSaleSection({
  campaigns,
  activeCampaignId,
  onSelectCampaign,
  onSelectSeason,
  onOpenProduct,
}: FlashSaleSectionProps) {
  const { t, tseason } = useI18n();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [remindedIds, setRemindedIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('kk_campaign_reminders');
      return saved ? (JSON.parse(saved) as string[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  if (campaigns.length === 0) return null;

  const toggleReminder = (campaignId: string) => {
    setRemindedIds((prev) => {
      const next = prev.includes(campaignId)
        ? prev.filter((id) => id !== campaignId)
        : [...prev, campaignId];
      try {
        localStorage.setItem('kk_campaign_reminders', JSON.stringify(next));
      } catch {
        // Ignore storage error
      }
      return next;
    });
  };

  return (
    <section aria-label={t('flash.title')} className="border-b border-[#E8E6E1] bg-white">
      <div className="mx-auto max-w-7xl px-4 py-7 sm:px-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#881337]">
              <Timer className="h-3.5 w-3.5" />
              <span>{t('flash.kicker')}</span>
            </div>
            <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-[#141413] sm:text-3xl">
              {t('flash.title')}
            </h2>
            <p className="mt-0.5 text-xs text-[#6B6A65]">{t('flash.sub')}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {campaigns.slice(0, 4).map((campaign) => {
            const theme = SEASON_THEMES[campaign.season] || SEASON_THEMES.Diwali;
            const isUpcoming = new Date(campaign.startsAt).getTime() > nowMs;
            const targetIso = isUpcoming ? campaign.startsAt : campaign.endsAt;
            const timer = getTimeBreakdown(targetIso, nowMs);
            const isReminded = remindedIds.includes(campaign._id);
            const isSelected = activeCampaignId === campaign._id;
            const isDark =
              campaign.season === 'Diwali' ||
              campaign.season === 'Christmas' ||
              campaign.season === 'New Year';

            return (
              <article
                key={campaign._id}
                className={`relative flex flex-col justify-between rounded-xl border p-5 transition-all ${theme.surface} ${theme.border} ${
                  isSelected ? 'ring-2 ring-[#881337] ring-offset-2' : 'hover:shadow-md'
                }`}
              >
                <div>
                  {/* Editorial Metadata Line */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em]">
                      <button
                        type="button"
                        onClick={() => onSelectSeason(campaign.season)}
                        className={`inline-flex items-center gap-1 hover:underline cursor-pointer ${theme.accent}`}
                      >
                        <Sparkles className="h-3 w-3" />
                        {tseason(campaign.season)}
                      </button>
                      <span className="opacity-40">·</span>
                      <span className={isUpcoming ? theme.accent : 'text-emerald-400'}>
                        {isUpcoming ? t('flash.startingSoon') : t('flash.liveNow')}
                      </span>
                      <span className="opacity-40">·</span>
                      <span className={isDark ? 'text-white/75' : 'text-[#57534E]'}>
                        {campaign.sellerName}
                      </span>
                    </div>

                    <span
                      className={`inline-flex items-center gap-1 text-xs font-semibold tabular-nums ${theme.accent}`}
                    >
                      <Flame className="h-3.5 w-3.5" />
                      {t('flash.upToOff', { percent: campaign.discountPercent })}
                    </span>
                  </div>

                  {/* Campaign Headline + Live Countdown Row */}
                  <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <h3 className="font-display text-xl font-semibold leading-snug sm:text-2xl">
                        {campaign.name}
                      </h3>
                      <p
                        className={`mt-1 line-clamp-2 text-xs leading-relaxed ${
                          isDark ? 'text-white/80' : 'text-[#57534E]'
                        }`}
                      >
                        {campaign.tagline}
                      </p>
                    </div>

                    {/* Flip-Style Tabular Countdown Timer */}
                    <div className="shrink-0">
                      <div
                        className={`mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                          isDark ? 'text-white/70' : 'text-[#6B6A65]'
                        }`}
                      >
                        {isUpcoming ? t('flash.startsIn') : t('flash.endsIn')}
                      </div>
                      <div className="flex items-center gap-1.5 tabular-nums">
                        {[
                          { val: timer.days, lbl: t('flash.days') },
                          { val: timer.hrs, lbl: t('flash.hrs') },
                          { val: timer.min, lbl: t('flash.min') },
                          { val: timer.sec, lbl: t('flash.sec') },
                        ].map((unit, uIdx) => (
                          <div key={unit.lbl} className="flex items-center gap-1.5">
                            <div
                              className={`min-w-[44px] rounded-md px-2 py-1.5 text-center ${theme.tileBg}`}
                            >
                              <div
                                className={`font-mono text-base font-bold leading-none ${theme.tileText}`}
                              >
                                {unit.val}
                              </div>
                              <div
                                className={`mt-1 text-[9px] font-medium uppercase tracking-wider ${
                                  isDark ? 'text-white/65' : 'text-[#6B6A65]'
                                }`}
                              >
                                {unit.lbl}
                              </div>
                            </div>
                            {uIdx < 3 && (
                              <span
                                className={`font-mono text-xs font-bold ${
                                  isDark ? 'text-white/40' : 'text-[#A8A29E]'
                                }`}
                              >
                                :
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Preview Thumbnails Strip */}
                  {campaign.products.length > 0 && (
                    <div className="mt-4 flex items-center gap-2.5 overflow-x-auto pb-1">
                      {campaign.products.slice(0, 4).map((prod) => (
                        <button
                          key={prod._id}
                          type="button"
                          onClick={() => onOpenProduct(prod)}
                          className={`group flex shrink-0 items-center gap-2 rounded-md border p-1.5 pr-2.5 text-left transition-colors cursor-pointer ${
                            isDark
                              ? 'border-white/15 bg-white/8 hover:bg-white/15'
                              : 'border-[#E8E6E1] bg-white hover:border-[#881337]'
                          }`}
                        >
                          <img
                            src={prod.images[0]?.thumbUrl || prod.images[0]?.url}
                            alt={prod.title}
                            className="h-10 w-10 rounded object-cover"
                          />
                          <div className="max-w-[120px]">
                            <div className="truncate text-[11px] font-medium group-hover:underline">
                              {prod.title}
                            </div>
                            <div
                              className={`text-[11px] font-semibold tabular-nums ${theme.accent}`}
                            >
                              {formatINR(prod.salePrice)}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Card Footer Actions */}
                <div
                  className={`mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3 ${
                    isDark ? 'border-white/12' : 'border-[#EAE6DD]'
                  }`}
                >
                  <span className={`text-xs ${isDark ? 'text-white/75' : 'text-[#57534E]'}`}>
                    {t('flash.itemsCount', { count: campaign.products.length })}
                  </span>

                  <div className="flex items-center gap-2">
                    {isUpcoming && (
                      <button
                        type="button"
                        onClick={() => toggleReminder(campaign._id)}
                        className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                          isReminded
                            ? isDark
                              ? 'border-[#F3CE84] bg-[#F3CE84]/15 text-[#F3CE84]'
                              : 'border-[#881337] bg-[#FFF8F6] text-[#881337]'
                            : isDark
                              ? 'border-white/25 text-white hover:bg-white/10'
                              : 'border-[#D6D3CD] text-[#141413] hover:bg-[#F5F3EE]'
                        }`}
                      >
                        {isReminded ? (
                          <BellRing className="h-3.5 w-3.5" />
                        ) : (
                          <Bell className="h-3.5 w-3.5" />
                        )}
                        {isReminded ? t('flash.reminded') : t('flash.remindMe')}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onSelectCampaign(campaign)}
                      className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${theme.btnBg}`}
                    >
                      <span>{isUpcoming ? t('flash.previewSale') : t('flash.shopCampaign')}</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
