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
  const headers: Record<string, string> = { "X-Request-Id": requestId };
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
export function createUserClient(
  url: string,
  key: string,
  token: string,
): SupabaseClient<Database> {
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

function hostnameOf(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "invalid";
  }
}

function tokenIssuerHostname(token: string): string | null {
  try {
    const encoded = token.split(".")[1];
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as { iss?: unknown };
    return typeof payload.iss === "string" ? hostnameOf(payload.iss) : null;
  } catch {
    return null;
  }
}

/** Validate the Supabase JWT. Returns a Response on failure. */
export async function authenticate(
  request: Request,
  requestId: string,
): Promise<AuthContext | Response> {
  const serverUrl = process.env.SUPABASE_URL;
  const serverKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const browserUrl = process.env.VITE_SUPABASE_URL;
  const browserKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if ((!serverUrl || !serverKey) && (!browserUrl || !browserKey))
    return errorResponse(500, "SERVER_MISCONFIG", "Backend is not configured.", requestId);
  if (!GEMINI_API_KEY)
    return errorResponse(500, "SERVER_MISCONFIG", "AI service is not configured.", requestId);

  const authHeader =
    request.headers.get("authorization") ?? request.headers.get("Authorization") ?? "";
  const bearerMatch = /^Bearer\s+([^\s]+)$/i.exec(authHeader.trim());
  if (!bearerMatch) return errorResponse(401, "UNAUTHORIZED", "Sign in to continue.", requestId);
  const token = bearerMatch[1] ?? "";
  if (token.split(".").length !== 3) {
    console.warn("[chat-auth-server]", {
      requestId,
      hasAuthorizationHeader: Boolean(authHeader),
      projectHostname: serverUrl ? hostnameOf(serverUrl) : null,
      verificationResult: "malformed_token",
      status: 401,
      errorCategory: "authentication",
    });
    return errorResponse(
      401,
      "UNAUTHORIZED",
      "Your session is invalid. Please sign in again.",
      requestId,
    );
  }

  const issuerHostname = tokenIssuerHostname(token);
  const serverHostname = serverUrl ? hostnameOf(serverUrl) : null;
  const browserHostname = browserUrl ? hostnameOf(browserUrl) : null;
  const useBrowserPair = Boolean(
    issuerHostname && browserHostname === issuerHostname && browserUrl && browserKey,
  );
  const supabaseUrl = useBrowserPair ? browserUrl : serverUrl;
  const supabaseKey = useBrowserPair ? browserKey : serverKey;
  const configuredHostname = supabaseUrl ? hostnameOf(supabaseUrl) : "missing";

  if (!supabaseUrl || !supabaseKey || (issuerHostname && issuerHostname !== configuredHostname)) {
    console.error("[chat-auth-server]", {
      requestId,
      hasAuthorizationHeader: true,
      projectHostname: serverHostname,
      verificationResult: "project_mismatch",
      status: 500,
      errorCategory: "configuration",
    });
    return errorResponse(
      500,
      "AUTH_PROJECT_MISMATCH",
      "Authentication is temporarily misconfigured. Please try again later.",
      requestId,
      { retryable: false },
    );
  }

  const supabase = createUserClient(supabaseUrl, supabaseKey, token);

  let authenticatedUserId: string | null = null;
  let verificationError: string | null = null;
  try {
    // getUser performs authoritative verification against the configured Auth
    // server and avoids treating local/JWKS verification failures as expiry.
    const result = await supabase.auth.getUser(token);
    authenticatedUserId = result.data.user?.id ?? null;
    verificationError = result.error?.message ?? null;
  } catch (e) {
    verificationError = e instanceof Error ? e.message : "JWT verification failed";
  }

  console.log("[chat-auth-server-result]", {
    requestId,
    hasAuthorizationHeader: true,
    projectHostname: configuredHostname,
    verificationResult: authenticatedUserId ? "accepted" : "rejected",
    authenticatedUserId,
    status: authenticatedUserId ? 200 : 401,
    errorCategory: authenticatedUserId ? null : "authentication",
  });

  if (verificationError || !authenticatedUserId) {
    return errorResponse(
      401,
      "UNAUTHORIZED",
      "Your session expired. Please sign in again.",
      requestId,
    );
  }
  return { supabase, userId: authenticatedUserId, geminiApiKey: GEMINI_API_KEY };
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
