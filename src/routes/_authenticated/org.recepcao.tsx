import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PhoneCall, SkipForward, Repeat, UserX } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOrgLive, useSession } from "@/hooks/use-qflow";
import {
  modules,
  queueIds,
  queueOrder,
  STATUS_LABELS,
  timeLisbon,
  waitingColor,
  type Ticket,
} from "@/lib/qflow";
import {
  admitTicket,
  callTicket,
  missTicket,
  recallTicket,
  recoverTicket,
  skipTicket,
} from "@/lib/ticket-actions";

export const Route = createFileRoute("/_authenticated/org/recepcao")({
  head: () => ({
    meta: [
      { title: "Receção | QFlow" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Chamada de senhas e admissão de doentes na receção da clínica." },
      { property: "og:title", content: "Receção | QFlow" },
      { property: "og:description", content: "Chamar senhas, registar doentes e acompanhar as filas." },
    ],
  }),
  component: Recepcao,
});

function Recepcao() {
  const session = useSession();
  const live = useOrgLive(session.org?.id, session.dayStart);
  const [deskId, setDeskId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [utente, setUtente] = useState("");
  const [lastCalled, setLastCalled] = useState<Ticket | null>(null);

  const mods = modules(session.org);

  useEffect(() => {
    if (deskId) return;
    const desks = live.desks.filter((d) => d.active);
    setDeskId(session.profile?.desk_id ?? desks[0]?.id ?? null);
  }, [deskId, live.desks, session.profile?.desk_id]);

  const desk = live.desks.find((d) => d.id === deskId) ?? null;
  const deskQueues = useMemo(() => {
    const ids = queueIds(desk);
    return live.queues.filter((q) => q.active && (ids.length === 0 || ids.includes(q.id)));
  }, [desk, live.queues]);

  /**
   * A ordem de chamada segue a preferência de filas configurada para o balcão:
   * a primeira fila da lista é servida antes das seguintes. Dentro de cada fila,
   * senhas prioritárias primeiro e depois a ordem de chegada (com senhas
   * saltadas a reentrar mais atrás).
   */
  const deskPreference = useMemo(() => queueIds(desk), [desk]);
  const rank = (queueId: string) => {
    const i = deskPreference.indexOf(queueId);
    return i === -1 ? deskPreference.length : i;
  };

  const waiting = useMemo(
    () =>
      live.tickets
        .filter((t) => t.status === "em_espera" && deskQueues.some((q) => q.id === t.queue_id))
        .sort((a, b) => rank(a.queue_id) - rank(b.queue_id) || queueOrder(a, b)),
    [live.tickets, deskQueues, deskPreference],
  );

  const next = waiting[0] ?? null;
  const pendingAdmission = useMemo(
    () =>
      live.tickets
        .filter(
          (t) =>
            t.status !== "concluido" &&
            !t.patient_name &&
            deskQueues.some((q) => q.id === t.queue_id),
        )
        .sort((a, b) => rank(a.queue_id) - rank(b.queue_id) || queueOrder(a, b))[0] ?? null,
    [live.tickets, deskQueues, deskPreference],
  );
  const missed = useMemo(
    () => live.tickets.filter((t) => t.status === "faltou").sort(queueOrder),
    [live.tickets],
  );
  const recent = useMemo(
    () =>
      live.tickets
        .filter((t) => t.called_at)
        .sort((a, b) => (b.called_at ?? "").localeCompare(a.called_at ?? ""))
        .slice(0, 10),
    [live.tickets],
  );

  const queueName = (id: string) => live.queues.find((q) => q.id === id)?.name ?? "Fila";

  const target = { deskId: desk?.id ?? null };

  const doCall = async () => {
    if (!next) return;
    await callTicket(next, target);
    setLastCalled(next);
    live.refresh();
  };

  return (
    <AppShell
      title="Receção"
      subtitle={session.org?.name ?? ""}
      roles={session.roles}
      userName={session.profile?.name}
      primaryRole={session.primaryRole}
      actions={
        live.desks.length > 0 ? (
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground">Balcão</Label>
            {canSwitchDesk ? (
              <select
                className="rounded-lg border bg-card px-3 py-2 text-sm font-medium"
                value={deskId ?? ""}
                onChange={(e) => setDeskId(e.target.value)}
              >
                {live.desks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="rounded-lg border bg-muted px-3 py-2 text-sm font-semibold">
                {desk?.name ?? "Sem balcão atribuído"}
              </span>
            )}
          </div>
        ) : null
      }

    >
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Chamadas */}
        <section className="space-y-4">
          <div className="rounded-2xl bg-primary p-6 text-primary-foreground">
            <p className="text-sm font-semibold opacity-90">Próxima senha</p>
            <p className="ticket-number mt-2 text-6xl">{next?.full_ticket ?? "—"}</p>
            <p className="mt-2 text-lg font-medium opacity-95">
              {next ? queueName(next.queue_id) : "Sem senhas em espera"}
              {next?.priority ? " · Prioritária" : ""}
            </p>
            <p className="mt-1 text-sm opacity-80">{waiting.length} pessoa(s) em espera</p>
            <Button
              variant="secondary"
              size="lg"
              className="mt-5 w-full text-lg"
              disabled={!next}
              onClick={doCall}
            >
              <PhoneCall className="mr-2 size-5" />
              {next ? `Chamar ${next.full_ticket}` : "Chamar"}
            </Button>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Button
                variant="outline"
                className="border-white/40 bg-transparent text-primary-foreground hover:bg-white/10"
                disabled={!next}
                onClick={async () => {
                  if (next) await skipTicket(next);
                  live.refresh();
                }}
              >
                <SkipForward className="mr-1.5 size-4" /> Saltar
              </Button>
              <Button
                variant="outline"
                className="border-white/40 bg-transparent text-primary-foreground hover:bg-white/10"
                disabled={!lastCalled}
                onClick={async () => {
                  if (lastCalled) await recallTicket(lastCalled, target);
                  live.refresh();
                }}
              >
                <Repeat className="mr-1.5 size-4" /> Re-chamar
              </Button>
              <Button
                variant="outline"
                className="border-white/40 bg-transparent text-primary-foreground hover:bg-white/10"
                disabled={!lastCalled}
                onClick={async () => {
                  if (lastCalled) await missTicket(lastCalled);
                  setLastCalled(null);
                  live.refresh();
                }}
              >
                <UserX className="mr-1.5 size-4" /> Faltou
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border bg-card p-5">
            <h2 className="text-sm font-semibold text-muted-foreground">Filas</h2>
            <ul className="mt-3 space-y-2">
              {live.queues
                .filter((q) => q.active)
                .map((q) => {
                  const count = live.tickets.filter(
                    (t) => t.queue_id === q.id && t.status === "em_espera",
                  ).length;
                  return (
                    <li key={q.id} className="flex items-center justify-between rounded-xl bg-muted px-4 py-3">
                      <span className="flex items-center gap-3 font-medium">
                        <span className="size-3 rounded-full" style={{ backgroundColor: q.color }} />
                        {q.name}
                      </span>
                      <span className={`rounded-lg px-2.5 py-1 text-sm font-semibold ${waitingColor(count)}`}>
                        {count}
                      </span>
                    </li>
                  );
                })}
            </ul>
          </div>
        </section>

        {/* Admissão */}
        <section className="space-y-4">
          <div className="rounded-2xl border bg-card p-5">
            <h2 className="text-lg font-semibold">Admissão</h2>
            {pendingAdmission ? (
              <>
                <p className="ticket-number mt-3 text-4xl text-primary">
                  {pendingAdmission.full_ticket}
                </p>
                <p className="text-sm text-muted-foreground">{queueName(pendingAdmission.queue_id)}</p>
                <div className="mt-4 space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="pname">Nome do doente</Label>
                    <Input id="pname" value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="putente">Nº de utente (opcional)</Label>
                    <Input id="putente" value={utente} onChange={(e) => setUtente(e.target.value)} />
                  </div>
                  <Button
                    className="w-full"
                    disabled={!name.trim()}
                    onClick={async () => {
                      await admitTicket(pendingAdmission, name, utente);
                      setName("");
                      setUtente("");
                      live.refresh();
                    }}
                  >
                    Confirmar admissão
                  </Button>
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                Nenhuma senha a aguardar registo de doente.
              </p>
            )}
          </div>

          {missed.length > 0 && (
            <div className="rounded-2xl border bg-card p-5">
              <h2 className="text-sm font-semibold text-muted-foreground">
                Faltas recuperáveis ({session.org?.missed_recovery_minutes ?? 60} min)
              </h2>
              <ul className="mt-3 divide-y">
                {missed.map((t) => (
                  <li key={t.id} className="flex items-center justify-between py-2.5 text-sm">
                    <span className="ticket-number text-base">{t.full_ticket}</span>
                    <span className="flex-1 px-3 text-muted-foreground">
                      {t.patient_name ?? queueName(t.queue_id)}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        await recoverTicket(t);
                        live.refresh();
                      }}
                    >
                      Recuperar
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-2xl border bg-card p-5">
            <h2 className="text-sm font-semibold text-muted-foreground">Últimas chamadas</h2>
            <ul className="mt-3 divide-y">
              {recent.length === 0 && (
                <li className="py-3 text-sm text-muted-foreground">Ainda sem chamadas hoje.</li>
              )}
              {recent.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="ticket-number text-base">{t.full_ticket}</span>
                  <span className="flex-1 px-3 text-muted-foreground">
                    {t.patient_name ?? "—"}
                  </span>
                  <span className="text-muted-foreground">{STATUS_LABELS[t.status]}</span>
                  <span className="ml-3 tabular-nums text-muted-foreground">
                    {timeLisbon(t.called_at, session.org?.timezone ?? "Europe/Lisbon")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
