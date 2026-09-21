import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { StrategyPicker } from "@/components/strategy-picker";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useOrgLive, useSession } from "@/hooks/use-qflow";
import { resetServiceDay, setPostStrategy, setQueueStrategy } from "@/lib/ticket-actions";
import {
  effectiveStrategy,
  isQueueStrategy,
  MODULE_LABELS,
  modules,
  priorityRatio,
  QUEUE_STRATEGY_LABELS,
  queueIds,
  waitingColor,
  type Modules,
} from "@/lib/qflow";

export const Route = createFileRoute("/_authenticated/org/turno")({
  head: () => ({
    meta: [
      { title: "Chefe de turno | QFlow" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content: "Gestão do turno: filas ativas, balcões, gabinetes e reset do dia.",
      },
      { property: "og:title", content: "Chefe de turno | QFlow" },
      {
        property: "og:description",
        content: "Ativar filas, atribuir balcões e acompanhar o atendimento ao vivo.",
      },
    ],
  }),
  component: Turno,
});

function Turno() {
  const session = useSession();
  const live = useOrgLive(session.org?.id, session.dayStart);
  const [busy, setBusy] = useState(false);
  const mods = modules(session.org);

  const toggleQueue = async (id: string, active: boolean) => {
    await supabase.from("queues").update({ active }).eq("id", id);
    live.refresh();
  };

  const toggleDesk = async (table: "desks" | "cabinets", id: string, active: boolean) => {
    await supabase.from(table).update({ active }).eq("id", id);
    live.refresh();
  };

  const assignQueue = async (
    table: "desks" | "cabinets",
    id: string,
    current: string[],
    queueId: string,
  ) => {
    const next = current.includes(queueId)
      ? current.filter((q) => q !== queueId)
      : [...current, queueId];
    await supabase.from(table).update({ queue_ids: next }).eq("id", id);
    live.refresh();
  };

  /**
   * Fecha as senhas abertas do dia de serviço atual no servidor. A numeração
   * reinicia sempre em 001 na hora de reset configurada na clínica.
   */
  const resetDay = async () => {
    if (!session.org) return;
    setBusy(true);
    const result = await resetServiceDay();
    setBusy(false);
    if (!result.error) {
      toast.success(
        `${String(result["closed"] ?? 0)} senha(s) do dia fechadas. A numeração reinicia às ${session.org.reset_time}.`,
      );
    }
    session.reload();
    live.refresh();
  };

  return (
    <AppShell
      title="Gestão do turno"
      subtitle={session.org?.name ?? ""}
      roles={session.roles}
      userName={session.profile?.name}
      primaryRole={session.primaryRole}
      actions={
        <Button variant="outline" onClick={resetDay} disabled={busy}>
          <RotateCcw className="mr-2 size-4" /> Fechar senhas do dia
        </Button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border bg-card p-5">
          <h2 className="text-lg font-semibold">Filas</h2>
          <ul className="mt-4 space-y-3">
            {live.queues.map((q) => {
              const waiting = live.tickets.filter(
                (t) => t.queue_id === q.id && t.status === "em_espera",
              ).length;
              const serving = live.tickets.find(
                (t) =>
                  t.queue_id === q.id && (t.status === "chamado" || t.status === "em_atendimento"),
              );
              return (
                <li key={q.id} className="flex items-center gap-4 rounded-xl bg-muted px-4 py-3">
                  <span className="size-3 rounded-full" style={{ backgroundColor: q.color }} />
                  <span className="font-medium">{q.name}</span>
                  <span className="ml-auto text-sm text-muted-foreground">
                    {serving ? `Em atendimento ${serving.full_ticket}` : "Livre"}
                  </span>
                  <span
                    className={`rounded-lg px-2.5 py-1 text-sm font-semibold ${waitingColor(waiting)}`}
                  >
                    {waiting}
                  </span>
                  <Switch checked={q.active} onCheckedChange={(v) => void toggleQueue(q.id, v)} />
                </li>
              );
            })}
          </ul>
        </section>

        <section className="space-y-6">
          <div className="rounded-2xl border bg-card p-5">
            <h2 className="text-lg font-semibold">Balcões</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Escolha aqui as filas de cada balcão (ex.: um balcão só de faturação). A ordem em que
              as seleciona é a ordem de chamada. O recepcionista não pode alterar esta escolha.
            </p>
            <ul className="mt-4 space-y-4">
              {live.desks.map((d) => (
                <li key={d.id} className="rounded-xl bg-muted p-4">
                  <div className="flex items-center gap-3">
                    <span className="font-medium">{d.name}</span>
                    <Switch
                      className="ml-auto"
                      checked={d.active}
                      onCheckedChange={(v) => void toggleDesk("desks", d.id, v)}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {live.queues.map((q) => {
                      const on = queueIds(d).includes(q.id);
                      return (
                        <button
                          key={q.id}
                          onClick={() => void assignQueue("desks", d.id, queueIds(d), q.id)}
                          className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                            on
                              ? "bg-primary text-primary-foreground"
                              : "bg-card text-muted-foreground hover:bg-accent"
                          }`}
                        >
                          {q.name}
                        </button>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {mods.gabinetes && (
            <div className="rounded-2xl border bg-card p-5">
              <h2 className="text-lg font-semibold">Gabinetes</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Filas de cada gabinete. O médico só vê as senhas do gabinete onde está atribuído.
              </p>
              <ul className="mt-4 space-y-4">
                {live.cabinets.map((c) => (
                  <li key={c.id} className="rounded-xl bg-muted p-4">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{c.name}</span>
                      <Switch
                        className="ml-auto"
                        checked={c.active}
                        onCheckedChange={(v) => void toggleDesk("cabinets", c.id, v)}
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {live.queues.map((q) => {
                        const on = queueIds(c).includes(q.id);
                        return (
                          <button
                            key={q.id}
                            onClick={() => void assignQueue("cabinets", c.id, queueIds(c), q.id)}
                            className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                              on
                                ? "bg-primary text-primary-foreground"
                                : "bg-card text-muted-foreground hover:bg-accent"
                            }`}
                          >
                            {q.name}
                          </button>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-2xl border bg-card p-5">
            <h2 className="text-lg font-semibold">Módulos ativos</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Apenas visualização — a ativação é feita pela administração da clínica.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {(Object.keys(MODULE_LABELS) as (keyof Modules)[]).map((key) => (
                <span
                  key={key}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                    mods[key]
                      ? "bg-success text-success-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {MODULE_LABELS[key]}
                </span>
              ))}
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
