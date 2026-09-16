import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PhoneCall, Check, UserX } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useOrgLive, useSession } from "@/hooks/use-qflow";
import { minutesSince, queueIds, queueOrder, timeLisbon } from "@/lib/qflow";
import { callTicket, finishTicket, missTicket, startService } from "@/lib/ticket-actions";

export const Route = createFileRoute("/_authenticated/org/gabinete")({
  head: () => ({
    meta: [
      { title: "Gabinete | QFlow" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Chamada de doentes e acompanhamento da consulta no gabinete." },
      { property: "og:title", content: "Gabinete | QFlow" },
      { property: "og:description", content: "Chamar o próximo doente e concluir consultas em tempo real." },
    ],
  }),
  component: Gabinete,
});

function Gabinete() {
  const session = useSession();
  const live = useOrgLive(session.org?.id, session.dayStart);
  const [cabinetId, setCabinetId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  // A doctor is bound to the cabinet assigned to their account; other roles may switch.
  const locked = session.primaryRole === "medico" && !!session.profile?.cabinet_id;

  useEffect(() => {
    if (locked) {
      setCabinetId(session.profile?.cabinet_id ?? null);
      return;
    }
    if (cabinetId) return;
    const active = live.cabinets.filter((c) => c.active);
    setCabinetId(session.profile?.cabinet_id ?? active[0]?.id ?? null);
  }, [locked, cabinetId, live.cabinets, session.profile?.cabinet_id]);

  const cabinet = live.cabinets.find((c) => c.id === cabinetId) ?? null;
  const cabQueues = useMemo(() => {
    const ids = queueIds(cabinet);
    return live.queues.filter((q) => q.active && (ids.length === 0 || ids.includes(q.id)));
  }, [cabinet, live.queues]);

  const mine = useMemo(
    () => live.tickets.filter((t) => cabQueues.some((q) => q.id === t.queue_id)),
    [live.tickets, cabQueues],
  );
  const current =
    mine.find((t) => t.cabinet_id === cabinetId && (t.status === "em_atendimento" || t.status === "chamado")) ??
    null;
  const waiting = useMemo(() => mine.filter((t) => t.status === "em_espera").sort(queueOrder), [mine]);
  const next = waiting[0] ?? null;

  const stats = {
    done: mine.filter((t) => t.status === "concluido").length,
    waiting: waiting.length,
    missed: mine.filter((t) => t.status === "faltou").length,
  };

  const label = (t: { patient_name: string | null; full_ticket: string }) =>
    t.patient_name ?? t.full_ticket;

  return (
    <AppShell
      title="Gabinete"
      subtitle={cabinet?.name ?? session.org?.name ?? ""}
      roles={session.roles}
      userName={session.profile?.name}
      primaryRole={session.primaryRole}
      actions={
        live.cabinets.length > 1 && !locked ? (
          <select
            className="rounded-lg border bg-card px-3 py-2 text-sm font-medium"
            value={cabinetId ?? ""}
            onChange={(e) => setCabinetId(e.target.value)}
          >
            {live.cabinets.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : null
      }
    >
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="space-y-4">
          <div className="rounded-2xl bg-priority p-6 text-priority-foreground">
            <p className="text-sm font-semibold opacity-90">Em consulta agora</p>
            {current ? (
              <>
                <p className="mt-2 text-3xl font-bold">{label(current)}</p>
                <p className="mt-1 text-lg opacity-90">
                  {current.full_ticket} · entrada {timeLisbon(current.called_at, session.org?.timezone ?? "Europe/Lisbon")}
                </p>
                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      await finishTicket(current);
                      live.refresh();
                    }}
                  >
                    <Check className="mr-2 size-4" /> Consulta concluída
                  </Button>
                  <Button
                    variant="outline"
                    className="border-white/40 bg-transparent text-priority-foreground hover:bg-white/10"
                    onClick={async () => {
                      await missTicket(current);
                      live.refresh();
                    }}
                  >
                    <UserX className="mr-2 size-4" /> Faltou
                  </Button>
                </div>
              </>
            ) : (
              <p className="mt-3 text-lg opacity-90">Nenhum doente em consulta.</p>
            )}
          </div>

          <Button
            size="lg"
            className="w-full text-lg"
            disabled={!next || !cabinet}
            onClick={async () => {
              if (!next || !cabinet) return;
              await callTicket(next, { cabinetId: cabinet.id });
              await startService(next);
              live.refresh();
            }}
          >
            <PhoneCall className="mr-2 size-5" />
            {next ? `Chamar ${label(next)}` : "Sem doentes em espera"}
          </Button>

          <div className="rounded-2xl border bg-card p-5">
            <h2 className="text-sm font-semibold text-muted-foreground">Lista de espera</h2>
            <ul className="mt-3 divide-y">
              {waiting.length === 0 && (
                <li className="py-3 text-sm text-muted-foreground">Fila vazia.</li>
              )}
              {waiting.map((t, i) => (
                <li key={t.id} className="flex items-center justify-between py-3">
                  <span className="font-medium">{label(t)}</span>
                  <span className="text-sm text-muted-foreground">
                    {t.full_ticket} · ~
                    {(live.queues.find((q) => q.id === t.queue_id)?.avg_duration_minutes ?? 10) * i} min
                    {t.priority ? " · prioritário" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="grid gap-3">
            {[
              { label: "Atendidos hoje", value: stats.done },
              { label: "Em espera", value: stats.waiting },
              { label: "Faltaram", value: stats.missed },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border bg-card p-5">
                <p className="text-sm text-muted-foreground">{s.label}</p>
                <p className="ticket-number mt-1 text-4xl">{s.value}</p>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border bg-card p-5">
            <Label htmlFor="note" className="text-sm text-muted-foreground">
              Nota de turno
            </Label>
            <Textarea
              id="note"
              className="mt-2"
              rows={5}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Observações do turno (apenas neste dispositivo)"
            />
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
