export function BrandLogo({ size = 32 }: { size?: number }) {
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <div
        className="absolute inset-0 rounded-full bg-brand-gradient blur-md opacity-70 animate-float-orb"
        aria-hidden
      />
      <div
        className="relative rounded-full bg-brand-gradient shadow-[0_0_20px_oklch(0.78_0.16_220/0.6)]"
        style={{ width: size * 0.7, height: size * 0.7 }}
      />
      <div
        className="absolute inset-0 rounded-full border border-white/20"
        aria-hidden
      />
    </div>
  );
}

export function BrandMark({ tagline = false }: { tagline?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandLogo size={30} />
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight text-gradient">
          FloatingSpace
        </div>
        {tagline && (
          <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
            by ZNTech
          </div>
        )}
      </div>
    </div>
  );
}