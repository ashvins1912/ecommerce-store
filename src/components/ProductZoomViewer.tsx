import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { ProductImage } from '../shared/types';
import { useI18n } from '../lib/i18n';

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.6;

interface ProductZoomViewerProps {
  open: boolean;
  images: ProductImage[];
  initialIndex: number;
  initialZoom?: number;
  title: string;
  onClose: () => void;
}

interface Point {
  x: number;
  y: number;
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));
}

export function ProductZoomViewer({
  open,
  images,
  initialIndex,
  initialZoom = 1,
  title,
  onClose,
}: ProductZoomViewerProps) {
  const { t } = useI18n();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(() => clampZoom(initialZoom));
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [isInteracting, setIsInteracting] = useState(false);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);

  const viewerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panRef = useRef(pan);
  panRef.current = pan;

  const pointersRef = useRef<Map<number, Point>>(new Map());
  const pinchStateRef = useRef<{ dist: number; mid: Point } | null>(null);
  const pointerDownOriginRef = useRef<Point | null>(null);
  const didDragRef = useRef(false);

  const clampPan = useCallback((nextPan: Point, targetZoom: number): Point => {
    if (targetZoom <= 1) return { x: 0, y: 0 };
    const stage = stageRef.current;
    const img = imgRef.current;
    if (!stage || !img) return nextPan;

    const stageW = stage.clientWidth;
    const stageH = stage.clientHeight;
    const baseW = img.offsetWidth;
    const baseH = img.offsetHeight;

    const maxX = Math.max(0, (baseW * targetZoom - stageW) / 2);
    const maxY = Math.max(0, (baseH * targetZoom - stageH) / 2);

    return {
      x: Math.min(maxX, Math.max(-maxX, nextPan.x)),
      y: Math.min(maxY, Math.max(-maxY, nextPan.y)),
    };
  }, []);

  const applyZoom = useCallback(
    (nextZoomRaw: number, focalClientPoint?: Point) => {
      const prevZoom = zoomRef.current;
      const nextZoom = clampZoom(nextZoomRaw);

      if (nextZoom <= 1) {
        setZoom(1);
        setPan({ x: 0, y: 0 });
        return;
      }

      let nextPan = panRef.current;
      if (focalClientPoint && stageRef.current) {
        const rect = stageRef.current.getBoundingClientRect();
        const cx = focalClientPoint.x - (rect.left + rect.width / 2);
        const cy = focalClientPoint.y - (rect.top + rect.height / 2);
        const scaleRatio = nextZoom / prevZoom;
        nextPan = {
          x: cx - (cx - nextPan.x) * scaleRatio,
          y: cy - (cy - nextPan.y) * scaleRatio,
        };
      }

      setZoom(nextZoom);
      setPan(clampPan(nextPan, nextZoom));
    },
    [clampPan]
  );

  // Reset viewer state cleanly whenever opened
  useEffect(() => {
    if (!open) {
      pointersRef.current.clear();
      pinchStateRef.current = null;
      setIsInteracting(false);
      if (typeof document !== 'undefined' && document.fullscreenElement) {
        try {
          void document.exitFullscreen();
        } catch {
          // Ignore fullscreen exit failures inside restricted contexts
        }
      }
      return;
    }

    const safeIdx = Math.max(0, Math.min(images.length - 1, initialIndex));
    setCurrentIndex(safeIdx);
    setZoom(clampZoom(initialZoom));
    setPan({ x: 0, y: 0 });
    pointersRef.current.clear();
    pinchStateRef.current = null;
    didDragRef.current = false;
  }, [open, initialIndex, initialZoom, images.length]);

  // Track native fullscreen changes cleanly
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleFsChange = () => {
      setIsNativeFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const handleClose = useCallback(() => {
    if (typeof document !== 'undefined' && document.fullscreenElement) {
      try {
        void document.exitFullscreen();
      } catch {
        // Ignore
      }
    }
    onClose();
  }, [onClose]);

  const goToSlide = useCallback(
    (nextIdx: number) => {
      if (images.length === 0) return;
      const wrapped = (nextIdx + images.length) % images.length;
      setCurrentIndex(wrapped);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      pointersRef.current.clear();
      pinchStateRef.current = null;
    },
    [images.length]
  );

  // Keyboard navigation & zoom controls (capture phase isolates Escape from underlying modals)
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
      } else if (e.key === 'ArrowLeft' && images.length > 1) {
        e.preventDefault();
        goToSlide(currentIndex - 1);
      } else if (e.key === 'ArrowRight' && images.length > 1) {
        e.preventDefault();
        goToSlide(currentIndex + 1);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        applyZoom(zoomRef.current + ZOOM_STEP);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        applyZoom(zoomRef.current - ZOOM_STEP);
      } else if (e.key === '0') {
        e.preventDefault();
        applyZoom(1);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, currentIndex, images.length, handleClose, goToSlide, applyZoom]);

  // Non-passive wheel listener for smooth pointer-centered desktop zoom
  useEffect(() => {
    const stage = stageRef.current;
    if (!open || !stage) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.35 : -0.35;
      applyZoom(zoomRef.current + delta, { x: e.clientX, y: e.clientY });
    };

    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [open, applyZoom]);

  const toggleFullscreen = async () => {
    const el = viewerRef.current;
    if (!el || typeof document === 'undefined') return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (el.requestFullscreen) {
        await el.requestFullscreen();
      }
    } catch {
      // iFrame environments may restrict Fullscreen API; modal already fills 100vw x 100dvh
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 1) {
      didDragRef.current = false;
      pointerDownOriginRef.current = { x: e.clientX, y: e.clientY };
      setIsInteracting(true);
    } else if (pointersRef.current.size === 2) {
      didDragRef.current = true;
      pointerDownOriginRef.current = null;
      setIsInteracting(true);
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      pinchStateRef.current = { dist, mid };
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const prevPoint = pointersRef.current.get(e.pointerId);
    if (!prevPoint) return;

    const currentPoint = { x: e.clientX, y: e.clientY };
    pointersRef.current.set(e.pointerId, currentPoint);

    if (pointersRef.current.size === 2 && pinchStateRef.current) {
      const pts = Array.from(pointersRef.current.values());
      const newDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const newMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };

      if (pinchStateRef.current.dist > 0 && stageRef.current) {
        const prevZoom = zoomRef.current;
        const nextZoom = clampZoom(prevZoom * (newDist / pinchStateRef.current.dist));
        const rect = stageRef.current.getBoundingClientRect();
        const cx = newMid.x - (rect.left + rect.width / 2);
        const cy = newMid.y - (rect.top + rect.height / 2);
        const scaleRatio = nextZoom / prevZoom;
        const panDeltaX = newMid.x - pinchStateRef.current.mid.x;
        const panDeltaY = newMid.y - pinchStateRef.current.mid.y;

        const nextPan =
          nextZoom <= 1
            ? { x: 0, y: 0 }
            : clampPan(
                {
                  x: cx - (cx - panRef.current.x) * scaleRatio + panDeltaX,
                  y: cy - (cy - panRef.current.y) * scaleRatio + panDeltaY,
                },
                nextZoom
              );

        setZoom(nextZoom);
        setPan(nextPan);
      }

      pinchStateRef.current = { dist: newDist, mid: newMid };
      didDragRef.current = true;
      return;
    }

    if (pointersRef.current.size === 1) {
      const dx = currentPoint.x - prevPoint.x;
      const dy = currentPoint.y - prevPoint.y;
      if (pointerDownOriginRef.current) {
        const totalDist = Math.hypot(
          currentPoint.x - pointerDownOriginRef.current.x,
          currentPoint.y - pointerDownOriginRef.current.y
        );
        if (totalDist > 6) {
          didDragRef.current = true;
        }
      }
      if (zoomRef.current > 1) {
        setPan((prev) => clampPan({ x: prev.x + dx, y: prev.y + dy }, zoomRef.current));
      }
    }
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) {
      pinchStateRef.current = null;
    }
    if (pointersRef.current.size === 0) {
      pointerDownOriginRef.current = null;
      setIsInteracting(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const clearPointer = (e: PointerEvent) => {
      if (!pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.delete(e.pointerId);
      if (pointersRef.current.size < 2) {
        pinchStateRef.current = null;
      }
      if (pointersRef.current.size === 0) {
        pointerDownOriginRef.current = null;
        setIsInteracting(false);
      }
    };
    window.addEventListener('pointerup', clearPointer);
    window.addEventListener('pointercancel', clearPointer);
    return () => {
      window.removeEventListener('pointerup', clearPointer);
      window.removeEventListener('pointercancel', clearPointer);
    };
  }, [open]);

  if (!open || images.length === 0 || typeof document === 'undefined') {
    return null;
  }

  const activeImage = images[currentIndex] || images[0];
  const isZoomed = zoom > 1.01;

  return createPortal(
    <div
      ref={viewerRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => e.stopPropagation()}
      className="fixed inset-0 z-[120] flex flex-col bg-[#0E0E0D]/95 text-white select-none"
    >
      {/* Top Toolbar */}
      <div className="relative z-20 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#141413]/90 px-3 sm:px-5 py-2.5">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xs sm:text-sm font-medium text-white truncate max-w-[180px] sm:max-w-md">
            {title}
          </span>
          {images.length > 1 && (
            <span className="shrink-0 rounded bg-white/10 px-2 py-0.5 text-[11px] font-mono tabular-nums text-white/85">
              {currentIndex + 1} / {images.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <span className="hidden sm:inline-flex items-center rounded bg-white/10 px-2 py-1 text-[11px] font-mono tabular-nums text-white/90">
            {zoom.toFixed(1)}x
          </span>

          <button
            type="button"
            onClick={() => applyZoom(zoom - ZOOM_STEP)}
            disabled={zoom <= MIN_ZOOM}
            aria-label={t('detail.zoomOut')}
            title={t('detail.zoomOut')}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-white/15 bg-white/10 text-white hover:bg-white/20 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
          >
            <ZoomOut className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => applyZoom(zoom + ZOOM_STEP)}
            disabled={zoom >= MAX_ZOOM}
            aria-label={t('detail.zoomIn')}
            title={t('detail.zoomIn')}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-white/15 bg-white/10 text-white hover:bg-white/20 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
          >
            <ZoomIn className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => applyZoom(1)}
            disabled={!isZoomed}
            aria-label={t('detail.resetZoom')}
            title={t('detail.resetZoom')}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-white/15 bg-white/10 text-white hover:bg-white/20 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
          >
            <RotateCcw className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={isNativeFullscreen ? t('detail.exitFullscreen') : t('detail.fullscreen')}
            title={isNativeFullscreen ? t('detail.exitFullscreen') : t('detail.fullscreen')}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-white/15 bg-white/10 text-white hover:bg-white/20 cursor-pointer"
          >
            {isNativeFullscreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>

          <button
            type="button"
            onClick={handleClose}
            aria-label={t('detail.close')}
            title={t('detail.close')}
            className="inline-flex h-11 items-center gap-1.5 rounded-md border border-white/20 bg-white px-3 text-xs font-semibold text-[#141413] hover:bg-[#F5F3EE] cursor-pointer"
          >
            <X className="h-4 w-4" />
            <span className="hidden sm:inline">{t('detail.close')}</span>
          </button>
        </div>
      </div>

      {/* Main Zoom Stage */}
      <div
        ref={stageRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUpOrCancel}
        onPointerCancel={handlePointerUpOrCancel}
        onClick={(e) => {
          if (e.target === e.currentTarget && !didDragRef.current) {
            handleClose();
          }
        }}
        className={`relative flex-1 overflow-hidden flex items-center justify-center p-4 sm:p-8 touch-none ${
          isZoomed
            ? isInteracting
              ? 'cursor-grabbing'
              : 'cursor-grab'
            : 'cursor-zoom-in'
        }`}
      >
        <img
          ref={imgRef}
          src={activeImage.url}
          alt={activeImage.altText || title}
          referrerPolicy="no-referrer"
          draggable={false}
          onClick={(e) => {
            e.stopPropagation();
            if (didDragRef.current) return;
            applyZoom(isZoomed ? 1 : 2.4, { x: e.clientX, y: e.clientY });
          }}
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
          }}
          className={`max-h-full max-w-full object-contain select-none will-change-transform ${
            isInteracting ? '' : 'transition-transform duration-150 ease-out'
          }`}
        />

        {images.length > 1 && (
          <>
            <button
              type="button"
              aria-label={t('pagination.prev')}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                goToSlide(currentIndex - 1);
              }}
              className="absolute left-3 sm:left-5 top-1/2 -translate-y-1/2 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-[#141413]/85 text-white hover:bg-[#141413] cursor-pointer"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label={t('pagination.next')}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                goToSlide(currentIndex + 1);
              }}
              className="absolute right-3 sm:right-5 top-1/2 -translate-y-1/2 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-[#141413]/85 text-white hover:bg-[#141413] cursor-pointer"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}
      </div>

      {/* Bottom Thumbnail Strip */}
      {images.length > 1 && (
        <div className="relative z-20 flex items-center justify-center gap-2 border-t border-white/10 bg-[#141413]/90 px-4 py-2.5 overflow-x-auto">
          {images.map((img, idx) => (
            <button
              key={`zoom-thumb-${idx}`}
              type="button"
              onClick={() => goToSlide(idx)}
              aria-label={`${title} ${idx + 1}`}
              className={`h-14 w-16 shrink-0 overflow-hidden rounded border transition-opacity cursor-pointer ${
                currentIndex === idx
                  ? 'border-white ring-2 ring-white/70 opacity-100'
                  : 'border-white/20 opacity-55 hover:opacity-90'
              }`}
            >
              <img
                src={img.thumbUrl || img.url}
                alt={`Thumbnail ${idx + 1}`}
                referrerPolicy="no-referrer"
                draggable={false}
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body
  );
}
