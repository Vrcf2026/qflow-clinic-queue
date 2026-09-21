import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  QUEUE_STRATEGIES,
  QUEUE_STRATEGY_HINTS,
  QUEUE_STRATEGY_LABELS,
  type PriorityRatio,
  type QueueStrategy,
} from "@/lib/qflow";

type Value = { strategy: QueueStrategy | null; ratio: PriorityRatio };

/**
 * Escolha da regra de ordenação. Usada para a clínica (allowInherit = false) e
 * para cada balcão/gabinete (allowInherit = true → "Seguir a regra da clínica").
 * Só quem pode gerir a configuração vê os controlos ativos.
 */
export function StrategyPicker({
  strategy,
  ratio,
  allowInherit = false,
  canEdit,
  inheritedLabel,
  compact = false,
  onSave,
}: {
  strategy: QueueStrategy | null;
  ratio: PriorityRatio;
  allowInherit?: boolean;
  canEdit: boolean;
  inheritedLabel?: string | undefined;
  compact?: boolean;
  onSave: (strategy: QueueStrategy | null, ratio: PriorityRatio) => void | Promise<void>;
}) {
  const [value, setValue] = useState<Value>({ strategy, ratio });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue({ strategy, ratio });
  }, [strategy, ratio.priority, ratio.normal]);

  const dirty =
    value.strategy !== strategy ||
    value.ratio.priority !== ratio.priority ||
    value.ratio.normal !== ratio.normal;

  const save = async () => {
    setBusy(true);
    await onSave(value.strategy, value.ratio);
    setBusy(false);
  };

  if (!canEdit) {
    return (
      <p className="text-sm text-muted-foreground">
        Regra em vigor:{" "}
        <span className="font-semibold text-foreground">
          {value.strategy ? QUEUE_STRATEGY_LABELS[value.strategy] : (inheritedLabel ?? "—")}
        </span>
        {value.strategy === "alternado" &&
          ` · ${value.ratio.priority} prioritária(s) por ${value.ratio.normal} normal(is)`}
        <br />
        Só o chefe de turno ou a administração pode alterar.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className={compact ? "flex flex-wrap gap-2" : "grid gap-2 sm:grid-cols-2"}>
        {allowInherit && (
          <button
            onClick={() => setValue((v) => ({ ...v, strategy: null }))}
            className={`rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors ${
              value.strategy === null
                ? "border-primary bg-primary/10 text-foreground"
                : "bg-card text-muted-foreground hover:bg-accent"
            }`}
          >
            Seguir a regra da clínica
            {inheritedLabel ? (
              <span className="block text-xs font-normal text-muted-foreground">
                {inheritedLabel}
              </span>
            ) : null}
          </button>
        )}
        {QUEUE_STRATEGIES.map((s) => (
          <button
            key={s}
            onClick={() => setValue((v) => ({ ...v, strategy: s }))}
            className={`rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors ${
              value.strategy === s
                ? "border-primary bg-primary/10 text-foreground"
                : "bg-card text-muted-foreground hover:bg-accent"
            }`}
          >
            {QUEUE_STRATEGY_LABELS[s]}
            {!compact && (
              <span className="block text-xs font-normal text-muted-foreground">
                {QUEUE_STRATEGY_HINTS[s]}
              </span>
            )}
          </button>
        ))}
      </div>

      {value.strategy === "alternado" && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl bg-muted p-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Prioritárias seguidas</Label>
            <Input
              type="number"
              min={1}
              className="w-24"
              value={value.ratio.priority}
              onChange={(e) =>
                setValue((v) => ({
                  ...v,
                  ratio: { ...v.ratio, priority: Math.max(1, Number(e.target.value) || 1) },
                }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Normais seguidas</Label>
            <Input
              type="number"
              min={1}
              className="w-24"
              value={value.ratio.normal}
              onChange={(e) =>
                setValue((v) => ({
                  ...v,
                  ratio: { ...v.ratio, normal: Math.max(1, Number(e.target.value) || 1) },
                }))
              }
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Ex.: {value.ratio.priority} prioritária(s) e depois {value.ratio.normal} normal(is),
            repetindo.
          </p>
        </div>
      )}

      <Button size="sm" disabled={!dirty || busy} onClick={() => void save()}>
        Guardar regra
      </Button>
    </div>
  );
}
