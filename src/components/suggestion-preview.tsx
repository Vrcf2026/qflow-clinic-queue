import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, PlayCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { QUEUE_STRATEGY_LABELS, isQueueStrategy } from "@/lib/qflow";
import { simulateCalls, type SimPost, type SimResult } from "@/lib/simulate-queue";

type Rule = { strategy: string; priority: number; normal: number };

type QueueDiff = {
  prefix: string;
  name: string;
  estado: "nova" | "alterada" | "igual";
  campos: { campo: string; antes: string; depois: string }[];
  color: string;
  avg_duration_minutes: number;
  priority_enabled: boolean;
  motivo: string;
};

type PostDiff = {
  name: string;
  tipo: "balcao" | "gabinete";
  estado: "novo" | "alterado";
  filas: string[];
  strategy: string | null;
  priority: number | null;
  normal: number | null;
  motivo: string;
  antes: { strategy: string | null; priority: number | null; normal: number | null; filas: string[] } | null;
};

type Preview = {
  error?: string;
  atual: {
    clinica: Rule;
    filas: { prefix: string; name: string; color: string; avg_duration_minutes: number }[];
    balcoes: { name: string; filas: string[] }[];
    gabinetes: { name: string; filas: string[] }[];
  };
  diff: {
    filas: QueueDiff[];
    balcoes: PostDiff[];
    gabinetes: PostDiff[];
    clinica: { antes: Rule; depois: Rule | null; motivo: string };
  };
  validacoes: { nivel: "erro" | "aviso"; mensagem: string }[];
  erros: number;
};

function ruleLabel(rule: { strategy: string | null; priority: number | null; normal: number | null } | null) {
  if (!rule || !rule.strategy) return "Segue a regra da clínica";
  const label = isQueueStrategy(rule.strategy) ? QUEUE_STRATEGY_LABELS[rule.strategy] : rule.strategy;
  if (rule.strategy === "alternado") return `${label} (${rule.priority ?? 2}:${rule.normal ?? 1})`;
  return label;
}

const ESTADO_STYLE: Record<string, string> = {
  nova: "bg-primary/10 text-primary",
  novo: "bg-primary/10 text-primary",
  alterada: "bg-warning/15 text-warning-foreground",
  alterado: "bg-warning/15 text-warning-foreground",
  igual: "bg-muted text-muted-foreground",
};

const ESTADO_LABEL: Record<string, string> = {
  nova: "nova",
  novo: "novo",
  alterada: "muda",
  alterado: "muda",
  igual: "sem alteração",
};

/**
 * Pré-visualização de uma sugestão da IA: compara com a configuração atual,
 * mostra as validações e simula as chamadas antes de aplicar.
 */
