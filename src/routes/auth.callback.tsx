import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { BrandLogo } from "@/components/BrandLogo";
import { supabase } from "@/integrations/supabase/client";
import { takeRedirect } from "@/lib/oauth";

export const Route = createFileRoute("/auth/callback")({
  // Session lives in localStorage; this page is browser-only by nature.
  ssr: false,
  head: () => ({
    meta: [
      { title: "Signing in — FloatingSpace" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("Completing sign-in…");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const url = new URL(window.location.href);
      const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
      const errorDescription =
        url.searchParams.get("error_description") ?? hash.get("error_description");

      if (errorDescription) {
        console.error("[auth.callback] OAuth provider returned an error", {
          message: errorDescription,
        });
        setMessage(errorDescription);
        toast.error(errorDescription);
        navigate({ to: "/auth", replace: true });
        return;
      }

      // Listen before exchanging so the SIGNED_IN event cannot be missed.
      let eventSession = null as Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"];
      const { data: authSubscription } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
          eventSession = session;
        }
      });

      // PKCE: exchange ?code= using the same singleton browser client used by the app.
      const code = url.searchParams.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          // detectSessionInUrl may have completed the same exchange first. Only fail
          // after checking whether that automatic exchange persisted a session.
          const existing = (await supabase.auth.getSession()).data.session;
          if (!existing) {
            console.error("[auth.callback] PKCE exchange failed", {
              name: error.name,
              message: error.message,
              status: error.status,
            });
            authSubscription.subscription.unsubscribe();
            setMessage(error.message);
            toast.error("Sign-in could not be completed. Please try again.");
            navigate({ to: "/auth", replace: true });
            return;
          }
          eventSession = existing;
        }
      }

      // Implicit flow tokens arrive in the hash.
      const access_token = hash.get("access_token");
      const refresh_token = hash.get("refresh_token");
      if (access_token && refresh_token) {
        const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
        if (error) {
          console.error("[auth.callback] OAuth session persistence failed", {
            name: error.name,
            message: error.message,
            status: error.status,
          });
          authSubscription.subscription.unsubscribe();
          toast.error("Sign-in could not be completed. Please try again.");
          navigate({ to: "/auth", replace: true });
          return;
        }
        eventSession = data.session;
      }

      if (!code && !access_token && !eventSession) {
        console.warn("[auth.callback] Callback arrived without an authorization code or session tokens");
      }

      // Confirm the session can be read back from the shared client's persistent
      // storage before leaving this public callback route.
      let session = eventSession ?? (await supabase.auth.getSession()).data.session;
      for (let i = 0; i < 30 && !session; i++) {
        await new Promise((resolve) => window.setTimeout(resolve, 100));
        session = eventSession ?? (await supabase.auth.getSession()).data.session;
      }
      authSubscription.subscription.unsubscribe();
      if (cancelled) return;

      // Clean the tokens/code out of the URL before moving on.
      window.history.replaceState({}, "", window.location.pathname);

      if (!session) {
        console.error("[auth.callback] No persisted session was available after OAuth completion", {
          hadCode: Boolean(code),
          hadHashTokens: Boolean(access_token && refresh_token),
        });
        toast.error("Sign-in could not be completed. Please try again.");
        navigate({ to: "/auth", replace: true });
        return;
      }

      toast.success("Signed in — welcome back!");
      navigate({ to: takeRedirect("/chat"), replace: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <AppShell hideHeader>
      <section className="mt-10 flex flex-col items-center justify-center rounded-3xl glass p-8 text-center">
        <BrandLogo size={48} />
        <h1 className="mt-4 text-lg font-semibold tracking-tight">
          <span className="text-gradient">FloatingSpace</span>
        </h1>
        <p className="mt-2 text-[12.5px] text-muted-foreground">{message}</p>
      </section>
    </AppShell>
  );
}