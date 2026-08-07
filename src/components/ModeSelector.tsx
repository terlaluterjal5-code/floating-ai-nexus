import { MODES, type ChatMode } from "@/lib/models";
import { Zap, Sparkles, Telescope } from "lucide-react";
import { useState } from "react";

const icons: Record<ChatMode, typeof Zap> = {
  basic: Zap,
  standard: Sparkles,
  deep: Telescope,
};

export function ModeSelector({
  value,
  onChange,
}: {
  value: ChatMode;
  onChange: (m: ChatMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const Icon = icons[value];
  const cur = MODES[value];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-surface/70 px-2.5 py-1.5 text-[11.5px] font-medium transition-colors duration-200 active:bg-surface"
      >
        <Icon className="h-3.5 w-3.5 text-primary" strokeWidth={1.9} />
        <span className="text-foreground">{cur.short}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-64">
            <div className="rounded-2xl border border-border bg-popover p-1.5 shadow-xl shadow-black/40">
              {(Object.keys(MODES) as ChatMode[]).map((m) => {
                const I = icons[m];
                const c = MODES[m];
                const active = m === value;
                return (
                  <button
                    key={m}
                    onClick={() => {
                      onChange(m);
                      setOpen(false);
                    }}
                    className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition-colors duration-200 ${
                      active ? "bg-white/10" : "hover:bg-white/5"
                    }`}
                  >
                    <I className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] font-medium text-foreground">{c.label}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {c.cost} cr
                        </span>
                      </div>
                      <p className="text-[11px] leading-snug text-muted-foreground">{c.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}