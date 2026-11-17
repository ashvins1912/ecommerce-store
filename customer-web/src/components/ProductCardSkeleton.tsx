export function ProductCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex flex-col bg-white border border-[#E8E6E1] rounded-lg overflow-hidden"
    >
      {/* Thumbnail 4:3 Placeholder with Top-Right Action Circles */}
      <div className="relative aspect-[4/3] w-full bg-[#F2EFE9] animate-pulse">
        <div className="flex justify-end gap-1.5 p-3">
          <div className="h-9 w-9 rounded-full bg-white/75" />
          <div className="h-9 w-9 rounded-full bg-white/75" />
        </div>
        {/* Multi-image dot placeholders */}
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5">
          <div className="h-1.5 w-4 rounded-full bg-white/70" />
          <div className="h-1.5 w-1.5 rounded-full bg-white/50" />
          <div className="h-1.5 w-1.5 rounded-full bg-white/50" />
        </div>
      </div>

      {/* Card Body Structure */}
      <div className="flex flex-1 flex-col justify-between p-4">
        <div>
          {/* Metadata kicker placeholder */}
          <div className="h-3 w-32 rounded bg-[#EFECE6] animate-pulse" />

          {/* Two-line title placeholder */}
          <div className="mt-2.5 space-y-1.5">
            <div className="h-4 w-11/12 rounded bg-[#E8E5DF] animate-pulse" />
            <div className="h-4 w-2/3 rounded bg-[#E8E5DF] animate-pulse" />
          </div>

          {/* Swatches & Rating row placeholder */}
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-full bg-[#E8E5DF] animate-pulse" />
              <div className="h-3 w-3 rounded-full bg-[#E8E5DF] animate-pulse" />
              <div className="h-3 w-3 rounded-full bg-[#E8E5DF] animate-pulse" />
            </div>
            <div className="h-3 w-20 rounded bg-[#EFECE6] animate-pulse" />
          </div>
        </div>

        {/* Pricing & Action Buttons Footer */}
        <div className="mt-4 space-y-2.5 border-t border-[#F0EEE9] pt-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <div className="h-4 w-16 rounded bg-[#E8E5DF] animate-pulse" />
              <div className="h-3 w-12 rounded bg-[#EFECE6] animate-pulse" />
            </div>
            <div className="h-6 w-16 rounded bg-[#F2EFE9] animate-pulse" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="h-8 rounded-md bg-[#E8E5DF] animate-pulse" />
            <div className="h-8 rounded-md bg-[#F2EFE9] animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}
