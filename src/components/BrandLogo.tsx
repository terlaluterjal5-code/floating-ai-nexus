/**
 * FloatingSpace mark — a minimal orbital glyph: a solid core with a tilted
 * orbit ring and a single satellite node. Pure vector, legible from 16px up.
 */
export function BrandLogo({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="FloatingSpace"
      className={className}
    >
      <circle cx="16" cy="16" r="14.5" className="fill-primary/10" />
      <ellipse
        cx="16"
        cy="16"
        rx="12"
        ry="5.2"
        transform="rotate(-28 16 16)"
        className="stroke-primary"
        strokeWidth="1.7"
      />
      <circle cx="16" cy="16" r="4.4" className="fill-primary" />
      <circle cx="26.1" cy="10.2" r="2.5" className="fill-foreground" />
    </svg>
  );
}

export function BrandMark({ tagline = false }: { tagline?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <BrandLogo size={26} />
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
          Floating<span className="text-primary">Space</span>
        </div>
        {tagline && (
          <div className="text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground">
            by ZNTech
          </div>
        )}
      </div>
    </div>
  );
}
