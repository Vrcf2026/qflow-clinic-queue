import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { clockLisbon, parseM3U, speakCall, timeLisbon, tvConfig, type Org } from "@/lib/qflow";

type TvQueueState = {
  id: string;
  name: string;
  name_en: string | null;
  color: string;
  waiting: number;
  current: { full_ticket: string; destination: string | null } | null;
  next: string[];
};

type TvCall = {
  id: string;
  full_ticket: string;
  destination: string | null;
  called_at: string;
  lang: string;
};

type MediaItem = {
  id: string;
  name: string;
  type: "stream" | "m3u" | "video_url" | "video_upload";
  url: string;
  duration_s: number | null;
  active: boolean;
  sort_order: number;
};

export const Route = createFileRoute("/tv")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({ token: String(search["token"] ?? "") }),
  head: () => ({
    meta: [
      { title: "Painel de chamadas | QFlow" },
      { name: "robots", content: "noindex, nofollow" },
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
  const [queues, setQueues] = useState<TvQueueState[]>([]);
  const [calls, setCalls] = useState<TvCall[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [clock, setClock] = useState(() => new Date());
  const [overlay, setOverlay] = useState<TvCall | null>(null);
  const [channels, setChannels] = useState<{ name: string; url: string }[]>([]);
  const [channel, setChannel] = useState<string>("");
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [playlistIdx, setPlaylistIdx] = useState(0);
  const playlistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [muted, setMuted] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const seenCall = useRef<string | null>(null);
  const bootstrapped = useRef(false);

  const cfg = useMemo(() => tvConfig(org), [org]);
  const timezone = org?.timezone ?? "Europe/Lisbon";

  // Device bootstrap: branding, TV configuration and the authoritative clock.
  useEffect(() => {
    if (!token) {
      setError("Token do dispositivo em falta.");
      return;
    }
    void (async () => {
      const sentAt = Date.now();
      const { data, error: rpcError } = await supabase.rpc("device_context", { p_token: token });
      const payload = data as unknown as { org: Org; server_now?: string; error?: string } | null;
      if (rpcError || !payload || payload.error) {
        setError("Dispositivo de TV não autorizado.");
        return;
      }
      setOrg(payload.org);
      if (payload.server_now) {
        setOffsetMs(new Date(payload.server_now).getTime() - (sentAt + Date.now()) / 2);
      }
      // Carregar media items para esta org
      const { data: mediaData } = await supabase
        .from("tv_media")
        .select("*")
        .eq("org_id", (payload.org as { id: string }).id)
        .eq("active", true)
        .order("sort_order")
        .order("created_at");
      setMediaItems((mediaData as MediaItem[]) ?? []);
    })();
  }, [token]);

  // Live state: server-side aggregation, polled (device sessions are anonymous).
  const loadState = useCallback(async () => {
    if (!token) return;
    const { data } = await supabase.rpc("tv_state", { p_token: token });
    const payload = data as unknown as
      | { queues: TvQueueState[]; recent_calls: TvCall[]; server_now: string; error?: string }
      | null;
    if (!payload || payload.error) return;
    setQueues(payload.queues ?? []);
    setCalls(payload.recent_calls ?? []);
    const latest = payload.recent_calls?.[0] ?? null;
    if (!bootstrapped.current) {
      seenCall.current = latest?.id ?? null;
      bootstrapped.current = true;
    } else if (latest && latest.id !== seenCall.current) {
      seenCall.current = latest.id;
      setOverlay(latest);
    }
  }, [token]);

  useEffect(() => {
    void loadState();
    const id = setInterval(() => void loadState(), 3000);
    return () => clearInterval(id);
  }, [loadState]);

  // Clock aligned with the server, resynced regularly.
  useEffect(() => {
    setClock(new Date(Date.now() + offsetMs));
    const id = setInterval(() => setClock(new Date(Date.now() + offsetMs)), 1000);
    return () => clearInterval(id);
  }, [offsetMs]);

  useEffect(() => {
    if (!token) return;
    const id = setInterval(() => {
      void (async () => {
        const sentAt = Date.now();
        const { data } = await supabase.rpc("tv_state", { p_token: token });
        const payload = data as unknown as { server_now?: string } | null;
        if (payload?.server_now) {
          setOffsetMs(new Date(payload.server_now).getTime() - (sentAt + Date.now()) / 2);
        }
      })();
    }, 300000);
    return () => clearInterval(id);
  }, [token]);

  // Call overlay + voice announcement
  useEffect(() => {
    if (!overlay) return;
    const destination = overlay.destination ?? "Balcão";
    const lang = overlay.lang === "en" ? "en" : org?.voice_lang === "en" ? "en" : "pt";
    const video = videoRef.current;
    const restore = video && !video.muted;
    if (cfg.silenciar_em_chamada && video) video.muted = true;
    speakCall(overlay.full_ticket, destination, lang);
    const id = setTimeout(() => {
      setOverlay(null);
      if (restore && video) video.muted = muted;
    }, 6000);
    return () => clearTimeout(id);
  }, [overlay, org?.voice_lang, cfg.silenciar_em_chamada, muted]);

  // M3U channel list
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

  // Determinar fonte de vídeo activa
  // Prioridade: 1) canal M3U seleccionado, 2) media items da tabela, 3) stream_url legado
  const activeMedia = mediaItems.length > 0 ? mediaItems[playlistIdx % mediaItems.length] : null;

  // Avançar playlist automaticamente se o item tiver duração definida
  useEffect(() => {
    if (!activeMedia || !activeMedia.duration_s) return;
    if (playlistTimer.current) clearTimeout(playlistTimer.current);
    playlistTimer.current = setTimeout(() => {
      setPlaylistIdx((i) => i + 1);
    }, activeMedia.duration_s * 1000);
    return () => { if (playlistTimer.current) clearTimeout(playlistTimer.current); };
  }, [activeMedia, playlistIdx]);

  // HLS playback
  const source = channel || (activeMedia ? activeMedia.url : cfg.stream_url);
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

  const mods = (org?.modules_enabled ?? {}) as { iptv?: boolean };
  // Mostrar vídeo se: módulo IPTV activo OU se houver media items configurados
  const showVideo = (!!mods.iptv || mediaItems.length > 0) && cfg.layout !== "sem_video" && !!source;
  
  // Nome do item actual para mostrar no selector
  const activeMediaName = activeMedia?.name ?? channel ?? "";

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
        <span className="ticket-number text-4xl">{clockLisbon(clock, timezone)}</span>
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
              {/* Selector de canal M3U */}
              {channels.length > 0 && (
                <select
                  className="max-w-48 bg-transparent text-tv-foreground outline-none"
                  value={channel}
                  onChange={(e) => { setChannel(e.target.value); setPlaylistIdx(0); }}
                >
                  {channels.map((c) => (
                    <option key={c.url} value={c.url} className="text-foreground">
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
              {/* Selector de media items (quando não há M3U) */}
              {channels.length === 0 && mediaItems.length > 1 && (
                <select
                  className="max-w-48 bg-transparent text-tv-foreground outline-none"
                  value={playlistIdx}
                  onChange={(e) => setPlaylistIdx(Number(e.target.value))}
                >
                  {mediaItems.map((m, i) => (
                    <option key={m.id} value={i} className="text-foreground">
                      {m.name}
                    </option>
                  ))}
                </select>
              )}
              {/* Nome do item actual (quando só há 1) */}
              {channels.length === 0 && mediaItems.length === 1 && (
                <span className="text-xs text-tv-muted truncate max-w-40">{activeMediaName}</span>
              )}
            </div>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          {queues.map((q) => (
            <div key={q.id} className="rounded-2xl bg-tv-panel px-6 py-4">
              <div className="flex items-center justify-between">
                <span className="text-lg font-semibold" style={{ color: q.color }}>
                  {q.name}
                </span>
                <span className="text-sm text-tv-muted">
                  {q.next.length > 0 ? `Próximas: ${q.next.join(" · ")}` : "Sem espera"}
                </span>
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className={showVideo ? "ticket-number text-5xl" : "ticket-number text-7xl"}>
                  {q.current?.full_ticket ?? "—"}
                </span>
                <span className="text-xl text-tv-accent">{q.current?.destination ?? ""}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <footer className="flex items-center gap-8 overflow-hidden border-t border-white/10 px-8 py-3 text-lg text-tv-muted">
        {calls.length === 0 ? (
          <span>Sem chamadas ainda hoje</span>
        ) : (
          calls.slice(0, 8).map((c) => (
            <span key={c.id} className="whitespace-nowrap">
              <span className="ticket-number text-tv-foreground">{c.full_ticket}</span>
              {" · "}
              {c.destination ?? "Balcão"}
              {" · "}
              {timeLisbon(c.called_at, timezone)}
            </span>
          ))
        )}
      </footer>

      {overlay && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-tv/95 backdrop-blur">
          <p className="text-3xl font-semibold text-tv-muted">
            {overlay.lang === "en" ? "Ticket" : "Senha"}
          </p>
          <p className="ticket-number mt-4 text-[14rem] leading-none text-tv-foreground">
            {overlay.full_ticket}
          </p>
          <p className="mt-6 text-5xl font-bold text-tv-accent">{overlay.destination ?? ""}</p>
        </div>
      )}
    </main>
  );
}