export function SuggestionPreview({
  id,
  open,
  onOpenChange,
  canApply,
  applying,
  onApply,
}: {
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canApply: boolean;
  applying: boolean;
  onApply: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [sim, setSim] = useState<SimResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(null);
    const { data, error } = await supabase.rpc("preview_config_suggestion", { p_id: id });
    setLoading(false);
    const payload = (data ?? null) as Preview | null;
    if (error || !payload || payload.error) {
      const code = String(payload?.error ?? error?.message ?? "");
      setFailed(
        code === "forbidden"
          ? "Não tem autorização para ver esta pré-visualização."
          : code === "not_found"
            ? "Sugestão não encontrada."
            : "Não foi possível preparar a pré-visualização.",
      );
      return;
    }
    setPreview(payload);
    setSim(null);
  }, [id]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const runSim = () => {
    if (!preview) return;
    const clinic: Rule = preview.diff.clinica.depois ?? preview.diff.clinica.antes;
    const known = new Map(
      preview.atual.filas.map((q) => [
        q.prefix.toUpperCase(),
        {
          prefix: q.prefix.toUpperCase(),
          name: q.name,
          color: q.color,
          avg_duration_minutes: q.avg_duration_minutes,
          priority_enabled: true,
        },
      ]),
    );
    preview.diff.filas.forEach((q) =>
      known.set(q.prefix, {
        prefix: q.prefix,
        name: q.name,
        color: q.color,
        avg_duration_minutes: q.avg_duration_minutes,
        priority_enabled: q.priority_enabled,
      }),
    );

    const posts: SimPost[] = [...preview.diff.balcoes, ...preview.diff.gabinetes].map((p) => ({
      name: p.name,
      tipo: p.tipo,
      filas: p.filas.map((f) => f.toUpperCase()),
      strategy: p.strategy,
      priority: p.priority,
      normal: p.normal,
    }));
    const used = new Set(posts.flatMap((p) => p.filas));
    const queues = [...known.values()].filter((q) => used.has(q.prefix) || preview.diff.filas.some((d) => d.prefix === q.prefix));
    setSim(simulateCalls(queues, posts, clinic));
  };

  const erros = preview?.erros ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pré-visualização da configuração sugerida</DialogTitle>
          <DialogDescription>
            Compare com a configuração atual, verifique os alertas e simule as chamadas. Nada é
            alterado até carregar em &quot;Aplicar&quot;.
          </DialogDescription>
        </DialogHeader>

        {loading && <p className="text-sm text-muted-foreground">A preparar a comparação...</p>}
        {failed && <p className="text-sm text-destructive">{failed}</p>}

        {preview && (
          <div className="space-y-5">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Verificações
              </h3>
              {preview.validacoes.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-success">
                  <CheckCircle2 className="size-4" /> Sem problemas detetados.
                </p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {preview.validacoes.map((v, i) => (
                    <li key={`${v.nivel}-${i}`} className="flex items-start gap-2">
                      {v.nivel === "erro" ? (
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                      ) : (
                        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className={v.nivel === "erro" ? "text-destructive" : "text-muted-foreground"}>
                        {v.mensagem}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Filas
              </h3>
              <ul className="space-y-2 text-sm">
                {preview.diff.filas.map((q) => (
                  <li key={q.prefix} className="rounded-xl border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="size-3 rounded-full" style={{ backgroundColor: q.color }} />
                      <span className="font-medium">
                        {q.prefix} · {q.name}
                      </span>
                      <Tag estado={q.estado} />
                    </div>
                    {q.campos.length > 0 && (
                      <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                        {q.campos.map((c) => (
                          <li key={c.campo}>
                            {c.campo}: <s>{c.antes}</s> → <strong>{c.depois}</strong>
                          </li>
                        ))}
                      </ul>
                    )}
                    {q.motivo && <p className="mt-1 text-xs text-muted-foreground">{q.motivo}</p>}
                  </li>
                ))}
                {preview.diff.filas.length === 0 && (
                  <li className="text-muted-foreground">A sugestão não propõe filas.</li>
                )}
              </ul>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Regra da clínica
              </h3>
              <p className="text-sm">
                <s className="text-muted-foreground">{ruleLabel(preview.diff.clinica.antes)}</s> →{" "}
                <strong>
                  {preview.diff.clinica.depois
                    ? ruleLabel(preview.diff.clinica.depois)
                    : ruleLabel(preview.diff.clinica.antes) + " (sem alteração)"}
                </strong>
              </p>
              {preview.diff.clinica.motivo && (
                <p className="text-xs text-muted-foreground">{preview.diff.clinica.motivo}</p>
              )}
            </section>

            {(["balcoes", "gabinetes"] as const).map((key) => (
              <section key={key} className="space-y-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {key === "balcoes" ? "Balcões" : "Gabinetes"}
                </h3>
                <ul className="space-y-2 text-sm">
                  {preview.diff[key].map((p) => (
                    <li key={p.name} className="rounded-xl border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{p.name}</span>
                        <Tag estado={p.estado} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Filas: {p.antes ? <s>{p.antes.filas.join(" → ") || "nenhuma"}</s> : null}{" "}
                        {p.antes ? "→ " : ""}
                        <strong>{p.filas.join(" → ") || "nenhuma"}</strong>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Regra: {p.antes ? <s>{ruleLabel(p.antes)}</s> : null} {p.antes ? "→ " : ""}
                        <strong>{ruleLabel(p)}</strong>
                      </p>
                      {p.motivo && <p className="mt-1 text-xs text-muted-foreground">{p.motivo}</p>}
                    </li>
                  ))}
                  {preview.diff[key].length === 0 && (
                    <li className="text-muted-foreground">Sem alterações propostas.</li>
                  )}
                </ul>
              </section>
            ))}

            <section className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Simulação de chamadas
                </h3>
                <Button size="sm" variant="outline" type="button" onClick={runSim}>
                  <PlayCircle className="mr-2 size-4" /> {sim ? "Simular outra vez" : "Simular"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Cria senhas fictícias em cada fila (uma em cada três prioritária) e mostra por que
                ordem cada posto as chamaria com estas regras. Não grava nada.
              </p>
              {sim && (
                <div className="space-y-2">
                  {sim.notes.map((n) => (
                    <p key={n} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <Info className="mt-0.5 size-4 shrink-0" /> {n}
                    </p>
                  ))}
                  {sim.calls.length > 0 && (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Espera máxima (em chamadas): prioritários {sim.maxWaitPriority} · normais{" "}
                        {sim.maxWaitNormal}
                      </p>
                      <ol className="grid gap-1 text-sm sm:grid-cols-2">
                        {sim.calls.map((c) => (
                          <li
                            key={c.step}
                            className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5"
                          >
                            <span className="w-6 text-xs text-muted-foreground">{c.step}.</span>
                            <span className="size-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                            <span className="font-semibold">{c.ticket}</span>
                            {c.priority && (
                              <span className="rounded bg-primary/10 px-1.5 text-xs font-semibold text-primary">
                                prioritário
                              </span>
                            )}
                            <span className="ml-auto text-xs text-muted-foreground">{c.post}</span>
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                </div>
              )}
            </section>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {erros > 0
              ? "Corrija a sugestão (gere outra) — há erros que impedem aplicar."
              : "Ao aplicar, as alterações ficam registadas na auditoria."}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
            <Button type="button" onClick={onApply} disabled={!canApply || applying || erros > 0 || !preview}>
              {applying ? "A aplicar..." : "Aplicar"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Tag({ estado }: { estado: string }) {
  return (
    <span className={`rounded-lg px-2 py-0.5 text-xs font-semibold ${ESTADO_STYLE[estado] ?? "bg-muted"}`}>
      {ESTADO_LABEL[estado] ?? estado}
    </span>
  );
}
