import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Ticket } from "@/lib/qflow";

/**
 * Every ticket action runs on the server (SECURITY DEFINER functions), so the
 * timestamps come from the application clock — never from the operator's device.
 */

type Target = {
  deskId?: string | null | undefined;
  cabinetId?: string | null | undefined;
};

type Result = Record<string, unknown> & { error?: string };

const MESSAGES: Record<string, string> = {
  no_access: "Sem acesso: a sua conta não está ativa nesta clínica.",
  forbidden: "Não tem permissão para esta senha.",
  not_found: "Senha não encontrada.",
  not_missed: "Esta senha não está marcada como falta.",
  recovery_expired: "Já passou o prazo para recuperar esta senha.",
  name_required: "Indique o nome do doente.",
};

function handle(data: unknown): Result {
  const result = (data ?? {}) as Result;
  if (result.error) toast.error(MESSAGES[result.error] ?? "Não foi possível concluir a ação.");
  return result;
}

export async function callTicket(ticket: Ticket, target: Target, recall = false) {
  const { data } = await supabase.rpc("call_ticket", {
    p_ticket_id: ticket.id,
    p_desk_id: target.deskId ?? undefined,
    p_cabinet_id: target.cabinetId ?? undefined,
    p_recall: recall,
  });
  return handle(data);
}

export async function recallTicket(ticket: Ticket, target: Target) {
  return callTicket(ticket, target, true);
}

export async function startService(ticket: Ticket) {
  const { data } = await supabase.rpc("start_service", { p_ticket_id: ticket.id });
  return handle(data);
}

export async function finishTicket(ticket: Ticket) {
  const { data } = await supabase.rpc("finish_ticket", { p_ticket_id: ticket.id });
  return handle(data);
}

export async function missTicket(ticket: Ticket) {
  const { data } = await supabase.rpc("miss_ticket", { p_ticket_id: ticket.id });
  return handle(data);
}

/** "Saltar": the ticket keeps its place in history and comes back a few tickets later. */
export async function skipTicket(ticket: Ticket) {
  const { data } = await supabase.rpc("skip_ticket", { p_ticket_id: ticket.id });
  const result = handle(data);
  if (!result.error) {
    if (result["status"] === "faltou") {
      toast.warning(`${ticket.full_ticket} passou a falta (limite de saltos atingido).`);
    } else {
      toast.success(
        `${ticket.full_ticket} volta à fila dentro de ${String(result["reinsert_after"] ?? 3)} senhas.`,
      );
    }
  }
  return result;
}

/** Brings a missed ticket back into the queue, within the configured window. */
export async function recoverTicket(ticket: Ticket) {
  const { data } = await supabase.rpc("recover_ticket", { p_ticket_id: ticket.id });
  const result = handle(data);
  if (!result.error) toast.success(`${ticket.full_ticket} voltou à fila.`);
  return result;
}

export async function admitTicket(ticket: Ticket, name: string, utente: string) {
  const { data } = await supabase.rpc("admit_ticket", {
    p_ticket_id: ticket.id,
    p_name: name,
    p_utente: utente,
  });
  return handle(data);
}

export async function resetServiceDay() {
  const { data } = await supabase.rpc("reset_service_day");
  return handle(data);
}

/** Next ticket a desk should call, honouring the desk queue preference order. */
export async function nextTicketForDesk(deskId: string): Promise<Ticket | null> {
  const { data } = await supabase.rpc("next_ticket_for_desk", { p_desk_id: deskId });
  const result = (data ?? {}) as { ticket?: Ticket | null; error?: string };
  return result.ticket ?? null;
}
