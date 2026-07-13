import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { isPremium, setPremium, usePremium } from "@/lib/storage";
import { Crown, Check, Sparkles, Zap, Rocket, Telescope, FileText, Infinity as InfIcon } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/premium")({
  head: () => ({
    meta: [
      { title: "FloatingSpace Premium" },
      { name: "description", content: "Unlock unlimited deep research, advanced image generation, priority AI, and more." },
    ],
  }),
  component: PremiumPage,
});

const FEATURES = [
  { icon: Telescope, text: "Unlimited Deep Research mode" },
  { icon: Sparkles, text: "Higher AI intelligence level" },
  { icon: Zap, text: "Faster response speed" },
  { icon: Sparkles, text: "Advanced AI image generation" },
  { icon: FileText, text: "Larger PDF analysis capability" },
  { icon: Rocket, text: "Priority AI processing" },
  { icon: Sparkles, text: "Exclusive futuristic AI tools" },
  { icon: Telescope, text: "Professional research assistant" },
  { icon: InfIcon, text: "Unlimited chat credits" },
  { icon: Sparkles, text: "Advanced data analysis" },
];

function PremiumPage() {
  const premium = usePremium();

  function toggle() {
    if (premium) {
      setPremium(false);
      toast.success("Premium disabled (demo)");
    } else {
      setPremium(true);
      toast.success("Welcome to FloatingSpace Premium!");
    }
  }

  return (
    <AppShell>
      <section className="relative mt-2 overflow-hidden rounded-3xl bg-brand-gradient p-5 text-white shadow-2xl shadow-primary/40">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/20 blur-3xl animate-float-orb" />
        <div className="relative flex items-center gap-2.5">
          <div className="rounded-2xl bg-black/25 p-2.5">
            <Crown className="h-6 w-6" />
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] opacity-90">
              FloatingSpace
            </div>
            <div className="text-xl font-bold tracking-tight">Premium</div>
          </div>
        </div>
        <div className="relative mt-4 flex items-baseline gap-1.5">
          <span className="text-3xl font-bold tracking-tight">200K</span>
          <span className="text-sm font-mono opacity-90">IDR / month</span>
        </div>
        <p className="relative mt-1 text-[12px] opacity-90">
          Cancel anytime · Priority AI · Unlimited research
        </p>
      </section>

      <section className="mt-4 glass rounded-3xl p-4">
        <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          What's included
        </h2>
        <ul className="grid grid-cols-1 gap-2">
          {FEATURES.map((f) => (
            <li key={f.text} className="flex items-center gap-2.5">
              <div className="rounded-lg bg-brand-gradient/20 p-1.5">
                <f.icon className="h-3.5 w-3.5 text-primary" />
              </div>
              <span className="flex-1 text-[13px]">{f.text}</span>
              <Check className="h-4 w-4 text-primary" />
            </li>
          ))}
        </ul>
      </section>

      <button
        onClick={toggle}
        className={`mt-4 w-full rounded-2xl py-3.5 text-[14px] font-semibold shadow-2xl transition active:scale-[0.98] ${
          premium
            ? "glass text-foreground"
            : "bg-brand-gradient text-brand-foreground shadow-primary/40 animate-pulse-ring"
        }`}
      >
        {premium ? "Manage Premium (demo — tap to disable)" : "Upgrade to Premium — 200K IDR / mo"}
      </button>

      <p className="mt-3 text-center text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
        Payment integration is a demo in this preview
      </p>
    </AppShell>
  );
}

// silence unused import if the check-only import is not visible
void isPremium;