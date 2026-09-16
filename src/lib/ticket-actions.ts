import { supabase } from "@/integrations/supabase/client";
import type { Ticket } from "@/lib/qflow";

type Target = {
  userId?: string | null | undefined;
  deskId?: string | null | undefined;
  deskName?: string | null | undefined;
  cabinetId?: string | null | undefined;
  cabinetName?: string | null | undefined;
};

export async function callTicket(ticket: Ticket, target: Target) {
  await supabase
    .from("tickets")
    .update({
      status: "chamado",
      called_at: new Date().toISOString(),
      desk_id: target.deskId ?? null,
      cabinet_id: target.cabinetId ?? null,
    })
    .eq("id", ticket.id);

  await supabase.from("call_log").insert({
    org_id: ticket.org_id,
    ticket_id: ticket.id,
    full_ticket: ticket.full_ticket,
    called_by_user_id: target.userId ?? null,
    desk_name: target.deskName ?? null,
    cabinet_name: target.cabinetName ?? null,
  });
}

export async function recallTicket(ticket: Ticket, target: Target) {
  await callTicket(ticket, target);
}

export async function startService(ticket: Ticket) {
  await supabase.from("tickets").update({ status: "em_atendimento" }).eq("id", ticket.id);
}

export async function finishTicket(ticket: Ticket) {
  await supabase
    .from("tickets")
    .update({ status: "concluido", done_at: new Date().toISOString() })
    .eq("id", ticket.id);

  if (ticket.called_at) {
    const minutes = Math.max(
      1,
      Math.round((Date.now() - new Date(ticket.called_at).getTime()) / 60000),
    );
    const { data: queue } = await supabase
      .from("queues")
      .select("avg_duration_minutes")
      .eq("id", ticket.queue_id)
      .maybeSingle();
    if (queue) {
      const blended = Math.max(1, Math.round(queue.avg_duration_minutes * 0.8 + minutes * 0.2));
      await supabase
        .from("queues")
        .update({ avg_duration_minutes: blended })
        .eq("id", ticket.queue_id);
    }
  }
}

export async function missTicket(ticket: Ticket) {
  await supabase
    .from("tickets")
    .update({ status: "faltou", done_at: new Date().toISOString() })
    .eq("id", ticket.id);
}

/** "Saltar": sends the ticket to the back of its queue. */
export async function skipTicket(ticket: Ticket) {
  await supabase
    .from("tickets")
    .update({ priority: false, created_at: new Date().toISOString() })
    .eq("id", ticket.id);
}

export async function admitTicket(ticket: Ticket, name: string, utente: string) {
  await supabase
    .from("tickets")
    .update({ patient_name: name.trim(), patient_utente: utente.trim() || null })
    .eq("id", ticket.id);
}
