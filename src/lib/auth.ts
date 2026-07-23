import { useEffect, useState } from "react";
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

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return { session, user: session?.user ?? null, loading };
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
  await supabase.auth.signOut();
  setTrialEndsAt(null);
}