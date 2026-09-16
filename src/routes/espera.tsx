import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellOff, Check, Download } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type Status = {
  ticket: { id: string; full_ticket: string; status: string; lang_used: string };
  queue: { name: string; name_en: string | null; avg_duration_minutes: number };
  org: { name: string; logo_url: string | null; primary_color: string };
  position: number;
  destination: string | null;
  wait_minutes: number;
  error?: string;
};

type NotifyState = "idle" | "granted" | "denied" | "unsupported";

const T = {
  pt: {
    title: "Acompanhe a sua senha",
    position: (p: number) => `${p}º na fila`,
    wait: (m: number) => `~${m} min de espera`,
    notifyBtn: "Avisar quando for chamado",
    notifyOn: "Notificações ativas",
    notifyDenied: "Notificações bloqueadas",
    hint: "Pode ir ao café — avisamos quando for a sua vez.",
    called: "É a sua vez!",
    goTo: "Dirija-se a",
    done: "Atendimento concluído.",
    missed: "A sua senha foi dada como falta. Fale com a receção.",
    install: "Guardar no ecrã",
    callTitle: (ticket: string) => `Senha ${ticket}`,
    callBody: (dest: string) => `Dirija-se a ${dest}`,
  },
  en: {
    title: "Follow your ticket",
    position: (p: number) => `${p}th in line`,
    wait: (m: number) => `~${m} min wait`,
    notifyBtn: "Notify me when called",
    notifyOn: "Notifications on",
    notifyDenied: "Notifications blocked",
    hint: "You can step out — we'll alert you when it's your turn.",
    called: "It's your turn!",
    goTo: "Please go to",
    done: "Service completed.",
    missed: "Your ticket was marked as a no-show. Please speak to reception.",
    install: "Save to screen",
    callTitle: (ticket: string) => `Ticket ${ticket}`,
    callBody: (dest: string) => `Please go to ${dest}`,
  },
} as const;

export const Route = createFileRoute("/espera")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    ticket: String(search["ticket"] ?? ""),
  }),
  head: () => ({
    meta: [
      { title: "A minha senha | QFlow" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "theme-color", content: "#1a6fc4" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "description", content: "Acompanhe a posição da sua senha na fila em tempo real." },
      { property: "og:title", content: "A minha senha | QFlow" },
    ],
    links: [
      { rel: "manifest", href: "/manifest.json" },
    ],
  }),
  component: WaitPage,
});

// Registar SW e pedir permissão para notificações
async function registerSW(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

async function requestNotifyPermission(): Promise<NotifyState> {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  const result = await Notification.requestPermission();
  return result === "granted" ? "granted" : "denied";
}

function showNativeNotification(title: string, body: string, ticketId: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const url = `${window.location.origin}/espera?ticket=${ticketId}`;
  if ("serviceWorker" in navigator) {
    void navigator.serviceWorker.ready.then((reg) =>
      reg.showNotification(title, {
        body,
        icon: "/favicon.ico",
        badge: "/favicon.ico",
        tag: "qflow-call",
        requireInteraction: true,
        data: { url },
      })
    );
  } else {
    new Notification(title, { body });
  }
}

// Barra de progresso da posição
function QueueProgress({ position, total }: { position: number; total: number }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, ((total - position) / total) * 100)) : 0;
  return (
    <div className="mt-4 overflow-hidden rounded-full bg-muted" style={{ height: 6 }}>
      <div
        className="h-full rounded-full transition-all duration-1000"
        style={{ width: `${pct}%`, backgroundColor: "var(--primary, #1a6fc4)" }}
      />
    </div>
  );
}

