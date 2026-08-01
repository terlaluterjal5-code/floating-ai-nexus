// Server-only subscription/entitlement resolution.
// Mirrors the /api/subscription-check contract and is the ONLY source of truth
// for authorization decisions. Feature flags sent by the client are ignored.
import type { SupabaseClient } from "@supabase/supabase-js";
import { FEATURE_KEYS, emptyFlags, type FeatureFlags, type FeatureKey } from "@/lib/ai/features";

const FREE_PLAN_CODE = "free";
const ACTIVE_STATUSES = ["active", "trialing", "past_due"];
const CACHE_TTL_MS = 5 * 60 * 1000;

export type Entitlements = {
  plan: string;
  planName: string;
  status: string;
  features: FeatureFlags;
  /** Daily chat request cap when unlimited_chat_credits is false. */
  chatDailyLimit: number;
  chatMinuteLimit: number;
};

const FREE_CHAT_DAILY = 40;
const FREE_CHAT_PER_MINUTE = 8;

type FeatureRow = {
  feature_key: string;
  value_text: string | null;
  value_number: number | null;
  value_bool: boolean | null;
};

function truthy(row: FeatureRow): boolean {
  if (row.value_bool !== null) return row.value_bool;
  if (row.value_number !== null) return Number(row.value_number) > 0;
  if (row.value_text !== null)
    return !["", "false", "0", "none", "off"].includes(row.value_text.toLowerCase());
  return false;
}

const cache = new Map<string, { at: number; value: Entitlements }>();

function freeFallback(): Entitlements {
  return {
    plan: FREE_PLAN_CODE,
    planName: "Free",
    status: "active",
    features: emptyFlags(),
    chatDailyLimit: FREE_CHAT_DAILY,
    chatMinuteLimit: FREE_CHAT_PER_MINUTE,
  };
}

/**
 * Resolve the signed-in user's plan + feature flags. RLS-scoped client only.
 * Cached in-memory for 5 minutes per user. Never throws — falls back to Free.
 */
export async function resolveEntitlements(
  supabase: SupabaseClient,
  userId: string,
  opts: { reqId?: string } = {},
): Promise<Entitlements> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  try {
    const { data: sub } = await supabase
      .from("user_subscriptions")
      .select("plan_id, status")
      .eq("user_id", userId)
      .maybeSingle();

    const hasActive = !!sub && ACTIVE_STATUSES.includes(sub.status as string);
    let planId: string | null = hasActive ? ((sub as { plan_id: string }).plan_id) : null;
    let status = hasActive ? ((sub as { status: string }).status) : "active";

    if (!planId) {
      const { data: freePlan } = await supabase
        .from("plans")
        .select("id")
        .eq("code", FREE_PLAN_CODE)
        .maybeSingle();
      if (!freePlan) return freeFallback();
      if (!sub) {
        const { error: insErr } = await supabase
          .from("user_subscriptions")
          .insert({ user_id: userId, plan_id: (freePlan as { id: string }).id, status: "active" });
        if (insErr && insErr.code !== "23505") {
          console.warn(`[entitlements] rid=${opts.reqId ?? "-"} user=${userId} free assign failed: ${insErr.message}`);
        }
      }
      planId = (freePlan as { id: string }).id;
      status = "active";
    }

    const { data: plan } = await supabase
      .from("plans")
      .select("code, name, plan_features(feature_key, value_text, value_number, value_bool)")
      .eq("id", planId)
      .maybeSingle();
    if (!plan) return freeFallback();

    const features = emptyFlags();
    let dailyOverride: number | null = null;
    const rows = ((plan as { plan_features?: FeatureRow[] }).plan_features ?? []) as FeatureRow[];
    for (const row of rows) {
      if ((FEATURE_KEYS as readonly string[]).includes(row.feature_key)) {
        features[row.feature_key as FeatureKey] = truthy(row);
      }
      if (row.feature_key === "unlimited_chat_credits" && row.value_bool !== true && row.value_number !== null) {
        dailyOverride = Number(row.value_number);
      }
    }

    const value: Entitlements = {
      plan: (plan as { code: string }).code,
      planName: (plan as { name: string }).name,
      status,
      features,
      chatDailyLimit: dailyOverride && dailyOverride > 0 ? dailyOverride : FREE_CHAT_DAILY,
      chatMinuteLimit: FREE_CHAT_PER_MINUTE,
    };
    cache.set(userId, { at: Date.now(), value });
    return value;
  } catch (e) {
    console.error(`[entitlements] rid=${opts.reqId ?? "-"} user=${userId} resolve failed: ${(e as Error).message}`);
    return freeFallback();
  }
}

export function invalidateEntitlements(userId: string) {
  cache.delete(userId);
}
