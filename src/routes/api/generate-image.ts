import { createFileRoute } from "@tanstack/react-router";
import { IMAGE_MODEL, IMAGE_PROMPT_PREFIX } from "@/lib/models";
import { recordUsage } from "@/lib/ai/usage.server";
import { checkRateLimit } from "@/lib/ai/rate-limit.server";
import { estimateCostUsd } from "@/lib/ai/gemini.server";
import { resolveEntitlements } from "@/lib/ai/entitlements.server";
import { authenticate, claimRequest, errorResponse, hashKey, jsonResponse, newRequestId } from "@/lib/ai/http.server";

const ENDPOINT = "/api/generate-image";
/** Standard prompt used when advanced_image_generation is not granted. */
const STANDARD_PREFIX =
  "High quality, realistic photograph with natural lighting and accurate colors. Subject:";

export const Route = createFileRoute("/api/generate-image")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: { Allow: "POST, OPTIONS" } }),

      POST: async ({ request }) => {
        const started = Date.now();
        const reqId = newRequestId();

        const auth = await authenticate(request, reqId);
        if (auth instanceof Response) return auth;
        const { supabase, userId, geminiApiKey } = auth;

        const { prompt, quality } = (await request.json().catch(() => ({}))) as {
          prompt?: string;
          quality?: "standard" | "premium";
        };
        if (!prompt || typeof prompt !== "string" || !prompt.trim())
          return errorResponse(400, "INVALID_BODY", "A prompt is required.", reqId);

        if (!claimRequest(hashKey([userId, ENDPOINT, prompt.slice(0, 400)]), 6000))
          return errorResponse(409, "DUPLICATE_REQUEST", "This image is already being generated.", reqId, {
            retryable: false,
          });

        const ent = await resolveEntitlements(supabase, userId, { reqId });
        const advanced = ent.features.advanced_image_generation;
        // Never trust the client: premium quality requires the feature flag.
        if (quality === "premium" && !advanced) {
          console.warn(`[generate-image] rid=${reqId} user=${userId} plan=${ent.plan} denied feature=advanced_image_generation`);
          return errorResponse(
            403,
            "FEATURE_NOT_AVAILABLE",
            "Advanced image generation is not available on your current plan.",
            reqId,
            { feature: "advanced_image_generation" },
          );
        }

        if (!ent.features.unlimited_chat_credits) {
          const rl = await checkRateLimit(supabase, userId, ENDPOINT, { perMinute: 3, perDay: 20 });
          if (!rl.ok) {
            await recordUsage(supabase, {
              userId, endpoint: ENDPOINT, model: IMAGE_MODEL, latencyMs: Date.now() - started,
              status: "rate_limited", error: `plan=${ent.plan} scope=${rl.scope}`,
            });
            return errorResponse(
              429,
              "IMAGE_LIMIT_REACHED",
              `You've reached your ${rl.scope === "minute" ? "per-minute" : "daily"} image limit on the ${ent.planName} plan.`,
              reqId,
              { retryable: true, retryAfterSec: rl.retryAfterSec },
            );
          }
        }

        const fullPrompt = `${advanced ? IMAGE_PROMPT_PREFIX : STANDARD_PREFIX} ${prompt}`;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(IMAGE_MODEL)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`;

        let lastStatus = 0;
        let lastCode = "UPSTREAM_ERROR";
        let dataUrl: string | null = null;
        let promptTokens = 0;
        let completionTokens = 0;
        let retryCount = 0;

        for (let attempt = 0; attempt < 3; attempt++) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 60_000);
          const onAbort = () => controller.abort();
          request.signal.addEventListener("abort", onAbort);
          try {
            const resp = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: controller.signal,
              body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
                generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
              }),
            });
            lastStatus = resp.status;
            if (!resp.ok) {
              const detail = await resp.text().catch(() => "");
              console.error(`[generate-image] rid=${reqId} user=${userId} plan=${ent.plan} model=${IMAGE_MODEL} status=${resp.status} retry_count=${retryCount} detail=${detail.slice(0, 300)}`);
              // Never retry permanent errors (400/401/403/404).
              if (resp.status === 429 || resp.status >= 500) {
                lastCode = resp.status === 429 ? "UPSTREAM_RATE_LIMITED" : "UPSTREAM_ERROR";
                const retryAfter = Number(resp.headers.get("retry-after"));
                if (attempt < 2) {
                  retryCount++;
                  const delay = Number.isFinite(retryAfter) && retryAfter > 0
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
            const data = (await resp.json()) as {
              candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string }; text?: string }[] } }[];
              usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
            };
            promptTokens = data.usageMetadata?.promptTokenCount ?? 0;
            completionTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
            for (const p of data.candidates?.[0]?.content?.parts ?? []) {
              if (p.inlineData?.data) {
                dataUrl = `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`;
                break;
              }
            }
            break;
          } catch (e) {
            if (request.signal.aborted) { lastCode = "ABORTED"; break; }
            lastCode = "UPSTREAM_TIMEOUT";
            console.error(`[generate-image] rid=${reqId} user=${userId} status=network attempt=${attempt} error=${(e as Error).name}`);
            if (attempt === 2) break;
            retryCount++;
            await new Promise((r) => setTimeout(r, Math.min(8000, 500 * 2 ** attempt) + Math.random() * 250));
          } finally {
            clearTimeout(timer);
            request.signal.removeEventListener("abort", onAbort);
          }
        }

        const latencyMs = Date.now() - started;
        const cost = estimateCostUsd(IMAGE_MODEL, promptTokens, completionTokens);

        if (!dataUrl) {
          await recordUsage(supabase, {
            userId, endpoint: ENDPOINT, model: IMAGE_MODEL, promptTokens, completionTokens,
            latencyMs, costUsd: cost, status: "error", error: `${lastCode}:${lastStatus}`,
          });
          const retryable = lastCode === "UPSTREAM_RATE_LIMITED" || lastCode === "UPSTREAM_ERROR" || lastCode === "UPSTREAM_TIMEOUT";
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

        console.log(`[generate-image] rid=${reqId} user=${userId} plan=${ent.plan} feature=advanced_image_generation=${advanced} model=${IMAGE_MODEL} status=ok latency=${latencyMs} retry_count=${retryCount}`);
        await recordUsage(supabase, {
          userId, endpoint: ENDPOINT, model: IMAGE_MODEL, promptTokens, completionTokens,
          latencyMs, costUsd: cost, status: "ok",
        });
        return jsonResponse(200, { dataUrl, quality: advanced ? "premium" : "standard", request_id: reqId });
      },
    },
  },
});
