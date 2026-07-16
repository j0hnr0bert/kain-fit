import { Link, useLocation } from "@tanstack/react-router";
import { Home, CalendarDays, User } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { to: "/today", label: "Today", icon: Home },
  { to: "/history", label: "History", icon: CalendarDays },
  { to: "/profile", label: "Profile", icon: User },
] as const;

export function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="max-w-md mx-auto flex items-center justify-around">
        {tabs.map((t) => {
          const active = pathname.startsWith(t.to);
          const Icon = t.icon;
          return (
            <Link
              key={t.to}
              to={t.to}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-1 py-3 min-h-[56px]",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 1.8} />
              <span className={cn("text-[11px] font-medium", active && "font-semibold")}>
                {t.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}