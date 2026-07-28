import type { SupabaseClient } from "@supabase/supabase-js";
import { generateGeminiText } from "./gemini.server";

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function loadUserMemories(supabase: SupabaseClient, userId: string, limit = 15): Promise<string[]> {
  const { data, error } = await supabase
    .from("memories").select("content").eq("user_id", userId)
    .order("importance", { ascending: false }).order("created_at", { ascending: false }).limit(limit);
  if (error || !data) return [];
  return data.map((r) => r.content as string);
}

export async function loadConversationSummary(supabase: SupabaseClient, conversationId: string): Promise<string | null> {
  const { data } = await supabase.from("conversation_summaries").select("summary").eq("conversation_id", conversationId).maybeSingle();
  return (data?.summary as string) || null;
}

export async function runMemoryWorker(
  supabase: SupabaseClient, apiKey: string, userId: string, conversationId: string,
): Promise<{ summarized: boolean; memoriesAdded: number }> {
  const { data: msgs, error } = await supabase
    .from("messages").select("role, content, created_at")
    .eq("conversation_id", conversationId).order("created_at", { ascending: true }).limit(40);
  if (error || !msgs || msgs.length < 2) return { summarized: false, memoriesAdded: 0 };

  const transcript = msgs.map((m) => `${(m.role as string).toUpperCase()}: ${(m.content as string).slice(0, 2000)}`).join("\n\n");
  const prompt = `You maintain a compact long-term memory for a chat assistant.

Given the transcript below, output STRICT JSON with two fields:
- "summary": one paragraph (<= 500 chars) describing the conversation so far.
- "memories": array of 0 to 5 short factual statements about the USER worth remembering across future chats (preferences, goals, personal facts, ongoing projects). Each item <= 160 chars. If nothing new, return an empty array.

Return ONLY the JSON object, no code fences, no commentary.

TRANSCRIPT:
${transcript}`;

  let parsed: { summary?: string; memories?: string[] } = {};
  try {
    const { text } = await generateGeminiText({ model: "gemini-2.5-flash", prompt, apiKey, maxOutputTokens: 1024 });
    const s = text.indexOf("{"); const e = text.lastIndexOf("}");
    if (s >= 0 && e > s) parsed = JSON.parse(text.slice(s, e + 1));
  } catch (e) {
    console.error("[memory-worker] extraction failed", (e as Error).message);
    return { summarized: false, memoriesAdded: 0 };
  }

  const summary = (parsed.summary ?? "").trim();
  const memories = Array.isArray(parsed.memories) ? parsed.memories.filter((s) => typeof s === "string") : [];

  if (summary) {
    await supabase.from("conversation_summaries").upsert(
      { conversation_id: conversationId, user_id: userId, summary, message_count: msgs.length, updated_at: new Date().toISOString() },
      { onConflict: "conversation_id" },
    );
  }
  let added = 0;
  for (const raw of memories) {
    const content = raw.trim();
    if (!content || content.length > 400) continue;
    const content_hash = await sha256Hex(content);
    const { error: insErr } = await supabase.from("memories").insert({
      user_id: userId, conversation_id: conversationId, content, content_hash, importance: 1,
    });
    if (!insErr) added++;
  }
  return { summarized: Boolean(summary), memoriesAdded: added };
}