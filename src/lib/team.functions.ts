import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Criação de contas da equipa.
 *
 * Não há registo público: só um super_admin da plataforma ou um org_admin da
 * própria clínica pode criar contas. O papel do chamador é validado no servidor
 * (nunca no browser) antes de usar a API de administração de contas.
 */
const input = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(72),
  role: z.enum(["org_admin", "chefe_turno", "rececionista", "medico"]),
  orgId: z.string().uuid().optional(),
  deskId: z.string().uuid().nullish(),
  cabinetId: z.string().uuid().nullish(),
});

export const createTeamMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: roles } = await supabase
      .from("user_roles")
      .select("role,org_id")
      .eq("user_id", userId);

    const isSuper = (roles ?? []).some((r) => r.role === "super_admin");
    const adminOrg = (roles ?? []).find((r) => r.role === "org_admin")?.org_id ?? null;
    const orgId = isSuper ? (data.orgId ?? adminOrg) : adminOrg;

    if (!isSuper && !adminOrg) return { error: "forbidden" as const };
    if (!orgId) return { error: "org_required" as const };
    if (!isSuper && data.orgId && data.orgId !== adminOrg) return { error: "forbidden" as const };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const created = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { name: data.name },
    });
    if (created.error || !created.data.user) {
      return { error: created.error?.message ?? "create_failed" };
    }
    const newId = created.data.user.id;

    const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
      id: newId,
      org_id: orgId,
      name: data.name,
      email: data.email,
      desk_id: data.deskId ?? null,
      cabinet_id: data.cabinetId ?? null,
      active: true,
    });
    if (profileError) return { error: profileError.message };

    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: newId, org_id: orgId, role: data.role });
    if (roleError) return { error: roleError.message };

    return { ok: true as const, userId: newId };
  });
