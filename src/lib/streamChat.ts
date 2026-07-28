import type { ChatMode } from "./models";
import { supabase } from "@/integrations/supabase/client";

export type SendMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: { name: string; mime: string; dataUrl: string }[];
};

export async function streamChat(
  messages: SendMessage[],
  mode: ChatMode,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
  conversationId?: string,
): Promise<string> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("You must be signed in.");
  const res = await fetch("/api/ai-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages, mode, conversationId }),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    try {
      const j = JSON.parse(text) as { error?: { message?: string } };
      throw new Error(j.error?.message || text || `Request failed (${res.status})`);
    } catch {
      throw new Error(text || `Request failed (${res.status})`);
    }
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload) as {
          choices?: { delta?: { content?: string } }[];
        };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onDelta(delta);
        }
      } catch {
        // ignore partial
      }
    }
  }
  return full;
}