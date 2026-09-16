import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABELS, type AppRole } from "@/lib/qflow";

type NavItem = { to: string; label: string; roles: AppRole[] };

const NAV: NavItem[] = [
  { to: "/org/recepcao", label: "Receção", roles: ["rececionista", "chefe_turno", "org_admin", "super_admin"] },
  { to: "/org/gabinete", label: "Gabinete", roles: ["medico", "chefe_turno", "org_admin", "super_admin"] },
  { to: "/org/turno", label: "Turno", roles: ["chefe_turno", "org_admin", "super_admin"] },
  { to: "/org/dashboard", label: "Administração", roles: ["org_admin", "super_admin"] },
  { to: "/admin", label: "Plataforma", roles: ["super_admin"] },
];

export function AppShell({
  title,
  subtitle,
  roles,
  userName,
  primaryRole,
  actions,
  children,
}: {
  title: string;
  subtitle?: string | undefined;
  roles: AppRole[];
  userName?: string | null | undefined;
  primaryRole?: AppRole | null | undefined;
  actions?: ReactNode | undefined;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    void navigate({ to: "/login", replace: true });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-5 py-3">
          <Link to="/" className="font-display text-xl font-extrabold text-primary">
            QFlow
          </Link>
          <nav className="flex flex-wrap gap-1">
            {NAV.filter((item) => item.roles.some((r) => roles.includes(r))).map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground [&.active]:bg-accent [&.active]:text-accent-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-right text-sm leading-tight">
              <span className="block font-medium">{userName ?? "Utilizador"}</span>
              <span className="block text-xs text-muted-foreground">
                {primaryRole ? ROLE_LABELS[primaryRole] : ""}
              </span>
            </span>
            <Button variant="outline" size="sm" onClick={signOut}>
              <LogOut className="mr-1.5 size-4" /> Sair
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 py-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          {actions}
        </div>
        {children}
      </div>
    </div>
  );
}
