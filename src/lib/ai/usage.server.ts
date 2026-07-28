import type { SupabaseClient } from "@supabase/supabase-js";

export type UsageLogInput = {
  userId: string;
  conversationId?: string | null;
  endpoint: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  costUsd?: number;
  status?: "ok" | "error" | "aborted" | "rate_limited";
  error?: string | null;
};

export async function recordUsage(supabase: SupabaseClient, input: UsageLogInput): Promise<void> {
  try {
    const { error } = await supabase.from("usage_logs").insert({
      user_id: input.userId,
      conversation_id: input.conversationId ?? null,
      endpoint: input.endpoint,
      model: input.model ?? "",
      prompt_tokens: input.promptTokens ?? 0,
      completion_tokens: input.completionTokens ?? 0,
      total_tokens: input.totalTokens ?? (input.promptTokens ?? 0) + (input.completionTokens ?? 0),
      latency_ms: input.latencyMs ?? 0,
      cost_usd: input.costUsd ?? 0,
      status: input.status ?? "ok",
      error: input.error ?? null,
    });
    if (error) console.error("[usage] insert failed", error.message);
  } catch (e) {
    console.error("[usage] insert threw", (e as Error).message);
  }
}