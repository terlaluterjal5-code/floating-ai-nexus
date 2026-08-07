import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useSession } from "@/lib/auth";
import { useHydrated } from "@/lib/storage";
import {
  createConversation,
  deleteConversation,
  updateConversation,
  useConversations,
} from "@/lib/conversations";
import { MODES } from "@/lib/models";
import { Plus, Search, Trash2, Pin, Pencil, MessagesSquare, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [{ title: "Chat History — FloatingSpace" }],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  const hydrated = useHydrated();
  const { user, loading } = useSession();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const nav = useNavigate();
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const {
    items,
    loading: listLoading,
    loadingMore,
    hasMore,
    loadMore,
    refresh,
  } = useConversations(user?.id, debouncedQ);

  useEffect(() => {
    if (!sentinelRef.current) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "200px" },
    );
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [loadMore]);

  if (hydrated && !loading && !user) return <Navigate to="/auth" />;

  async function create() {
    if (!user) return;
    try {
      const conv = await createConversation(user.id, "standard");
      nav({ to: "/chat/$threadId", params: { threadId: conv.id } });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function rename(id: string, current: string) {
    const next = prompt("Rename conversation", current);
    if (!next || next === current) return;
    try {
      await updateConversation(id, { title: next });
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function togglePin(id: string, pinned: boolean) {
    try {
      await updateConversation(id, { pinned: !pinned });
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this conversation?")) return;
    try {
      await deleteConversation(id);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <AppShell>
      <div className="mt-2 flex items-center justify-between px-1">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">Chat History</h1>
        <button
          onClick={create}
          className="flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground active:scale-95"
        >
          <Plus className="h-3.5 w-3.5" /> New chat
        </button>
      </div>

      <div className="border border-border bg-surface/60 mt-3 flex items-center gap-2 rounded-full px-3 py-2">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search conversations…"
          className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div className="mt-3 flex flex-col gap-1.5">
        {listLoading && items.length === 0 && (
          <div className="border border-border bg-surface/60 mt-4 flex items-center justify-center gap-2 rounded-2xl p-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-[12px]">Loading…</span>
          </div>
        )}
        {!listLoading && items.length === 0 && (
          <div className="border border-border bg-surface/60 mt-4 rounded-2xl p-6 text-center">
            <MessagesSquare className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
            <p className="text-[12px] text-muted-foreground">
              {debouncedQ ? "No matches." : "No conversations yet."}
            </p>
          </div>
        )}
        {items.map((t) => (
          <div
            key={t.id}
            className="border border-border bg-surface/60 flex items-center gap-1 rounded-2xl p-2"
          >
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
              <div className="mt-0.5 flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <span>{MODES[t.mode].label}</span>
                <span>·</span>
                <span>{new Date(t.updated_at).toLocaleString()}</span>
              </div>
            </Link>
            <button
              onClick={() => togglePin(t.id, t.pinned)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:text-primary active:scale-95"
              aria-label="Pin"
            >
              <Pin className={`h-3.5 w-3.5 ${t.pinned ? "text-primary" : ""}`} />
            </button>
            <button
              onClick={() => rename(t.id, t.title)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:text-foreground active:scale-95"
              aria-label="Rename"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => remove(t.id)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-red-400 active:scale-95"
              aria-label="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <div ref={sentinelRef} className="h-8" />
        {loadingMore && (
          <div className="flex items-center justify-center gap-2 py-2 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="text-[11px]">Loading more…</span>
          </div>
        )}
        {!hasMore && items.length > 0 && (
          <div className="py-2 text-center text-[10px] text-muted-foreground">End of history</div>
        )}
      </div>
    </AppShell>
  );
}
