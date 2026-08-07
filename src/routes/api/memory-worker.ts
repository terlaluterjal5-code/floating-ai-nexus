import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { runMemoryWorker } from "@/lib/ai/memory.server";

function isNewKey(v: string) {
  return v.startsWith("sb_publishable_") || v.startsWith("sb_secret_");
}
function jsonError(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/memory-worker")({
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
        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY)
          return jsonError(500, "server_misconfig", "Supabase env missing");
        if (!GEMINI_API_KEY) return jsonError(500, "server_misconfig", "Missing GEMINI_API_KEY");

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

        let body: { conversationId?: string };
        try {
          body = (await request.json()) as { conversationId?: string };
        } catch {
          return jsonError(400, "invalid_body", "Invalid JSON");
        }
        const conversationId = body.conversationId;
        if (!conversationId) return jsonError(400, "invalid_body", "conversationId required");

        const { data: conv } = await supabase
          .from("conversations")
          .select("id, user_id")
          .eq("id", conversationId)
          .maybeSingle();
        if (!conv || conv.user_id !== userId)
          return jsonError(404, "not_found", "Conversation not found");

        try {
          const result = await runMemoryWorker(supabase, GEMINI_API_KEY, userId, conversationId);
          return new Response(JSON.stringify({ ok: true, ...result }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          console.error("[memory-worker] error", (e as Error).message);
          return jsonError(500, "worker_failed", (e as Error).message);
        }
      },
    },
  },
});
