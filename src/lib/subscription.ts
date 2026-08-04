import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const FEATURE_KEYS = [
  "unlimited_deep_research",
  "higher_ai_intelligence",
  "faster_response_speed",
  "advanced_image_generation",
  "larger_pdf_analysis",
  "priority_processing",
  "exclusive_futuristic_ai_tools",
  "professional_research_assistant",
  "unlimited_chat_credits",
  "advanced_data_analysis",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type SubscriptionCheck = {
  plan: string;
  planName: string;
  status: string;
  price: { amountCents: number; currency: string; period: string };
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  autoAssignedFreePlan: boolean;
  features: Record<FeatureKey, boolean>;
  featureLabels: Record<string, string>;
};

const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; userId: string; data: SubscriptionCheck } | null = null;
let inflight: Promise<SubscriptionCheck> | null = null;

export function clearSubscriptionCache() {
  cache = null;
  inflight = null;
}

export async function fetchSubscription(force = false): Promise<SubscriptionCheck> {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session) throw new Error("unauthenticated");

  if (!force && cache && cache.userId === session.user.id && Date.now() - cache.at < TTL_MS) {
    return cache.data;
  }
  if (!force && inflight) return inflight;

  inflight = (async () => {
    const { authedFetch } = await import("@/lib/authedFetch");
    const res = await authedFetch("/api/subscription-check");
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(body?.error?.message ?? `subscription-check failed (${res.status})`);
    }
    const data = body as SubscriptionCheck;
    cache = { at: Date.now(), userId: session.user.id, data };
    return data;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

export function useSubscription() {
  const [data, setData] = useState<SubscriptionCheck | null>(cache?.data ?? null);
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchSubscription()
      .then((d) => active && setData(d))
      .catch((e: Error) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  return { subscription: data, loading, error };
}

export function hasFeature(sub: SubscriptionCheck | null, key: FeatureKey) {
  return !!sub?.features?.[key];
}