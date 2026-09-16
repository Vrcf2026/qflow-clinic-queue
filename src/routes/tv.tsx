import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { parseM3U, speakCall, timeLisbon, tvConfig, type Org } from "@/lib/qflow";

type TvQueue = { id: string; name: string; name_en: string | null; prefix: string; color: string };
type TvTicket = {
  id: string;
  queue_id: string;
  full_ticket: string;
  priority: boolean;
  status: string;
  desk_id: string | null;
  cabinet_id: string | null;
  lang_used: string;
  created_at: string;
  called_at: string | null;
};

const TICKET_COLUMNS =
  "id,queue_id,full_ticket,priority,status,desk_id,cabinet_id,lang_used,created_at,called_at";

export const Route = createFileRoute("/tv")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({ token: String(search.token ?? "") }),
  head: () => ({
    meta: [
      { title: "Painel de chamadas | QFlow" },
      {
        name: "description",
        content: "Painel de TV com chamadas de senhas, anúncio por voz e vídeo para salas de espera.",
      },
      { property: "og:title", content: "Painel de chamadas QFlow" },
      { property: "og:description", content: "Chamadas de senhas em ecrã inteiro com anúncio por voz." },
    ],
  }),
  component: TvPanel,
});

function TvPanel() {
  const { token } = Route.useSearch();
  const [org, setOrg] = useState<Org | null>(null);
  const [queues, setQueues] = useState<TvQueue[]>([]);
  const [tickets, setTickets] = useState<TvTicket[]>([]);
  const [places, setPlaces] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const [overlay, setOverlay] = useState<TvTicket | null>(null);
  const [channels, setChannels] = useState<{ name: string; url: string }[]>([]);
  const [channel, setChannel] = useState<string>("");
  const [muted, setMuted] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const cfg = useMemo(() => tvConfig(org), [org]);
  const orgId = org?.id;

  const loadContext = useCallback(async () => {
    if (!token) return setError("Token do dispositivo em falta.");
    const { data, error: rpcError } = await supabase.rpc("device_context", { p_token: token });
    const payload = data as unknown as { org: Org; queues: TvQueue[]; error?: string } | null;
    if (rpcError || !payload || payload.error) return setError("Dispositivo de TV não autorizado.");
    setOrg(payload.org);
    setQueues(payload.queues);
  }, [token]);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  const loadTickets = useCallback(async () => {
    if (!orgId) return;
    const since = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
    const [t, d, c] = await Promise.all([
      supabase
        .from("tickets")
        .select(TICKET_COLUMNS)
        .eq("org_id", orgId)
        .gte("created_at", since)
        .order("created_at"),
      supabase.from("desks").select("id,name").eq("org_id", orgId),
      supabase.from("cabinets").select("id,name").eq("org_id", orgId),
    ]);
    setTickets((t.data ?? []) as TvTicket[]);
    const map: Record<string, string> = {};
    for (const row of d.data ?? []) map[row.id] = row.name;
    for (const row of c.data ?? []) map[row.id] = row.name;
    setPlaces(map);
  }, [orgId]);

  useEffect(() => {
    void loadTickets();
    const id = setInterval(() => void loadTickets(), 8000);
    return () => clearInterval(id);
  }, [loadTickets]);

  // Clock
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Realtime calls
  useEffect(() => {
    if (!orgId) return;
    const channelSub = supabase
      .channel(`org-tv:${orgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tickets", filter: `org_id=eq.${orgId}` },
        (payload) => {
          const row = payload.new as TvTicket | undefined;
          void loadTickets();
          const previous = payload.old as TvTicket | undefined;
          if (row && row.status === "chamado" && previous?.status !== "chamado") {
            setOverlay(row);
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channelSub);
    };
  }, [orgId, loadTickets]);

  // Overlay + voice announcement
  useEffect(() => {
    if (!overlay) return;
    const destination =
      (overlay.desk_id && places[overlay.desk_id]) ||
      (overlay.cabinet_id && places[overlay.cabinet_id]) ||
      "Balcão";
    const lang = overlay.lang_used === "en" ? "en" : (org?.voice_lang === "en" ? "en" : "pt");
    const video = videoRef.current;
    const restore = video && !video.muted;
    if (cfg.silenciar_em_chamada && video) video.muted = true;
    speakCall(overlay.full_ticket, destination, lang);
    const id = setTimeout(() => {
      setOverlay(null);
      if (restore && video) video.muted = muted;
    }, 6000);
    return () => clearTimeout(id);
  }, [overlay, places, org?.voice_lang, cfg.silenciar_em_chamada, muted]);

  // M3U channels
  useEffect(() => {
    const url = cfg.m3u_url;
    if (!url) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(url);
        const text = await res.text();
        if (!cancelled) {
          const list = parseM3U(text);
          setChannels(list);
          if (!channel && list.length) setChannel(cfg.active_channel || list[0]!.url);
        }
      } catch {
        /* stream list unavailable */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cfg.m3u_url, cfg.active_channel, channel]);

  // HLS playback
  const source = channel || cfg.stream_url;
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !source) return;
    let hls: { destroy: () => void } | null = null;
    void (async () => {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = source;
      } else {
        const mod = await import("hls.js");
        const Hls = mod.default;
        if (Hls.isSupported()) {
          const instance = new Hls();
          instance.loadSource(source);
          instance.attachMedia(video);
          hls = instance;
        } else {
          video.src = source;
        }
      }
      video.volume = cfg.volume ?? 0.5;
      video.muted = muted;
      void video.play().catch(() => undefined);
    })();
    return () => hls?.destroy();
  }, [source, cfg.volume, muted]);

  const modules = (org?.modules_enabled ?? {}) as { iptv?: boolean };
  const showVideo = !!modules.iptv && cfg.layout !== "sem_video" && !!source;

  const byQueue = useMemo(() => {
    return queues.map((q) => {
      const qt = tickets.filter((t) => t.queue_id === q.id);
      const serving = qt
        .filter((t) => t.status === "chamado" || t.status === "em_atendimento")
        .sort((a, b) => (b.called_at ?? "").localeCompare(a.called_at ?? ""))[0];
      const next = qt
        .filter((t) => t.status === "em_espera")
        .sort((a, b) =>
          a.priority === b.priority
            ? a.created_at.localeCompare(b.created_at)
            : a.priority
              ? -1
              : 1,
        )
        .slice(0, 2);
      return { queue: q, serving, next };
    });
  }, [queues, tickets]);

  const recent = useMemo(
    () =>
      tickets
        .filter((t) => t.called_at)
        .sort((a, b) => (b.called_at ?? "").localeCompare(a.called_at ?? ""))
        .slice(0, 8),
    [tickets],
  );

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-tv text-tv-foreground">
        <p className="text-2xl font-semibold text-destructive">{error}</p>
      </main>
    );
  }

  return (
    <main className="relative flex h-screen flex-col overflow-hidden bg-tv text-tv-foreground">
      <header className="flex items-center justify-between px-8 py-5">
        <div className="flex items-center gap-4">
          {org?.logo_url ? <img src={org.logo_url} alt="" className="h-10 w-auto" /> : null}
          <span className="font-display text-2xl font-bold">{org?.name ?? "QFlow"}</span>
        </div>
        <span className="ticket-number text-4xl">
          {new Intl.DateTimeFormat("pt-PT", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Europe/Lisbon",
          }).format(clock)}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 gap-6 px-8 pb-4">
        {showVideo && (
          <div
            className="relative min-h-0 overflow-hidden rounded-2xl bg-black"
            style={{ flexBasis: `${cfg.video_ratio ?? 65}%` }}
          >
            <video ref={videoRef} className="size-full object-cover" playsInline autoPlay muted={muted} />
            <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-xl bg-tv-panel/80 px-3 py-2 text-sm">
              <button onClick={() => setMuted((m) => !m)} aria-label="Som">
                {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              </button>
              {channels.length > 0 && (
                <select
                  className="max-w-48 bg-transparent text-tv-foreground outline-none"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                >
                  {channels.map((c) => (
                    <option key={c.url} value={c.url} className="text-foreground">
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          {byQueue.map(({ queue, serving, next }) => (
            <div key={queue.id} className="rounded-2xl bg-tv-panel px-6 py-4">
              <div className="flex items-center justify-between">
                <span className="text-lg font-semibold" style={{ color: queue.color }}>
                  {queue.name}
                </span>
                <span className="text-sm text-tv-muted">
                  {next.length > 0 ? `Próximas: ${next.map((n) => n.full_ticket).join(" · ")}` : "Sem espera"}
                </span>
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className={showVideo ? "ticket-number text-5xl" : "ticket-number text-7xl"}>
                  {serving?.full_ticket ?? "—"}
                </span>
                <span className="text-xl text-tv-accent">
                  {serving
                    ? (serving.desk_id && places[serving.desk_id]) ||
                      (serving.cabinet_id && places[serving.cabinet_id]) ||
                      ""
                    : ""}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <footer className="flex items-center gap-8 overflow-hidden border-t border-white/10 px-8 py-3 text-lg text-tv-muted">
        {recent.length === 0 ? (
          <span>Sem chamadas ainda hoje</span>
        ) : (
          recent.map((t) => (
            <span key={t.id} className="whitespace-nowrap">
              <span className="ticket-number text-tv-foreground">{t.full_ticket}</span>
              {" · "}
              {(t.desk_id && places[t.desk_id]) || (t.cabinet_id && places[t.cabinet_id]) || "Balcão"}
              {" · "}
              {timeLisbon(t.called_at)}
            </span>
          ))
        )}
      </footer>

      {overlay && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-tv/95 backdrop-blur">
          <p className="text-3xl font-semibold text-tv-muted">
            {overlay.lang_used === "en" ? "Ticket" : "Senha"}
          </p>
          <p className="ticket-number mt-4 text-[14rem] leading-none text-tv-foreground">
            {overlay.full_ticket}
          </p>
          <p className="mt-6 text-5xl font-bold text-tv-accent">
            {(overlay.desk_id && places[overlay.desk_id]) ||
              (overlay.cabinet_id && places[overlay.cabinet_id]) ||
              ""}
          </p>
        </div>
      )}
    </main>
  );
}
