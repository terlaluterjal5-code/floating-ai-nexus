import { createFileRoute } from "@tanstack/react-router";
import { MODES, type ChatMode } from "@/lib/models";
import {
  streamGemini,
  estimateCostUsd,
  type ClientMessage,
  type GeminiStreamError,
} from "@/lib/ai/gemini.server";
import { loadUserMemories, loadConversationSummary, runMemoryWorker } from "@/lib/ai/memory.server";
import { recordUsage } from "@/lib/ai/usage.server";
import { checkRateLimit } from "@/lib/ai/rate-limit.server";
import { resolveEntitlements } from "@/lib/ai/entitlements.server";
import type { FeatureKey } from "@/lib/ai/features";
import {
  authenticate,
  claimRequest,
  errorResponse,
  hashKey,
  newRequestId,
} from "@/lib/ai/http.server";

/** Request types the client may declare. Authorization is still server-decided. */
type RequestType =
  | "chat"
  | "deep_research"
  | "data_analysis"
  | "pdf_analysis"
  | "research_assistant"
  | "futuristic_tools";

type Body = {
  messages: ClientMessage[];
  mode: ChatMode;
  conversationId?: string;
  requestType?: RequestType;
};

const ENDPOINT = "/api/ai-chat";
/** Models that are actually available for the configured GEMINI_API_KEY. */
const MODEL_FLASH = "gemini-flash-latest";
const MODEL_PRO = "gemini-pro-latest";
/** Free-tier attachment budget (bytes). Larger docs need larger_pdf_analysis. */
const FREE_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const PREMIUM_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const REQUEST_TYPE_FEATURE: Partial<Record<RequestType, FeatureKey>> = {
  deep_research: "unlimited_deep_research",
  data_analysis: "advanced_data_analysis",
  research_assistant: "professional_research_assistant",
  futuristic_tools: "exclusive_futuristic_ai_tools",
};

function attachmentBytes(messages: ClientMessage[]): number {
  let total = 0;
  for (const m of messages)
    for (const a of m.attachments ?? []) {
      const b64 = a.dataUrl.slice(a.dataUrl.indexOf(",") + 1);
      total += Math.floor(b64.length * 0.75);
    }
  return total;
}

function upstreamErrorText(err: GeminiStreamError): string {
  switch (err.code) {
    case "invalid_api_key":
      return "\n\n_The AI service is not correctly configured. Please try again later._";
    case "rate_limited":
      return "\n\n_The AI service is temporarily rate limited. Please retry in a moment._";
    case "quota_exceeded":
      return "\n\n_The AI service quota has been exhausted. Please try again later._";
    case "timeout":
      return "\n\n_The AI took too long to respond. Please try again._";
    case "aborted":
      return "";
    default:
      return "\n\n_The AI service is temporarily unavailable. Please try again._";
  }
}

