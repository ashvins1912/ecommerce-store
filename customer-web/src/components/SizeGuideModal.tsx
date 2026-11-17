import { useEffect, useRef, useState } from 'react';
import { Check, Ruler, X } from 'lucide-react';
import type { ClothingSpecs } from '../shared/types';
import { useI18n, type TranslationKey } from '../lib/i18n';

interface SizeRow {
  size: string;
  bustIn: number;
  waistIn: number;
  hipIn: number;
  shoulderIn: number;
  lengthIn: number;
}

const ETHNIC_KURTA_CHART: SizeRow[] = [
  { size: 'XS', bustIn: 34, waistIn: 28, hipIn: 37, shoulderIn: 13.5, lengthIn: 45 },
  { size: 'S', bustIn: 36, waistIn: 30, hipIn: 39, shoulderIn: 14.0, lengthIn: 45.5 },
  { size: 'M', bustIn: 38, waistIn: 32, hipIn: 41, shoulderIn: 14.5, lengthIn: 46 },
  { size: 'L', bustIn: 40, waistIn: 34, hipIn: 43, shoulderIn: 15.0, lengthIn: 46.5 },
  { size: 'XL', bustIn: 42, waistIn: 36, hipIn: 45, shoulderIn: 15.5, lengthIn: 47 },
  { size: 'XXL', bustIn: 44, waistIn: 38, hipIn: 47, shoulderIn: 16.0, lengthIn: 47.5 },
];

const RELAXED_COORD_CHART: SizeRow[] = [
  { size: 'XS', bustIn: 35, waistIn: 29, hipIn: 38, shoulderIn: 14.0, lengthIn: 30 },
  { size: 'S', bustIn: 37, waistIn: 31, hipIn: 40, shoulderIn: 14.5, lengthIn: 30.5 },
  { size: 'M', bustIn: 39, waistIn: 33, hipIn: 42, shoulderIn: 15.0, lengthIn: 31 },
  { size: 'L', bustIn: 41.5, waistIn: 35.5, hipIn: 44.5, shoulderIn: 15.5, lengthIn: 31.5 },
  { size: 'XL', bustIn: 44, waistIn: 38, hipIn: 47, shoulderIn: 16.0, lengthIn: 32 },
  { size: 'XXL', bustIn: 46.5, waistIn: 40.5, hipIn: 49.5, shoulderIn: 16.5, lengthIn: 32.5 },
];

const DRESS_FUSION_CHART: SizeRow[] = [
  { size: 'XS', bustIn: 34, waistIn: 27.5, hipIn: 38.5, shoulderIn: 13.5, lengthIn: 48 },
  { size: 'S', bustIn: 36, waistIn: 29.5, hipIn: 40.5, shoulderIn: 14.0, lengthIn: 48.5 },
  { size: 'M', bustIn: 38, waistIn: 31.5, hipIn: 42.5, shoulderIn: 14.5, lengthIn: 49 },
  { size: 'L', bustIn: 40.5, waistIn: 34, hipIn: 45, shoulderIn: 15.0, lengthIn: 49.5 },
  { size: 'XL', bustIn: 43, waistIn: 36.5, hipIn: 47.5, shoulderIn: 15.5, lengthIn: 50 },
  { size: 'XXL', bustIn: 45.5, waistIn: 39, hipIn: 50, shoulderIn: 16.0, lengthIn: 50.5 },
];

const TAILORED_JACKET_CHART: SizeRow[] = [
  { size: 'XS', bustIn: 36, waistIn: 32, hipIn: 36, shoulderIn: 15.0, lengthIn: 25 },
  { size: 'S', bustIn: 38, waistIn: 34, hipIn: 38, shoulderIn: 15.5, lengthIn: 26 },
  { size: 'M', bustIn: 40, waistIn: 36, hipIn: 40, shoulderIn: 16.0, lengthIn: 27 },
  { size: 'L', bustIn: 42, waistIn: 38, hipIn: 42, shoulderIn: 16.5, lengthIn: 27.5 },
  { size: 'XL', bustIn: 44, waistIn: 40, hipIn: 44, shoulderIn: 17.0, lengthIn: 28 },
];

function selectEaseKey(fabricLower: string, defaultKey: TranslationKey): TranslationKey {
  if (fabricLower.includes('velvet') || fabricLower.includes('brocade')) {
    return 'size.noteVelvet';
  }
  if (fabricLower.includes('silk') || fabricLower.includes('chanderi')) {
    return 'size.noteSilk';
  }
  if (fabricLower.includes('crepe') || fabricLower.includes('georgette') || fabricLower.includes('organza')) {
    return 'size.noteCrepe';
  }
  if (fabricLower.includes('linen') || fabricLower.includes('khadi')) {
    return 'size.noteLinen';
  }
  return defaultKey;
}

