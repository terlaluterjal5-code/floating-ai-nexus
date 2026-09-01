import { createFileRoute } from "@tanstack/react-router";
import { MODES, CHAT_MODEL, type ChatMode } from "@/lib/models";
import {
  streamChatCompletion,
  estimateCostUsd,
  type ClientMessage,
  type AiStreamError,
} from "@/lib/ai/openrouter.server";
import { loadUserMemories, loadConversationSummary, runMemoryWorker } from "@/lib/ai/memory.server";
import { recordUsage } from "@/lib/ai/usage.server";
import { checkRateLimit } from "@/lib/ai/rate-limit.server";
import {
  authenticate,
  claimRequest,
  errorResponse,
  hashKey,
  newRequestId,
} from "@/lib/ai/http.server";

type Body = {
  messages: ClientMessage[];
  mode: ChatMode;
  conversationId?: string;
  requestType?: string;
};

const ENDPOINT = "/api/ai-chat";
/** Attachment budget (bytes). */
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const CHAT_PER_MINUTE = 20;
const CHAT_PER_DAY = 500;

function attachmentBytes(messages: ClientMessage[]): number {
  let total = 0;
  for (const m of messages)
    for (const a of m.attachments ?? []) {
      const b64 = a.dataUrl.slice(a.dataUrl.indexOf(",") + 1);
      total += Math.floor(b64.length * 0.75);
    }
  return total;
}

function upstreamErrorText(err: AiStreamError): string {
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
        const { supabase, userId, aiApiKey } = auth;

        // 2. Parse + validate input
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return errorResponse(400, "INVALID_BODY", "Malformed request.", reqId);
        }
        const { messages, mode, conversationId } = body;
        const requestType = body.requestType ?? "chat";
        if (!Array.isArray(messages) || messages.length === 0 || !mode || !MODES[mode]) {
          return errorResponse(400, "INVALID_BODY", "Missing messages or mode.", reqId);
        }

        // 3. Request deduplication
        const last = messages[messages.length - 1];
        const dedupKey = hashKey([
          userId,
          conversationId,
          mode,
          last?.role,
          last?.content?.slice(0, 400),
        ]);
        if (!claimRequest(dedupKey)) {
          return errorResponse(
            409,
            "DUPLICATE_REQUEST",
            "This request is already being processed.",
            reqId,
            { retryable: false },
          );
        }

        // 4. Attachment size guard
        const bytes = attachmentBytes(messages);
        if (bytes > MAX_ATTACHMENT_BYTES) {
          return errorResponse(
            413,
            "ATTACHMENT_TOO_LARGE",
            "This document is too large to analyse.",
            reqId,
          );
        }

        // 5. Abuse protection (fair-use rate limit)
        const rl = await checkRateLimit(supabase, userId, ENDPOINT, {
          perMinute: CHAT_PER_MINUTE,
          perDay: CHAT_PER_DAY,
        });
        if (!rl.ok) {
          await recordUsage(supabase, {
            userId,
            conversationId: conversationId ?? null,
            endpoint: ENDPOINT,
            model: "",
            latencyMs: Date.now() - started,
            status: "rate_limited",
            error: `scope=${rl.scope}`,
          });
          console.warn(`[ai-chat] rid=${reqId} user=${userId} status=chat_limit scope=${rl.scope}`);
          return errorResponse(
            429,
            "CHAT_LIMIT_REACHED",
            `Too many requests right now. Please retry in a moment.`,
            reqId,
            { retryable: true, retryAfterSec: rl.retryAfterSec },
          );
        }

        // 6. Model configuration
        const cfg = MODES[mode];
        const model = CHAT_MODEL;

        // 7. Context assembly
        const [memories, summary] = await Promise.all([
          loadUserMemories(supabase, userId, 12),
          conversationId
            ? loadConversationSummary(supabase, conversationId)
            : Promise.resolve<string | null>(null),
        ]);
        const systemBlocks: string[] = [cfg.system];
        if (summary) systemBlocks.push(`Prior conversation summary:\n${summary}`);
        if (memories.length)
          systemBlocks.push(
            `Long-term memory about the user (use only if relevant, do not mention that you have memory):\n- ${memories.join("\n- ")}`,
          );
        const system = systemBlocks.join("\n\n");

        console.log(
          `[ai-chat] rid=${reqId} user=${userId} type=${requestType} mode=${mode} model=${model} msgs=${messages.length} conv=${conversationId ?? "-"} status=start`,
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

            try {
              const result = await streamChatCompletion({
                model,
                system,
                messages,
                apiKey: aiApiKey,
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
            } catch (e) {
              const ge = e as AiStreamError;
              console.error(
                `[ai-chat] rid=${reqId} user=${userId} model=${model} status=upstream_error code=${ge.code} http=${ge.status}`,
              );
              status = ge.code === "aborted" ? "aborted" : "error";
              errMsg = ge.code;
              write({ choices: [{ delta: { content: upstreamErrorText(ge) } }] });
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
                console.error(
                  `[ai-chat] rid=${reqId} status=message_save_failed error=${error.message}`,
                );
              } else if (data) {
                messageId = data.id;
                write({
                  meta: { messageId: data.id, createdAt: data.created_at, model, usage },
                });
                await supabase
                  .from("conversations")
                  .update({ updated_at: new Date().toISOString() })
                  .eq("id", conversationId);
              }
            }

            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();

            // 9. Usage logging
            const cost = estimateCostUsd(model, usage.promptTokens, usage.completionTokens);
            console.log(
              `[ai-chat] rid=${reqId} user=${userId} model=${model} status=${status} tokens=${usage.totalTokens} latency=${latencyMs}`,
            );
            await recordUsage(supabase, {
              userId,
              conversationId: conversationId ?? null,
              endpoint: ENDPOINT,
              model,
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              totalTokens: usage.totalTokens,
              latencyMs,
              costUsd: cost,
              status,
              error: errMsg ? `${requestType}:${errMsg}` : null,
            });

            if (status === "ok" && conversationId && messageId && fullText.length > 40) {
              runMemoryWorker(supabase, aiApiKey, userId, conversationId).catch((e) =>
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
          },
        });
      },
    },
  },
});
