import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ChartCard, OrgStats as OrgStatsPanel } from "@/components/org-stats";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { createTeamMember } from "@/lib/team.functions";
import { useSession } from "@/hooks/use-qflow";
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";

import { MODULE_LABELS, modules, type Device, type Modules, type Org } from "@/lib/qflow";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Plataforma | QFlow" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Gestão global das clínicas, módulos e dispositivos da plataforma QFlow." },
      { property: "og:title", content: "Plataforma | QFlow" },
      { property: "og:description", content: "Criar clínicas, ativar módulos e ver estatísticas globais." },
    ],
  }),
  component: SuperAdmin,
});

type OrgStats = Record<string, number>;

type Platform = {
  totals?: { orgs: number; devices: number; users: number; tickets: number };
  by_org?: { name: string; plan: string; tickets: number; missed: number }[];
  by_day?: { day: string; tickets: number }[];
};

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function SuperAdmin() {
  const session = useSession();
  const isSuper = session.roles.includes("super_admin");
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [stats, setStats] = useState<OrgStats>({});
  const [newOrg, setNewOrg] = useState({ name: "", slug: "" });
  const [platform, setPlatform] = useState<Platform>({});
  const [detailOrg, setDetailOrg] = useState<string | null>(null);
  const [orgAdmin, setOrgAdmin] = useState<{ org: string; name: string; email: string; password: string }>({
    org: "",
    name: "",
    email: "",
    password: "",
  });

  /** Cria o administrador de uma clínica (validado no servidor). */
  const createOrgAdmin = async (orgId: string) => {
    const result = await createTeamMember({
      data: {
        name: orgAdmin.name.trim(),
        email: orgAdmin.email.trim(),
        password: orgAdmin.password,
        role: "org_admin",
        orgId,
      },
    }).catch(() => ({ error: "create_failed" }) as { error: string });
    if ("error" in result && result.error) {
      toast.error(
        result.error.includes("already")
          ? "Já existe uma conta com este email."
          : "Não foi possível criar a conta.",
      );
      return;
    }
    toast.success("Administrador da clínica criado.");
    setOrgAdmin({ org: "", name: "", email: "", password: "" });
  };

  const load = useCallback(async () => {
    const [{ data: orgRows }, { data: deviceRows }, { data: ticketRows }] = await Promise.all([
      supabase.from("organizations").select("*").order("created_at"),
      supabase.from("devices").select("*"),
      supabase
        .from("tickets")
        .select("id,org_id")
        .gte("created_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
    ]);
    setOrgs(orgRows ?? []);
    setDevices(deviceRows ?? []);
    const counts: OrgStats = {};
    for (const t of ticketRows ?? []) counts[t.org_id] = (counts[t.org_id] ?? 0) + 1;
    setStats(counts);

    // Estatísticas globais dos últimos 30 dias, calculadas no servidor.
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 29);
    const { data: pf } = await supabase.rpc("platform_stats", {
      p_from: isoDate(from),
      p_to: isoDate(to),
    });
    setPlatform((pf ?? {}) as Platform);
  }, []);

  useEffect(() => {
    if (isSuper) void load();
  }, [isSuper, load]);

  const createOrg = async () => {
    const slug =
      newOrg.slug.trim() ||
      newOrg.name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    const { error } = await supabase
      .from("organizations")
      .insert({ name: newOrg.name.trim(), slug });
    if (error) {
      toast.error("Não foi possível criar a clínica.");
      return;
    }
    setNewOrg({ name: "", slug: "" });
    toast.success("Clínica criada.");
    void load();
  };

  const toggleModule = async (org: Org, key: keyof Modules, value: boolean) => {
    const next = { ...modules(org), [key]: value };
    await supabase.from("organizations").update({ modules_enabled: next }).eq("id", org.id);
    void load();
  };

  if (!session.loading && !isSuper) {
    return (
      <AppShell
        title="Plataforma"
        roles={session.roles}
        userName={session.profile?.name}
        primaryRole={session.primaryRole}
      >
        <p className="text-muted-foreground">
          Esta área é reservada aos administradores da plataforma.
        </p>
      </AppShell>
    );
  }

  const totalToday = Object.values(stats).reduce((a, b) => a + b, 0);

  return (
    <AppShell
      title="Gestão da plataforma"
      subtitle={`${orgs.length} clínica(s) · ${totalToday} senha(s) hoje`}
      roles={session.roles}
      userName={session.profile?.name}
      primaryRole={session.primaryRole}
    >
      <div className="grid gap-6">
        <section className="grid gap-4 sm:grid-cols-3">
          {[
            { label: "Clínicas ativas", value: platform.totals?.orgs ?? orgs.length },
            { label: "Senhas (30 dias)", value: platform.totals?.tickets ?? totalToday },
            { label: "Dispositivos ativos", value: platform.totals?.devices ?? devices.length },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border bg-card p-5">
              <p className="text-sm text-muted-foreground">{s.label}</p>
              <p className="ticket-number mt-1 text-4xl">{s.value}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <ChartCard title="Senhas por dia (todas as clínicas)">
            <LineChart data={platform.by_day ?? []}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="day" fontSize={11} tickMargin={6} />
              <YAxis fontSize={11} allowDecimals={false} />
              <Tooltip />
              <Line type="monotone" dataKey="tickets" stroke="var(--color-primary)" strokeWidth={2} />
            </LineChart>
          </ChartCard>
          <ChartCard title="Senhas por clínica (30 dias)">
            <BarChart data={platform.by_org ?? []}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="name" fontSize={11} tickMargin={6} />
              <YAxis fontSize={11} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="tickets" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
              <Bar dataKey="missed" fill="var(--color-destructive)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ChartCard>
        </section>

        <section className="rounded-2xl border bg-card p-5">
          <h2 className="text-lg font-semibold">Nova clínica</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-[2fr_2fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="orgname">Nome</Label>
              <Input
                id="orgname"
                value={newOrg.name}
                onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="orgslug">Endereço curto (opcional)</Label>
              <Input
                id="orgslug"
                value={newOrg.slug}
                onChange={(e) => setNewOrg({ ...newOrg, slug: e.target.value })}
              />
            </div>
            <Button className="self-end" disabled={!newOrg.name.trim()} onClick={createOrg}>
              <Plus className="mr-2 size-4" /> Criar
            </Button>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Clínicas</h2>
          {orgs.map((org) => {
            const mods = modules(org);
            return (
              <article key={org.id} className="rounded-2xl border bg-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold">{org.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {org.slug} · plano {org.plan} · {stats[org.id] ?? 0} senha(s) hoje
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">
                      {devices.filter((d) => d.org_id === org.id).length} dispositivo(s)
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setOrgAdmin(
                          orgAdmin.org === org.id
                            ? { org: "", name: "", email: "", password: "" }
                            : { org: org.id, name: "", email: "", password: "" },
                        )
                      }
                    >
                      {orgAdmin.org === org.id ? "Cancelar" : "Criar administrador"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDetailOrg(detailOrg === org.id ? null : org.id)}
                    >
                      {detailOrg === org.id ? "Fechar estatísticas" : "Ver estatísticas"}
                    </Button>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {(Object.keys(MODULE_LABELS) as (keyof Modules)[]).map((key) => (
                    <label key={key} className="flex items-center justify-between gap-3 rounded-xl bg-muted px-3 py-2 text-sm">
                      {MODULE_LABELS[key]}
                      <Switch
                        checked={mods[key]}
                        onCheckedChange={(v) => void toggleModule(org, key, v)}
                      />
                    </label>
                  ))}
                </div>
                {orgAdmin.org === org.id && (
                  <div className="mt-4 grid gap-3 rounded-xl bg-muted p-4 sm:grid-cols-4">
                    <Input
                      placeholder="Nome"
                      value={orgAdmin.name}
                      onChange={(e) => setOrgAdmin({ ...orgAdmin, name: e.target.value })}
                    />
                    <Input
                      placeholder="Email"
                      type="email"
                      value={orgAdmin.email}
                      onChange={(e) => setOrgAdmin({ ...orgAdmin, email: e.target.value })}
                    />
                    <Input
                      placeholder="Palavra-passe (mín. 8)"
                      value={orgAdmin.password}
                      onChange={(e) => setOrgAdmin({ ...orgAdmin, password: e.target.value })}
                    />
                    <Button
                      disabled={
                        orgAdmin.name.trim().length < 2 ||
                        !orgAdmin.email.includes("@") ||
                        orgAdmin.password.length < 8
                      }
                      onClick={() => void createOrgAdmin(org.id)}
                    >
                      Criar conta
                    </Button>
                  </div>
                )}
                {detailOrg === org.id && (
                  <div className="mt-5 border-t pt-5">
                    <OrgStatsPanel orgId={org.id} />
                  </div>
                )}
              </article>
            );
          })}
        </section>

        <section className="rounded-2xl border bg-card p-5">
          <h2 className="text-lg font-semibold">Dispositivos (todas as clínicas)</h2>
          <ul className="mt-4 divide-y">
            {devices.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span className="font-medium">{d.name}</span>
                <span className="text-muted-foreground">
                  {d.type === "tv" ? "Painel TV" : "Quiosque"} ·{" "}
                  {orgs.find((o) => o.id === d.org_id)?.name ?? "—"}
                </span>
                <span className={d.active ? "text-success" : "text-destructive"}>
                  {d.active ? "Ativo" : "Revogado"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
