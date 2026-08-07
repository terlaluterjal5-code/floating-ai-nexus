import { MAX_CREDITS, useCredits, usePremium } from "@/lib/storage";
import { Infinity as InfIcon, Zap } from "lucide-react";

export function CreditsBattery({ compact = false }: { compact?: boolean }) {
  const credits = useCredits();
  const premium = usePremium();
  const pct = premium ? 100 : Math.min(100, Math.round((credits / MAX_CREDITS) * 100));
  const low = !premium && pct < 15;
  const color = premium
    ? "bg-primary"
    : low
      ? "bg-destructive"
      : pct < 40
        ? "bg-amber-400"
        : "bg-primary";

  return (
    <div className="flex items-center gap-1.5">
      <div className="relative flex items-center gap-1.5 rounded-full border border-border bg-surface/70 px-2.5 py-1">
        <div className="relative flex h-3.5 w-7 items-center rounded-[3px] border border-border p-[1.5px]">
          <div
            className={`h-full rounded-[1.5px] ${color} transition-[width] duration-300`}
            style={{ width: `${pct}%` }}
          />
          <div className="absolute -right-[3px] top-1/2 h-1.5 w-[2px] -translate-y-1/2 rounded-r-sm bg-border" />
        </div>
        {premium ? (
          <div className="flex items-center gap-0.5 text-[10px] font-semibold text-primary">
            <InfIcon className="h-3 w-3" />
          </div>
        ) : (
          <span className="text-[10.5px] font-medium tabular-nums text-foreground/90">
            {credits}
            {!compact && <span className="text-muted-foreground">/{MAX_CREDITS}</span>}
          </span>
        )}
        {low && <Zap className="h-3 w-3 text-destructive" />}
      </div>
    </div>
  );
}
