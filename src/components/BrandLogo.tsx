import logoAsset from "@/assets/floating-space-logo.png.asset.json";

export function BrandLogo({ size = 32 }: { size?: number }) {
  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <div
        className="absolute inset-0 rounded-full bg-brand-gradient blur-lg opacity-60 animate-float-orb"
        aria-hidden
      />
      <img
        src={logoAsset.url}
        alt="FloatingSpace logo"
        className="relative h-full w-full object-contain drop-shadow-[0_0_10px_oklch(0.78_0.16_220/0.55)]"
        style={{ filter: "invert(1)" }}
        draggable={false}
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