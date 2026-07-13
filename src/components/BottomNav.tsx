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
    <nav className="fixed inset-x-0 bottom-0 z-40 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto max-w-md px-3 pb-3">
        <div className="glass flex items-center justify-between rounded-2xl px-2 py-2 shadow-2xl shadow-black/40">
          {items.map(({ to, label, icon: Icon }) => {
            const active =
              to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);
            return (
              <Link
                key={to}
                to={to}
                className={`relative flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 transition-all duration-200 active:scale-95 ${
                  active ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {active && (
                  <span className="absolute inset-0 rounded-xl bg-brand-gradient opacity-15" />
                )}
                <Icon
                  className={`relative h-5 w-5 transition-transform ${active ? "scale-110" : ""}`}
                  strokeWidth={active ? 2.4 : 1.8}
                />
                <span className="relative text-[9.5px] font-medium tracking-wide">{label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}