import { MAX_CREDITS, useCredits, usePremium } from "@/lib/storage";
import { Infinity as InfIcon, Zap } from "lucide-react";

export function CreditsBattery({ compact = false }: { compact?: boolean }) {
  const credits = useCredits();
  const premium = usePremium();
  const pct = premium ? 100 : Math.min(100, Math.round((credits / MAX_CREDITS) * 100));
  const low = !premium && pct < 15;
  const color = premium
    ? "bg-brand-gradient"
    : low
      ? "bg-destructive"
      : pct < 40
        ? "bg-amber-400"
        : "bg-brand-gradient";

  return (
    <div className="flex items-center gap-1.5">
      <div className="glass relative flex items-center gap-1.5 rounded-full px-2.5 py-1">
        <div className="relative flex h-3.5 w-7 items-center rounded-[3px] border border-white/25 p-[1.5px]">
          <div
            className={`h-full rounded-[1.5px] ${color} transition-[width] duration-500`}
            style={{ width: `${pct}%` }}
          />
          <div className="absolute -right-[3px] top-1/2 h-1.5 w-[2px] -translate-y-1/2 rounded-r-sm bg-white/25" />
        </div>
        {premium ? (
          <div className="flex items-center gap-0.5 text-[10px] font-mono font-semibold text-gradient">
            <InfIcon className="h-3 w-3" />
          </div>
        ) : (
          <span className="text-[10px] font-mono font-semibold tabular-nums text-foreground/90">
            {credits}
            {!compact && <span className="text-muted-foreground">/{MAX_CREDITS}</span>}
          </span>
        )}
        {low && <Zap className="h-3 w-3 text-destructive animate-pulse" />}
      </div>
    </div>
  );
}