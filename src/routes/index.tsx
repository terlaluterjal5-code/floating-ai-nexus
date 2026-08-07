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
      <section className="mt-1">
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-foreground">
          Your futuristic AI workspace
        </h1>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          Reasoning · Deep research · Images · PDF analysis
        </p>
        <button
          onClick={() => startChat("", "standard")}
          className="mt-4 flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-surface/70 px-4 py-3.5 text-left transition duration-200 active:bg-surface"
        >
          <span className="text-[13.5px] text-muted-foreground">Ask FloatingSpace anything…</span>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <ArrowRight className="h-4 w-4" />
          </span>
        </button>
      </section>

      {/* Quick actions */}
      <section className="mt-3 grid grid-cols-4 gap-2">
        {[
          { to: "/chat", label: "Chat", icon: Bot },
          { to: "/image", label: "Image", icon: Sparkles },
          { to: "/pdf", label: "PDF", icon: FileText },
          { to: "/premium", label: "Premium", icon: Crown },
        ].map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface/60 px-2 py-3.5 transition duration-200 active:bg-surface"
          >
            <Icon className="h-[18px] w-[18px] text-primary" strokeWidth={1.8} />
            <span className="text-[11px] font-medium text-foreground/90">{label}</span>
          </Link>
        ))}
      </section>

      {/* Deep research callout */}
      <button
        onClick={() => startChat("", "deep")}
        className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-primary/25 bg-primary/10 p-4 text-left transition duration-200 active:bg-primary/15"
      >
        <Telescope className="h-5 w-5 shrink-0 text-primary" strokeWidth={1.8} />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium text-foreground">Deep Research</div>
          <div className="truncate text-[11.5px] text-muted-foreground">
            Structured, comprehensive reports
          </div>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {/* Topics */}
      {TOPICS.map(({ section, icon: SecIcon, items }) => (
        <section key={section} className="mt-7">
          <div className="mb-2.5 flex items-center gap-2">
            <SecIcon className="h-[15px] w-[15px] text-muted-foreground" strokeWidth={1.8} />
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {section}
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {items.map((it) => (
              <button
                key={it.label}
                onClick={() => startChat(it.prompt)}
                className="flex min-h-[72px] flex-col items-start gap-2 rounded-2xl border border-border bg-surface/50 p-3 text-left transition duration-200 active:bg-surface"
              >
                <it.icon className="h-4 w-4 text-primary" strokeWidth={1.8} />
                <div className="text-[12.5px] font-medium leading-snug text-foreground/90">
                  {it.label}
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}

      <footer className="mt-9 pb-2 text-center text-[10.5px] tracking-wide text-muted-foreground">
        FloatingSpace · by ZNTech
      </footer>
    </AppShell>
  );
}
