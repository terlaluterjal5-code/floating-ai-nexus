import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

type PkceCapableAuthClient = typeof supabase.auth & {
  flowType: "pkce" | "implicit";
  detectSessionInUrl: boolean;
};

/**
 * The generated singleton defaults to implicit flow, while the custom-domain
 * callback exchanges an authorization code. Configure that same singleton for
 * PKCE before either sign-in or callback initialization; do not create another
 * client with separate storage.
 */
export function configureSharedAuthForPkce() {
  const auth = supabase.auth as PkceCapableAuthClient;
  auth.flowType = "pkce";
  // The callback route performs the exchange explicitly. Disabling automatic
  // URL detection prevents the same one-time code being consumed twice.
  auth.detectSessionInUrl = false;
}

/** Public, same-origin callback path. Must exist as a route in src/routes. */
export const AUTH_CALLBACK_PATH = "/auth/callback";
const REDIRECT_KEY = "fs:auth:redirect";

export function authCallbackUrl(): string {
  return `${window.location.origin}${AUTH_CALLBACK_PATH}`;
}

/** Lovable's OAuth broker proxy (/~oauth/*) only exists on Lovable-served hosts. */
export function isLovableHost(hostname = window.location.hostname): boolean {
  return (
    hostname.endsWith(".lovable.app") ||
    hostname.endsWith(".lovableproject.com") ||
    hostname === "localhost" ||
    hostname === "127.0.0.1"
  );
}

/** Remember a sanitized same-origin destination to use after the session exists. */
export function rememberRedirect(path: string) {
  if (typeof sessionStorage === "undefined") return;
  if (!path.startsWith("/") || path.startsWith("//")) return;
  sessionStorage.setItem(REDIRECT_KEY, path);
}

export function takeRedirect(fallback = "/chat"): string {
  if (typeof sessionStorage === "undefined") return fallback;
  const stored = sessionStorage.getItem(REDIRECT_KEY);
  sessionStorage.removeItem(REDIRECT_KEY);
  if (!stored || !stored.startsWith("/") || stored.startsWith("//")) return fallback;
  if (stored.startsWith(AUTH_CALLBACK_PATH) || stored.startsWith("/auth")) return fallback;
  return stored;
}

export type OAuthStart = { redirected: boolean; error?: Error };

/**
 * Starts Google sign-in.
 * - Lovable-served hosts keep the managed broker flow (iframe/preview safe).
 * - Custom production domains use Supabase PKCE directly, which returns via the
 *   Supabase callback and then back to `${origin}/auth/callback`.
 */
export async function startGoogleSignIn(): Promise<OAuthStart> {
  const redirectTo = authCallbackUrl();

  if (isLovableHost()) {
    const res = await lovable.auth.signInWithOAuth("google", { redirect_uri: redirectTo });
    if (res.error) return { redirected: false, error: res.error as Error };
    return { redirected: Boolean(res.redirected) };
  }

  configureSharedAuthForPkce();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, queryParams: { prompt: "select_account" } },
  });
  if (error) return { redirected: false, error };
  return { redirected: true };
}