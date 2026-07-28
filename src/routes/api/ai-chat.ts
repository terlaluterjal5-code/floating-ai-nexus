import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { MODES, type ChatMode } from "@/lib/models";
import { streamGemini, estimateCostUsd, type ClientMessage, type GeminiStreamError } from "@/lib/ai/gemini.server";
import { loadUserMemories, loadConversationSummary, runMemoryWorker } from "@/lib/ai/memory.server";
import { recordUsage } from "@/lib/ai/usage.server";
import { checkRateLimit } from "@/lib/ai/rate-limit.server";

type Body = { messages: ClientMessage[]; mode: ChatMode; conversationId?: string };

function isNewKey(v: string) { return v.startsWith("sb_publishable_") || v.startsWith("sb_secret_"); }
function jsonError(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: { code, message } }), { status, headers: { "Content-Type": "application/json" } });
}

export const Route = createFileRoute("/api/ai-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const started = Date.now();
        const authHeader = request.headers.get("authorization") ?? "";
        if (!authHeader.startsWith("Bearer ")) return jsonError(401, "unauthorized", "Missing bearer token");
        const token = authHeader.slice(7);
        if (token.split(".").length !== 3) return jsonError(401, "unauthorized", "Invalid token");

        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return jsonError(500, "server_misconfig", "Supabase env missing");
        if (!GEMINI_API_KEY) return jsonError(500, "server_misconfig", "Missing GEMINI_API_KEY");

        const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: {
            headers: { Authorization: `Bearer ${token}` },
            fetch: (input, init) => {
              const h = new Headers(init?.headers);
              if (isNewKey(SUPABASE_PUBLISHABLE_KEY) && h.get("Authorization") === `Bearer ${SUPABASE_PUBLISHABLE_KEY}`) h.delete("Authorization");
              h.set("apikey", SUPABASE_PUBLISHABLE_KEY);
              return fetch(input, { ...init, headers: h });
            },
          },
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        });
        const { data: claims, error: cErr } = await supabase.auth.getClaims(token);
        if (cErr || !claims?.claims?.sub) return jsonError(401, "unauthorized", "Invalid session");
        const userId = claims.claims.sub as string;

        let body: Body;
        try { body = (await request.json()) as Body; } catch { return jsonError(400, "invalid_body", "Invalid JSON"); }
        const { messages, mode, conversationId } = body;
        if (!Array.isArray(messages) || messages.length === 0 || !mode || !MODES[mode]) return jsonError(400, "invalid_body", "Missing messages or mode");

        const rl = await checkRateLimit(supabase, userId, "/api/ai-chat");
        if (!rl.ok) {
          return new Response(
            JSON.stringify({ error: { code: "rate_limited", message: `Rate limit exceeded (${rl.scope}). Try again in ${rl.retryAfterSec}s.` } }),
            { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(rl.retryAfterSec) } },
          );
        }

        const [memories, summary] = await Promise.all([
          loadUserMemories(supabase, userId, 12),
          conversationId ? loadConversationSummary(supabase, conversationId) : Promise.resolve<string | null>(null),
        ]);
        const cfg = MODES[mode];
        const systemBlocks: string[] = [cfg.system];
        if (summary) systemBlocks.push(`Prior conversation summary:\n${summary}`);
        if (memories.length) systemBlocks.push(`Long-term memory about the user (use only if relevant, do not mention that you have memory):\n- ${memories.join("\n- ")}`);
        const system = systemBlocks.join("\n\n");

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            const write = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
            let fullText = "";
            let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 };
            let status: "ok" | "error" | "aborted" = "ok";
            let errMsg: string | null = null;
            try {
              const result = await streamGemini({
                model: cfg.model, system, messages, apiKey: GEMINI_API_KEY, clientSignal: request.signal,
                writeDelta: (t) => { fullText += t; write({ choices: [{ delta: { content: t } }] }); },
              });
              usage = { promptTokens: result.promptTokens, completionTokens: result.completionTokens, totalTokens: result.totalTokens, latencyMs: result.latencyMs };
            } catch (e) {
              const ge = e as GeminiStreamError;
              status = ge.code === "aborted" ? "aborted" : "error";
              errMsg = ge.message || "Streaming failed";
              console.error("[ai-chat] gemini error", ge.code, ge.status, ge.message);
              const userMsg =
                ge.code === "invalid_api_key" ? "\n\n_AI service is not properly configured. Please contact support._"
                : ge.code === "rate_limited" ? "\n\n_The AI is temporarily rate limited. Please try again in a moment._"
                : ge.code === "quota_exceeded" ? "\n\n_AI quota exceeded. Please try again later._"
                : ge.code === "timeout" ? "\n\n_The AI took too long to respond. Please try again._"
                : ge.code === "aborted" ? "" : "\n\n_The AI encountered an error. Please try again._";
              if (userMsg) write({ choices: [{ delta: { content: userMsg } }] });
            }
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();

            const cost = estimateCostUsd(cfg.model, usage.promptTokens, usage.completionTokens);
            await recordUsage(supabase, {
              userId, conversationId: conversationId ?? null, endpoint: "/api/ai-chat", model: cfg.model,
              promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens,
              latencyMs: usage.latencyMs || Date.now() - started, costUsd: cost, status, error: errMsg,
            });
            if (status === "ok" && conversationId && fullText.length > 40) {
              runMemoryWorker(supabase, GEMINI_API_KEY, userId, conversationId).catch((e) =>
                console.error("[ai-chat] memory-worker error", (e as Error).message),
              );
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});