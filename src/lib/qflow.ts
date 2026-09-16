import type { Database } from "@/integrations/supabase/types";

export type Org = Database["public"]["Tables"]["organizations"]["Row"];
export type Queue = Database["public"]["Tables"]["queues"]["Row"];
export type Desk = Database["public"]["Tables"]["desks"]["Row"];
export type Cabinet = Database["public"]["Tables"]["cabinets"]["Row"];
export type Ticket = Database["public"]["Tables"]["tickets"]["Row"];
export type Device = Database["public"]["Tables"]["devices"]["Row"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type AppRole = Database["public"]["Enums"]["app_role"];
export type TicketStatus = Database["public"]["Enums"]["ticket_status"];

export type Modules = {
  kiosk: boolean;
  tv: boolean;
  recepcao: boolean;
  gabinetes: boolean;
  iptv: boolean;
  sms: boolean;
  prioritarios: boolean;
  multi_balcao: boolean;
};

export type TvConfig = {
  stream_url: string;
  m3u_url: string;
  active_channel: string;
  layout: "video_esquerda" | "video_completo" | "sem_video";
  video_ratio: number;
  volume: number;
  silenciar_em_chamada: boolean;
};

export const MODULE_LABELS: Record<keyof Modules, string> = {
  kiosk: "Quiosque",
  tv: "Painel TV",
  recepcao: "Receção",
  gabinetes: "Gabinetes",
  iptv: "IPTV / vídeo na TV",
  sms: "Notificações SMS",
  prioritarios: "Senhas prioritárias",
  multi_balcao: "Multi-balcão",
};

export const ROLE_LABELS: Record<AppRole, string> = {
  super_admin: "Super administrador",
  org_admin: "Administrador da clínica",
  chefe_turno: "Chefe de turno",
  rececionista: "Recepcionista",
  medico: "Médico",
};

export const STATUS_LABELS: Record<TicketStatus, string> = {
  em_espera: "Em espera",
  chamado: "Chamado",
  em_atendimento: "Em atendimento",
  concluido: "Concluído",
  faltou: "Faltou",
};

export const ROLE_HOME: Record<AppRole, string> = {
  super_admin: "/admin",
  org_admin: "/org/dashboard",
  chefe_turno: "/org/turno",
  rececionista: "/org/recepcao",
  medico: "/org/gabinete",
};

export const ROLE_PRIORITY: AppRole[] = [
  "super_admin",
  "org_admin",
  "chefe_turno",
  "rececionista",
  "medico",
];

export function modules(org?: Org | null): Modules {
  return {
    kiosk: true,
    tv: true,
    recepcao: true,
    gabinetes: true,
    iptv: false,
    sms: false,
    prioritarios: true,
    multi_balcao: true,
    ...((org?.modules_enabled as Partial<Modules> | null) ?? {}),
  } as Modules;
}

export function tvConfig(org?: Org | null): TvConfig {
  return {
    stream_url: "",
    m3u_url: "",
    active_channel: "",
    layout: "video_esquerda",
    video_ratio: 65,
    volume: 0.5,
    silenciar_em_chamada: true,
    ...((org?.tv_config as Partial<TvConfig> | null) ?? {}),
  } as TvConfig;
}

export function queueIds(row?: { queue_ids: unknown } | null): string[] {
  const v = row?.queue_ids;
  return Array.isArray(v) ? (v as string[]) : [];
}

/** Start of the current service day, based on the org reset time (local clock). */
export function dayStart(resetTime = "08:00"): Date {
  const [h, m] = resetTime.split(":").map((n) => Number(n) || 0);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  if (d.getTime() > Date.now()) d.setDate(d.getDate() - 1);
  return d;
}

export function timeLisbon(value?: string | null): string {
  if (!value) return "--:--";
  return new Intl.DateTimeFormat("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Lisbon",
  }).format(new Date(value));
}

export function waitingColor(count: number): string {
  if (count >= 10) return "bg-destructive text-destructive-foreground";
  if (count >= 5) return "bg-warn text-warn-foreground";
  return "bg-success text-success-foreground";
}

export function minutesSince(value?: string | null): number {
  if (!value) return 0;
  return Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
}

/** Sort helper: priority tickets first, then FIFO. */
export function queueOrder(a: Ticket, b: Ticket): number {
  if (a.priority !== b.priority) return a.priority ? -1 : 1;
  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
}

let voices: SpeechSynthesisVoice[] = [];
function loadVoices() {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  voices = window.speechSynthesis.getVoices();
}

export function speakCall(fullTicket: string, destination: string, lang: "pt" | "en" = "pt") {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  if (!voices.length) loadVoices();
  const text =
    lang === "en"
      ? `Ticket ${fullTicket.split("-").join(" ")}, please go to ${destination}`
      : `Senha ${fullTicket.split("-").join(" ")}, dirija-se ao ${destination}`;
  const utter = new SpeechSynthesisUtterance(text);
  const wanted = lang === "en" ? "en" : "pt";
  const voice =
    voices.find((v) => v.lang.toLowerCase().startsWith(wanted === "pt" ? "pt-pt" : "en")) ??
    voices.find((v) => v.lang.toLowerCase().startsWith(wanted)) ??
    voices.find((v) => v.lang.toLowerCase().startsWith("en"));
  if (voice) utter.voice = voice;
  utter.lang = voice?.lang ?? (wanted === "pt" ? "pt-PT" : "en-GB");
  utter.rate = 0.95;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

export function qrUrl(value: string, size = 220): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}`;
}

/** Minimal M3U parser: returns channel name + stream url pairs. */
export function parseM3U(text: string): { name: string; url: string }[] {
  const lines = text.split(/\r?\n/);
  const out: { name: string; url: string }[] = [];
  let pending: string | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF")) {
      const comma = line.indexOf(",");
      pending = comma >= 0 ? line.slice(comma + 1).trim() : "Canal";
    } else if (!line.startsWith("#")) {
      out.push({ name: pending ?? line, url: line });
      pending = null;
    }
  }
  return out;
}
