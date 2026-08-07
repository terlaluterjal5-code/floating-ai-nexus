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
    <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-md flex-col overflow-x-hidden">
      {!hideHeader && (
        <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+12px)] backdrop-blur-xl">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <Link to="/" className="flex min-w-0 items-center">
              <BrandMark />
            </Link>
            <div className="flex shrink-0 items-center gap-1">
              <CreditsBattery compact />
              <Link
                to="/history"
                aria-label="Chat history"
                className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 hover:text-foreground active:bg-white/5"
              >
                <History className="h-[18px] w-[18px]" />
              </Link>
              <Link
                to={user ? "/profile" : "/auth"}
                aria-label={user ? "Profile" : "Sign in"}
                className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full text-muted-foreground transition-colors duration-200 hover:text-foreground active:bg-white/5"
              >
                {avatar ? (
                  <img src={avatar} alt="" className="h-7 w-7 rounded-full object-cover" />
                ) : (
                  <UserIcon className="h-[18px] w-[18px]" />
                )}
              </Link>
              {headerRight}
            </div>
          </div>
        </header>
      )}
      <main className="flex-1 px-4 pb-28 pt-3">{children}</main>
      <BottomNav />
    </div>
  );
}