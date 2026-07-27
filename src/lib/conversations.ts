import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ChatMode } from "./models";

export type MessageAttachment = { name: string; kind: "pdf" | "image" };

export type Conversation = {
  id: string;
  user_id: string;
  title: string;
  mode: ChatMode;
  pinned: boolean;
  created_at: string;
  updated_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  user_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  attachments: MessageAttachment[];
  created_at: string;
};

const PAGE_SIZE = 20;

function normalizeConv(row: Record<string, unknown>): Conversation {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    title: (row.title as string) || "New chat",
    mode: ((row.mode as string) || "standard") as ChatMode,
    pinned: Boolean(row.pinned),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}
function normalizeMsg(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    conversation_id: row.conversation_id as string,
    user_id: row.user_id as string,
    role: row.role as Message["role"],
    content: (row.content as string) || "",
    attachments: Array.isArray(row.attachments)
      ? (row.attachments as MessageAttachment[])
      : [],
    created_at: row.created_at as string,
  };
}

export async function createConversation(
  userId: string,
  mode: ChatMode,
  title = "New chat",
): Promise<Conversation> {
  const { data, error } = await supabase
    .from("conversations")
    .insert({ user_id: userId, mode, title })
    .select("*")
    .single();
  if (error) throw error;
  return normalizeConv(data);
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? normalizeConv(data) : null;
}

export async function updateConversation(
  id: string,
  patch: Partial<Pick<Conversation, "title" | "mode" | "pinned">>,
): Promise<void> {
  const { error } = await supabase.from("conversations").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteConversation(id: string): Promise<void> {
  const { error } = await supabase.from("conversations").delete().eq("id", id);
  if (error) throw error;
}

export async function touchConversation(id: string, title?: string): Promise<void> {
  const patch: { updated_at: string; title?: string } = {
    updated_at: new Date().toISOString(),
  };
  if (title) patch.title = title;
  const { error } = await supabase.from("conversations").update(patch).eq("id", id);
  if (error) throw error;
}

export async function listConversations(
  userId: string,
  opts: { search?: string; from?: number; limit?: number } = {},
): Promise<Conversation[]> {
  const from = opts.from ?? 0;
  const limit = opts.limit ?? PAGE_SIZE;
  const search = opts.search?.trim();

  if (search) {
    // Title match + content match via messages table
    const [titleRes, msgRes] = await Promise.all([
      supabase
        .from("conversations")
        .select("*")
        .eq("user_id", userId)
        .ilike("title", `%${search}%`)
        .order("updated_at", { ascending: false })
        .limit(100),
      supabase
        .from("messages")
        .select("conversation_id")
        .eq("user_id", userId)
        .ilike("content", `%${search}%`)
        .limit(200),
    ]);
    if (titleRes.error) throw titleRes.error;
    if (msgRes.error) throw msgRes.error;
    const ids = new Set<string>((msgRes.data ?? []).map((r) => r.conversation_id as string));
    (titleRes.data ?? []).forEach((c) => ids.add((c as { id: string }).id));
    if (ids.size === 0) return [];
    const { data, error } = await supabase
      .from("conversations")
      .select("*")
      .eq("user_id", userId)
      .in("id", Array.from(ids))
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false })
      .range(from, from + limit - 1);
    if (error) throw error;
    return (data ?? []).map(normalizeConv);
  }

  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("user_id", userId)
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false })
    .range(from, from + limit - 1);
  if (error) throw error;
  return (data ?? []).map(normalizeConv);
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(normalizeMsg);
}

export async function insertMessage(
  userId: string,
  conversationId: string,
  role: Message["role"],
  content: string,
  attachments: MessageAttachment[] = [],
): Promise<Message> {
  const { data, error } = await supabase
    .from("messages")
    .insert({
      user_id: userId,
      conversation_id: conversationId,
      role,
      content,
      attachments,
    })
    .select("*")
    .single();
  if (error) throw error;
  return normalizeMsg(data);
}

export function useConversations(
  userId: string | undefined,
  search: string,
): {
  items: Conversation[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
} {
  const [items, setItems] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!userId) {
      setItems([]);
      setHasMore(false);
      return;
    }
    let alive = true;
    setLoading(true);
    listConversations(userId, { search, from: 0, limit: PAGE_SIZE })
      .then((rows) => {
        if (!alive) return;
        setItems(rows);
        setHasMore(rows.length === PAGE_SIZE);
      })
      .catch(() => {
        if (!alive) return;
        setItems([]);
        setHasMore(false);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [userId, search, tick]);

  const loadMore = useCallback(() => {
    if (!userId || loadingMore || !hasMore) return;
    setLoadingMore(true);
    listConversations(userId, { search, from: items.length, limit: PAGE_SIZE })
      .then((rows) => {
        setItems((prev) => [...prev, ...rows]);
        setHasMore(rows.length === PAGE_SIZE);
      })
      .finally(() => setLoadingMore(false));
  }, [userId, search, items.length, loadingMore, hasMore]);

  // Realtime: refresh on any change in user's conversations
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`conversations:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations", filter: `user_id=eq.${userId}` },
        () => refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  return { items, loading, loadingMore, hasMore, loadMore, refresh };
}