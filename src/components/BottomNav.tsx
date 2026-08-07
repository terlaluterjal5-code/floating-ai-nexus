import { Link, useRouterState } from "@tanstack/react-router";
import { Home, MessagesSquare, Sparkles, FileText, Crown } from "lucide-react";

const items = [
  { to: "/", label: "Home", icon: Home },
  { to: "/chat", label: "Chat", icon: MessagesSquare },
  { to: "/image", label: "Image", icon: Sparkles },
  { to: "/pdf", label: "PDF", icon: FileText },
  { to: "/premium", label: "Premium", icon: Crown },
] as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
      <div className="mx-auto max-w-md px-2">
        <div className="flex items-stretch justify-between py-1.5">
          {items.map(({ to, label, icon: Icon }) => {
            const active =
              to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);
            return (
              <Link
                key={to}
                to={to}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 transition-colors duration-200 ${
                  active ? "text-primary" : "text-muted-foreground active:text-foreground"
                }`}
              >
                <Icon className="h-[19px] w-[19px]" strokeWidth={active ? 2.2 : 1.7} />
                <span className="text-[10px] font-medium tracking-wide">{label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
