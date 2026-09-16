import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Cria a primeira conta de administrador da plataforma.
 *
 * Funciona uma única vez: se já existir qualquer papel atribuído, devolve
 * `already_initialised` e não faz nada. Depois disso, todas as contas passam a
 * ser criadas por um super_admin ou por um org_admin (ver team.functions.ts).
 */
const input = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(72),
});

export const createFirstAdmin = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { count } = await supabaseAdmin
      .from("user_roles")
      .select("id", { count: "exact", head: true });
    if ((count ?? 0) > 0) return { error: "already_initialised" as const };

    const created = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { name: data.name },
    });
    if (created.error || !created.data.user) {
      return { error: created.error?.message ?? "create_failed" };
    }
    const userId = created.data.user.id;

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .upsert({ id: userId, name: data.name, email: data.email, active: true });
    if (profileError) return { error: profileError.message };

    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: "super_admin" });
    if (roleError) return { error: roleError.message };

    return { ok: true as const, userId };
  });
