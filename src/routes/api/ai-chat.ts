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

function writeUserFacingError(
  write: (obj: unknown) => void,
  code: GeminiStreamError["code"],
) {
  const msg =
    code === "invalid_api_key" ? "\n\n_AI service is not properly configured. Please contact support._"
    : code === "rate_limited" ? "\n\n_The AI is temporarily rate limited. Please try again in a moment._"
    : code === "quota_exceeded" ? "\n\n_AI quota exceeded. Please try again later._"
    : code === "timeout" ? "\n\n_The AI took too long to respond. Please try again._"
    : code === "aborted" ? "" : "\n\n_The AI encountered an error. Please try again._";
  if (msg) write({ choices: [{ delta: { content: msg } }] });
}

export const Route = createFileRoute("/api/ai-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const started = Date.now();
        const reqId = Math.random().toString(36).slice(2, 10);
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
          console.warn(`[ai-chat] rid=${reqId} user=${userId} SERVER rate limit hit scope=${rl.scope}`);
          return new Response(
            JSON.stringify({ error: { code: "server_rate_limited", message: `You're sending messages too fast (${rl.scope} limit). Try again in ${rl.retryAfterSec}s.` } }),
            { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(rl.retryAfterSec) } },
          );
        }

        const [memories, summary] = await Promise.all([
          loadUserMemories(supabase, userId, 12),
          conversationId ? loadConversationSummary(supabase, conversationId) : Promise.resolve<string | null>(null),
        ]);
        const cfg = MODES[mode];
        console.log(`[ai-chat] rid=${reqId} user=${userId} mode=${mode} model=${cfg.model} msgs=${messages.length} conv=${conversationId ?? "-"}`);
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
            let usedModel = cfg.model;
            try {
              const result = await streamGemini({
                model: cfg.model, system, messages, apiKey: GEMINI_API_KEY, clientSignal: request.signal,
                writeDelta: (t) => { fullText += t; write({ choices: [{ delta: { content: t } }] }); },
              });
              usage = { promptTokens: result.promptTokens, completionTokens: result.completionTokens, totalTokens: result.totalTokens, latencyMs: result.latencyMs };
            } catch (e) {
              const ge = e as GeminiStreamError;
              console.error(`[ai-chat] rid=${reqId} UPSTREAM gemini error model=${cfg.model} code=${ge.code} status=${ge.status} message=${ge.message}`);
              // Fallback: if pro rate-limited/quota, retry with flash so the user still gets an answer.
              const FALLBACK_MODEL = "gemini-flash-latest";
              const shouldFallback = (ge.code === "rate_limited" || ge.code === "quota_exceeded" || ge.code === "upstream") && cfg.model !== FALLBACK_MODEL;
              if (shouldFallback && !request.signal.aborted && fullText.length === 0) {
                try {
                  console.log(`[ai-chat] rid=${reqId} FALLBACK model=${FALLBACK_MODEL}`);
                  const result = await streamGemini({
                    model: FALLBACK_MODEL, system, messages, apiKey: GEMINI_API_KEY, clientSignal: request.signal,
                    writeDelta: (t) => { fullText += t; write({ choices: [{ delta: { content: t } }] }); },
                  });
                  usage = { promptTokens: result.promptTokens, completionTokens: result.completionTokens, totalTokens: result.totalTokens, latencyMs: result.latencyMs };
                  usedModel = FALLBACK_MODEL;
                  status = "ok";
                } catch (e2) {
                  const ge2 = e2 as GeminiStreamError;
                  status = ge2.code === "aborted" ? "aborted" : "error";
                  errMsg = ge2.message || "Streaming failed";
                  console.error(`[ai-chat] rid=${reqId} FALLBACK failed code=${ge2.code} status=${ge2.status} message=${ge2.message}`);
                  writeUserFacingError(write, ge2.code);
                }
              } else {
                status = ge.code === "aborted" ? "aborted" : "error";
                errMsg = ge.message || "Streaming failed";
                writeUserFacingError(write, ge.code);
              }
            }
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();

            const cost = estimateCostUsd(usedModel, usage.promptTokens, usage.completionTokens);
            console.log(`[ai-chat] rid=${reqId} done model=${usedModel} status=${status} tokens=${usage.totalTokens} latencyMs=${usage.latencyMs || Date.now() - started} cost=$${cost.toFixed(6)}`);
            await recordUsage(supabase, {
              userId, conversationId: conversationId ?? null, endpoint: "/api/ai-chat", model: usedModel,
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