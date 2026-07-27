import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/auth";
import { createConversation, listConversations } from "@/lib/conversations";
import { useHydrated } from "@/lib/storage";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/chat/")({
  component: ChatIndex,
});

function ChatIndex() {
  const hydrated = useHydrated();
  const { user, loading } = useSession();
  const [targetId, setTargetId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated || loading || !user) return;
    let alive = true;
    (async () => {
      try {
        const existing = await listConversations(user.id, { from: 0, limit: 1 });
        if (!alive) return;
        if (existing[0]) {
          setTargetId(existing[0].id);
          return;
        }
        const conv = await createConversation(user.id, "standard");
        if (!alive) return;
        setTargetId(conv.id);
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [user, hydrated, loading]);

  if (hydrated && !loading && !user) return <Navigate to="/auth" />;
  if (targetId) return <Navigate to="/chat/$threadId" params={{ threadId: targetId }} />;
  return (
    <div className="flex min-h-[50vh] items-center justify-center gap-2 text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-[12px]">{err ?? "Loading…"}</span>
    </div>
  );
}