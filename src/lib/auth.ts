import { useEffect, useState, useSyncExternalStore } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { setTrialEndsAt } from "@/lib/storage";

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  trial_ends_at: string;
};

type AuthSnapshot = {
  session: Session | null;
  user: User | null;
  status: "initializing" | "authenticated" | "unauthenticated";
  loading: boolean;
  error: string | null;
};

const serverAuthSnapshot: AuthSnapshot = {
  session: null,
  user: null,
  status: "initializing",
  loading: true,
  error: null,
};
let authSnapshot = serverAuthSnapshot;
let authStarted = false;
let authRevision = 0;
let authInitialization: Promise<AuthSnapshot> | null = null;
const authListeners = new Set<() => void>();

function publishAuth(session: Session | null, status: AuthSnapshot["status"], error: string | null = null) {
  authSnapshot = {
    session,
    user: session?.user ?? null,
    status,
    loading: status === "initializing",
    error,
  };
  authListeners.forEach((listener) => listener());
}

export function initializeAuth(): Promise<AuthSnapshot> {
  if (typeof window === "undefined") return Promise.resolve(serverAuthSnapshot);
  if (authInitialization) return authInitialization;

  authStarted = true;

  // The application's only auth listener is installed before the persistent
  // session read, so a concurrent SIGNED_IN event cannot be missed.
  supabase.auth.onAuthStateChange((event, session) => {
    if (event !== "INITIAL_SESSION" && event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "TOKEN_REFRESHED" && event !== "USER_UPDATED") return;
    if (event === "INITIAL_SESSION" && !session && authSnapshot.session) return;
    authRevision += 1;
    publishAuth(session, session ? "authenticated" : "unauthenticated");
  });

  const readRevision = authRevision;
  authInitialization = supabase.auth.getSession().then(({ data, error }) => {
    // Never let an older null storage read overwrite a newer auth event.
    if (readRevision !== authRevision) return authSnapshot;
    if (error) {
      console.error("[auth] Session initialization failed", {
        name: error.name,
        message: error.message,
        status: error.status,
      });
      publishAuth(null, "unauthenticated", error.message);
      return authSnapshot;
    }
    publishAuth(data.session, data.session ? "authenticated" : "unauthenticated");
    return authSnapshot;
  }).catch((error: unknown) => {
    if (readRevision !== authRevision) return authSnapshot;
    const message = error instanceof Error ? error.message : "Unknown auth initialization error";
    console.error("[auth] Session initialization failed", { message });
    publishAuth(null, "unauthenticated", message);
    return authSnapshot;
  });

  return authInitialization;
}

function startAuthState() {
  if (authStarted || typeof window === "undefined") return;
  void initializeAuth();
}

function subscribeAuth(listener: () => void) {
  authListeners.add(listener);
  startAuthState();
  return () => {
    authListeners.delete(listener);
  };
}

export function useSession() {
  return useSyncExternalStore(subscribeAuth, () => authSnapshot, () => serverAuthSnapshot);
}

export function useProfile(user: User | null) {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    if (!user) {
      setProfile(null);
      setTrialEndsAt(null);
      return;
    }
    let mounted = true;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id,email,display_name,avatar_url,trial_ends_at")
        .eq("id", user.id)
        .maybeSingle();
      if (!mounted) return;
      if (data) {
        setProfile(data as Profile);
        setTrialEndsAt(new Date(data.trial_ends_at).getTime());
      }
    })();
    return () => {
      mounted = false;
    };
  }, [user?.id]);
  return profile;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  authRevision += 1;
  publishAuth(null, "unauthenticated");
  setTrialEndsAt(null);
}