import { useCallback, useEffect, useState } from "react";
import { Sparkle, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { suggestClinicConfig } from "@/lib/config-assistant.functions";
import { QUEUE_STRATEGY_LABELS, isQueueStrategy, timeLisbon } from "@/lib/qflow";
import { SuggestionPreview } from "@/components/suggestion-preview";

type Post = {
  name: string;
  filas: string[];
  strategy: string | null;
  priority: number | null;
  normal: number | null;
  motivo: string;
};

type Suggestion = {
  resumo: string;
  filas: {
    name: string;
    name_en: string | null;
    prefix: string;
    color: string;
    priority_enabled: boolean;
    avg_duration_minutes: number;
    motivo: string;
  }[];
  balcoes: Post[];
  gabinetes: Post[];
  clinica: { strategy: string; priority: number; normal: number; motivo: string };
  avisos: string[];
};

type Row = {
  id: string;
  created_at: string;
  prompt: string;
  status: string;
  suggestion: Suggestion;
};

const EXAMPLE =
  "Somos uma clínica com muita faturação ao início da manhã, dois médicos de família e análises clínicas. Queremos um balcão só para faturação e que os utentes prioritários sejam chamados primeiro, mas sem deixar os normais à espera demasiado tempo.";

function strategyLabel(value: string | null, ratio?: { priority: number; normal: number } | null) {
  if (!value) return "Segue a regra da clínica";
  const label = isQueueStrategy(value) ? QUEUE_STRATEGY_LABELS[value] : value;
  if (value === "alternado" && ratio) return `${label} (${ratio.priority}:${ratio.normal})`;
  return label;
}

/**
 * Assistente de configuração: o gestor descreve as necessidades da clínica em
 * texto livre, a IA propõe filas, balcões, gabinetes e regras de prioridade, e
 * só quem tem autorização (chefe de turno ou superior) pode aplicar.
 */
export function ConfigAssistant({
  timezone = "Europe/Lisbon",
  canApply,
  onApplied,
}: {
  timezone?: string;
  canApply: boolean;
  onApplied?: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("config_suggestions")
      .select("id,created_at,prompt,status,suggestion")
      .order("created_at", { ascending: false })
      .limit(10);
    setRows((data ?? []) as unknown as Row[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = async () => {
    if (prompt.trim().length < 10) {
      toast.error("Descreva as necessidades da clínica com um pouco mais de detalhe.");
      return;
    }
    setBusy(true);
    let result: Awaited<ReturnType<typeof suggestClinicConfig>>;
    try {
      result = await suggestClinicConfig({ data: { prompt: prompt.trim() } });
    } catch (error) {
      setBusy(false);
      console.error(error);
      toast.error("Não foi possível falar com o assistente. Tente novamente.");
      return;
    }
    setBusy(false);
    if ("error" in result && result.error) {
      const map: Record<string, string> = {
        forbidden: "Não tem autorização para usar o assistente.",
        org_required: "A sua conta não está associada a uma clínica.",
        ai_key_missing: "A ligação à IA não está configurada.",
      };
      toast.error(map[result.error] ?? `Não foi possível gerar a sugestão: ${result.error}`);
      return;
    }
    toast.success("Sugestão pronta. Reveja antes de aplicar.");
    setPrompt("");
    void load();
  };

  const apply = async (id: string) => {
    setApplying(id);
    const { data, error } = await supabase.rpc("apply_config_suggestion", { p_id: id });
    setApplying(null);
    const payload = (data ?? {}) as Record<string, unknown>;
    if (error || payload["error"]) {
      const code = String(payload["error"] ?? error?.message ?? "");
      const map: Record<string, string> = {
        forbidden: "Só o chefe de turno ou a administração podem aplicar.",
        already_applied: "Esta sugestão já foi aplicada.",
        not_found: "Sugestão não encontrada.",
      };
      toast.error(map[code] ?? `Não foi possível aplicar: ${code}`);
      return;
    }
    toast.success(
      `Aplicado: ${String(payload["queues_created"] ?? 0)} fila(s) nova(s), ${String(
        payload["queues_updated"] ?? 0,
      )} atualizada(s), ${String(payload["desks_created"] ?? 0)} balcão(ões) e ${String(
        payload["cabinets_created"] ?? 0,
      )} gabinete(s) criados.`,
    );
    setPreviewId(null);
    void load();
    onApplied?.();
  };

  const discard = async (id: string) => {
    await supabase.from("config_suggestions").update({ status: "descartada" }).eq("id", id);
    void load();
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border bg-card p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Wand2 className="size-5 text-primary" /> Assistente de configuração
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Descreva por palavras suas como a clínica funciona e o que precisa. A aplicação propõe
          filas, balcões, gabinetes e regras de prioridade. Nada é alterado até carregar em
          &quot;Aplicar&quot;.
        </p>
        <Textarea
          className="mt-4 min-h-32"
          placeholder={EXAMPLE}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={busy || !canApply}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button onClick={generate} disabled={busy || !canApply}>
            <Sparkle className="mr-2 size-4" />
            {busy ? "A preparar sugestão..." : "Gerar sugestão"}
          </Button>
          <Button
            variant="outline"
            onClick={() => setPrompt(EXAMPLE)}
            disabled={busy || !canApply}
            type="button"
          >
            Usar exemplo
          </Button>
          {!canApply && (
            <span className="text-sm text-muted-foreground">
              Só o chefe de turno ou a administração podem usar o assistente.
            </span>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ainda não há sugestões guardadas.</p>
      ) : (
        rows.map((row) => (
          <article key={row.id} className="rounded-2xl border bg-card p-5">
            <header className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold">
                {timeLisbon(new Date(row.created_at), timezone)}
              </span>
              <span
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                  row.status === "aplicada"
                    ? "bg-success text-success-foreground"
                    : row.status === "descartada"
                      ? "bg-muted text-muted-foreground"
                      : "bg-primary/10 text-primary"
                }`}
              >
                {row.status}
              </span>
              {row.status === "pendente" && canApply && (
                <div className="ml-auto flex gap-2">
                  <Button size="sm" onClick={() => setPreviewId(row.id)}>
                    Pré-visualizar e simular
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void discard(row.id)}>
                    Descartar
                  </Button>
                </div>
              )}
            </header>

            <p className="mt-3 text-sm italic text-muted-foreground">&ldquo;{row.prompt}&rdquo;</p>
            <p className="mt-3 text-sm">{row.suggestion?.resumo}</p>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Block title="Filas">
                {(row.suggestion?.filas ?? []).map((q) => (
                  <li key={q.prefix} className="flex flex-wrap items-center gap-2">
                    <span className="size-3 rounded-full" style={{ backgroundColor: q.color }} />
                    <span className="font-medium">
                      {q.prefix} · {q.name}
                    </span>
                    <span className="text-muted-foreground">
                      {q.avg_duration_minutes} min{q.priority_enabled ? " · com prioritários" : ""}
                    </span>
                    <span className="w-full text-xs text-muted-foreground">{q.motivo}</span>
                  </li>
                ))}
              </Block>
              <Block title="Regra da clínica">
                <li>
                  <span className="font-medium">
                    {strategyLabel(row.suggestion?.clinica?.strategy ?? null, {
                      priority: row.suggestion?.clinica?.priority ?? 2,
                      normal: row.suggestion?.clinica?.normal ?? 1,
                    })}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {row.suggestion?.clinica?.motivo}
                  </span>
                </li>
              </Block>
              <Block title="Balcões">
                {(row.suggestion?.balcoes ?? []).map((d) => (
                  <PostItem key={d.name} post={d} />
                ))}
              </Block>
              <Block title="Gabinetes">
                {(row.suggestion?.gabinetes ?? []).map((c) => (
                  <PostItem key={c.name} post={c} />
                ))}
              </Block>
            </div>

            {(row.suggestion?.avisos ?? []).length > 0 && (
              <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {row.suggestion.avisos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
          </article>
        ))
      )}

      {previewId && (
        <SuggestionPreview
          id={previewId}
          open
          onOpenChange={(next) => {
            if (!next) setPreviewId(null);
          }}
          canApply={canApply}
          applying={applying === previewId}
          onApply={() => void apply(previewId)}
        />
      )}
    </div>
  );
}

function PostItem({ post }: { post: Post }) {
  return (
    <li>
      <span className="font-medium">{post.name}</span>
      <span className="text-muted-foreground"> · {post.filas.join(" → ") || "sem filas"}</span>
      <span className="block text-xs text-muted-foreground">
        {strategyLabel(post.strategy, { priority: post.priority ?? 2, normal: post.normal ?? 1 })} —{" "}
        {post.motivo}
      </span>
    </li>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-muted p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <ul className="mt-2 space-y-2 text-sm">{children}</ul>
    </div>
  );
}