function WaitPage() {
  const { ticket } = Route.useSearch();
  const [state, setState] = useState<Status | null>(null);
  const [notifyState, setNotifyState] = useState<NotifyState>("idle");
  const [initialPosition, setInitialPosition] = useState<number | null>(null);
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const announced = useRef(false);
  const swReg = useRef<ServiceWorkerRegistration | null>(null);

  // Registar SW na montagem
  useEffect(() => {
    void registerSW().then((reg) => { swReg.current = reg; });

    // PWA install prompt
    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Verificar permissão já concedida
  useEffect(() => {
    if (!("Notification" in window)) { setNotifyState("unsupported"); return; }
    if (Notification.permission === "granted") setNotifyState("granted");
    if (Notification.permission === "denied") setNotifyState("denied");
  }, []);

  const load = useCallback(async () => {
    if (!ticket) return;
    const { data } = await supabase.rpc("ticket_status", { p_ticket_id: ticket });
    const payload = data as unknown as Status | null;
    if (payload && !payload.error) {
      setState(payload);
      if (initialPosition === null) setInitialPosition(payload.position);
    }
  }, [ticket, initialPosition]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [load]);

  // Realtime
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
    return () => { void supabase.removeChannel(channel); };
  }, [ticket, load]);

  const lang = (state?.ticket.lang_used === "en" ? "en" : "pt") as "pt" | "en";
  const t = T[lang];
  const called =
    state?.ticket.status === "chamado" || state?.ticket.status === "em_atendimento";

  // Notificação quando chamado
  useEffect(() => {
    if (!called || announced.current || !state || notifyState !== "granted") return;
    announced.current = true;
    const title = t.callTitle(state.ticket.full_ticket);
    const body = state.destination ? t.callBody(state.destination) : t.called;
    showNativeNotification(title, body, state.ticket.id);
  }, [called, state, notifyState, t]);

  // Cor primária da org como CSS var local
  const primaryColor = state?.org.primary_color ?? "#1a6fc4";

  const handleNotify = async () => {
    const result = await requestNotifyPermission();
    setNotifyState(result);
  };

  const handleInstall = async () => {
    if (!installPrompt) return;
    // @ts-expect-error — BeforeInstallPromptEvent não está nos tipos padrão
    await installPrompt.prompt();
    setInstallPrompt(null);
  };

  if (!state) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">A carregar…</p>
      </main>
    );
  }

  // Ecrã de chamada — destaque total
  if (called) {
    return (
      <main
        className="flex min-h-screen flex-col items-center justify-center px-6 text-center text-white"
        style={{ backgroundColor: primaryColor }}
      >
        {state.org.logo_url && (
          <img src={state.org.logo_url} alt={state.org.name} className="mb-6 h-12 w-auto opacity-90" />
        )}
        <p className="text-2xl font-semibold opacity-90">{t.called}</p>
        <p
          className="ticket-number mt-4 leading-none"
          style={{ fontSize: "clamp(5rem,20vw,10rem)" }}
        >
          {state.ticket.full_ticket}
        </p>
        {state.destination && (
          <p className="mt-6 text-3xl font-bold">
            {t.goTo} <span className="underline decoration-2 underline-offset-4">{state.destination}</span>
          </p>
        )}
        <p className="mt-8 text-sm opacity-70">{state.org.name}</p>
      </main>
    );
  }

  // Ecrã de espera normal
  return (
    <main className="min-h-screen bg-background px-5 py-10" style={{ "--primary": primaryColor } as React.CSSProperties}>
      <div className="mx-auto max-w-sm">

        {/* Cabeçalho da org */}
        <div className="mb-8 text-center">
          {state.org.logo_url ? (
            <img src={state.org.logo_url} alt={state.org.name} className="mx-auto mb-3 h-12 w-auto" />
          ) : null}
          <p className="text-lg font-bold" style={{ color: primaryColor }}>
            {state.org.name}
          </p>
        </div>

        {/* Senha */}
        <div className="rounded-3xl border bg-card p-8 text-center shadow-sm">
          <p className="text-sm font-medium text-muted-foreground">{t.title}</p>
          <p
            className="ticket-number mt-3 leading-none"
            style={{ fontSize: "clamp(4rem,18vw,7rem)", color: primaryColor }}
          >
            {state.ticket.full_ticket}
          </p>
          <p className="mt-2 text-base font-semibold text-muted-foreground">
            {(lang === "en" ? state.queue.name_en : state.queue.name) ?? state.queue.name}
          </p>
        </div>

        {/* Posição e espera */}
        {state.ticket.status === "concluido" ? (
          <div className="mt-6 rounded-2xl border border-green-200 bg-green-50 p-5 text-center">
            <Check className="mx-auto mb-2 size-8 text-green-600" />
            <p className="font-semibold text-green-800">{t.done}</p>
          </div>
        ) : state.ticket.status === "faltou" ? (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-center">
            <p className="font-semibold text-red-800">{t.missed}</p>
          </div>
        ) : (
          <>
            <div className="mt-5 rounded-2xl border bg-card p-5 text-center">
              <p className="text-4xl font-bold" style={{ color: primaryColor }}>
                {t.position(state.position)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{t.wait(state.wait_minutes)}</p>
              <QueueProgress
                position={state.position}
                total={initialPosition ?? state.position}
              />
            </div>

            <p className="mt-5 text-center text-sm text-muted-foreground">{t.hint}</p>

            {/* Notificações */}
            <div className="mt-4 space-y-2">
              {notifyState === "idle" && (
                <Button className="w-full" size="lg" onClick={handleNotify}
                  style={{ backgroundColor: primaryColor }}>
                  <Bell className="mr-2 size-5" /> {t.notifyBtn}
                </Button>
              )}
              {notifyState === "granted" && (
                <div className="flex items-center justify-center gap-2 rounded-xl bg-green-50 border border-green-200 py-3 text-sm font-medium text-green-800">
                  <Bell className="size-4" /> {t.notifyOn}
                </div>
              )}
              {notifyState === "denied" && (
                <div className="flex items-center justify-center gap-2 rounded-xl bg-amber-50 border border-amber-200 py-3 text-sm font-medium text-amber-800">
                  <BellOff className="size-4" /> {t.notifyDenied}
                </div>
              )}

              {/* PWA install */}
              {installPrompt && (
                <Button variant="outline" className="w-full" size="lg" onClick={handleInstall}>
                  <Download className="mr-2 size-5" /> {t.install}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
