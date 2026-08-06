import { supabase } from "@/integrations/supabase/client";
import { initializeAuth } from "@/lib/auth";

/** Refresh when the access token expires within this window. */
const EXPIRY_SKEW_SEC = 60;

let refreshInFlight: Promise<string | null> | null = null;

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

  const expiresAt = session?.expires_at ?? 0;
  const nearExpiry = expiresAt > 0 && expiresAt - EXPIRY_SKEW_SEC <= Math.floor(Date.now() / 1000);

  if (!session) throw new NotAuthenticatedError();

  if (nearExpiry) {
    const refreshedToken = await refreshOnce();
    if (!refreshedToken) throw new NotAuthenticatedError();
    return refreshedToken;
  }

  const token = session.access_token;
  if (!token) throw new NotAuthenticatedError();
  return token;
}

async function refreshOnce(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = supabase.auth
      .refreshSession()
      .then(({ data, error }) => (error ? null : data.session?.access_token ?? null))
      .catch(() => null)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
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
  if (!retryToken) throw new NotAuthenticatedError();
  return send(retryToken);
}
