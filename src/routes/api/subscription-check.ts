import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type FeatureValue = string | number | boolean | null;

const CACHE_SECONDS = 300;
const FREE_PLAN_CODE = "free";

function isNewKey(v: string) {
  return v.startsWith("sb_publishable_") || v.startsWith("sb_secret_");
}

function json(status: number, body: unknown, cache = false) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": cache
        ? `private, max-age=${CACHE_SECONDS}, stale-while-revalidate=60`
        : "no-store",
    },
  });
}

function jsonError(status: number, code: string, message: string, reqId: string) {
  return json(status, { error: { code, message, requestId: reqId } });
}

/** Publishable-key client acting as the signed-in user (RLS enforced). No service role key. */
function createUserClient(url: string, key: string, token: string): SupabaseClient<Database> {
  return createClient<Database>(url, key, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (isNewKey(key) && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
}

function featureValue(row: {
  value_bool: boolean | null;
  value_number: number | null;
  value_text: string | null;
}): FeatureValue {
  if (row.value_bool !== null) return row.value_bool;
  if (row.value_number !== null) return Number(row.value_number);
  if (row.value_text !== null) return row.value_text;
  return null;
}

export const Route = createFileRoute("/api/subscription-check")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const reqId = Math.random().toString(36).slice(2, 10);
        const started = Date.now();
        let step = "init";

        try {
          const SUPABASE_URL = process.env.SUPABASE_URL;
          const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
          if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
            console.error(`[subscription-check] rid=${reqId} missing Supabase env`);
            return jsonError(500, "server_misconfig", "Backend is not configured.", reqId);
          }

          step = "auth";
          const authHeader = request.headers.get("authorization") ?? "";
          if (!authHeader.startsWith("Bearer ")) {
            return jsonError(401, "unauthorized", "Missing bearer token.", reqId);
          }
          const token = authHeader.slice(7).trim();
          if (token.split(".").length !== 3) {
            return jsonError(401, "unauthorized", "Invalid bearer token.", reqId);
          }

          const supabase = createUserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, token);
          const { data: userData, error: userError } = await supabase.auth.getUser();
          if (userError || !userData?.user) {
            console.warn(`[subscription-check] rid=${reqId} auth failed: ${userError?.message ?? "no user"}`);
            return jsonError(401, "unauthorized", "Session is invalid or expired.", reqId);
          }
          const userId = userData.user.id;

          step = "load_subscription";
          const { data: sub, error: subError } = await supabase
            .from("user_subscriptions")
            .select("id, plan_id, status, current_period_end, cancel_at_period_end")
            .eq("user_id", userId)
            .maybeSingle();
          if (subError) throw Object.assign(new Error(subError.message), { step });

          step = "resolve_plan";
          let planId = sub?.plan_id ?? null;
          let status = sub?.status ?? "active";
          let periodEnd = sub?.current_period_end ?? null;
          let cancelAtPeriodEnd = sub?.cancel_at_period_end ?? false;
          let assigned = false;

          if (!planId) {
            const { data: freePlan, error: freeError } = await supabase
              .from("plans")
              .select("id")
              .eq("code", FREE_PLAN_CODE)
              .maybeSingle();
            if (freeError) throw Object.assign(new Error(freeError.message), { step });
            if (!freePlan) {
              console.error(`[subscription-check] rid=${reqId} free plan row missing`);
              return jsonError(404, "plan_not_found", "No subscription plan is configured.", reqId);
            }

            step = "assign_free_plan";
            const { error: insertError } = await supabase
              .from("user_subscriptions")
              .insert({ user_id: userId, plan_id: freePlan.id, status: "active" });
            // Ignore unique-violation races: another concurrent request created it.
            if (insertError && insertError.code !== "23505") {
              throw Object.assign(new Error(insertError.message), { step });
            }
            planId = freePlan.id;
            status = "active";
            periodEnd = null;
            cancelAtPeriodEnd = false;
            assigned = true;
          }

          step = "load_plan_features";
          const { data: plan, error: planError } = await supabase
            .from("plans")
            .select(
              "id, code, name, price_cents, currency, billing_period, plan_features(feature_key, label, value_text, value_number, value_bool)",
            )
            .eq("id", planId)
            .maybeSingle();
          if (planError) throw Object.assign(new Error(planError.message), { step });
          if (!plan) {
            console.error(`[subscription-check] rid=${reqId} plan ${planId} missing`);
            return jsonError(404, "plan_not_found", "The subscribed plan no longer exists.", reqId);
          }

          const features: Record<string, FeatureValue> = {};
          const featureLabels: Record<string, string> = {};
          for (const f of plan.plan_features ?? []) {
            features[f.feature_key] = featureValue(f);
            if (f.label) featureLabels[f.feature_key] = f.label;
          }

          console.log(
            `[subscription-check] rid=${reqId} user=${userId} plan=${plan.code} assigned=${assigned} ms=${Date.now() - started}`,
          );

          return json(
            200,
            {
              plan: plan.code,
              planName: plan.name,
              status,
              price: { amountCents: plan.price_cents, currency: plan.currency, period: plan.billing_period },
              currentPeriodEnd: periodEnd,
              cancelAtPeriodEnd,
              autoAssignedFreePlan: assigned,
              features,
              featureLabels,
              cachedFor: CACHE_SECONDS,
            },
            true,
          );
        } catch (err) {
          const e = err as Error & { step?: string };
          console.error(
            `[subscription-check] rid=${reqId} step=${e.step ?? step} ms=${Date.now() - started} error=${e.message}`,
            e.stack,
          );
          return jsonError(500, "internal_error", "Could not verify your subscription. Please try again.", reqId);
        }
      },

      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: { Allow: "GET, OPTIONS" },
        }),
    },
  },
});