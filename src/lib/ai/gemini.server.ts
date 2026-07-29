// Server-only Gemini client. Reads GEMINI_API_KEY from process.env.
// Never import from client code.

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export type GeminiMessage = {
  role: "user" | "model";
  parts: GeminiPart[];
};

export type ClientAttachment = { name: string; mime: string; dataUrl: string };
export type ClientMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: ClientAttachment[];
};

function dataUrlToInline(dataUrl: string, fallbackMime: string): { mimeType: string; data: string } | null {
  const m = /^data:([^;,]+)(?:;base64)?,(.*)$/i.exec(dataUrl);
  if (!m) return null;
  const mimeType = m[1] || fallbackMime;
  const raw = m[2] || "";
  // Ensure base64 encoding
  const looksBase64 = /^[A-Za-z0-9+/=\s]+$/.test(raw) && dataUrl.includes(";base64");
  const data = looksBase64 ? raw.replace(/\s+/g, "") : btoa(unescape(encodeURIComponent(decodeURIComponent(raw))));
  return { mimeType, data };
}

export function toGeminiMessages(messages: ClientMessage[]): GeminiMessage[] {
  return messages.map((m) => {
    const parts: GeminiPart[] = [];
    if (m.content) parts.push({ text: m.content });
    for (const a of m.attachments ?? []) {
      const inline = dataUrlToInline(a.dataUrl, a.mime);
      if (inline) parts.push({ inlineData: inline });
    }
    if (parts.length === 0) parts.push({ text: "" });
    return {
      role: m.role === "assistant" ? "model" : "user",
      parts,
    };
  });
}

export type GeminiStreamError = {
  status: number;
  code: "invalid_api_key" | "rate_limited" | "quota_exceeded" | "timeout" | "network" | "upstream" | "aborted";
  message: string;
};

export type GeminiStreamResult = {
  fullText: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
};

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function classifyStatus(status: number): GeminiStreamError["code"] {
  if (status === 401 || status === 403) return "invalid_api_key";
  if (status === 429) return "rate_limited";
  if (status === 402) return "quota_exceeded";
  if (status >= 500) return "upstream";
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

/**
 * Stream a Gemini response as OpenAI-compatible SSE deltas so the existing
 * client parser works unchanged. Emits `data: {choices:[{delta:{content:"..."}}]}\n\n`.
 */
export async function streamGemini(opts: {
  model: string;
  system: string;
  messages: ClientMessage[];
  apiKey: string;
  writeDelta: (text: string) => void;
  clientSignal?: AbortSignal;
}): Promise<GeminiStreamResult> {
  const start = Date.now();
  const reqId = rid();
  const body = {
    contents: toGeminiMessages(opts.messages),
    systemInstruction: opts.system ? { role: "system", parts: [{ text: opts.system }] } : undefined,
    generationConfig: {
      temperature: 0.85,
      topP: 0.95,
      maxOutputTokens: 8192,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    ],
  };

  const url = `${BASE_URL}/models/${encodeURIComponent(opts.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(opts.apiKey)}`;

  let attempt = 0;
  let lastErr: GeminiStreamError | null = null;
  while (attempt < MAX_RETRIES) {
    attempt++;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const onClientAbort = () => controller.abort();
    opts.clientSignal?.addEventListener("abort", onClientAbort);
    try {
      const attemptStart = Date.now();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        lastErr = { status: res.status, code: classifyStatus(res.status), message: text || res.statusText };
        const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
        console.error(
          `[gemini] rid=${reqId} model=${opts.model} attempt=${attempt}/${MAX_RETRIES} status=${res.status} latencyMs=${Date.now() - attemptStart} retryAfter=${retryAfterMs ?? "n/a"} body=${(text || "").slice(0, 500)}`,
        );
        clearTimeout(timeout);
        opts.clientSignal?.removeEventListener("abort", onClientAbort);
        // Retry only on 429 / 5xx (respect Retry-After)
        if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
          const backoff = retryAfterMs ?? Math.min(8000, 400 * 2 ** (attempt - 1));
          await sleep(backoff + Math.random() * 250);
          continue;
        }
        throw lastErr;
      }
      console.log(`[gemini] rid=${reqId} model=${opts.model} attempt=${attempt} status=200 streaming`);

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
              candidates?: { content?: { parts?: { text?: string }[] } }[];
              usageMetadata?: {
                promptTokenCount?: number;
                candidatesTokenCount?: number;
                totalTokenCount?: number;
              };
            };
            const parts = json.candidates?.[0]?.content?.parts ?? [];
            for (const p of parts) {
              if (p.text) {
                full += p.text;
                opts.writeDelta(p.text);
              }
            }
            if (json.usageMetadata) {
              promptTokens = json.usageMetadata.promptTokenCount ?? promptTokens;
              completionTokens = json.usageMetadata.candidatesTokenCount ?? completionTokens;
              totalTokens = json.usageMetadata.totalTokenCount ?? totalTokens;
            }
          } catch {
            /* ignore parse error on partial line */
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
        throw { status: 0, code: "aborted", message: "Client aborted" } satisfies GeminiStreamError;
      }
      const err = e as { name?: string; code?: string; message?: string };
      if (err?.name === "AbortError") {
        lastErr = { status: 0, code: "timeout", message: "Upstream timeout" };
      } else if (lastErr) {
        // structured error from above
      } else {
        lastErr = { status: 0, code: "network", message: err?.message || "Network error" };
      }
      console.error(`[gemini] rid=${reqId} model=${opts.model} attempt=${attempt}/${MAX_RETRIES} caught code=${lastErr?.code} message=${lastErr?.message}`);
      if (attempt >= MAX_RETRIES) break;
      await sleep(Math.min(8000, 400 * 2 ** (attempt - 1)) + Math.random() * 200);
    }
  }
  throw (lastErr ?? { status: 0, code: "network", message: "Unknown error" }) satisfies GeminiStreamError;
}

/**
 * One-shot Gemini call (non-streaming). Used by memory-worker.
 */
export async function generateGeminiText(opts: {
  model: string;
  system?: string;
  prompt: string;
  apiKey: string;
  maxOutputTokens?: number;
}): Promise<{ text: string; promptTokens: number; completionTokens: number; latencyMs: number }> {
  const start = Date.now();
  const url = `${BASE_URL}/models/${encodeURIComponent(opts.model)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
        systemInstruction: opts.system ? { role: "system", parts: [{ text: opts.system }] } : undefined,
        generationConfig: { temperature: 0.3, maxOutputTokens: opts.maxOutputTokens ?? 1024 },
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Gemini ${res.status}: ${t || res.statusText}`);
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    return {
      text,
      promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      latencyMs: Date.now() - start,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Simple pricing (USD per 1M tokens) — approximate current Gemini pricing.
 */
export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const rates: Record<string, { input: number; output: number }> = {
    "gemini-2.5-flash": { input: 0.075, output: 0.3 },
    "gemini-2.5-pro": { input: 1.25, output: 10 },
    "gemini-2.5-flash-image-preview": { input: 0.075, output: 0.3 },
  };
  const r = rates[model] ?? { input: 0.5, output: 1.5 };
  return (promptTokens * r.input + completionTokens * r.output) / 1_000_000;
}