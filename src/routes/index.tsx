import { createFileRoute } from "@tanstack/react-router";
import { Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { BrandLogo } from "@/components/BrandLogo";
import {
  Cpu,
  Globe2,
  LineChart,
  Rocket,
  Bot,
  Atom,
  Landmark,
  Coins,
  TrendingUp,
  ArrowRight,
  Sparkles,
  FileText,
  Telescope,
  Crown,
} from "lucide-react";
import { createConversation } from "@/lib/conversations";
import { useSession } from "@/lib/auth";
import type { ChatMode } from "@/lib/models";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  component: Index,
});

const TOPICS = [
  {
    section: "Technology",
    icon: Cpu,
    items: [
      { icon: Bot, label: "Latest AI developments", prompt: "Give me a deep briefing on the latest breakthroughs in AI in the past 6 months." },
      { icon: Rocket, label: "Future technology", prompt: "What are the most impactful emerging technologies of the next decade?" },
      { icon: Bot, label: "Robotics", prompt: "Explain the current state of humanoid robotics and where it's heading." },
      { icon: Rocket, label: "Space exploration", prompt: "Summarize the most exciting current space exploration missions and what they aim to discover." },
      { icon: Atom, label: "Quantum computing", prompt: "Explain quantum computing progress and its real-world implications." },
    ],
  },
  {
    section: "Geopolitics",
    icon: Globe2,
    items: [
      { icon: Globe2, label: "Global conflicts", prompt: "Give me a neutral, well-sourced overview of the most significant ongoing global conflicts." },
      { icon: Landmark, label: "International relations", prompt: "Analyze the current state of international relations between major powers." },
      { icon: Coins, label: "World economy", prompt: "What are the key trends shaping the world economy right now?" },
      { icon: TrendingUp, label: "Global power changes", prompt: "How is the global balance of power shifting and why?" },
    ],
  },
  {
    section: "Finance",
    icon: LineChart,
    items: [
      { icon: LineChart, label: "Stock market", prompt: "Give me an analytical overview of the current stock market environment." },
      { icon: Coins, label: "Cryptocurrency", prompt: "Analyze the current state of the crypto market with key trends and risks." },
      { icon: TrendingUp, label: "Investment insights", prompt: "Share thoughtful, diversified investment insights for the current environment." },
      { icon: LineChart, label: "Economic trends", prompt: "What are the major macroeconomic trends I should be aware of?" },
    ],
  },
];

function Index() {
  const navigate = useNavigate();
  const { user } = useSession();

  async function startChat(prompt: string, mode: ChatMode = "standard") {
    if (!user) {
      navigate({ to: "/auth" });
      return;
    }
    try {
      const conv = await createConversation(user.id, mode, prompt ? prompt.slice(0, 60) : "New chat");
      navigate({
        to: "/chat/$threadId",
        params: { threadId: conv.id },
        search: { q: prompt || undefined },
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <AppShell>
      {/* Hero */}
      <section className="relative mt-2 overflow-hidden rounded-3xl glass p-5">
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-brand-gradient opacity-40 blur-3xl animate-float-orb"
          aria-hidden
        />
        <div className="relative flex items-start gap-3">
          <BrandLogo size={44} />
          <div className="flex-1">
            <h1 className="text-[22px] font-semibold leading-tight tracking-tight">
              <span className="text-gradient">FloatingSpace</span>
              <span className="text-foreground/90"> AI</span>
            </h1>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Next-generation research assistant · GPT-class reasoning · Deep research
            </p>
          </div>
        </div>
        <button
          onClick={() => startChat("", "standard")}
          className="mt-4 flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left transition active:scale-[0.99]"
        >
          <div>
            <div className="text-[13px] font-medium text-foreground/90">Ask FloatingSpace anything…</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              Reasoning · Research · Analysis
            </div>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-gradient text-brand-foreground shadow-lg shadow-primary/30 animate-pulse-ring">
            <ArrowRight className="h-4 w-4" />
          </div>
        </button>
      </section>

      {/* Quick actions */}
      <section className="mt-4 grid grid-cols-4 gap-2">
        {[
          { to: "/chat", label: "Chat", icon: Bot },
          { to: "/image", label: "Image", icon: Sparkles },
          { to: "/pdf", label: "PDF", icon: FileText },
          { to: "/premium", label: "Premium", icon: Crown },
        ].map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="glass flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3 transition active:scale-95"
          >
            <div className="rounded-xl bg-brand-gradient/20 p-2">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <span className="text-[11px] font-medium">{label}</span>
          </Link>
        ))}
      </section>

      {/* Deep research callout */}
      <button
        onClick={() => startChat("", "deep")}
        className="relative mt-4 flex w-full items-center gap-3 overflow-hidden rounded-2xl bg-brand-gradient p-4 text-left shadow-xl shadow-primary/30 active:scale-[0.99]"
      >
        <div className="rounded-xl bg-black/25 p-2">
          <Telescope className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 text-white">
          <div className="text-[13px] font-semibold">Deep Research Mode</div>
          <div className="text-[11px] opacity-90">Structured, comprehensive reports</div>
        </div>
        <ArrowRight className="h-4 w-4 text-white/90" />
      </button>

      {/* Topics */}
      {TOPICS.map(({ section, icon: SecIcon, items }) => (
        <section key={section} className="mt-6">
          <div className="mb-2 flex items-center gap-2 px-1">
            <SecIcon className="h-4 w-4 text-primary" />
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {section}
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {items.map((it) => (
              <button
                key={it.label}
                onClick={() => startChat(it.prompt)}
                className="glass group flex flex-col items-start gap-2 rounded-2xl p-3 text-left transition active:scale-[0.97]"
              >
                <div className="rounded-lg bg-brand-gradient/20 p-1.5">
                  <it.icon className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="text-[12.5px] font-medium leading-snug text-foreground/90">
                  {it.label}
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}

      <footer className="mt-8 pb-2 text-center text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
        FloatingSpace · Built by ZNTech
      </footer>
    </AppShell>
  );
}
