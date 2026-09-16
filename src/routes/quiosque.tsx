import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Accessibility, Printer, QrCode, RotateCcw, Smartphone } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { qrUrl, type Org } from "@/lib/qflow";

type KioskQueue = {
  id: string;
  name: string;
  name_en: string | null;
  prefix: string;
  color: string;
  priority_enabled: boolean;
  avg_duration_minutes: number;
  waiting: number;
};

type Ctx = { org: Org; queues: KioskQueue[]; device: { id: string; name: string } };

type Issued = {
  full_ticket: string;
  ticket_id: string;
  position: number;
  wait_minutes: number;
  queue_name: string;
};

type Lang = "pt" | "en";

const T = {
  pt: {
    service: "O que pretende?",
    type: "Tipo de atendimento",
    normal: "Normal",
    priority: "Prioritário",
    priorityHint: "idoso · grávida · deficiente",
    waiting: "em espera",
    qr: "QR para telemóvel",
    print: "Imprimir talão",
    place: (p: number, m: number) => `Está em ${p}º lugar · ~${m} minutos de espera`,
    ticket: "A sua senha",
    back: "Voltar",
    scan: "Aponte a câmara do telemóvel para acompanhar a sua senha",
    done: "Novo atendimento",
  },
  en: {
    service: "What do you need?",
    type: "Type of service",
    normal: "Normal",
    priority: "Priority",
    priorityHint: "elderly · pregnant · disability",
    waiting: "waiting",
    qr: "QR to mobile",
    print: "Print ticket",
    place: (p: number, m: number) => `You are ${p}th in line · ~${m} minutes wait`,
    ticket: "Your ticket",
    back: "Back",
    scan: "Point your phone camera to follow your ticket",
    done: "New ticket",
  },
} as const;

export const Route = createFileRoute("/quiosque")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({ token: String(search.token ?? "") }),
  head: () => ({
    meta: [
      { title: "Quiosque de senhas | QFlow" },
      { name: "description", content: "Quiosque de emissão de senhas bilingue para clínicas." },
      { property: "og:title", content: "Quiosque de senhas QFlow" },
      { property: "og:description", content: "Emissão de senhas no quiosque, em português ou inglês." },
    ],
  }),
  component: Kiosk,
});

