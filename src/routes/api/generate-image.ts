import { createFileRoute } from "@tanstack/react-router";
import { IMAGE_MODEL, IMAGE_PROMPT_PREFIX } from "@/lib/models";
import { recordUsage } from "@/lib/ai/usage.server";
import { checkRateLimit } from "@/lib/ai/rate-limit.server";
import {
  estimateCostUsd,
  orHeaders,
  OPENROUTER_BASE_URL,
} from "@/lib/ai/openrouter.server";
import {
  authenticate,
  claimRequest,
  errorResponse,
  hashKey,
  jsonResponse,
  newRequestId,
} from "@/lib/ai/http.server";

const ENDPOINT = "/api/generate-image";

type ORImageResponse = {
  choices?: {
    message?: {
      content?: string | { type?: string; text?: string }[];
      images?: { image_url?: { url?: string } }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

function extractDataUrl(data: ORImageResponse): string | null {
  const msg = data.choices?.[0]?.message;
  const fromImages = msg?.images?.[0]?.image_url?.url;
  if (fromImages) return fromImages;
  if (typeof msg?.content === "string" && msg.content.startsWith("data:image/")) return msg.content;
  if (Array.isArray(msg?.content)) {
    for (const part of msg.content) {
      if (part?.text?.startsWith("data:image/")) return part.text;
    }
  }
  return null;
}

export const Route = createFileRoute("/api/generate-image")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: { Allow: "POST, OPTIONS" } }),

      POST: async ({ request }) => {
        const started = Date.now();
        const reqId = newRequestId();

        const auth = await authenticate(request, reqId);
        if (auth instanceof Response) return auth;
        const { supabase, userId, aiApiKey } = auth;

        const { prompt } = (await request.json().catch(() => ({}))) as { prompt?: string };
        if (!prompt || typeof prompt !== "string" || !prompt.trim())
          return errorResponse(400, "INVALID_BODY", "A prompt is required.", reqId);

        if (!claimRequest(hashKey([userId, ENDPOINT, prompt.slice(0, 400)]), 6000))
          return errorResponse(
            409,
            "DUPLICATE_REQUEST",
            "This image is already being generated.",
            reqId,
            { retryable: false },
          );

        const rl = await checkRateLimit(supabase, userId, ENDPOINT, { perMinute: 5, perDay: 60 });
        if (!rl.ok) {
          await recordUsage(supabase, {
            userId,
            endpoint: ENDPOINT,
            model: IMAGE_MODEL,
            latencyMs: Date.now() - started,
            status: "rate_limited",
            error: `scope=${rl.scope}`,
          });
          return errorResponse(
            429,
            "IMAGE_LIMIT_REACHED",
            `You've reached the ${rl.scope === "minute" ? "per-minute" : "daily"} image limit. Please try again later.`,
            reqId,
            { retryable: true, retryAfterSec: rl.retryAfterSec },
          );
        }

        const fullPrompt = `${IMAGE_PROMPT_PREFIX} ${prompt}`;
        let lastStatus = 0;
        let lastCode = "UPSTREAM_ERROR";
        let dataUrl: string | null = null;
        let promptTokens = 0;
        let completionTokens = 0;
        let retryCount = 0;

        for (let attempt = 0; attempt < 3; attempt++) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 90_000);
          const onAbort = () => controller.abort();
          request.signal.addEventListener("abort", onAbort);
          try {
            const resp = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
              method: "POST",
              headers: orHeaders(aiApiKey),
              signal: controller.signal,
              body: JSON.stringify({
                model: IMAGE_MODEL,
                modalities: ["image", "text"],
                messages: [{ role: "user", content: fullPrompt }],
              }),
            });
            lastStatus = resp.status;
            if (!resp.ok) {
              const detail = await resp.text().catch(() => "");
              console.error(
                `[generate-image] rid=${reqId} user=${userId} model=${IMAGE_MODEL} status=${resp.status} retry_count=${retryCount} detail=${detail.slice(0, 300)}`,
              );
              if (resp.status === 429 || resp.status >= 500) {
                lastCode = resp.status === 429 ? "UPSTREAM_RATE_LIMITED" : "UPSTREAM_ERROR";
                const retryAfter = Number(resp.headers.get("retry-after"));
                if (attempt < 2) {
                  retryCount++;
                  const delay =
                    Number.isFinite(retryAfter) && retryAfter > 0
                      ? retryAfter * 1000
                      : Math.min(8000, 500 * 2 ** attempt) + Math.random() * 250;
                  await new Promise((r) => setTimeout(r, delay));
                  continue;
                }
                break;
              }
              lastCode = "UPSTREAM_REJECTED";
              break;
            }
            const data = (await resp.json()) as ORImageResponse;
            promptTokens = data.usage?.prompt_tokens ?? 0;
            completionTokens = data.usage?.completion_tokens ?? 0;
            dataUrl = extractDataUrl(data);
            break;
          } catch (e) {
            if (request.signal.aborted) {
              lastCode = "ABORTED";
              break;
            }
            lastCode = "UPSTREAM_TIMEOUT";
            console.error(
              `[generate-image] rid=${reqId} user=${userId} status=network attempt=${attempt} error=${(e as Error).name}`,
            );
            if (attempt === 2) break;
            retryCount++;
            await new Promise((r) =>
              setTimeout(r, Math.min(8000, 500 * 2 ** attempt) + Math.random() * 250),
            );
          } finally {
            clearTimeout(timer);
            request.signal.removeEventListener("abort", onAbort);
          }
        }

        const latencyMs = Date.now() - started;
        const cost = estimateCostUsd(IMAGE_MODEL, promptTokens, completionTokens);

        if (!dataUrl) {
          await recordUsage(supabase, {
            userId,
            endpoint: ENDPOINT,
            model: IMAGE_MODEL,
            promptTokens,
            completionTokens,
            latencyMs,
            costUsd: cost,
            status: "error",
            error: `${lastCode}:${lastStatus}`,
          });
          const retryable =
            lastCode === "UPSTREAM_RATE_LIMITED" ||
            lastCode === "UPSTREAM_ERROR" ||
            lastCode === "UPSTREAM_TIMEOUT";
          return errorResponse(
            lastStatus === 429 ? 429 : 502,
            lastCode,
            lastCode === "UPSTREAM_RATE_LIMITED"
              ? "The AI service is temporarily rate limited."
              : "Image generation failed. Please try a different prompt or try again.",
            reqId,
            { retryable },
          );
        }

        console.log(
          `[generate-image] rid=${reqId} user=${userId} model=${IMAGE_MODEL} status=ok latency=${latencyMs} retry_count=${retryCount}`,
        );
        await recordUsage(supabase, {
          userId,
          endpoint: ENDPOINT,
          model: IMAGE_MODEL,
          promptTokens,
          completionTokens,
          latencyMs,
          costUsd: cost,
          status: "ok",
        });
        return jsonResponse(200, { dataUrl, request_id: reqId });
      },
    },
  },
});
