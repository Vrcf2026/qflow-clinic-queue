import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export type StatsPayload = {
  error?: string;
  totals?: {
    tickets: number;
    done: number;
    missed: number;
    waiting: number;
    avg_wait_minutes: number;
    avg_service_minutes: number;
  };
  by_day?: { day: string; tickets: number; missed: number }[];
  by_queue?: { name: string; color: string; tickets: number; avg_wait_minutes: number }[];
  by_desk?: { name: string; tickets: number }[];
  by_hour?: { hour: number; tickets: number }[];
};

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Estatísticas da clínica: intervalo de datas calculado e agregado no servidor. */
export function OrgStats({ orgId }: { orgId?: string | undefined }) {
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 13);
    return isoDate(d);
  });
  const [to, setTo] = useState(() => isoDate(today));
  const [data, setData] = useState<StatsPayload | null>(null);

  const load = useCallback(async () => {
    const args: { p_from: string; p_to: string; p_org?: string } = { p_from: from, p_to: to };
    if (orgId) args.p_org = orgId;
    const { data: raw } = await supabase.rpc("org_stats", args);
    setData((raw ?? {}) as StatsPayload);
  }, [from, to, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = data?.totals;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-4">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">De</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Até</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button variant="outline" onClick={() => void load()}>
          Atualizar
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Senhas", value: totals?.tickets ?? 0 },
          { label: "Atendidas", value: totals?.done ?? 0 },
          { label: "Faltas", value: totals?.missed ?? 0 },
          { label: "Em espera", value: totals?.waiting ?? 0 },
          { label: "Espera média", value: `${totals?.avg_wait_minutes ?? 0} min` },
          { label: "Atendimento médio", value: `${totals?.avg_service_minutes ?? 0} min` },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="ticket-number mt-1 text-2xl">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Senhas por dia">
          <LineChart data={data?.by_day ?? []}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="day" fontSize={11} tickMargin={6} />
            <YAxis fontSize={11} allowDecimals={false} />
            <Tooltip />
            <Line type="monotone" dataKey="tickets" stroke="var(--color-primary)" strokeWidth={2} />
            <Line type="monotone" dataKey="missed" stroke="var(--color-destructive)" strokeWidth={2} />
          </LineChart>
        </ChartCard>

        <ChartCard title="Senhas por fila">
          <BarChart data={data?.by_queue ?? []}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="name" fontSize={11} tickMargin={6} />
            <YAxis fontSize={11} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="tickets" radius={[6, 6, 0, 0]}>
              {(data?.by_queue ?? []).map((q) => (
                <Cell key={q.name} fill={q.color} />
              ))}
            </Bar>
          </BarChart>
        </ChartCard>

        <ChartCard title="Senhas por hora">
          <BarChart data={data?.by_hour ?? []}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="hour" fontSize={11} tickMargin={6} />
            <YAxis fontSize={11} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="tickets" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ChartCard>

        <ChartCard title="Senhas por balcão">
          <BarChart data={data?.by_desk ?? []}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="name" fontSize={11} tickMargin={6} />
            <YAxis fontSize={11} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="tickets" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ChartCard>
      </div>
    </div>
  );
}

export function ChartCard({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <div className="rounded-2xl border bg-card p-5">
      <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
      <div className="mt-4 h-64">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