function Kiosk() {
  const { token } = Route.useSearch();
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang | null>(null);
  const [queue, setQueue] = useState<KioskQueue | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [showQr, setShowQr] = useState(false);

  const load = useCallback(async () => {
    if (!token) return setError("Token do dispositivo em falta.");
    const { data, error: rpcError } = await supabase.rpc("device_context", { p_token: token });
    const payload = data as unknown as (Ctx & { error?: string }) | null;
    if (rpcError || !payload || payload.error) return setError("Quiosque não autorizado.");
    setCtx(payload);
  }, [token]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 15000);
    return () => clearInterval(id);
  }, [load]);

  const langs = useMemo(() => {
    const kl = (ctx?.org.kiosk_languages ?? { pt: true }) as { pt?: boolean; en?: boolean };
    return { pt: kl.pt !== false, en: !!kl.en };
  }, [ctx]);

  useEffect(() => {
    if (ctx && !lang && !langs.en) setLang("pt");
  }, [ctx, lang, langs.en]);

  const reset = useCallback(() => {
    setIssued(null);
    setQueue(null);
    setShowQr(false);
    setLang(langs.en ? null : "pt");
    void load();
  }, [langs.en, load]);

  useEffect(() => {
    if (!issued) return;
    const id = setTimeout(reset, 20000);
    return () => clearTimeout(id);
  }, [issued, reset]);

  const emit = async (q: KioskQueue, priority: boolean) => {
    const { data } = await supabase.rpc("issue_ticket", {
      p_token: token,
      p_queue_id: q.id,
      p_priority: priority,
      p_lang: lang ?? "pt",
    });
    const payload = data as unknown as
      | { ticket: { id: string; full_ticket: string }; position: number; wait_minutes: number; error?: string }
      | null;
    if (!payload || payload.error) return;
    setIssued({
      full_ticket: payload.ticket.full_ticket,
      ticket_id: payload.ticket.id,
      position: payload.position,
      wait_minutes: payload.wait_minutes,
      queue_name: (lang === "en" ? q.name_en : q.name) ?? q.name,
    });
    void load();
  };

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-8 text-center">
        <p className="text-xl font-semibold text-destructive">{error}</p>
      </main>
    );
  }
  if (!ctx) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">A carregar quiosque…</p>
      </main>
    );
  }

  const t = T[lang ?? "pt"];
  const followUrl =
    typeof window !== "undefined" && issued
      ? `${window.location.origin}/espera?ticket=${issued.ticket_id}`
      : "";

  return (
    <main className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b bg-card px-8 py-5">
        <div className="flex items-center gap-4">
          {ctx.org.logo_url ? (
            <img src={ctx.org.logo_url} alt={ctx.org.name} className="h-10 w-auto" />
          ) : null}
          <span className="font-display text-2xl font-bold text-foreground">{ctx.org.name}</span>
        </div>
        <span className="text-sm text-muted-foreground">{ctx.device.name}</span>
      </header>

      {/* Language selection */}
      {!lang && (
        <section className="mx-auto max-w-3xl px-8 py-16">
          <h1 className="text-center text-3xl font-bold">Escolha o idioma · Choose language</h1>
          <div className="mt-10 grid gap-6">
            <Button className="touch-tile h-28 text-3xl" size="lg" onClick={() => setLang("pt")}>
              🇵🇹 Português
            </Button>
            <Button
              variant="outline"
              className="touch-tile h-28 text-3xl"
              size="lg"
              onClick={() => setLang("en")}
            >
              🇬🇧 English
            </Button>
          </div>
        </section>
      )}

      {/* Step 1 — service */}
      {lang && !queue && !issued && (
        <section className="mx-auto max-w-5xl px-8 py-12">
          <h1 className="text-4xl font-bold">{t.service}</h1>
          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            {ctx.queues.map((q) => (
              <button
                key={q.id}
                onClick={() =>
                  q.priority_enabled ? setQueue(q) : void emit(q, false)
                }
                className="touch-tile flex items-center justify-between border-2 border-border bg-card px-7 py-8 text-left transition-colors hover:border-primary hover:bg-accent"
              >
                <span>
                  <span className="block text-3xl font-bold text-card-foreground">
                    {(lang === "en" ? q.name_en : q.name) ?? q.name}
                  </span>
                  <span className="mt-1 block text-base font-medium text-muted-foreground">
                    {q.waiting} {t.waiting}
                  </span>
                </span>
                <span
                  className="ticket-number rounded-xl px-4 py-2 text-2xl text-primary-foreground"
                  style={{ backgroundColor: q.color }}
                >
                  {q.prefix}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Step 2 — priority */}
      {lang && queue && !issued && (
        <section className="mx-auto max-w-3xl px-8 py-12">
          <h1 className="text-4xl font-bold">{t.type}</h1>
          <div className="mt-10 grid gap-6">
            <Button className="touch-tile h-28 text-3xl" onClick={() => void emit(queue, false)}>
              {t.normal}
            </Button>
            <button
              onClick={() => void emit(queue, true)}
              className="touch-tile flex flex-col items-center justify-center bg-priority px-6 py-6 text-priority-foreground"
            >
              <span className="flex items-center gap-3 text-3xl font-bold">
                <Accessibility className="size-8" /> {t.priority}
              </span>
              <span className="mt-1 text-base font-medium opacity-90">{t.priorityHint}</span>
            </button>
            <Button variant="ghost" size="lg" onClick={() => setQueue(null)}>
              {t.back}
            </Button>
          </div>
        </section>
      )}

      {/* Step 3 — issued */}
      {issued && (
        <section className="mx-auto max-w-3xl px-8 py-12 text-center">
          <p className="text-lg font-semibold text-muted-foreground">{t.ticket}</p>
          <p className="ticket-number mt-4 text-[8rem] leading-none text-primary">
            {issued.full_ticket}
          </p>
          <p className="mt-3 text-2xl font-semibold">{issued.queue_name}</p>
          <p className="mt-4 text-xl text-muted-foreground">
            {t.place(issued.position, issued.wait_minutes)}
          </p>

          {showQr && followUrl && (
            <div className="mt-8 flex flex-col items-center gap-3">
              <img src={qrUrl(followUrl)} alt="QR" className="size-56 rounded-xl border bg-card p-3" />
              <p className="text-sm text-muted-foreground">{t.scan}</p>
            </div>
          )}

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            <Button className="touch-tile" size="lg" onClick={() => setShowQr((v) => !v)}>
              {showQr ? <Smartphone className="mr-2 size-6" /> : <QrCode className="mr-2 size-6" />}
              {t.qr}
            </Button>
            <Button
              variant="outline"
              className="touch-tile"
              size="lg"
              onClick={() => window.print()}
            >
              <Printer className="mr-2 size-6" /> {t.print}
            </Button>
          </div>
          <Button variant="ghost" className="mt-6" onClick={reset}>
            <RotateCcw className="mr-2 size-4" /> {t.done}
          </Button>

          {/* 80mm thermal print layout */}
          <div id="print-ticket" className="hidden print:block" style={{ width: "80mm" }}>
            <div style={{ textAlign: "center", fontFamily: "monospace", padding: "6mm 4mm" }}>
              {ctx.org.logo_url ? (
                <img src={ctx.org.logo_url} alt="" style={{ height: "12mm", margin: "0 auto 3mm" }} />
              ) : null}
              <div style={{ fontSize: "12pt", fontWeight: 700 }}>{ctx.org.name}</div>
              <div style={{ fontSize: "10pt", marginTop: "2mm" }}>{issued.queue_name}</div>
              <div style={{ fontSize: "44pt", fontWeight: 700, margin: "3mm 0" }}>
                {issued.full_ticket}
              </div>
              <div style={{ fontSize: "10pt" }}>{t.place(issued.position, issued.wait_minutes)}</div>
              {followUrl ? (
                <img src={qrUrl(followUrl, 180)} alt="" style={{ width: "35mm", margin: "3mm auto" }} />
              ) : null}
              <div style={{ fontSize: "9pt" }}>
                {new Intl.DateTimeFormat("pt-PT", {
                  dateStyle: "short",
                  timeStyle: "short",
                  timeZone: "Europe/Lisbon",
                }).format(new Date())}
              </div>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
