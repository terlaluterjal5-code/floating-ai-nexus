import type { ChatMode } from "./models";
import { authedFetch, NotAuthenticatedError } from "@/lib/authedFetch";

export type SendMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: { name: string; mime: string; dataUrl: string }[];
};

export type ChatRequestType =
  | "chat"
  | "deep_research"
  | "data_analysis"
  | "pdf_analysis"
  | "research_assistant"
  | "futuristic_tools";

export type StreamChatResult = {
  text: string;
  /** Set when the server persisted the assistant message. */
  messageId?: string;
  createdAt?: string;
};

export class ChatApiError extends Error {
  code: string;
  feature?: string;
  requestId?: string;
  retryable?: boolean;
  constructor(msg: string, opts: { code: string; feature?: string; requestId?: string; retryable?: boolean }) {
    super(msg);
    this.name = "ChatApiError";
    this.code = opts.code;
    this.feature = opts.feature;
    this.requestId = opts.requestId;
    this.retryable = opts.retryable;
  }
}

export async function streamChat(
  messages: SendMessage[],
  mode: ChatMode,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
  conversationId?: string,
  requestType: ChatRequestType = "chat",
): Promise<StreamChatResult> {
  let res: Response;
  try {
    // Sends a freshly validated access token from the one shared Supabase
    // client, and retries exactly once after a genuine 401.
    res = await authedFetch("/api/ai-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, mode, conversationId, requestType }),
      signal,
    });
  } catch (e) {
    if (e instanceof NotAuthenticatedError) {
      throw new ChatApiError("You must be signed in.", { code: "UNAUTHORIZED" });
    }
    throw e;
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    try {
      const j = JSON.parse(text) as {
        error?: { code?: string; message?: string; feature?: string; request_id?: string; retryable?: boolean };
      };
      throw new ChatApiError(j.error?.message || `Request failed (${res.status})`, {
        code: j.error?.code ?? "REQUEST_FAILED",
        feature: j.error?.feature,
        requestId: j.error?.request_id,
        retryable: j.error?.retryable,
      });
    } catch (e) {
      if (e instanceof ChatApiError) throw e;
      throw new ChatApiError(text || `Request failed (${res.status})`, { code: "REQUEST_FAILED" });
    }
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let messageId: string | undefined;
  let createdAt: string | undefined;

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
          meta?: { messageId?: string; createdAt?: string };
        };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onDelta(delta);
        }
        if (json.meta?.messageId) {
          messageId = json.meta.messageId;
          createdAt = json.meta.createdAt;
        }
      } catch {
        // ignore partial
      }
    }
  }
  return { text: full, messageId, createdAt };
}
