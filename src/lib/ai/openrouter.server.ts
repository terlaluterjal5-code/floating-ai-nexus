// Server-only OpenRouter client. Reads OPENROUTER_API_KEY from process.env.
// Never import from client code.

export type ClientAttachment = { name: string; mime: string; dataUrl: string };
export type ClientMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: ClientAttachment[];
};

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

type ORMessage = { role: "system" | "user" | "assistant"; content: string | ContentPart[] };

export type AiStreamError = {
  status: number;
  code:
    | "invalid_api_key"
    | "rate_limited"
    | "quota_exceeded"
    | "timeout"
    | "network"
    | "upstream"
    | "aborted";
  message: string;
};

export type AiStreamResult = {
  fullText: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
};

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function classifyStatus(status: number): AiStreamError["code"] {
  if (status === 401 || status === 403) return "invalid_api_key";
  if (status === 429) return "rate_limited";
  if (status === 402) return "quota_exceeded";
  return "upstream";
}

function parseRetryAfter(h: string | null): number | null {
  if (!h) return null;
  const s = Number(h);
  if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const d = Date.parse(h);
  if (!Number.isNaN(d)) return Math.max(0, d - Date.now());
  return null;
}

function rid() {
  return Math.random().toString(36).slice(2, 10);
}

export function orHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://floatingspace.biz.id",
    "X-Title": "FloatingSpace",
  };
}

/** Convert app messages (with data-URL attachments) to OpenRouter content parts. */
export function toOpenRouterMessages(messages: ClientMessage[]): ORMessage[] {
  return messages.map((m) => {
    const atts = m.attachments ?? [];
    if (atts.length === 0) return { role: m.role, content: m.content };
    const parts: ContentPart[] = [];
    if (m.content) parts.push({ type: "text", text: m.content });
    for (const a of atts) {
      if (a.mime.startsWith("image/")) {
        parts.push({ type: "image_url", image_url: { url: a.dataUrl } });
      } else {
        parts.push({ type: "file", file: { filename: a.name, file_data: a.dataUrl } });
      }
    }
    if (parts.length === 0) parts.push({ type: "text", text: "" });
    return { role: m.role, content: parts };
  });
}

/**
 * Stream a chat completion from OpenRouter as OpenAI-compatible SSE deltas
 * so the existing client parser works unchanged.
 */
export async function streamChatCompletion(opts: {
  model: string;
  system: string;
  messages: ClientMessage[];
  apiKey: string;
  writeDelta: (text: string) => void;
  clientSignal?: AbortSignal;
}): Promise<AiStreamResult> {
  const start = Date.now();
  const reqId = rid();
  const msgs: ORMessage[] = [];
  if (opts.system) msgs.push({ role: "system", content: opts.system });
  msgs.push(...toOpenRouterMessages(opts.messages));

  const body = {
    model: opts.model,
    messages: msgs,
    stream: true,
    temperature: 0.85,
    top_p: 0.95,
    max_tokens: 8192,
    usage: { include: true },
  };

  let attempt = 0;
  let lastErr: AiStreamError | null = null;
  while (attempt < MAX_RETRIES) {
    attempt++;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const onClientAbort = () => controller.abort();
    opts.clientSignal?.addEventListener("abort", onClientAbort);
    try {
      const attemptStart = Date.now();
      const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: orHeaders(opts.apiKey),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        lastErr = {
          status: res.status,
          code: classifyStatus(res.status),
          message: text || res.statusText,
        };
        const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
        console.error(
          `[openrouter] rid=${reqId} model=${opts.model} attempt=${attempt}/${MAX_RETRIES} status=${res.status} latencyMs=${Date.now() - attemptStart} retryAfter=${retryAfterMs ?? "n/a"} body=${(text || "").slice(0, 500)}`,
        );
        clearTimeout(timeout);
        opts.clientSignal?.removeEventListener("abort", onClientAbort);
        if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
          const backoff = retryAfterMs ?? Math.min(8000, 400 * 2 ** (attempt - 1));
          await sleep(backoff + Math.random() * 250);
          continue;
        }
        throw lastErr;
      }
      console.log(`[openrouter] rid=${reqId} model=${opts.model} attempt=${attempt} status=200 streaming`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";
      let promptTokens = 0;
      let completionTokens = 0;
      let totalTokens = 0;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const json = JSON.parse(payload) as {
              choices?: { delta?: { content?: string | null } }[];
              usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
                total_tokens?: number;
              };
            };
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) {
              full += delta;
              opts.writeDelta(delta);
            }
            if (json.usage) {
              promptTokens = json.usage.prompt_tokens ?? promptTokens;
              completionTokens = json.usage.completion_tokens ?? completionTokens;
              totalTokens = json.usage.total_tokens ?? totalTokens;
            }
          } catch {
            /* ignore partial line */
          }
        }
      }

      clearTimeout(timeout);
      opts.clientSignal?.removeEventListener("abort", onClientAbort);
      return {
        fullText: full,
        promptTokens,
        completionTokens,
        totalTokens: totalTokens || promptTokens + completionTokens,
        latencyMs: Date.now() - start,
      };
    } catch (e) {
      clearTimeout(timeout);
      opts.clientSignal?.removeEventListener("abort", onClientAbort);
      if (opts.clientSignal?.aborted) {
        throw { status: 0, code: "aborted", message: "Client aborted" } satisfies AiStreamError;
      }
      const err = e as { name?: string; message?: string };
      if (err?.name === "AbortError") {
        lastErr = { status: 0, code: "timeout", message: "Upstream timeout" };
      } else if (!lastErr) {
        lastErr = { status: 0, code: "network", message: err?.message || "Network error" };
      }
      console.error(
        `[openrouter] rid=${reqId} model=${opts.model} attempt=${attempt}/${MAX_RETRIES} caught code=${lastErr?.code} message=${lastErr?.message}`,
      );
      if (attempt >= MAX_RETRIES) break;
      await sleep(Math.min(8000, 400 * 2 ** (attempt - 1)) + Math.random() * 200);
    }
  }
  throw (lastErr ?? { status: 0, code: "network", message: "Unknown error" }) satisfies AiStreamError;
}

/** One-shot (non-streaming) completion. Used by the memory worker. */
export async function generateText(opts: {
  model: string;
  system?: string;
  prompt: string;
  apiKey: string;
  maxOutputTokens?: number;
}): Promise<{ text: string; promptTokens: number; completionTokens: number; latencyMs: number }> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: orHeaders(opts.apiKey),
      signal: controller.signal,
      body: JSON.stringify({
        model: opts.model,
        messages: [
          ...(opts.system ? [{ role: "system", content: opts.system }] : []),
          { role: "user", content: opts.prompt },
        ],
        temperature: 0.3,
        max_tokens: opts.maxOutputTokens ?? 1024,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`OpenRouter ${res.status}: ${t || res.statusText}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: data.choices?.[0]?.message?.content ?? "",
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - start,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Approximate pricing (USD per 1M tokens) for logging only. */
export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const rates: Record<string, { input: number; output: number }> = {
    "google/gemini-3.7-flash": { input: 0.3, output: 2.5 },
    "google/gemini-2.5-flash-image-preview": { input: 0.3, output: 2.5 },
  };
  const r = rates[model] ?? { input: 0.5, output: 1.5 };
  return (promptTokens * r.input + completionTokens * r.output) / 1_000_000;
}
