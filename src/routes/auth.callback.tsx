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
        setMessage(errorDescription);
        toast.error(errorDescription);
        navigate({ to: "/auth", replace: true });
        return;
      }

      // PKCE: exchange ?code= for a persisted session.
      const code = url.searchParams.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error && !/code verifier|both auth code/i.test(error.message)) {
          setMessage(error.message);
          toast.error(error.message);
          navigate({ to: "/auth", replace: true });
          return;
        }
      }

      // Implicit flow tokens arrive in the hash.
      const access_token = hash.get("access_token");
      const refresh_token = hash.get("refresh_token");
      if (access_token && refresh_token) {
        await supabase.auth.setSession({ access_token, refresh_token });
      }

      // Wait briefly for the session to be readable (detectSessionInUrl may race us).
      let session = (await supabase.auth.getSession()).data.session;
      for (let i = 0; i < 20 && !session; i++) {
        await new Promise((r) => setTimeout(r, 150));
        session = (await supabase.auth.getSession()).data.session;
      }
      if (cancelled) return;

      // Clean the tokens/code out of the URL before moving on.
      window.history.replaceState({}, "", window.location.pathname);

      if (!session) {
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