import { supabase } from "@/integrations/supabase/client";
import { initializeAuth } from "@/lib/auth";

/** Refresh when the access token expires within this window. */
const EXPIRY_SKEW_SEC = 60;

export class NotAuthenticatedError extends Error {
  constructor() {
    super("You must be signed in.");
    this.name = "NotAuthenticatedError";
  }
}

/**
 * Read the access token from the ONE shared Supabase client, refreshing it when
 * it is expired or about to expire. Never returns a stale token, and never
 * treats startup initialization as a signed-out state.
 */
export async function getFreshAccessToken(): Promise<string> {
  await initializeAuth();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    console.warn("[chat-auth] session read failed", {
      name: sessionError.name,
      message: sessionError.message,
      status: sessionError.status,
    });
    throw new NotAuthenticatedError();
  }
  let session = sessionData.session;

  console.log("[chat-auth]", {
    hasSession: Boolean(session),
    hasAccessToken: Boolean(session?.access_token),
    accessTokenLength: session?.access_token?.length ?? 0,
    userId: session?.user?.id ?? null,
    expiresAt: session?.expires_at ?? null,
  });

  const expiresAt = session?.expires_at ?? 0;
  const nearExpiry = expiresAt > 0 && expiresAt - EXPIRY_SKEW_SEC <= Math.floor(Date.now() / 1000);

  if (!session || nearExpiry) {
    console.info("[auth] token refresh attempted");
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session) {
      if (session && !nearExpiry) {
        console.warn("[auth] token refresh failed, using existing session");
      } else {
        console.warn("[auth] token refresh failed");
        throw new NotAuthenticatedError();
      }
    } else {
      console.info("[auth] token refresh succeeded");
      session = data.session;
      console.log("[chat-auth]", {
        hasSession: true,
        hasAccessToken: Boolean(session.access_token),
        accessTokenLength: session.access_token.length,
        userId: session.user.id,
        expiresAt: session.expires_at ?? null,
      });
    }
  }

  const token = session?.access_token;
  if (!token) throw new NotAuthenticatedError();
  return token;
}

async function refreshOnce(): Promise<string | null> {
  console.info("[auth] request rejected, refreshing session once");
  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session) {
    console.warn("[auth] token refresh failed");
    return null;
  }
  console.info("[auth] token refresh succeeded");
  return data.session.access_token;
}

/**
 * Authenticated fetch against this app's own API routes. Retries exactly once,
 * and only for genuine 401 authentication failures - never for 400/404/422/429/5xx.
 */
export async function authedFetch(
  input: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
): Promise<Response> {
  const token = await getFreshAccessToken();
  const send = (bearer: string) =>
    fetch(input, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${bearer}` },
    });

  const res = await send(token);
  if (res.status !== 401) return res;

  const retryToken = await refreshOnce();
  if (!retryToken) return res;
  return send(retryToken);
}
