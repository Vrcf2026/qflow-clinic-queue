import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Check } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type Status = {
  ticket: { id: string; full_ticket: string; status: string; lang_used: string };
  queue: { name: string; name_en: string | null };
  org: { name: string; logo_url: string | null; primary_color: string };
  position: number;
  destination: string | null;
  wait_minutes: number;
  error?: string;
};

const T = {
  pt: {
    title: "Acompanhe a sua senha",
    position: (p: number) => `${p}º na fila`,
    wait: (m: number) => `~${m} minutos de espera`,
    notify: "Ativar notificação",
    notified: "Notificações ativas",
    hint: "Será notificado quando for chamado.",
    called: "É a sua vez!",
    goTo: "Dirija-se a",
    done: "Atendimento concluído.",
    missed: "A sua senha foi dada como falta.",
  },
  en: {
    title: "Follow your ticket",
    position: (p: number) => `${p}th in line`,
    wait: (m: number) => `~${m} minutes wait`,
    notify: "Enable notifications",
    notified: "Notifications on",
    hint: "You will be notified when you are called.",
    called: "It's your turn!",
    goTo: "Please go to",
    done: "Service completed.",
    missed: "Your ticket was marked as a no-show.",
  },
} as const;

export const Route = createFileRoute("/espera")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({ ticket: String(search["ticket"] ?? "") }),
  head: () => ({
    meta: [
      { title: "A minha senha | QFlow" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Acompanhe a posição da sua senha na fila da clínica em tempo real." },
      { property: "og:title", content: "A minha senha | QFlow" },
      { property: "og:description", content: "Posição na fila e tempo de espera em tempo real." },
    ],
  }),
  component: WaitPage,
});

function WaitPage() {
  const { ticket } = Route.useSearch();
  const [state, setState] = useState<Status | null>(null);
  const [notify, setNotify] = useState(false);
  const announced = useRef(false);

  const load = useCallback(async () => {
    if (!ticket) return;
    const { data } = await supabase.rpc("ticket_status", { p_ticket_id: ticket });
    const payload = data as unknown as Status | null;
    if (payload && !payload.error) setState(payload);
  }, [ticket]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!ticket) return;
    const channel = supabase
      .channel(`ticket:${ticket}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tickets", filter: `id=eq.${ticket}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [ticket, load]);

  const lang = (state?.ticket.lang_used === "en" ? "en" : "pt") as "pt" | "en";
  const t = T[lang];
  const called = state?.ticket.status === "chamado" || state?.ticket.status === "em_atendimento";

  useEffect(() => {
    if (!called || announced.current || !state) return;
    announced.current = true;
    if (notify && "Notification" in window && Notification.permission === "granted") {
      new Notification(
        `${state.ticket.full_ticket} — ${t.called}`,
        state.destination ? { body: `${t.goTo} ${state.destination}` } : {},
      );
    }
  }, [called, notify, state, t]);

  const askPermission = async () => {
    if (!("Notification" in window)) return;
    const res = await Notification.requestPermission();
    setNotify(res === "granted");
  };

  if (!state) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">A carregar…</p>
      </main>
    );
  }

  if (called) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-primary px-6 text-center text-primary-foreground">
        <p className="text-2xl font-semibold">{t.called}</p>
        <p className="ticket-number mt-4 text-7xl">{state.ticket.full_ticket}</p>
        {state.destination && (
          <p className="mt-6 text-2xl font-semibold">
            {t.goTo} {state.destination}
          </p>
        )}
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background px-6 py-10">
      <div className="mx-auto max-w-md text-center">
        {state.org.logo_url ? (
          <img src={state.org.logo_url} alt={state.org.name} className="mx-auto h-12 w-auto" />
        ) : null}
        <p className="mt-3 font-display text-xl font-bold" style={{ color: state.org.primary_color }}>
          {state.org.name}
        </p>
        <h1 className="mt-8 text-lg font-semibold text-muted-foreground">{t.title}</h1>
        <p className="ticket-number mt-2 text-7xl text-primary">{state.ticket.full_ticket}</p>
        <p className="mt-2 text-xl font-semibold">
          {(lang === "en" ? state.queue.name_en : state.queue.name) ?? state.queue.name}
        </p>

        {state.ticket.status === "concluido" ? (
          <p className="mt-8 text-lg font-medium text-success">{t.done}</p>
        ) : state.ticket.status === "faltou" ? (
          <p className="mt-8 text-lg font-medium text-destructive">{t.missed}</p>
        ) : (
          <>
            <div className="mt-8 rounded-2xl border bg-card p-6">
              <p className="text-4xl font-bold text-card-foreground">{t.position(state.position)}</p>
              <p className="mt-2 text-muted-foreground">{t.wait(state.wait_minutes)}</p>
            </div>
            <p className="mt-6 text-sm text-muted-foreground">{t.hint}</p>
            <Button className="mt-4 w-full" size="lg" onClick={askPermission} disabled={notify}>
              {notify ? <Check className="mr-2 size-4" /> : <Bell className="mr-2 size-4" />}
              {notify ? t.notified : t.notify}
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