function selectMeasurementContext(
  subCategory: string,
  clothingSpecs?: ClothingSpecs
): {
  chartKey: TranslationKey;
  rows: SizeRow[];
  lengthKey: TranslationKey;
  easeKey: TranslationKey;
} {
  const sub = subCategory.toLowerCase();
  const fitLower = (clothingSpecs?.fit || '').toLowerCase();
  const fabricLower = (clothingSpecs?.fabric || '').toLowerCase();

  if (sub.includes('jacket') || sub.includes('layer') || fitLower.includes('tailored')) {
    return {
      chartKey: 'size.chartJackets',
      rows: TAILORED_JACKET_CHART,
      lengthKey: 'size.lenJacket',
      easeKey: selectEaseKey(fabricLower, 'size.noteJacket'),
    };
  }
  if (
    sub.includes('dress') ||
    sub.includes('fusion') ||
    sub.includes('anarkali') ||
    fitLower.includes('a-line') ||
    fitLower.includes('flared')
  ) {
    return {
      chartKey: 'size.chartDress',
      rows: DRESS_FUSION_CHART,
      lengthKey: 'size.lenDress',
      easeKey: selectEaseKey(fabricLower, 'size.noteTrue'),
    };
  }
  if (
    sub.includes('co-ord') ||
    sub.includes('tunic') ||
    sub.includes('kurti') ||
    fitLower.includes('relaxed')
  ) {
    return {
      chartKey: 'size.chartRelaxed',
      rows: RELAXED_COORD_CHART,
      lengthKey: 'size.lenTunic',
      easeKey: selectEaseKey(fabricLower, 'size.noteDrape'),
    };
  }
  return {
    chartKey: 'size.chartKurta',
    rows: ETHNIC_KURTA_CHART,
    lengthKey: 'size.lenGarment',
    easeKey: selectEaseKey(fabricLower, 'size.noteTrue'),
  };
}

interface SizeGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  productTitle: string;
  subCategory: string;
  clothingSpecs?: ClothingSpecs;
  availableSizes: string[];
  selectedSize?: string;
  onSelectSize?: (size: string) => void;
}

