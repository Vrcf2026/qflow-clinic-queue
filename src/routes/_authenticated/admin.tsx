import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Upload } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { AuditLog } from "@/components/audit-log";
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

type NewOrg = {
  name: string;
  slug: string;
  plan: "starter" | "pro" | "enterprise";
  primary_color: string;
  secondary_color: string;
  logo_url: string;
  voice_lang: string;
  timezone: string;
  reset_time: string;
  kiosk_en: boolean;
  modules: Modules;
  // primeiro admin
  admin_name: string;
  admin_email: string;
  admin_password: string;
};

const DEFAULT_MODULES: Modules = {
  kiosk: true,
  tv: true,
  recepcao: true,
  gabinetes: false,
  iptv: false,
  sms: false,
  prioritarios: true,
  multi_balcao: false,
};

const PLANS = [
  { value: "starter", label: "Starter" },
  { value: "pro", label: "Pro" },
  { value: "enterprise", label: "Enterprise" },
];

const TIMEZONES = [
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Paris",
  "America/Sao_Paulo",
  "America/New_York",
];

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function ColorSwatch({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="size-5 rounded-full border" style={{ backgroundColor: color }} />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function LogoUploader({
  value,
  orgId,
  onChange,
}: {
  value: string;
  orgId?: string;
  onChange: (url: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    const path = `logos/${orgId ?? "new"}-${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("org-assets").upload(path, file, { upsert: true });
    if (error) {
      toast.error("Não foi possível carregar o logótipo.");
      setUploading(false);
      return;
    }
    const { data } = supabase.storage.from("org-assets").getPublicUrl(path);
    onChange(data.publicUrl);
    setUploading(false);
    toast.success("Logótipo carregado.");
  };

  return (
    <div className="flex flex-col gap-2">
      {value && (
        <div className="flex items-center gap-3 rounded-xl border bg-muted p-3">
          <img src={value} alt="Logo" className="h-10 w-auto max-w-[120px] object-contain" />
          <Button variant="ghost" size="sm" onClick={() => onChange("")}>
            Remover
          </Button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          placeholder="https://... ou carregue um ficheiro"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1"
        />
        <Button
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => ref.current?.click()}
        >
          <Upload className="mr-2 size-4" />
          {uploading ? "A carregar…" : "Ficheiro"}
        </Button>
        <input
          ref={ref}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Formulário de nova clínica — expandido e completo
// ──────────────────────────────────────────────────────────────
function NewOrgForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<NewOrg>({
    name: "",
    slug: "",
    plan: "starter",
    primary_color: "#1a6fc4",
    secondary_color: "#07101f",
    logo_url: "",
    voice_lang: "pt",
    timezone: "Europe/Lisbon",
    reset_time: "08:00",
    kiosk_en: false,
    modules: { ...DEFAULT_MODULES },
    admin_name: "",
    admin_email: "",
    admin_password: "",
  });

  const set = <K extends keyof NewOrg>(k: K, v: NewOrg[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const setMod = (k: keyof Modules, v: boolean) =>
    setForm((f) => ({ ...f, modules: { ...f.modules, [k]: v } }));

  const autoSlug = () => {
    if (!form.slug) set("slug", slugify(form.name));
  };

  const valid =
    form.name.trim().length >= 2 &&
    form.admin_name.trim().length >= 2 &&
    form.admin_email.includes("@") &&
    form.admin_password.length >= 8;

  const create = async () => {
    setBusy(true);
    const slug = form.slug.trim() || slugify(form.name);

    // 1 — criar org
    const { data: orgRow, error: orgErr } = await supabase
      .from("organizations")
      .insert({
        name: form.name.trim(),
        slug,
        plan: form.plan,
        primary_color: form.primary_color,
        secondary_color: form.secondary_color,
        logo_url: form.logo_url || null,
        voice_lang: form.voice_lang,
        timezone: form.timezone,
        reset_time: form.reset_time,
        kiosk_languages: { pt: true, en: form.kiosk_en },
        modules_enabled: form.modules,
      })
      .select()
      .single();

    if (orgErr || !orgRow) {
      toast.error(orgErr?.message?.includes("slug") ? "Endereço curto já existe." : "Não foi possível criar a clínica.");
      setBusy(false);
      return;
    }

    // 2 — carregar logo se foi indicado e ainda não tem URL pública
    // (já tratado pelo LogoUploader, mas se vieram por URL direta fica assim)

    // 3 — criar admin
    const result = await createTeamMember({
      data: {
        name: form.admin_name.trim(),
        email: form.admin_email.trim(),
        password: form.admin_password,
        role: "org_admin",
        orgId: orgRow.id,
      },
    }).catch(() => ({ error: "create_failed" }) as { error: string });

    setBusy(false);

    if ("error" in result && result.error) {
      toast.error("Clínica criada mas não foi possível criar o administrador. Faça-o manualmente.");
    } else {
      toast.success(`Clínica "${orgRow.name}" criada com sucesso. O administrador já pode entrar.`);
    }

    setForm({
      name: "", slug: "", plan: "starter",
      primary_color: "#1a6fc4", secondary_color: "#07101f",
      logo_url: "", voice_lang: "pt", timezone: "Europe/Lisbon",
      reset_time: "08:00", kiosk_en: false,
      modules: { ...DEFAULT_MODULES },
      admin_name: "", admin_email: "", admin_password: "",
    });
    setOpen(false);
    onCreated();
  };

  return (
    <section className="rounded-2xl border bg-card">
      <button
        className="flex w-full items-center justify-between px-5 py-4 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex items-center gap-2 text-lg font-semibold">
          <Plus className="size-5" /> Nova clínica
        </span>
        {open ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t px-5 pb-6 pt-5 space-y-8">

          {/* ── Identidade ── */}
          <div>
            <h3 className="mb-4 text-sm font-semibold text-muted-foreground">Identidade</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome da clínica">
                <Input
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  onBlur={autoSlug}
                  placeholder="Clínica Saúde+"
                />
              </Field>
              <Field label="Endereço curto (slug)" hint="Gerado automaticamente se deixar vazio">
                <Input
                  value={form.slug}
                  onChange={(e) => set("slug", slugify(e.target.value))}
                  placeholder="clinica-saude"
                />
              </Field>
              <Field label="Plano">
                <select
                  className="rounded-lg border bg-card px-3 py-2 text-sm"
                  value={form.plan}
                  onChange={(e) => set("plan", e.target.value as NewOrg["plan"])}
                >
                  {PLANS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Logótipo">
                <LogoUploader value={form.logo_url} onChange={(u) => set("logo_url", u)} />
              </Field>
            </div>
          </div>

          {/* ── Cores e aparência ── */}
          <div>
            <h3 className="mb-1 text-sm font-semibold text-muted-foreground">Cores e aparência</h3>
            <p className="mb-4 text-xs text-muted-foreground">
              A cor primária aparece nos botões, destaque de senhas e identidade do quiosque. A secundária é o fundo do painel TV.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Cor primária">
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={form.primary_color}
                    onChange={(e) => set("primary_color", e.target.value)}
                    className="h-10 w-14 cursor-pointer rounded-lg border bg-card p-1"
                  />
                  <Input
                    value={form.primary_color}
                    onChange={(e) => set("primary_color", e.target.value)}
                    className="font-mono text-sm"
                    maxLength={7}
                  />
                </div>
              </Field>
              <Field label="Cor secundária (TV)">
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={form.secondary_color}
                    onChange={(e) => set("secondary_color", e.target.value)}
                    className="h-10 w-14 cursor-pointer rounded-lg border bg-card p-1"
                  />
                  <Input
                    value={form.secondary_color}
                    onChange={(e) => set("secondary_color", e.target.value)}
                    className="font-mono text-sm"
                    maxLength={7}
                  />
                </div>
              </Field>
              {/* Pré-visualização */}
              <div className="sm:col-span-2 flex gap-4 items-center rounded-xl bg-muted px-4 py-3">
                <div
                  className="flex h-12 flex-1 items-center justify-center rounded-lg text-sm font-semibold text-white"
                  style={{ backgroundColor: form.primary_color }}
                >
                  Botão primário
                </div>
                <div
                  className="flex h-12 flex-1 items-center justify-center rounded-lg text-sm font-semibold text-white"
                  style={{ backgroundColor: form.secondary_color }}
                >
                  Fundo TV
                </div>
              </div>
            </div>

            {/* Paletes rápidas */}
            <div className="mt-4">
              <p className="mb-2 text-xs text-muted-foreground">Paletes rápidas</p>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "Azul (padrão)", primary: "#1a6fc4", secondary: "#07101f" },
                  { label: "Verde saúde", primary: "#0e9488", secondary: "#062820" },
                  { label: "Roxo", primary: "#7c3aed", secondary: "#1a0a3a" },
                  { label: "Âmbar", primary: "#b45309", secondary: "#1a0e00" },
                  { label: "Coral", primary: "#e11d48", secondary: "#1a000a" },
                  { label: "Cinzento", primary: "#475569", secondary: "#0f172a" },
                ].map((p) => (
                  <button
                    key={p.label}
                    onClick={() => { set("primary_color", p.primary); set("secondary_color", p.secondary); }}
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

          {/* ── Configurações regionais ── */}
          <div>
            <h3 className="mb-4 text-sm font-semibold text-muted-foreground">Configurações regionais</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Idioma da voz (anúncio TV)">
                <select
                  className="rounded-lg border bg-card px-3 py-2 text-sm"
                  value={form.voice_lang}
                  onChange={(e) => set("voice_lang", e.target.value)}
                >
                  <option value="pt">Português (pt-PT)</option>
                  <option value="en">Inglês</option>
                </select>
              </Field>
              <Field label="Fuso horário">
                <select
                  className="rounded-lg border bg-card px-3 py-2 text-sm"
                  value={form.timezone}
                  onChange={(e) => set("timezone", e.target.value)}
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </Field>
              <Field label="Reset diário (hora)">
                <Input
                  type="time"
                  value={form.reset_time}
                  onChange={(e) => set("reset_time", e.target.value)}
                />
              </Field>
              <Field label="Quiosque bilingue">
                <label className="flex h-10 items-center gap-3 rounded-lg border bg-card px-3 text-sm cursor-pointer">
                  <Switch
                    checked={form.kiosk_en}
                    onCheckedChange={(v) => set("kiosk_en", v)}
                  />
                  Activar inglês no quiosque
                </label>
              </Field>
            </div>
          </div>

          {/* ── Módulos ── */}
          <div>
            <h3 className="mb-1 text-sm font-semibold text-muted-foreground">Módulos activos</h3>
            <p className="mb-4 text-xs text-muted-foreground">
              Pode alterar em qualquer altura no painel de cada clínica.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {(Object.keys(MODULE_LABELS) as (keyof Modules)[]).map((key) => (
                <label
                  key={key}
                  className="flex items-center justify-between gap-3 rounded-xl border bg-muted px-3 py-2 text-sm cursor-pointer"
                >
                  {MODULE_LABELS[key]}
                  <Switch
                    checked={form.modules[key]}
                    onCheckedChange={(v) => setMod(key, v)}
                  />
                </label>
              ))}
            </div>
          </div>

          {/* ── Primeiro administrador ── */}
          <div>
            <h3 className="mb-1 text-sm font-semibold text-muted-foreground">Primeiro administrador</h3>
            <p className="mb-4 text-xs text-muted-foreground">
              A conta é criada de imediato. A pessoa entra em <code className="rounded bg-muted px-1">/login</code> com estes dados e pode mudar a palavra-passe.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Nome">
                <Input
                  value={form.admin_name}
                  onChange={(e) => set("admin_name", e.target.value)}
                  placeholder="Ana Silva"
                />
              </Field>
              <Field label="Email">
                <Input
                  type="email"
                  value={form.admin_email}
                  onChange={(e) => set("admin_email", e.target.value)}
                  placeholder="ana@clinica.pt"
                />
              </Field>
              <Field label="Palavra-passe inicial (mín. 8)">
                <Input
                  value={form.admin_password}
                  onChange={(e) => set("admin_password", e.target.value)}
                  placeholder="••••••••"
                />
              </Field>
            </div>
          </div>

          {/* ── Resumo + botão ── */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-muted px-4 py-3">
            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
              <ColorSwatch color={form.primary_color} label="Cor primária" />
              <ColorSwatch color={form.secondary_color} label="Cor TV" />
              <span>{form.plan} · {Object.values(form.modules).filter(Boolean).length} módulos</span>
              {form.logo_url && <span>✓ Logo</span>}
            </div>
            <Button
              disabled={!valid || busy}
              onClick={() => void create()}
            >
              {busy ? "A criar…" : "Criar clínica e administrador"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────
// Página principal
// ──────────────────────────────────────────────────────────────
function SuperAdmin() {
  const session = useSession();
  const isSuper = session.roles.includes("super_admin");
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [stats, setStats] = useState<OrgStats>({});
  const [platform, setPlatform] = useState<Platform>({});
  const [detailOrg, setDetailOrg] = useState<string | null>(null);
  const [orgAdmin, setOrgAdmin] = useState<{ org: string; name: string; email: string; password: string }>({
    org: "", name: "", email: "", password: "",
  });

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

  const toggleModule = async (org: Org, key: keyof Modules, value: boolean) => {
    const next = { ...modules(org), [key]: value };
    await supabase.from("organizations").update({ modules_enabled: next }).eq("id", org.id);
    void load();
  };

  if (!session.loading && !isSuper) {
    return (
      <AppShell title="Plataforma" roles={session.roles} userName={session.profile?.name} primaryRole={session.primaryRole}>
        <p className="text-muted-foreground">Esta área é reservada aos administradores da plataforma.</p>
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

        {/* KPIs */}
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

        {/* Gráficos globais */}
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

        {/* Formulário nova clínica */}
        <NewOrgForm onCreated={() => void load()} />

        {/* Lista de clínicas */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Clínicas</h2>
          {orgs.map((org) => {
            const mods = modules(org);
            return (
              <article key={org.id} className="rounded-2xl border bg-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {org.logo_url && (
                      <img src={org.logo_url} alt="" className="h-8 w-auto max-w-[80px] rounded object-contain" />
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold">{org.name}</h3>
                        <span className="size-3 rounded-full border" style={{ backgroundColor: org.primary_color }} title="Cor primária" />
                        <span className="size-3 rounded-full border" style={{ backgroundColor: org.secondary_color }} title="Cor TV" />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {org.slug} · plano {org.plan} · {stats[org.id] ?? 0} senha(s) hoje
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
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
                      {orgAdmin.org === org.id ? "Cancelar" : "Novo admin"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDetailOrg(detailOrg === org.id ? null : org.id)}
                    >
                      {detailOrg === org.id ? "Fechar" : "Estatísticas"}
                    </Button>
                  </div>
                </div>

                {/* Módulos */}
                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {(Object.keys(MODULE_LABELS) as (keyof Modules)[]).map((key) => (
                    <label key={key} className="flex items-center justify-between gap-3 rounded-xl bg-muted px-3 py-2 text-sm cursor-pointer">
                      {MODULE_LABELS[key]}
                      <Switch
                        checked={mods[key]}
                        onCheckedChange={(v) => void toggleModule(org, key, v)}
                      />
                    </label>
                  ))}
                </div>

                {/* Criar admin */}
                {orgAdmin.org === org.id && (
                  <div className="mt-4 grid gap-3 rounded-xl bg-muted p-4 sm:grid-cols-4">
                    <Input placeholder="Nome" value={orgAdmin.name} onChange={(e) => setOrgAdmin({ ...orgAdmin, name: e.target.value })} />
                    <Input placeholder="Email" type="email" value={orgAdmin.email} onChange={(e) => setOrgAdmin({ ...orgAdmin, email: e.target.value })} />
                    <Input placeholder="Palavra-passe (mín. 8)" value={orgAdmin.password} onChange={(e) => setOrgAdmin({ ...orgAdmin, password: e.target.value })} />
                    <Button
                      disabled={orgAdmin.name.trim().length < 2 || !orgAdmin.email.includes("@") || orgAdmin.password.length < 8}
                      onClick={() => void createOrgAdmin(org.id)}
                    >
                      Criar conta
                    </Button>
                  </div>
                )}

                {/* Estatísticas e auditoria */}
                {detailOrg === org.id && (
                  <div className="mt-5 space-y-6 border-t pt-5">
                    <OrgStatsPanel orgId={org.id} />
                    <div>
                      <h3 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
                        Registo de auditoria
                      </h3>
                      <AuditLog orgId={org.id} timezone={org.timezone ?? "Europe/Lisbon"} />
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </section>

        {/* Auditoria global */}
        <section className="rounded-2xl border bg-card p-5">
          <h2 className="text-lg font-semibold">Auditoria (todas as clínicas)</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Rasto completo e inalterável de senhas e alterações de configuração.
          </p>
          <div className="mt-4">
            <AuditLog showOrgColumn />
          </div>
        </section>

        {/* Todos os dispositivos */}
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
