import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { BrandLogo } from "@/components/BrandLogo";
import { supabase } from "@/integrations/supabase/client";
import { initializeAuth } from "@/lib/auth";
import { configureSharedAuthForPkce, takeRedirect } from "@/lib/oauth";

let callbackCompletion: { key: string; promise: Promise<void> } | null = null;

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
  const callbackUrlRef = useRef<URL | null>(null);

  // Preserve callback parameters across renders. Keep the URL intact until a
  // persisted session has been verified successfully.
  if (!callbackUrlRef.current) {
    callbackUrlRef.current = new URL(window.location.href);
    configureSharedAuthForPkce();
  }

  useEffect(() => {
    const complete = async () => {
      const url = callbackUrlRef.current;
      if (!url) {
        console.error("[auth.callback] Callback URL could not be initialized");
        toast.error("Sign-in could not be completed. Please try again.");
        setMessage("Sign-in could not be completed. Please return to sign in and try again.");
        return;
      }
      const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
      const errorDescription =
        url.searchParams.get("error_description") ?? hash.get("error_description");

      if (errorDescription) {
        console.error("[auth.callback] OAuth provider returned an error", {
          message: errorDescription,
        });
        setMessage(errorDescription);
        toast.error(errorDescription);
        return;
      }

      // Initialize the one shared client, then exchange the PKCE code exactly
      // once through that same instance.
      await initializeAuth();
      let session = (await supabase.auth.getSession()).data.session;
      const code = url.searchParams.get("code");
      if (!session && code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          const existing = (await supabase.auth.getSession()).data.session;
          if (!existing) {
            console.error("[auth.callback] PKCE exchange failed", {
              name: error.name,
              message: error.message,
              status: error.status,
            });
            setMessage(error.message);
            toast.error("Sign-in could not be completed. Please try again.");
            return;
          }
          session = existing;
        } else {
          session = data.session;
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
          toast.error("Sign-in could not be completed. Please try again.");
          setMessage("Sign-in could not be completed. Please return to sign in and try again.");
          return;
        }
        session = data.session;
      }

      if (!code && !access_token && !session) {
        console.warn("[auth.callback] Callback arrived without an authorization code or session tokens");
      }

      // Confirm the session can be read back from persistent storage before
      // clearing the callback URL or entering a protected route.
      session = session ?? (await supabase.auth.getSession()).data.session;
      for (let i = 0; i < 30 && !session; i++) {
        await new Promise((resolve) => window.setTimeout(resolve, 100));
        session = (await supabase.auth.getSession()).data.session;
      }
      if (!session) {
        console.error("[auth.callback] No persisted session was available after OAuth completion", {
          hadCode: Boolean(code),
          hadHashTokens: Boolean(access_token && refresh_token),
        });
        toast.error("Sign-in could not be completed. Please try again.");
        setMessage("Sign-in could not be completed. Please return to sign in and try again.");
        return;
      }

      window.history.replaceState({}, "", window.location.pathname);
      toast.success("Signed in — welcome back!");
      navigate({ to: takeRedirect("/chat"), replace: true });
    };

    // React Strict Mode or a remount must never consume the same code twice,
    // while a later login attempt with a new callback URL must still run.
    const callbackKey = callbackUrlRef.current?.href ?? window.location.href;
    if (!callbackCompletion || callbackCompletion.key !== callbackKey) {
      callbackCompletion = { key: callbackKey, promise: complete() };
    }
    void callbackCompletion.promise;
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