import type { SupabaseClient } from "@supabase/supabase-js";

type Limits = { perMinute: number; perDay: number };
const DEFAULTS: Limits = { perMinute: 20, perDay: 500 };

export async function checkRateLimit(
  supabase: SupabaseClient,
  userId: string,
  endpoint: string,
  limits: Limits = DEFAULTS,
): Promise<{ ok: true } | { ok: false; retryAfterSec: number; scope: "minute" | "day" }> {
  const nowIso = new Date().toISOString();
  const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
  const oneDayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const [{ count: mc, error: e1 }, { count: dc, error: e2 }] = await Promise.all([
    supabase.from("usage_logs").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("endpoint", endpoint)
      .gte("created_at", oneMinAgo).lte("created_at", nowIso),
    supabase.from("usage_logs").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("endpoint", endpoint)
      .gte("created_at", oneDayAgo).lte("created_at", nowIso),
  ]);
  if (e1 || e2) return { ok: true };
  if ((mc ?? 0) >= limits.perMinute) return { ok: false, retryAfterSec: 60, scope: "minute" };
  if ((dc ?? 0) >= limits.perDay) return { ok: false, retryAfterSec: 3600, scope: "day" };
  return { ok: true };
}