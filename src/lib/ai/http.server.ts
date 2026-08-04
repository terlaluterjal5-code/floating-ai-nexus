// Server-only HTTP/auth helpers shared by AI routes.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { FeatureKey } from "@/lib/ai/features";

export function newRequestId() {
  return Math.random().toString(36).slice(2, 10);
}

function isNewKey(v: string) {
  return v.startsWith("sb_publishable_") || v.startsWith("sb_secret_");
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

/** Structured error envelope. Never contains stack traces or secrets. */
export function errorResponse(
  status: number,
  code: string,
  message: string,
  requestId: string,
  extra: { feature?: FeatureKey | string; retryable?: boolean; retryAfterSec?: number } = {},
) {
  const headers: Record<string, string> = {};
  if (extra.retryAfterSec) headers["Retry-After"] = String(extra.retryAfterSec);
  return jsonResponse(
    status,
    {
      error: {
        code,
        message,
        ...(extra.feature ? { feature: extra.feature } : {}),
        ...(extra.retryable !== undefined ? { retryable: extra.retryable } : {}),
        request_id: requestId,
      },
    },
    headers,
  );
}

/** RLS-scoped Supabase client acting as the bearer-token user. */
export function createUserClient(url: string, key: string, token: string): SupabaseClient<Database> {
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

export type AuthContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
  geminiApiKey: string;
};

/** Validate the Supabase JWT. Returns a Response on failure. */
export async function authenticate(
  request: Request,
  requestId: string,
): Promise<AuthContext | Response> {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY)
    return errorResponse(500, "SERVER_MISCONFIG", "Backend is not configured.", requestId);
  if (!GEMINI_API_KEY)
    return errorResponse(500, "SERVER_MISCONFIG", "AI service is not configured.", requestId);

  const authHeader = request.headers.get("authorization") ?? request.headers.get("Authorization") ?? "";
  const bearerMatch = /^Bearer\s+([^\s]+)$/i.exec(authHeader.trim());
  if (!bearerMatch)
    return errorResponse(401, "UNAUTHORIZED", "Sign in to continue.", requestId);
  const token = bearerMatch[1] ?? "";

  console.log("[chat-auth-server]", {
    hasAuthorizationHeader: Boolean(authHeader),
    hasToken: Boolean(token),
    tokenLength: token.length,
    tokenPrefix: token.slice(0, 10) || null,
    supabaseUrl: SUPABASE_URL,
  });

  if (token.split(".").length !== 3) {
    console.warn(`[auth] rid=${requestId} rejected: malformed bearer token`);
    return errorResponse(401, "UNAUTHORIZED", "Your session is invalid. Please sign in again.", requestId);
  }

  const supabase = createUserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, token);

  let claims: Awaited<ReturnType<typeof supabase.auth.getClaims>>["data"] | null = null;
  let claimsErrorMessage: string | null = null;
  try {
    const result = await supabase.auth.getClaims(token);
    claims = result.data;
    claimsErrorMessage = result.error?.message ?? null;
  } catch (e) {
    claimsErrorMessage = e instanceof Error ? e.message : "JWT verification failed";
  }

  const sub = claims?.claims?.sub as string | undefined;
  console.log("[chat-auth-server-result]", {
    hasClaims: Boolean(claims?.claims),
    sub: sub ?? null,
    error: claimsErrorMessage,
  });

  if (claimsErrorMessage || !sub) {
    console.warn(`[auth] rid=${requestId} rejected: ${claimsErrorMessage ?? "no subject"}`);
    return errorResponse(401, "UNAUTHORIZED", "Your session expired. Please sign in again.", requestId);
  }
  return { supabase, userId: sub, geminiApiKey: GEMINI_API_KEY };
}

/** In-memory request dedup: rejects identical requests fired within `windowMs`. */
const inflight = new Map<string, number>();
export function claimRequest(key: string, windowMs = 4000): boolean {
  const now = Date.now();
  for (const [k, t] of inflight) if (now - t > 60_000) inflight.delete(k);
  const prev = inflight.get(key);
  if (prev && now - prev < windowMs) return false;
  inflight.set(key, now);
  return true;
}

export function hashKey(parts: (string | number | undefined | null)[]): string {
  const s = parts.filter((p) => p !== undefined && p !== null).join("|");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + ":" + s.length;
}
