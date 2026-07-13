import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { getThreads, newThread, upsertThread } from "@/lib/storage";
import { useHydrated } from "@/lib/storage";

export const Route = createFileRoute("/chat/")({
  component: ChatIndex,
});

function ChatIndex() {
  const hydrated = useHydrated();
  const targetId = useMemo(() => {
    if (!hydrated) return null;
    const existing = getThreads()[0];
    if (existing) return existing.id;
    const t = newThread("standard");
    upsertThread(t);
    return t.id;
  }, [hydrated]);
  if (!targetId) return null;
  return <Navigate to="/chat/$threadId" params={{ threadId: targetId }} />;
}