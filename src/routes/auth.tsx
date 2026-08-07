import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { BrandLogo } from "@/components/BrandLogo";
import { useSession } from "@/lib/auth";
import { startGoogleSignIn, rememberRedirect } from "@/lib/oauth";
import { Sparkles, Crown, Telescope } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — FloatingSpace" },
      { name: "description", content: "Sign in to FloatingSpace to unlock a 2-day Premium trial, cloud sync, and your personal AI history." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { user, loading } = useSession();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate({ to: "/chat", replace: true });
  }, [loading, user, navigate]);

  async function google() {
    if (loading || busy) return;
    setBusy(true);
    try {
      rememberRedirect("/chat");
      const res = await startGoogleSignIn();
      if (res.error) {
        toast.error(res.error.message ?? "Sign-in failed");
        setBusy(false);
        return;
      }
      if (res.redirected) return;
      toast.success("Signed in — enjoy your 2-day Premium trial!");
      navigate({ to: "/chat", replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sign-in failed");
      setBusy(false);
    }
  }

  return (
    <AppShell hideHeader>
      <section className="relative mt-10 rounded-3xl border border-border bg-surface/60 p-6">
        <div className="flex flex-col items-center text-center">
          <BrandLogo size={48} />
          <h1 className="mt-4 text-[22px] font-semibold tracking-tight text-foreground">
            Welcome to FloatingSpace
          </h1>
          <p className="mt-1.5 text-[12.5px] text-muted-foreground">
            Sign in and unlock a{" "}
            <span className="font-semibold text-foreground">2-day Premium trial</span>
          </p>
        </div>

        <ul className="mt-6 space-y-3">
          {[
            { icon: Crown, text: "2-day Premium trial — unlimited credits" },
            { icon: Telescope, text: "Deep Research access" },
            { icon: Sparkles, text: "HD image generation & PDF analysis" },
          ].map((f) => (
            <li key={f.text} className="flex items-center gap-2.5">
              <f.icon className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} />
              <span className="text-[13px] text-foreground/90">{f.text}</span>
            </li>
          ))}
        </ul>

        <button
          onClick={google}
          disabled={loading || busy}
          className="mt-7 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white py-3.5 text-[14px] font-semibold text-black transition duration-200 active:scale-[0.99] disabled:opacity-60"
        >
          <GoogleIcon />
          {loading ? "Checking session…" : busy ? "Connecting…" : "Continue with Google"}
        </button>

        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          By continuing you accept our terms & privacy notice.
        </p>
      </section>

      <div className="mt-4 text-center">
        <Link to="/" className="text-[12px] text-muted-foreground underline-offset-4 hover:underline">
          Continue as guest
        </Link>
      </div>
    </AppShell>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.9 6.1 29.7 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.9 6.1 29.7 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.5 0 10.5-2.1 14.3-5.5l-6.6-5.4C29.6 34.9 26.9 36 24 36c-5.3 0-9.7-3.4-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.6 5.4C41.8 35 44 30 44 24c0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  );
}