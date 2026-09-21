import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { EVENT_LABELS, timeLisbon } from "@/lib/qflow";

export type AuditEntry = {
  id: string;
  created_at: string;
  day_start: string | null;
  org_id: string | null;
  org_name: string | null;
  entity: string;
  entity_id: string | null;
  entity_label: string | null;
  action: string;
  actor_name: string | null;
  actor_email: string | null;
  detail: Record<string, unknown>;
};

const ENTITY_LABELS: Record<string, string> = {
  senha: "Senha",
  fila: "Fila",
  balcao: "Balcão",
  gabinete: "Gabinete",
  clinica: "Clínica",
};

const ACTION_LABELS: Record<string, string> = {
  ...EVENT_LABELS,
  criado: "Criado",
  alterado: "Alterado",
  removido: "Removido",
  configuracao_alterada: "Configuração alterada",
};

const ENTITY_FILTERS = ["", "senha", "fila", "balcao", "gabinete", "clinica"] as const;

function today(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

function describe(entry: AuditEntry): string {
  const d = entry.detail ?? {};
  if (entry.entity === "senha") {
    const parts = [d["fila"], d["posto"]].filter(Boolean).map(String);
    if (d["prioritaria"] === true) parts.push("prioritária");
    if (d["reason"]) parts.push(`motivo: ${String(d["reason"])}`);
    return parts.join(" · ");
  }
  const after = d["depois"] as Record<string, unknown> | undefined;
  if (after) return Object.keys(after).join(", ");
  return "";
}

/**
 * Registo de auditoria imutável: quem, quando e o que fez.
 * Filtros por clínica (super administrador), dia de serviço e tipo de registo.
 */
export function AuditLog({
  orgId,
  showOrgColumn = false,
  timezone = "Europe/Lisbon",
}: {
  orgId?: string | null | undefined;
  showOrgColumn?: boolean | undefined;
  timezone?: string | undefined;
}) {
  const [from, setFrom] = useState(today(-6));
  const [to, setTo] = useState(today());
  const [entity, setEntity] = useState<string>("");
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const args: {
      p_from: string;
      p_to: string;
      p_limit: number;
      p_org?: string;
      p_entity?: string;
    } = { p_from: from, p_to: to, p_limit: 400 };
    if (orgId) args.p_org = orgId;
    if (entity) args.p_entity = entity;
    const { data } = await supabase.rpc("audit_trail", args);
    const payload = (data ?? {}) as { entries?: AuditEntry[]; error?: string };
    setError(payload.error ? "Sem permissão para consultar o registo." : null);
    setEntries(payload.entries ?? []);
    setLoading(false);
  }, [from, to, orgId, entity]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">De</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Até</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Tipo</Label>
          <select
            className="rounded-lg border bg-card px-3 py-2 text-sm"
            value={entity}
            onChange={(e) => setEntity(e.target.value)}
          >
            {ENTITY_FILTERS.map((e) => (
              <option key={e} value={e}>
                {e === "" ? "Todos" : ENTITY_LABELS[e]}
              </option>
            ))}
          </select>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          Atualizar
        </Button>
        <p className="ml-auto text-xs text-muted-foreground">
          {entries.length} registo(s) · não podem ser alterados nem apagados
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Hora</th>
              <th className="px-4 py-2">Turno (dia)</th>
              {showOrgColumn && <th className="px-4 py-2">Clínica</th>}
              <th className="px-4 py-2">Quem</th>
              <th className="px-4 py-2">Tipo</th>
              <th className="px-4 py-2">Item</th>
              <th className="px-4 py-2">Ação</th>
              <th className="px-4 py-2">Detalhe</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {entries.length === 0 && (
              <tr>
                <td className="px-4 py-4 text-muted-foreground" colSpan={showOrgColumn ? 8 : 7}>
                  Sem registos no período escolhido.
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap px-4 py-2 tabular-nums">
                  {new Date(e.created_at).toLocaleDateString("pt-PT", { timeZone: timezone })}{" "}
                  {timeLisbon(e.created_at, timezone)}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                  {e.day_start
                    ? new Date(e.day_start).toLocaleDateString("pt-PT", { timeZone: timezone })
                    : "—"}
                </td>
                {showOrgColumn && <td className="px-4 py-2">{e.org_name ?? "—"}</td>}
                <td className="px-4 py-2">
                  {e.actor_name ?? e.actor_email ?? "Dispositivo/sistema"}
                </td>
                <td className="px-4 py-2">{ENTITY_LABELS[e.entity] ?? e.entity}</td>
                <td className="px-4 py-2 font-medium">{e.entity_label ?? "—"}</td>
                <td className="px-4 py-2">{ACTION_LABELS[e.action] ?? e.action}</td>
                <td className="px-4 py-2 text-muted-foreground">{describe(e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
