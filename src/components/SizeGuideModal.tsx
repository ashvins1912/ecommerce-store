import { useState } from 'react';
import { Ruler, X } from 'lucide-react';
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

const TAILORED_JACKET_CHART: SizeRow[] = [
  { size: 'XS', bustIn: 36, waistIn: 32, hipIn: 36, shoulderIn: 15.0, lengthIn: 25 },
  { size: 'S', bustIn: 38, waistIn: 34, hipIn: 38, shoulderIn: 15.5, lengthIn: 26 },
  { size: 'M', bustIn: 40, waistIn: 36, hipIn: 40, shoulderIn: 16.0, lengthIn: 27 },
  { size: 'L', bustIn: 42, waistIn: 38, hipIn: 42, shoulderIn: 16.5, lengthIn: 27.5 },
  { size: 'XL', bustIn: 44, waistIn: 40, hipIn: 44, shoulderIn: 17.0, lengthIn: 28 },
];

function selectMeasurementContext(subCategory: string, clothingSpecs?: ClothingSpecs): {
  chartKey: TranslationKey;
  rows: SizeRow[];
  lengthKey: TranslationKey;
  easeKey: TranslationKey;
} {
  const sub = subCategory.toLowerCase();
  const fitLower = (clothingSpecs?.fit || '').toLowerCase();
  const fabricLower = (clothingSpecs?.fabric || '').toLowerCase();

  if (sub.includes('jacket') || sub.includes('layer')) {
    return {
      chartKey: 'size.chartJackets',
      rows: TAILORED_JACKET_CHART,
      lengthKey: 'size.lenJacket',
      easeKey: 'size.noteJacket',
    };
  }
  if (sub.includes('co-ord') || fitLower.includes('relaxed')) {
    return {
      chartKey: 'size.chartRelaxed',
      rows: RELAXED_COORD_CHART,
      lengthKey: 'size.lenTunic',
      easeKey:
        fabricLower.includes('linen') || fabricLower.includes('khadi')
          ? 'size.noteLinen'
          : 'size.noteDrape',
    };
  }
  return {
    chartKey: 'size.chartKurta',
    rows: ETHNIC_KURTA_CHART,
    lengthKey: 'size.lenGarment',
    easeKey:
      fabricLower.includes('silk') || fabricLower.includes('chanderi')
        ? 'size.noteSilk'
        : 'size.noteTrue',
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
}

export function SizeGuideModal({
  isOpen,
  onClose,
  productTitle,
  subCategory,
  clothingSpecs,
  availableSizes,
  selectedSize,
}: SizeGuideModalProps) {
  const { t } = useI18n();
  const [unit, setUnit] = useState<'in' | 'cm'>('in');

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

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
      <div className="w-full max-w-2xl rounded-xl border border-[#E8E6E1] bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[#E8E6E1] px-6 py-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-[#881337]">
              <Ruler className="h-3.5 w-3.5" />
              <span>{t(context.chartKey)}</span>
            </div>
            <h2 className="mt-1 font-display text-2xl font-semibold text-[#141413]">
              {t('size.title')}
            </h2>
            <p className="text-xs text-[#6B6A65] truncate max-w-md">{productTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('detail.close')}
            className="rounded-md border border-[#E8E6E1] p-1.5 text-[#57534E] hover:bg-[#FAF9F6] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Dynamic Fabric & Fit Context Strip */}
          {clothingSpecs && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 rounded-lg border border-[#E8E6E1] bg-[#FAF9F6] p-4 text-xs">
              <div>
                <div className="text-[#6B6A65]">{t('detail.fabric')}</div>
                <div className="mt-0.5 font-semibold text-[#141413]">{clothingSpecs.fabric}</div>
              </div>
              <div>
                <div className="text-[#6B6A65]">{t('size.silhouetteFit')}</div>
                <div className="mt-0.5 font-semibold text-[#141413]">{clothingSpecs.fit}</div>
              </div>
              <div>
                <div className="text-[#6B6A65]">{t('detail.washCare')}</div>
                <div className="mt-0.5 font-semibold text-[#141413]">{clothingSpecs.washCare}</div>
              </div>
            </div>
          )}

          {/* Unit Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-[#57534E] max-w-md">{t(context.easeKey)}</p>
            <div className="inline-flex items-center gap-1 rounded-md bg-[#F0EEE9] p-1">
              <button
                type="button"
                onClick={() => setUnit('in')}
                className={`rounded px-3 py-1 text-xs font-medium cursor-pointer ${
                  unit === 'in' ? 'bg-white text-[#141413] shadow-xs' : 'text-[#57534E]'
                }`}
              >
                {t('size.inches')}
              </button>
              <button
                type="button"
                onClick={() => setUnit('cm')}
                className={`rounded px-3 py-1 text-xs font-medium cursor-pointer ${
                  unit === 'cm' ? 'bg-white text-[#141413] shadow-xs' : 'text-[#57534E]'
                }`}
              >
                {t('size.cm')}
              </button>
            </div>
          </div>

          {/* Measurement Table */}
          <div className="overflow-x-auto rounded-lg border border-[#E8E6E1]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#E8E6E1] bg-[#FAF9F6] text-[#6B6A65]">
                <tr>
                  <th className="px-4 py-3 font-medium">{t('size.colSize')}</th>
                  <th className="px-4 py-3 font-medium text-right">{t('size.colBust')}</th>
                  <th className="px-4 py-3 font-medium text-right">{t('size.colWaist')}</th>
                  <th className="px-4 py-3 font-medium text-right">{t('size.colHip')}</th>
                  <th className="px-4 py-3 font-medium text-right">{t('size.colShoulder')}</th>
                  <th className="px-4 py-3 font-medium text-right">{t(context.lengthKey)}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EEE9] tabular-nums">
                {rowsToShow.map((row) => {
                  const isCurrent = selectedSize === row.size;
                  return (
                    <tr
                      key={row.size}
                      className={isCurrent ? 'bg-[#881337]/5 font-semibold' : 'bg-white'}
                    >
                      <td className="px-4 py-2.5 text-[#141413]">
                        {row.size}
                        {isCurrent && (
                          <span className="ml-2 text-[11px] font-normal text-[#881337]">
                            {t('size.selected')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">{formatVal(row.bustIn)}</td>
                      <td className="px-4 py-2.5 text-right">{formatVal(row.waistIn)}</td>
                      <td className="px-4 py-2.5 text-right">{formatVal(row.hipIn)}</td>
                      <td className="px-4 py-2.5 text-right">{formatVal(row.shoulderIn)}</td>
                      <td className="px-4 py-2.5 text-right">{formatVal(row.lengthIn)}</td>
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
