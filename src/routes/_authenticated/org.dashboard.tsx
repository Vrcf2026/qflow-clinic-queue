import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { OrgStats } from "@/components/org-stats";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { createTeamMember } from "@/lib/team.functions";
import { useOrgLive, useSession } from "@/hooks/use-qflow";
import { StrategyPicker } from "@/components/strategy-picker";
import { setPostStrategy, setQueueStrategy } from "@/lib/ticket-actions";
import {
  MODULE_LABELS,
  QUEUE_STRATEGY_LABELS,
  ROLE_LABELS,
  effectiveStrategy,
  isQueueStrategy,
  modules,
  priorityRatio,
  queueIds,
  tvConfig,
  waitingColor,
  type AppRole,
  type Cabinet,
  type Desk,
  type Device,
  type Modules,
  type Profile,
  type Queue,
  type TvConfig,
} from "@/lib/qflow";

export const Route = createFileRoute("/_authenticated/org/dashboard")({
  head: () => ({
    meta: [
      { title: "Administração da clínica | QFlow" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content: "Gestão de filas, balcões, gabinetes, equipa, dispositivos e painel de TV da clínica.",
      },
      { property: "og:title", content: "Administração da clínica | QFlow" },
      { property: "og:description", content: "Configure filas, equipa, dispositivos e painel de TV do QFlow." },
    ],
  }),
  component: Dashboard,
});

const TABS = [
  ["geral", "Visão geral"],
  ["estatisticas", "Estatísticas"],
  ["filas", "Filas"],
  ["balcoes", "Balcões"],
  ["gabinetes", "Gabinetes"],
  ["equipa", "Utilizadores"],
  ["dispositivos", "Dispositivos"],
  ["marca", "Personalização"],
  ["tv", "Configuração TV"],
  ["modulos", "Módulos"],
  ["config", "Configurações"],
] as const;