export const Route = createFileRoute("/api/ai-chat")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: { Allow: "POST, OPTIONS" } }),

      POST: async ({ request }) => {
        const started = Date.now();
        const reqId = newRequestId();

        // 1. Authenticate (Supabase JWT)
        const auth = await authenticate(request, reqId);
        if (auth instanceof Response) return auth;
        const { supabase, userId, geminiApiKey } = auth;

        // 2. Parse + validate input
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return errorResponse(400, "INVALID_BODY", "Malformed request.", reqId);
        }
        const { messages, mode, conversationId } = body;
        const requestType: RequestType = body.requestType ?? "chat";
        if (!Array.isArray(messages) || messages.length === 0 || !mode || !MODES[mode]) {
          return errorResponse(400, "INVALID_BODY", "Missing messages or mode.", reqId);
        }

        // 3. Request deduplication
        const last = messages[messages.length - 1];
        const dedupKey = hashKey([userId, conversationId, mode, last?.role, last?.content?.slice(0, 400)]);
        if (!claimRequest(dedupKey)) {
          return errorResponse(409, "DUPLICATE_REQUEST", "This request is already being processed.", reqId, {
            retryable: false,
          });
        }

        // 4. Subscription + feature authorization (server-side only)
        const ent = await resolveEntitlements(supabase, userId, { reqId });
        const f = ent.features;

        const deepRequested = mode === "deep" || requestType === "deep_research";
        if (deepRequested && !f.unlimited_deep_research) {
          console.warn(`[ai-chat] rid=${reqId} user=${userId} plan=${ent.plan} denied feature=unlimited_deep_research`);
          return errorResponse(
            403,
            "FEATURE_NOT_AVAILABLE",
            "Deep Research is not available on your current plan.",
            reqId,
            { feature: "unlimited_deep_research" },
          );
        }
        const gated = REQUEST_TYPE_FEATURE[requestType];
        if (gated && !f[gated]) {
          console.warn(`[ai-chat] rid=${reqId} user=${userId} plan=${ent.plan} denied feature=${gated}`);
          return errorResponse(403, "FEATURE_NOT_AVAILABLE", "This feature is not available on your current plan.", reqId, {
            feature: gated,
          });
        }

        const bytes = attachmentBytes(messages);
        const cap = f.larger_pdf_analysis ? PREMIUM_ATTACHMENT_BYTES : FREE_ATTACHMENT_BYTES;
        if (bytes > cap) {
          console.warn(`[ai-chat] rid=${reqId} user=${userId} plan=${ent.plan} denied feature=larger_pdf_analysis bytes=${bytes}`);
          return errorResponse(
            413,
            f.larger_pdf_analysis ? "ATTACHMENT_TOO_LARGE" : "FEATURE_NOT_AVAILABLE",
            f.larger_pdf_analysis
              ? "This document is too large to analyse."
              : "Large document analysis is not available on your current plan.",
            reqId,
            { feature: "larger_pdf_analysis" },
          );
        }

        // 5. Chat usage limit (skipped when unlimited_chat_credits)
        if (!f.unlimited_chat_credits) {
          const rl = await checkRateLimit(supabase, userId, ENDPOINT, {
            perMinute: ent.chatMinuteLimit,
            perDay: ent.chatDailyLimit,
          });
          if (!rl.ok) {
            await recordUsage(supabase, {
              userId,
              conversationId: conversationId ?? null,
              endpoint: ENDPOINT,
              model: "",
              latencyMs: Date.now() - started,
              status: "rate_limited",
              error: `plan=${ent.plan} scope=${rl.scope}`,
            });
            console.warn(`[ai-chat] rid=${reqId} user=${userId} plan=${ent.plan} status=chat_limit scope=${rl.scope}`);
            return errorResponse(
              429,
              "CHAT_LIMIT_REACHED",
              `You've reached your ${rl.scope === "minute" ? "per-minute" : "daily"} chat limit on the ${ent.planName} plan. Upgrade for unlimited chat.`,
              reqId,
              { feature: "unlimited_chat_credits", retryable: true, retryAfterSec: rl.retryAfterSec },
            );
          }
        }

        // 6. Model configuration — only models available to this API key
        const cfg = MODES[mode];
        const model = deepRequested && f.higher_ai_intelligence ? MODEL_PRO : MODEL_FLASH;
        const priority = f.priority_processing;
        const fast = f.faster_response_speed;

        // 7. Context assembly (leaner when faster_response_speed is enabled)
        const memoryLimit = fast ? 8 : 12;
        const [memories, summary] = await Promise.all([
          loadUserMemories(supabase, userId, memoryLimit),
          conversationId ? loadConversationSummary(supabase, conversationId) : Promise.resolve<string | null>(null),
        ]);
        const systemBlocks: string[] = [cfg.system];
        if (summary) systemBlocks.push(`Prior conversation summary:\n${summary}`);
        if (memories.length)
          systemBlocks.push(
            `Long-term memory about the user (use only if relevant, do not mention that you have memory):\n- ${memories.join("\n- ")}`,
          );
        const system = systemBlocks.join("\n\n");

        console.log(
          `[ai-chat] rid=${reqId} user=${userId} plan=${ent.plan} type=${requestType} mode=${mode} model=${model} priority=${priority} fast=${fast} msgs=${messages.length} conv=${conversationId ?? "-"} status=start`,
        );

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            const write = (obj: unknown) =>
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
            let fullText = "";
            let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 };
            let status: "ok" | "error" | "aborted" = "ok";
            let errMsg: string | null = null;
            let usedModel = model;
            let retryCount = 0;

            const run = async (m: string) => {
              const result = await streamGemini({
                model: m,
                system,
                messages,
                apiKey: geminiApiKey,
                clientSignal: request.signal,
                writeDelta: (t) => {
                  fullText += t;
                  write({ choices: [{ delta: { content: t } }] });
                },
              });
              usage = {
                promptTokens: result.promptTokens,
                completionTokens: result.completionTokens,
                totalTokens: result.totalTokens,
                latencyMs: result.latencyMs,
              };
            };

            try {
              await run(model);
            } catch (e) {
              const ge = e as GeminiStreamError;
              console.error(
                `[ai-chat] rid=${reqId} user=${userId} plan=${ent.plan} model=${model} status=upstream_error code=${ge.code} http=${ge.status} retry_count=${retryCount}`,
              );
              const transient =
                ge.code === "rate_limited" || ge.code === "quota_exceeded" || ge.code === "upstream";
              if (transient && model !== MODEL_FLASH && !request.signal.aborted && fullText.length === 0) {
                retryCount++;
                try {
                  await run(MODEL_FLASH);
                  usedModel = MODEL_FLASH;
                } catch (e2) {
                  const ge2 = e2 as GeminiStreamError;
                  status = ge2.code === "aborted" ? "aborted" : "error";
                  errMsg = ge2.code;
                  write({ choices: [{ delta: { content: upstreamErrorText(ge2) } }] });
                }
              } else {
                status = ge.code === "aborted" ? "aborted" : "error";
                errMsg = ge.code;
                write({ choices: [{ delta: { content: upstreamErrorText(ge) } }] });
              }
            }

            const latencyMs = usage.latencyMs || Date.now() - started;

            // 8. Persist the assistant message (server-side, authoritative)
            let messageId: string | null = null;
            if (status === "ok" && conversationId && fullText.length > 0) {
              const { data, error } = await supabase
                .from("messages")
                .insert({
                  conversation_id: conversationId,
                  user_id: userId,
                  role: "assistant",
                  content: fullText,
                  attachments: [],
                })
                .select("id, created_at")
                .maybeSingle();
              if (error) {
                console.error(`[ai-chat] rid=${reqId} status=message_save_failed error=${error.message}`);
              } else if (data) {
                messageId = data.id;
                write({ meta: { messageId: data.id, createdAt: data.created_at, model: usedModel, usage } });
                await supabase
                  .from("conversations")
                  .update({ updated_at: new Date().toISOString() })
                  .eq("id", conversationId);
              }
            }

            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();

            // 9. Usage logging
            const cost = estimateCostUsd(usedModel, usage.promptTokens, usage.completionTokens);
            console.log(
              `[ai-chat] rid=${reqId} user=${userId} plan=${ent.plan} feature=${gated ?? requestType} model=${usedModel} status=${status} tokens=${usage.totalTokens} latency=${latencyMs} retry_count=${retryCount} priority=${priority}`,
            );
            await recordUsage(supabase, {
              userId,
              conversationId: conversationId ?? null,
              endpoint: ENDPOINT,
              model: usedModel,
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              totalTokens: usage.totalTokens,
              latencyMs,
              costUsd: cost,
              status,
              error: errMsg ? `${requestType}:${errMsg}` : null,
            });

            if (status === "ok" && conversationId && messageId && fullText.length > 40) {
              runMemoryWorker(supabase, geminiApiKey, userId, conversationId).catch((e) =>
                console.error(`[ai-chat] rid=${reqId} memory-worker error=${(e as Error).message}`),
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
            "X-Request-Id": reqId,
            "X-Priority": priority ? "high" : "normal",
          },
        });
      },
    },
  },
});
