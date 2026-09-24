/**
 * Gestão de conteúdo do painel TV
 * Suporta: streams HLS, listas M3U, vídeos MP4 por URL ou upload directo
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical, Link2, Monitor, Plus, Trash2, Upload, Tv } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type MediaType = "stream" | "m3u" | "video_url" | "video_upload";

type MediaItem = {
  id: string;
  name: string;
  type: MediaType;
  url: string;
  duration_s: number | null;
  active: boolean;
  sort_order: number;
};

const TYPE_LABELS: Record<MediaType, string> = {
  stream:       "Stream ao vivo (HLS)",
  m3u:          "Lista de canais (M3U)",
  video_url:    "Vídeo por URL (MP4/HLS)",
  video_upload: "Vídeo carregado",
};

const TYPE_ICONS: Record<MediaType, typeof Tv> = {
  stream:       Tv,
  m3u:          Monitor,
  video_url:    Link2,
  video_upload: Upload,
};

const TYPE_HINTS: Record<MediaType, string> = {
  stream:       "URL directo do stream HLS (ex: https://…/live.m3u8)",
  m3u:          "URL da lista M3U com vários canais — a TV mostra um selector",
  video_url:    "URL de um ficheiro MP4 ou stream HLS público",
  video_upload: "Carregue um ficheiro MP4 do seu computador (máx. 500 MB)",
};

// ── Lista de itens de media ─────────────────────────────────────────────────
export function TvMediaList({ orgId }: { orgId: string }) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("tv_media")
      .select("*")
      .eq("org_id", orgId)
      .order("sort_order")
      .order("created_at");
    setItems((data as MediaItem[]) ?? []);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  const toggle = async (item: MediaItem) => {
    await supabase.from("tv_media").update({ active: !item.active }).eq("id", item.id);
    void load();
  };

  const remove = async (item: MediaItem) => {
    if (!confirm(`Remover "${item.name}"?`)) return;
    // Se for upload, remover também do storage
    if (item.type === "video_upload") {
      const path = item.url.split("/tv-media/")[1];
      if (path) await supabase.storage.from("tv-media").remove([path]);
    }
    await supabase.from("tv_media").delete().eq("id", item.id);
    toast.success("Item removido.");
    void load();
  };

  const moveUp = async (item: MediaItem, idx: number) => {
    if (idx === 0) return;
    const prev = items[idx - 1]!;
    await Promise.all([
      supabase.from("tv_media").update({ sort_order: prev.sort_order }).eq("id", item.id),
      supabase.from("tv_media").update({ sort_order: item.sort_order }).eq("id", prev.id),
    ]);
    void load();
  };

  if (loading) return <p className="text-sm text-muted-foreground">A carregar…</p>;

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-muted/40 p-6 text-center text-sm text-muted-foreground">
        Sem conteúdo configurado. Adicione um stream, lista M3U ou vídeo abaixo.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item, idx) => {
        const Icon = TYPE_ICONS[item.type];
        return (
          <div
            key={item.id}
            className={`flex items-center gap-3 rounded-xl border p-3 transition-opacity ${item.active ? "" : "opacity-50"}`}
          >
            <button onClick={() => void moveUp(item, idx)} className="text-muted-foreground hover:text-foreground" title="Mover para cima">
              <GripVertical className="size-4" />
            </button>
            <Icon className="size-4 flex-shrink-0 text-primary" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{item.name}</p>
              <p className="text-xs text-muted-foreground truncate">{TYPE_LABELS[item.type]}{item.duration_s ? ` · ${item.duration_s}s` : ""}</p>
            </div>
            <Switch checked={item.active} onCheckedChange={() => void toggle(item)} />
            <button onClick={() => void remove(item)} className="text-muted-foreground hover:text-destructive transition-colors">
              <Trash2 className="size-4" />
            </button>
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">Arraste ↕ para reordenar. A TV reproduz os itens activos por esta ordem.</p>
    </div>
  );
}

// ── Adicionar novo item ─────────────────────────────────────────────────────
export function TvMediaAdd({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<MediaType>("stream");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [duration, setDuration] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => { setName(""); setUrl(""); setDuration(""); setOpen(false); };

  const save = async () => {
    if (!name.trim() || (!url && type !== "video_upload")) {
      toast.error("Preencha o nome e o endereço.");
      return;
    }
    const { error } = await supabase.from("tv_media").insert({
      org_id: orgId,
      name: name.trim(),
      type,
      url,
      duration_s: duration ? parseInt(duration) : null,
      active: true,
      sort_order: 999,
    });
    if (error) { toast.error("Não foi possível guardar."); return; }
    toast.success("Conteúdo adicionado.");
    reset();
    // Forçar re-render da lista
    window.dispatchEvent(new CustomEvent("tv-media-refresh"));
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    const path = `${orgId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error: upErr } = await supabase.storage
      .from("tv-media")
      .upload(path, file, { upsert: false });
    if (upErr) { toast.error("Erro ao carregar o ficheiro."); setUploading(false); return; }
    const { data } = supabase.storage.from("tv-media").getPublicUrl(path);
    setUrl(data.publicUrl);
    if (!name) setName(file.name.replace(/\.[^.]+$/, ""));
    setUploading(false);
    toast.success("Ficheiro carregado — clique em Adicionar para guardar.");
  };

  // Escutar evento de refresh da lista (após save)
  useEffect(() => {
    const handler = () => window.location.reload();
    window.addEventListener("tv-media-refresh", handler);
    return () => window.removeEventListener("tv-media-refresh", handler);
  }, []);

  return (
    <div className="border-t pt-4">
      {!open ? (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-2 size-4" /> Adicionar conteúdo
        </Button>
      ) : (
        <div className="space-y-4 rounded-xl bg-muted/40 p-4">
          <h4 className="text-sm font-semibold">Novo item</h4>

          {/* Tipo */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(Object.keys(TYPE_LABELS) as MediaType[]).map((t) => {
              const Icon = TYPE_ICONS[t];
              return (
                <button
                  key={t}
                  onClick={() => { setType(t); setUrl(""); }}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs font-medium transition-colors ${type === t ? "border-primary bg-primary/10 text-primary" : "bg-card hover:bg-accent"}`}
                >
                  <Icon className="size-5" />
                  {TYPE_LABELS[t]}
                </button>
              );
            })}
          </div>

          <p className="text-xs text-muted-foreground">{TYPE_HINTS[type]}</p>

          {/* Nome */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Nome (para identificar na lista)</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex: RTP1 · Publicidade Verão · Canal Saúde" />
          </div>

          {/* URL ou upload */}
          {type === "video_upload" ? (
            <div className="space-y-2">
              {url ? (
                <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800">
                  <Upload className="size-4" /> Ficheiro pronto — {url.split("/").pop()}
                </div>
              ) : (
                <Button
                  variant="outline"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                  className="w-full"
                >
                  <Upload className="mr-2 size-4" />
                  {uploading ? "A carregar…" : "Escolher ficheiro MP4"}
                </Button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="video/mp4,video/webm,video/ogg"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFile(f); }}
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                {type === "stream" ? "URL do stream (HLS .m3u8)" : type === "m3u" ? "URL da lista M3U" : "URL do vídeo (MP4 ou HLS)"}
              </Label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={type === "m3u" ? "https://…/canais.m3u" : "https://…/stream.m3u8"}
              />
            </div>
          )}

          {/* Duração (para vídeos em playlist) */}
          {(type === "video_url" || type === "video_upload") && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Duração em segundos (opcional — para playlist automática)</Label>
              <Input
                type="number"
                min={5}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="ex: 30"
                className="max-w-32"
              />
            </div>
          )}

          <div className="flex gap-2">
            <Button
              disabled={!name.trim() || (!url && type !== "video_upload") || uploading}
              onClick={save}
            >
              Adicionar
            </Button>
            <Button variant="outline" onClick={reset}>Cancelar</Button>
          </div>
        </div>
      )}
    </div>
  );
}