export function SizeGuideModal({
  isOpen,
  onClose,
  productTitle,
  subCategory,
  clothingSpecs,
  availableSizes,
  selectedSize,
  onSelectSize,
}: SizeGuideModalProps) {
  const { t } = useI18n();
  const [unit, setUnit] = useState<'in' | 'cm'>('in');
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

  if (!isOpen) return null;

  const context = selectMeasurementContext(subCategory, clothingSpecs);
  const formatVal = (inches: number) =>
    unit === 'in' ? `${inches}"` : `${(inches * 2.54).toFixed(1)} cm`;

  const sizeSet = new Set(availableSizes.map((s) => s.toUpperCase()));
  const filteredRows =
    sizeSet.size > 0
      ? context.rows.filter((r) => sizeSet.has(r.size) || r.size === selectedSize)
      : context.rows;
  const rowsToShow = filteredRows.length > 0 ? filteredRows : context.rows;

  const patternDetails = [
    clothingSpecs?.pattern,
    clothingSpecs?.sleeveType,
    clothingSpecs?.neckType,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-3 sm:p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="size-guide-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto overscroll-contain rounded-xl border border-[#E8E6E1] bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[#E8E6E1] bg-white px-4 sm:px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium text-[#881337]">
              <Ruler className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{t(context.chartKey)}</span>
            </div>
            <h2
              id="size-guide-modal-title"
              className="mt-1 font-display text-xl sm:text-2xl font-semibold text-[#141413]"
            >
              {t('size.title')}
            </h2>
            <p className="text-xs text-[#6B6A65] truncate max-w-md">{productTitle}</p>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label={t('detail.close')}
            className="inline-flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md border border-[#E8E6E1] text-[#57534E] hover:bg-[#FAF9F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#881337] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-5">
          {/* Dynamic Fabric & Fit Context Strip */}
          {clothingSpecs && (
            <div className="rounded-lg border border-[#E8E6E1] bg-[#FAF9F6] p-4 space-y-3">
              <div className="text-[11px] font-medium uppercase tracking-wider text-[#6B6A65]">
                {t('size.fabricNotes')}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <div>
                  <div className="text-[#6B6A65]">{t('detail.fabric')}</div>
                  <div className="mt-0.5 font-semibold text-[#141413]">{clothingSpecs.fabric}</div>
                </div>
                <div>
                  <div className="text-[#6B6A65]">{t('size.silhouetteFit')}</div>
                  <div className="mt-0.5 font-semibold text-[#141413]">{clothingSpecs.fit}</div>
                </div>
                {patternDetails && (
                  <div>
                    <div className="text-[#6B6A65]">{t('size.patternNeck')}</div>
                    <div className="mt-0.5 font-semibold text-[#141413]">{patternDetails}</div>
                  </div>
                )}
                <div>
                  <div className="text-[#6B6A65]">{t('detail.washCare')}</div>
                  <div className="mt-0.5 font-semibold text-[#141413]">
                    {clothingSpecs.washCare}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Ease Guidance & Unit Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1 max-w-md">
              <p className="text-xs leading-relaxed text-[#57534E]">{t(context.easeKey)}</p>
              {onSelectSize && availableSizes.length > 0 && (
                <p className="text-[11px] text-[#881337]">{t('size.clickToSelect')}</p>
              )}
            </div>
            <div
              role="group"
              aria-label="Measurement unit"
              className="inline-flex items-center gap-1 rounded-md bg-[#F0EEE9] p-1"
            >
              <button
                type="button"
                onClick={() => setUnit('in')}
                aria-pressed={unit === 'in'}
                className={`min-h-[44px] sm:min-h-[38px] rounded px-3.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  unit === 'in'
                    ? 'bg-white text-[#141413] shadow-xs'
                    : 'text-[#57534E] hover:text-[#141413]'
                }`}
              >
                {t('size.inches')}
              </button>
              <button
                type="button"
                onClick={() => setUnit('cm')}
                aria-pressed={unit === 'cm'}
                className={`min-h-[44px] sm:min-h-[38px] rounded px-3.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  unit === 'cm'
                    ? 'bg-white text-[#141413] shadow-xs'
                    : 'text-[#57534E] hover:text-[#141413]'
                }`}
              >
                {t('size.cm')}
              </button>
            </div>
          </div>

          {/* Measurement Table with sticky Size column on mobile */}
          <div className="w-full overflow-x-auto rounded-lg border border-[#E8E6E1]">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="border-b border-[#E8E6E1] bg-[#FAF9F6] text-[#6B6A65]">
                <tr>
                  <th className="sticky left-0 z-10 bg-[#FAF9F6] px-4 py-3 font-medium">
                    {t('size.colSize')}
                  </th>
                  <th className="px-4 py-3 font-medium text-right whitespace-nowrap">
                    {t('size.colBust')}
                  </th>
                  <th className="px-4 py-3 font-medium text-right whitespace-nowrap">
                    {t('size.colWaist')}
                  </th>
                  <th className="px-4 py-3 font-medium text-right whitespace-nowrap">
                    {t('size.colHip')}
                  </th>
                  <th className="px-4 py-3 font-medium text-right whitespace-nowrap">
                    {t('size.colShoulder')}
                  </th>
                  <th className="px-4 py-3 font-medium text-right whitespace-nowrap">
                    {t(context.lengthKey)}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EEE9] tabular-nums">
                {rowsToShow.map((row) => {
                  const isCurrent = selectedSize?.toUpperCase() === row.size;
                  const canSelect =
                    Boolean(onSelectSize) &&
                    (sizeSet.size === 0 || sizeSet.has(row.size));

                  return (
                    <tr
                      key={row.size}
                      onClick={() => {
                        if (canSelect && onSelectSize) {
                          onSelectSize(row.size);
                          onClose();
                        }
                      }}
                      className={`transition-colors ${
                        isCurrent
                          ? 'bg-[#881337]/5 font-semibold'
                          : canSelect
                            ? 'bg-white hover:bg-[#FAF9F6] cursor-pointer'
                            : 'bg-white'
                      }`}
                    >
                      <td
                        className={`sticky left-0 z-10 px-4 py-3 text-[#141413] whitespace-nowrap ${
                          isCurrent ? 'bg-[#FDF6F8]' : 'bg-white'
                        }`}
                      >
                        <div className="inline-flex items-center gap-1.5">
                          <span>{row.size}</span>
                          {isCurrent && (
                            <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-[#881337]">
                              <Check className="h-3 w-3" />
                              {t('size.selected')}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">{formatVal(row.bustIn)}</td>
                      <td className="px-4 py-3 text-right">{formatVal(row.waistIn)}</td>
                      <td className="px-4 py-3 text-right">{formatVal(row.hipIn)}</td>
                      <td className="px-4 py-3 text-right">{formatVal(row.shoulderIn)}</td>
                      <td className="px-4 py-3 text-right">{formatVal(row.lengthIn)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="text-[11px] text-[#6B6A65] leading-relaxed">{t('size.howToMeasure')}</div>
        </div>
      </div>
    </div>
  );
}
