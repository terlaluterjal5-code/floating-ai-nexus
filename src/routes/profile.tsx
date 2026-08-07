import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { useSession, useProfile, signOut } from "@/lib/auth";
import { useTrialEndsAt } from "@/lib/storage";
import { Crown, LogOut, Sparkles, Clock, Mail, User as UserIcon } from "lucide-react";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Your Profile — FloatingSpace" },
      { name: "description", content: "Manage your FloatingSpace account, view your Premium trial status and sign out." },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const navigate = useNavigate();
  const { user, loading } = useSession();
  const profile = useProfile(user);
  const trialEnds = useTrialEndsAt();

  const trial = useMemo(() => {
    if (!trialEnds) return { active: false, msLeft: 0 };
    const msLeft = trialEnds - Date.now();
    return { active: msLeft > 0, msLeft };
  }, [trialEnds]);

  if (!loading && !user) {
    return (
      <AppShell>
        <section className="mt-6 border border-border bg-surface/60 rounded-3xl p-6 text-center">
          <UserIcon className="mx-auto h-10 w-10 text-muted-foreground" />
          <h1 className="mt-3 text-lg font-semibold">You're not signed in</h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Sign in to unlock your 2-day Premium trial.
          </p>
          <Link
            to="/auth"
            className="mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-primary py-3 text-[14px] font-semibold text-primary-foreground"
          >
            Sign in
          </Link>
        </section>
      </AppShell>
    );
  }

  const name =
    profile?.display_name ||
    (user?.user_metadata?.full_name as string | undefined) ||
    user?.email?.split("@")[0] ||
    "FloatingSpace user";
  const email = profile?.email || user?.email || "";
  const avatar = profile?.avatar_url || (user?.user_metadata?.avatar_url as string | undefined);

  async function handleSignOut() {
    try {
      await signOut();
      toast.success("Signed out");
      navigate({ to: "/auth", replace: true });
    } catch (error) {
      console.error("[auth] Sign-out failed", {
        message: error instanceof Error ? error.message : "Unknown sign-out error",
      });
      toast.error("Could not sign out. Please try again.");
    }
  }

  return (
    <AppShell>
      <section className="relative mt-2 overflow-hidden rounded-3xl border border-border bg-surface/60 p-5">
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary opacity-10 blur-3xl"
          aria-hidden
        />
        <div className="relative flex items-center gap-3">
          <div className="relative">
            {avatar ? (
              <img
                src={avatar}
                alt={name}
                className="h-16 w-16 rounded-2xl border border-border object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-2xl font-semibold text-primary-foreground">
                {name[0]?.toUpperCase()}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[16px] font-semibold">{name}</div>
            <div className="flex items-center gap-1 truncate text-[12px] text-muted-foreground">
              <Mail className="h-3 w-3" />
              <span className="truncate">{email}</span>
            </div>
          </div>
        </div>
      </section>

      <section
        className={`relative mt-4 overflow-hidden rounded-3xl p-5 ${
          trial.active
            ? "bg-primary text-white"
            : "border border-border bg-surface/60"
        }`}
      >
        <div className="flex items-center gap-2.5">
          <div className={`rounded-xl p-2 ${trial.active ? "bg-black/25" : "bg-primary/12"}`}>
            <Crown className={`h-5 w-5 ${trial.active ? "text-white" : "text-primary"}`} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] opacity-90">
              Premium Trial
            </div>
            <div className="text-lg font-bold tracking-tight">
              {trial.active ? "Active" : "Expired"}
            </div>
          </div>
        </div>
        {trial.active ? (
          <div className="mt-3 flex items-center gap-2 text-[12.5px]">
            <Clock className="h-3.5 w-3.5" />
            <span>{formatRemaining(trial.msLeft)} left of your 2-day Premium trial</span>
          </div>
        ) : (
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            Your trial has ended. Upgrade to keep Premium benefits.
          </p>
        )}
        <Link
          to="/premium"
          className={`mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-2xl py-3 text-[13px] font-semibold transition active:scale-[0.98] ${
            trial.active
              ? "bg-black/25 text-white"
              : "bg-primary text-primary-foreground"
          }`}
        >
          <Sparkles className="h-4 w-4" />
          {trial.active ? "See Premium plan" : "Upgrade to Premium"}
        </Link>
      </section>

      <button
        onClick={handleSignOut}
        className="border border-border bg-surface/60 mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-[13px] font-medium text-foreground/90 transition active:scale-[0.98]"
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </AppShell>
  );
}

function formatRemaining(ms: number) {
  const totalMin = Math.floor(ms / 60000);
  const d = Math.floor(totalMin / (60 * 24));
  const h = Math.floor((totalMin % (60 * 24)) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}