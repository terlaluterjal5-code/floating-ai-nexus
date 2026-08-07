import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { recordUsage } from "@/lib/ai/usage.server";

function isNewKey(v: string) {
  return v.startsWith("sb_publishable_") || v.startsWith("sb_secret_");
}
function jsonError(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Body = {
  conversationId?: string;
  endpoint: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  costUsd?: number;
  status?: "ok" | "error" | "aborted" | "rate_limited";
  error?: string;
};

export const Route = createFileRoute("/api/usage-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        if (!authHeader.startsWith("Bearer "))
          return jsonError(401, "unauthorized", "Missing bearer token");
        const token = authHeader.slice(7);
        if (token.split(".").length !== 3) return jsonError(401, "unauthorized", "Invalid token");

        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY)
          return jsonError(500, "server_misconfig", "Supabase env missing");

        const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: {
            headers: { Authorization: `Bearer ${token}` },
            fetch: (input, init) => {
              const h = new Headers(init?.headers);
              if (
                isNewKey(SUPABASE_PUBLISHABLE_KEY) &&
                h.get("Authorization") === `Bearer ${SUPABASE_PUBLISHABLE_KEY}`
              )
                h.delete("Authorization");
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
        try {
          body = (await request.json()) as Body;
        } catch {
          return jsonError(400, "invalid_body", "Invalid JSON");
        }
        if (!body.endpoint) return jsonError(400, "invalid_body", "endpoint required");

        await recordUsage(supabase, {
          userId,
          conversationId: body.conversationId ?? null,
          endpoint: body.endpoint,
          model: body.model,
          promptTokens: body.promptTokens,
          completionTokens: body.completionTokens,
          totalTokens: body.totalTokens,
          latencyMs: body.latencyMs,
          costUsd: body.costUsd,
          status: body.status,
          error: body.error ?? null,
        });
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
