import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { BottomNav } from "./BottomNav";
import { BrandMark } from "./BrandLogo";
import { CreditsBattery } from "./CreditsBattery";
import { History, User as UserIcon } from "lucide-react";
import { useAutoTopup } from "@/lib/storage";
import { useSession, useProfile } from "@/lib/auth";

export function AppShell({
  children,
  headerRight,
  hideHeader = false,
}: {
  children: ReactNode;
  headerRight?: ReactNode;
  hideHeader?: boolean;
}) {
  useAutoTopup();
  const { user } = useSession();
  const profile = useProfile(user);
  const avatar =
    profile?.avatar_url || (user?.user_metadata?.avatar_url as string | undefined);
  return (
    <div className="relative mx-auto flex min-h-[100dvh] max-w-md flex-col">
      {!hideHeader && (
        <header className="sticky top-0 z-30 px-4 pt-[calc(env(safe-area-inset-top)+10px)] pb-2">
          <div className="glass flex items-center justify-between rounded-2xl px-3 py-2">
            <Link to="/" className="flex items-center">
              <BrandMark tagline />
            </Link>
            <div className="flex items-center gap-1.5">
              <CreditsBattery compact />
              <Link
                to="/history"
                aria-label="Chat history"
                className="glass flex h-8 w-8 items-center justify-center rounded-full text-foreground/80 transition active:scale-95"
              >
                <History className="h-4 w-4" />
              </Link>
              <Link
                to={user ? "/profile" : "/auth"}
                aria-label={user ? "Profile" : "Sign in"}
                className="glass flex h-8 w-8 items-center justify-center overflow-hidden rounded-full text-foreground/80 transition active:scale-95"
              >
                {avatar ? (
                  <img src={avatar} alt="" className="h-full w-full object-cover" />
                ) : (
                  <UserIcon className="h-4 w-4" />
                )}
              </Link>
              {headerRight}
            </div>
          </div>
        </header>
      )}
      <main className="flex-1 px-4 pb-28 pt-2">{children}</main>
      <BottomNav />
    </div>
  );
}