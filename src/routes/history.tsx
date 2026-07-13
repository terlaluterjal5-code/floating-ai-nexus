import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  deleteThread,
  newThread,
  togglePin,
  upsertThread,
  useHydrated,
  useThreads,
} from "@/lib/storage";
import { MODES } from "@/lib/models";
import { Plus, Search, Trash2, Pin, MessagesSquare } from "lucide-react";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [{ title: "Chat History — FloatingSpace" }],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  const hydrated = useHydrated();
  const threads = useThreads();
  const [q, setQ] = useState("");
  const nav = useNavigate();

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return threads;
    return threads.filter(
      (t) =>
        t.title.toLowerCase().includes(s) ||
        t.messages.some((m) => m.content.toLowerCase().includes(s)),
    );
  }, [threads, q]);

  function create() {
    const t = newThread("standard");
    upsertThread(t);
    nav({ to: "/chat/$threadId", params: { threadId: t.id } });
  }

  return (
    <AppShell>
      <div className="mt-2 flex items-center justify-between px-1">
        <h1 className="text-lg font-semibold tracking-tight text-gradient">Chat History</h1>
        <button
          onClick={create}
          className="flex items-center gap-1 rounded-full bg-brand-gradient px-3 py-1.5 text-[11px] font-semibold text-brand-foreground shadow-lg shadow-primary/30 active:scale-95"
        >
          <Plus className="h-3.5 w-3.5" /> New chat
        </button>
      </div>

      <div className="glass mt-3 flex items-center gap-2 rounded-full px-3 py-2">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search conversations…"
          className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div className="mt-3 flex flex-col gap-1.5">
        {hydrated && filtered.length === 0 && (
          <div className="glass mt-4 rounded-2xl p-6 text-center">
            <MessagesSquare className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
            <p className="text-[12px] text-muted-foreground">
              {threads.length === 0 ? "No conversations yet." : "No matches."}
            </p>
          </div>
        )}
        {filtered.map((t) => (
          <div key={t.id} className="glass flex items-center gap-2 rounded-2xl p-2">
            <Link
              to="/chat/$threadId"
              params={{ threadId: t.id }}
              className="flex-1 rounded-xl px-2 py-1.5 transition active:bg-white/5"
            >
              <div className="flex items-center gap-1.5">
                {t.pinned && <Pin className="h-3 w-3 text-primary" />}
                <div className="truncate text-[13px] font-semibold text-foreground/95">
                  {t.title || "Untitled"}
                </div>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                <span>{MODES[t.mode].label}</span>
                <span>·</span>
                <span>{t.messages.length} msg</span>
                <span>·</span>
                <span>{new Date(t.updatedAt).toLocaleDateString()}</span>
              </div>
            </Link>
            <button
              onClick={() => togglePin(t.id)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:text-primary"
              aria-label="Pin"
            >
              <Pin className={`h-3.5 w-3.5 ${t.pinned ? "fill-current text-primary" : ""}`} />
            </button>
            <button
              onClick={() => {
                if (confirm("Delete this conversation?")) deleteThread(t.id);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:text-destructive"
              aria-label="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </AppShell>
  );
}