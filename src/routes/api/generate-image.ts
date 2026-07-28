import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { IMAGE_MODEL, IMAGE_PROMPT_PREFIX } from "@/lib/models";
import { recordUsage } from "@/lib/ai/usage.server";
import { checkRateLimit } from "@/lib/ai/rate-limit.server";
import { estimateCostUsd } from "@/lib/ai/gemini.server";

function isNewKey(v: string) { return v.startsWith("sb_publishable_") || v.startsWith("sb_secret_"); }
function jsonError(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: { code, message } }), { status, headers: { "Content-Type": "application/json" } });
}

export const Route = createFileRoute("/api/generate-image")({
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

        const rl = await checkRateLimit(supabase, userId, "/api/generate-image", { perMinute: 6, perDay: 100 });
        if (!rl.ok) {
          return new Response(JSON.stringify({ error: { code: "rate_limited", message: `Rate limit (${rl.scope}). Retry in ${rl.retryAfterSec}s.` } }),
            { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(rl.retryAfterSec) } });
        }

        const { prompt } = (await request.json().catch(() => ({}))) as { prompt?: string };
        if (!prompt || typeof prompt !== "string") return jsonError(400, "invalid_body", "Prompt required");

        const fullPrompt = `${IMAGE_PROMPT_PREFIX} ${prompt}`;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(IMAGE_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

        let lastStatus = 0; let lastBody = ""; let dataUrl: string | null = null;
        let promptTokens = 0; let completionTokens = 0;
        for (let attempt = 0; attempt < 3; attempt++) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 60_000);
          try {
            const resp = await fetch(url, {
              method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
              body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
                generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
              }),
            });
            clearTimeout(timer);
            lastStatus = resp.status;
            if (!resp.ok) {
              lastBody = await resp.text().catch(() => "");
              if (resp.status === 429 || resp.status >= 500) { await new Promise((r) => setTimeout(r, 500 * 2 ** attempt)); continue; }
              break;
            }
            const data = (await resp.json()) as {
              candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string }; text?: string }[] } }[];
              usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
            };
            promptTokens = data.usageMetadata?.promptTokenCount ?? 0;
            completionTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
            const parts = data.candidates?.[0]?.content?.parts ?? [];
            for (const p of parts) {
              if (p.inlineData?.data) { dataUrl = `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`; break; }
            }
            break;
          } catch (e) {
            clearTimeout(timer);
            lastBody = (e as Error).message;
            if (attempt === 2) break;
            await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
          }
        }

        const latencyMs = Date.now() - started;
        const cost = estimateCostUsd(IMAGE_MODEL, promptTokens, completionTokens);
        if (!dataUrl) {
          await recordUsage(supabase, { userId, endpoint: "/api/generate-image", model: IMAGE_MODEL, promptTokens, completionTokens, latencyMs, costUsd: cost, status: "error", error: lastBody || `Upstream ${lastStatus}` });
          const code = lastStatus === 429 ? 429 : 502;
          return jsonError(code, "upstream_error", lastBody || "No image returned");
        }
        await recordUsage(supabase, { userId, endpoint: "/api/generate-image", model: IMAGE_MODEL, promptTokens, completionTokens, latencyMs, costUsd: cost, status: "ok" });
        return new Response(JSON.stringify({ dataUrl }), { headers: { "Content-Type": "application/json" } });
      },
    },
  },
});