function Dashboard() {
  const session = useSession();
  const orgId = session.org?.id;
  const live = useOrgLive(orgId, session.dayStart);
  const mods = modules(session.org);

  const [team, setTeam] = useState<(Profile & { roles: AppRole[] })[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [brand, setBrand] = useState({ name: "", logo_url: "", primary_color: "#1a6fc4", secondary_color: "#07101f" });
  const [tv, setTv] = useState<TvConfig>(tvConfig(session.org));
  const [settings, setSettings] = useState({
    reset_time: "08:00",
    voice_lang: "pt",
    timezone: "Europe/Lisbon",
    pt: true,
    en: false,
  });
  const [newUser, setNewUser] = useState<{
    name: string;
    email: string;
    password: string;
    role: AppRole;
    deskId: string;
    cabinetId: string;
  }>({ name: "", email: "", password: "", role: "rececionista", deskId: "", cabinetId: "" });
  const [creating, setCreating] = useState(false);
  const [flow, setFlow] = useState({ skip_reinsert_after: 3, max_skips: 3, missed_recovery_minutes: 60 });
  const [newDevice, setNewDevice] = useState<{ name: string; type: "quiosque" | "tv" }>({
    name: "",
    type: "quiosque",
  });

  const loadTeam = useCallback(async () => {
    if (!orgId) return;
    const [{ data: profiles }, { data: roles }, { data: deviceRows }] = await Promise.all([
      supabase.from("profiles").select("*").eq("org_id", orgId).order("name"),
      supabase.from("user_roles").select("user_id,role").eq("org_id", orgId),
      supabase.from("devices").select("*").eq("org_id", orgId).order("created_at"),
    ]);
    setTeam(
      (profiles ?? []).map((p) => ({
        ...p,
        roles: (roles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role as AppRole),
      })),
    );
    setDevices(deviceRows ?? []);
  }, [orgId]);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

  useEffect(() => {
    const org = session.org;
    if (!org) return;
    setBrand({ name: org.name, logo_url: org.logo_url ?? "", primary_color: org.primary_color, secondary_color: org.secondary_color });
    setTv(tvConfig(org));
    const kl = (org.kiosk_languages ?? {}) as { pt?: boolean; en?: boolean };
    setSettings({
      reset_time: org.reset_time,
      voice_lang: org.voice_lang,
      timezone: org.timezone,
      pt: kl.pt !== false,
      en: !!kl.en,
    });
    setFlow({
      skip_reinsert_after: org.skip_reinsert_after,
      max_skips: org.max_skips,
      missed_recovery_minutes: org.missed_recovery_minutes,
    });
  }, [session.org]);

  const saveOrg = async (patch: Record<string, unknown>) => {
    if (!orgId) return;
    const { error } = await supabase
      .from("organizations")
      .update(patch as never)
      .eq("id", orgId);
    if (error) {
      toast.error("Não foi possível guardar.");
      return;
    }
    toast.success("Alterações guardadas.");
    session.reload();
  };

  // Queues
  const addQueue = async () => {
    if (!orgId) return;
    await supabase.from("queues").insert({
      org_id: orgId,
      name: "Nova fila",
      name_en: "New queue",
      prefix: "N",
      order: live.queues.length + 1,
    });
    live.refresh();
  };
  const patchQueue = async (id: string, patch: Partial<Queue>) => {
    await supabase.from("queues").update(patch).eq("id", id);
    live.refresh();
  };
  const removeQueue = async (id: string) => {
    await supabase.from("queues").delete().eq("id", id);
    live.refresh();
  };

  const addPlace = async (table: "desks" | "cabinets") => {
    if (!orgId) return;
    const count = (table === "desks" ? live.desks : live.cabinets).length + 1;
    await supabase
      .from(table)
      .insert({ org_id: orgId, name: table === "desks" ? `Balcão ${count}` : `Gabinete ${count}` });
    live.refresh();
  };
  const patchPlace = async (
    table: "desks" | "cabinets",
    id: string,
    patch: Partial<Desk | Cabinet>,
  ) => {
    await supabase.from(table).update(patch).eq("id", id);
    live.refresh();
  };

  const setRole = async (userId: string, role: AppRole) => {
    if (!orgId) return;
    await supabase.from("user_roles").delete().eq("user_id", userId);
    await supabase.from("user_roles").insert({ user_id: userId, org_id: orgId, role });
    await supabase.from("profiles").update({ org_id: orgId }).eq("id", userId);
    toast.success("Papel atualizado.");
    void loadTeam();
  };

  /** Cria a conta no servidor (só super_admin ou org_admin podem). */
  const createUser = async () => {
    setCreating(true);
    const result = await createTeamMember({
      data: {
        name: newUser.name.trim(),
        email: newUser.email.trim(),
        password: newUser.password,
        role: newUser.role,
        ...(newUser.deskId ? { deskId: newUser.deskId } : {}),
        ...(newUser.cabinetId ? { cabinetId: newUser.cabinetId } : {}),
      },
    }).catch(() => ({ error: "create_failed" }) as { error: string });
    setCreating(false);
    if ("error" in result && result.error) {
      toast.error(
        result.error === "forbidden"
          ? "Não tem permissão para criar contas."
          : result.error.includes("already")
            ? "Já existe uma conta com este email."
            : "Não foi possível criar a conta.",
      );
      return;
    }
    toast.success("Conta criada. A pessoa já pode entrar com estes dados.");
    setNewUser({ name: "", email: "", password: "", role: "rececionista", deskId: "", cabinetId: "" });
    void loadTeam();
  };

  const createDevice = async () => {
    if (!orgId || !newDevice.name.trim()) return;
    await supabase.from("devices").insert({
      org_id: orgId,
      name: newDevice.name.trim(),
      type: newDevice.type,
    });
    setNewDevice({ name: "", type: "quiosque" });
    void loadTeam();
  };

  const todayTickets = live.tickets;
  const stats = [
    { label: "Senhas hoje", value: todayTickets.length },
    { label: "Em espera", value: todayTickets.filter((t) => t.status === "em_espera").length },
    { label: "Atendidas", value: todayTickets.filter((t) => t.status === "concluido").length },
    { label: "Faltas", value: todayTickets.filter((t) => t.status === "faltou").length },
  ];

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <AppShell
      title="Administração da clínica"
      subtitle={session.org?.name ?? ""}
      roles={session.roles}
      userName={session.profile?.name}
      primaryRole={session.primaryRole}
    >
      <Tabs defaultValue="geral">
        <TabsList className="flex h-auto flex-wrap justify-start">
          {TABS.filter(([id]) => id !== "gabinetes" || mods.gabinetes).map(([id, label]) => (
            <TabsTrigger key={id} value={id}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Visão geral */}
        <TabsContent value="geral" className="mt-6 space-y-6">
          <div className="grid gap-4 sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="rounded-2xl border bg-card p-5">
                <p className="text-sm text-muted-foreground">{s.label}</p>
                <p className="ticket-number mt-1 text-4xl">{s.value}</p>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border bg-card p-5">
            <h2 className="text-lg font-semibold">Filas ao vivo</h2>
            <ul className="mt-4 space-y-2">
              {live.queues.map((q) => {
                const waiting = todayTickets.filter(
                  (t) => t.queue_id === q.id && t.status === "em_espera",
                ).length;
                return (
                  <li key={q.id} className="flex items-center gap-3 rounded-xl bg-muted px-4 py-3">
                    <span className="size-3 rounded-full" style={{ backgroundColor: q.color }} />
                    <span className="font-medium">{q.name}</span>
                    <span className="ml-auto text-sm text-muted-foreground">
                      média {q.avg_duration_minutes} min
                    </span>
                    <span className={`rounded-lg px-2.5 py-1 text-sm font-semibold ${waitingColor(waiting)}`}>
                      {waiting}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </TabsContent>

        {/* Estatísticas */}
        <TabsContent value="estatisticas" className="mt-6">
          <OrgStats />
        </TabsContent>

        {/* Filas */}
        <TabsContent value="filas" className="mt-6 space-y-4">
          <Button onClick={addQueue}>
            <Plus className="mr-2 size-4" /> Nova fila
          </Button>
          {live.queues.map((q) => (
            <div key={q.id} className="grid gap-3 rounded-2xl border bg-card p-4 md:grid-cols-6">
              <Field label="Nome (PT)">
                <Input
                  defaultValue={q.name}
                  onBlur={(e) => void patchQueue(q.id, { name: e.target.value })}
                />
              </Field>
              <Field label="Nome (EN)">
                <Input
                  defaultValue={q.name_en ?? ""}
                  onBlur={(e) => void patchQueue(q.id, { name_en: e.target.value })}
                />
              </Field>
              <Field label="Prefixo">
                <Input
                  defaultValue={q.prefix}
                  maxLength={3}
                  onBlur={(e) => void patchQueue(q.id, { prefix: e.target.value.toUpperCase() })}
                />
              </Field>
              <Field label="Cor">
                <Input
                  type="color"
                  defaultValue={q.color}
                  onBlur={(e) => void patchQueue(q.id, { color: e.target.value })}
                />
              </Field>
              <Field label="Duração média (min)">
                <Input
                  type="number"
                  min={1}
                  defaultValue={q.avg_duration_minutes}
                  onBlur={(e) =>
                    void patchQueue(q.id, { avg_duration_minutes: Number(e.target.value) || 10 })
                  }
                />
              </Field>
              <div className="flex items-end justify-between gap-3">
                <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                  Prioridade
                  <Switch
                    checked={q.priority_enabled}
                    onCheckedChange={(v) => void patchQueue(q.id, { priority_enabled: v })}
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                  Ativa
                  <Switch
                    checked={q.active}
                    onCheckedChange={(v) => void patchQueue(q.id, { active: v })}
                  />
                </label>
                <Button variant="ghost" size="icon" onClick={() => void removeQueue(q.id)}>
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </TabsContent>

        {/* Balcões e gabinetes */}
        {(["balcoes", "gabinetes"] as const).map((tab) => {
          const table = tab === "balcoes" ? ("desks" as const) : ("cabinets" as const);
          const rows = tab === "balcoes" ? live.desks : live.cabinets;
          return (
            <TabsContent key={tab} value={tab} className="mt-6 space-y-4">
              <Button onClick={() => void addPlace(table)}>
                <Plus className="mr-2 size-4" /> {tab === "balcoes" ? "Novo balcão" : "Novo gabinete"}
              </Button>
              {rows.map((row) => (
                <div key={row.id} className="rounded-2xl border bg-card p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Input
                      className="max-w-xs"
                      defaultValue={row.name}
                      onBlur={(e) => void patchPlace(table, row.id, { name: e.target.value })}
                    />
                    <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
                      Ativo
                      <Switch
                        checked={row.active}
                        onCheckedChange={(v) => void patchPlace(table, row.id, { active: v })}
                      />
                    </label>
                  </div>
                  <p className="mt-4 text-xs text-muted-foreground">
                    Filas servidas (a ordem define a preferência de chamada — a primeira é servida
                    primeiro).
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {queueIds(row).map((qid, i) => {
                      const ids = queueIds(row);
                      const q = live.queues.find((x) => x.id === qid);
                      if (!q) return null;
                      const move = (delta: number) => {
                        const next = [...ids];
                        const target = i + delta;
                        if (target < 0 || target >= next.length) return;
                        const a = next[i]!;
                        next[i] = next[target]!;
                        next[target] = a;
                        void patchPlace(table, row.id, { queue_ids: next });
                      };
                      return (
                        <span
                          key={qid}
                          className="flex items-center gap-1 rounded-lg bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground"
                        >
                          {i + 1}. {q.name}
                          <button aria-label="Subir" onClick={() => move(-1)} className="px-1">
                            ↑
                          </button>
                          <button aria-label="Descer" onClick={() => move(1)} className="px-1">
                            ↓
                          </button>
                        </span>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {live.queues.map((q) => {
                      const ids = queueIds(row);
                      const on = ids.includes(q.id);
                      return (
                        <button
                          key={q.id}
                          onClick={() =>
                            void patchPlace(table, row.id, {
                              queue_ids: on ? ids.filter((x) => x !== q.id) : [...ids, q.id],
                            })
                          }
                          className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                            on
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:bg-accent"
                          }`}
                        >
                          {q.name}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-4 border-t pt-3">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">
                      Regra de chamada deste {tab === "balcoes" ? "balcão" : "gabinete"}
                    </p>
                    <div className="mt-2">
                      <StrategyPicker
                        strategy={isQueueStrategy(row.queue_strategy) ? row.queue_strategy : null}
                        ratio={priorityRatio(row.priority_ratio, orgRule.ratio)}
                        allowInherit
                        compact
                        canEdit
                        inheritedLabel={QUEUE_STRATEGY_LABELS[orgRule.strategy]}
                        onSave={async (strategy, ratio) => {
                          await setPostStrategy(
                            table,
                            row.id,
                            strategy,
                            strategy === null ? null : ratio,
                          );
                          live.refresh();
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </TabsContent>
          );
        })}

        {/* Utilizadores */}
        <TabsContent value="equipa" className="mt-6 space-y-4">
          <div className="grid gap-3 rounded-2xl border bg-card p-4 md:grid-cols-3">
            <div className="md:col-span-3">
              <h2 className="text-lg font-semibold">Criar conta</h2>
              <p className="text-sm text-muted-foreground">
                Não existe registo público: as contas são criadas aqui e a pessoa entra em {origin}
                /login com o email e a palavra-passe que definir.
              </p>
            </div>
            <Field label="Nome">
              <Input value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
              />
            </Field>
            <Field label="Palavra-passe inicial (mín. 8)">
              <Input
                type="text"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
              />
            </Field>
            <Field label="Papel">
              <select
                className="rounded-lg border bg-card px-3 py-2 text-sm"
                value={newUser.role}
                onChange={(e) => setNewUser({ ...newUser, role: e.target.value as AppRole })}
              >
                {(["org_admin", "chefe_turno", "rececionista", "medico"] as AppRole[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Balcão">
              <select
                className="rounded-lg border bg-card px-3 py-2 text-sm"
                value={newUser.deskId}
                onChange={(e) => setNewUser({ ...newUser, deskId: e.target.value })}
              >
                <option value="">—</option>
                {live.desks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Gabinete">
              <select
                className="rounded-lg border bg-card px-3 py-2 text-sm"
                value={newUser.cabinetId}
                onChange={(e) => setNewUser({ ...newUser, cabinetId: e.target.value })}
              >
                <option value="">—</option>
                {live.cabinets.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="md:col-span-3">
              <Button
                onClick={createUser}
                disabled={
                  creating ||
                  newUser.name.trim().length < 2 ||
                  !newUser.email.includes("@") ||
                  newUser.password.length < 8
                }
              >
                <Plus className="mr-2 size-4" /> Criar conta
              </Button>
            </div>
          </div>
          {team.map((member) => (
            <div key={member.id} className="grid gap-3 rounded-2xl border bg-card p-4 md:grid-cols-5">
              <div>
                <p className="font-medium">{member.name || "Sem nome"}</p>
                <p className="text-sm text-muted-foreground">{member.email}</p>
              </div>
              <Field label="Papel">
                <select
                  className="rounded-lg border bg-card px-3 py-2 text-sm"
                  value={member.roles[0] ?? ""}
                  onChange={(e) => void setRole(member.id, e.target.value as AppRole)}
                >
                  <option value="">— sem acesso —</option>
                  {(["org_admin", "chefe_turno", "rececionista", "medico"] as AppRole[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Balcão">
                <select
                  className="rounded-lg border bg-card px-3 py-2 text-sm"
                  value={member.desk_id ?? ""}
                  onChange={async (e) => {
                    await supabase
                      .from("profiles")
                      .update({ desk_id: e.target.value || null })
                      .eq("id", member.id);
                    void loadTeam();
                  }}
                >
                  <option value="">—</option>
                  {live.desks.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Gabinete">
                <select
                  className="rounded-lg border bg-card px-3 py-2 text-sm"
                  value={member.cabinet_id ?? ""}
                  onChange={async (e) => {
                    await supabase
                      .from("profiles")
                      .update({ cabinet_id: e.target.value || null })
                      .eq("id", member.id);
                    void loadTeam();
                  }}
                >
                  <option value="">—</option>
                  {live.cabinets.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Conta ativa">
                <Switch
                  checked={member.active}
                  onCheckedChange={async (v) => {
                    await supabase.from("profiles").update({ active: v }).eq("id", member.id);
                    toast.success(v ? "Conta reativada." : "Conta desativada — acesso bloqueado.");
                    void loadTeam();
                  }}
                />
              </Field>
            </div>
          ))}
        </TabsContent>

        {/* Dispositivos */}
        <TabsContent value="dispositivos" className="mt-6 space-y-4">
          <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-4">
            <Field label="Nome do dispositivo">
              <Input
                value={newDevice.name}
                onChange={(e) => setNewDevice({ ...newDevice, name: e.target.value })}
              />
            </Field>
            <Field label="Tipo">
              <select
                className="rounded-lg border bg-card px-3 py-2 text-sm"
                value={newDevice.type}
                onChange={(e) =>
                  setNewDevice({ ...newDevice, type: e.target.value as "quiosque" | "tv" })
                }
              >
                <option value="quiosque">Quiosque</option>
                <option value="tv">Painel TV</option>
              </select>
            </Field>
            <Button onClick={createDevice} disabled={!newDevice.name.trim()}>
              <Plus className="mr-2 size-4" /> Criar dispositivo
            </Button>
          </div>

          {devices.map((d) => {
            const url = `${origin}/${d.type === "tv" ? "tv" : "quiosque"}?token=${d.token}`;
            return (
              <div key={d.id} className="rounded-2xl border bg-card p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-medium">{d.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {d.type === "tv" ? "Painel TV" : "Quiosque"}
                  </span>
                  <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
                    Ativo
                    <Switch
                      checked={d.active}
                      onCheckedChange={async (v) => {
                        await supabase.from("devices").update({ active: v }).eq("id", d.id);
                        void loadTeam();
                      }}
                    />
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <code className="max-w-full overflow-x-auto rounded-lg bg-muted px-3 py-2 text-xs">
                    {url}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(url);
                      toast.success("Endereço copiado.");
                    }}
                  >
                    Copiar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      await supabase
                        .from("devices")
                        .update({ token: crypto.randomUUID() })
                        .eq("id", d.id);
                      toast.success("Token revogado e substituído.");
                      void loadTeam();
                    }}
                  >
                    Revogar token
                  </Button>
                </div>
              </div>
            );
          })}
        </TabsContent>

        {/* Personalização */}
        <TabsContent value="marca" className="mt-6 space-y-6 rounded-2xl border bg-card p-5 max-w-2xl">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome da clínica">
              <Input value={brand.name} onChange={(e) => setBrand({ ...brand, name: e.target.value })} />
            </Field>
            <Field label="Logótipo">
              {brand.logo_url && (
                <div className="mb-2 flex items-center gap-3 rounded-xl border bg-muted p-2">
                  <img src={brand.logo_url} alt="Logo" className="h-10 w-auto max-w-[120px] object-contain" />
                  <button className="text-xs text-muted-foreground hover:text-destructive" onClick={() => setBrand({ ...brand, logo_url: "" })}>Remover</button>
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  value={brand.logo_url}
                  placeholder="https://… ou carregue um ficheiro"
                  onChange={(e) => setBrand({ ...brand, logo_url: e.target.value })}
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById("logo-upload-org")?.click()}
                >
                  Ficheiro
                </Button>
                <input
                  id="logo-upload-org"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file || !orgId) return;
                    const path = `logos/${orgId}-${Date.now()}-${file.name}`;
                    const { error } = await supabase.storage.from("org-assets").upload(path, file, { upsert: true });
                    if (error) { toast.error("Não foi possível carregar o logótipo."); return; }
                    const { data } = supabase.storage.from("org-assets").getPublicUrl(path);
                    setBrand({ ...brand, logo_url: data.publicUrl });
                    toast.success("Logótipo carregado.");
                  }}
                />
              </div>
            </Field>
          </div>

          <div>
            <p className="mb-3 text-sm font-medium">Cores</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Cor primária" hint="Botões, senhas, quiosque">
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={brand.primary_color}
                    onChange={(e) => setBrand({ ...brand, primary_color: e.target.value })}
                    className="h-10 w-14 cursor-pointer rounded-lg border bg-card p-1"
                  />
                  <Input
                    value={brand.primary_color}
                    onChange={(e) => setBrand({ ...brand, primary_color: e.target.value })}
                    className="font-mono text-sm"
                    maxLength={7}
                  />
                </div>
              </Field>
              <Field label="Cor secundária" hint="Fundo do painel TV">
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={brand.secondary_color}
                    onChange={(e) => setBrand({ ...brand, secondary_color: e.target.value })}
                    className="h-10 w-14 cursor-pointer rounded-lg border bg-card p-1"
                  />
                  <Input
                    value={brand.secondary_color}
                    onChange={(e) => setBrand({ ...brand, secondary_color: e.target.value })}
                    className="font-mono text-sm"
                    maxLength={7}
                  />
                </div>
              </Field>
            </div>

            {/* Pré-visualização */}
            <div className="mt-4 flex gap-3">
              <div className="flex flex-1 items-center justify-center rounded-xl py-4 text-sm font-semibold text-white" style={{ backgroundColor: brand.primary_color }}>
                Cor primária
              </div>
              <div className="flex flex-1 items-center justify-center rounded-xl py-4 text-sm font-semibold text-white" style={{ backgroundColor: brand.secondary_color }}>
                Fundo TV
              </div>
            </div>

            {/* Paletes rápidas */}
            <div className="mt-4">
              <p className="mb-2 text-xs text-muted-foreground">Paletes rápidas</p>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "Azul", primary: "#1a6fc4", secondary: "#07101f" },
                  { label: "Verde", primary: "#0e9488", secondary: "#062820" },
                  { label: "Roxo", primary: "#7c3aed", secondary: "#1a0a3a" },
                  { label: "Âmbar", primary: "#b45309", secondary: "#1a0e00" },
                  { label: "Coral", primary: "#e11d48", secondary: "#1a000a" },
                  { label: "Cinzento", primary: "#475569", secondary: "#0f172a" },
                ].map((p) => (
                  <button
                    key={p.label}
                    onClick={() => setBrand({ ...brand, primary_color: p.primary, secondary_color: p.secondary })}
                    className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
                  >
                    <span className="size-3 rounded-full" style={{ backgroundColor: p.primary }} />
                    <span className="size-3 rounded-full" style={{ backgroundColor: p.secondary }} />
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <Button
            onClick={() =>
              void saveOrg({
                name: brand.name,
                logo_url: brand.logo_url || null,
                primary_color: brand.primary_color,
                secondary_color: brand.secondary_color,
              })
            }
          >
            Guardar personalização
          </Button>
        </TabsContent>

        {/* TV */}
        <TabsContent value="tv" className="mt-6 max-w-xl space-y-4 rounded-2xl border bg-card p-5">
          <Field label="Endereço do stream (HLS)">
            <Input value={tv.stream_url} onChange={(e) => setTv({ ...tv, stream_url: e.target.value })} />
          </Field>
          <Field label="Lista de canais (M3U)">
            <Input value={tv.m3u_url} onChange={(e) => setTv({ ...tv, m3u_url: e.target.value })} />
          </Field>
          <Field label="Disposição">
            <select
              className="rounded-lg border bg-card px-3 py-2 text-sm"
              value={tv.layout}
              onChange={(e) => setTv({ ...tv, layout: e.target.value as TvConfig["layout"] })}
            >
              <option value="video_esquerda">Vídeo à esquerda, filas à direita</option>
              <option value="video_completo">Vídeo em destaque</option>
              <option value="sem_video">Apenas filas</option>
            </select>
          </Field>
          <Field label="Largura do vídeo (%)">
            <Input
              type="number"
              min={30}
              max={80}
              value={tv.video_ratio}
              onChange={(e) => setTv({ ...tv, video_ratio: Number(e.target.value) || 65 })}
            />
          </Field>
          <label className="flex items-center justify-between gap-3 text-sm">
            Silenciar vídeo durante a chamada
            <Switch
              checked={tv.silenciar_em_chamada}
              onCheckedChange={(v) => setTv({ ...tv, silenciar_em_chamada: v })}
            />
          </label>
          <Button onClick={() => void saveOrg({ tv_config: tv })}>Guardar</Button>
        </TabsContent>

        {/* Módulos */}
        <TabsContent value="modulos" className="mt-6 grid max-w-2xl gap-3 sm:grid-cols-2">
          {(Object.keys(MODULE_LABELS) as (keyof Modules)[]).map((key) => (
            <label
              key={key}
              className="flex items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3 text-sm"
            >
              {MODULE_LABELS[key]}
              <Switch
                checked={mods[key]}
                onCheckedChange={(v) => void saveOrg({ modules_enabled: { ...mods, [key]: v } })}
              />
            </label>
          ))}
        </TabsContent>

        {/* Configurações */}
        <TabsContent value="config" className="mt-6 max-w-xl space-y-4 rounded-2xl border bg-card p-5">
          <Field label="Hora do reset diário">
            <Input
              type="time"
              value={settings.reset_time}
              onChange={(e) => setSettings({ ...settings, reset_time: e.target.value })}
            />
          </Field>
          <Field label="Idioma da voz">
            <select
              className="rounded-lg border bg-card px-3 py-2 text-sm"
              value={settings.voice_lang}
              onChange={(e) => setSettings({ ...settings, voice_lang: e.target.value })}
            >
              <option value="pt">Português (pt-PT)</option>
              <option value="en">Inglês</option>
            </select>
          </Field>
          <Field label="Fuso horário">
            <Input
              value={settings.timezone}
              onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
            />
          </Field>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm">
              Quiosque em português
              <Switch
                checked={settings.pt}
                onCheckedChange={(v) => setSettings({ ...settings, pt: v })}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              Quiosque em inglês
              <Switch
                checked={settings.en}
                onCheckedChange={(v) => setSettings({ ...settings, en: v })}
              />
            </label>
          </div>
          <div className="space-y-2 border-t pt-4">
            <Label className="text-xs text-muted-foreground">
              Regra de ordenação da fila (predefinição da clínica)
            </Label>
            <StrategyPicker
              strategy={orgRule.strategy}
              ratio={orgRule.ratio}
              canEdit
              onSave={async (strategy, ratio) => {
                if (!strategy) return;
                await setQueueStrategy(strategy, ratio);
                session.reload();
                live.refresh();
              }}
            />
          </div>
          <div className="grid gap-3 border-t pt-4 sm:grid-cols-3">
            <Field label="Saltar: volta depois de N senhas">
              <Input
                type="number"
                min={1}
                max={20}
                value={flow.skip_reinsert_after}
                onChange={(e) =>
                  setFlow({ ...flow, skip_reinsert_after: Number(e.target.value) || 3 })
                }
              />
            </Field>
            <Field label="Saltos máximos antes de falta">
              <Input
                type="number"
                min={1}
                max={10}
                value={flow.max_skips}
                onChange={(e) => setFlow({ ...flow, max_skips: Number(e.target.value) || 3 })}
              />
            </Field>
            <Field label="Recuperar faltas até (min)">
              <Input
                type="number"
                min={0}
                max={480}
                value={flow.missed_recovery_minutes}
                onChange={(e) =>
                  setFlow({ ...flow, missed_recovery_minutes: Number(e.target.value) || 0 })
                }
              />
            </Field>
          </div>
          <Button
            onClick={() =>
              void saveOrg({
                ...flow,
                reset_time: settings.reset_time,
                voice_lang: settings.voice_lang,
                timezone: settings.timezone,
                kiosk_languages: { pt: settings.pt, en: settings.en },
              })
            }
          >
            Guardar
          </Button>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
