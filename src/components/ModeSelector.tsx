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
        className="glass flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition active:scale-95"
      >
        <Icon className="h-3.5 w-3.5 text-primary" />
        <span className="text-gradient">{cur.short}</span>
        <span className="text-muted-foreground">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-64 animate-scale-in">
            <div className="glass rounded-2xl p-2 shadow-2xl shadow-black/50">
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
                    className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${
                      active ? "bg-white/10" : "hover:bg-white/5"
                    }`}
                  >
                    <div className="mt-0.5 rounded-lg bg-brand-gradient/20 p-1.5">
                      <I className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] font-semibold text-foreground">{c.label}</span>
                        <span className="font-mono text-[9px] text-muted-foreground">
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