import { createOpenAI } from "@ai-sdk/openai";
import { createServerFn } from "@tanstack/react-start";
import { Output, streamText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLovableAiGatewayRunIdFetch } from "@/lib/ai-gateway.server";

/**
 * Assistente de configuração.
 *
 * O gestor de turno (ou a administração) descreve por palavras próprias as
 * necessidades da clínica e o modelo devolve uma proposta de filas, balcões,
 * gabinetes e regras de prioridade. A proposta é sempre guardada em
 * config_suggestions (histórico/auditoria) e só é aplicada quando alguém com
 * autorização carregar em "Aplicar" — a aplicação acontece no servidor, na
 * função apply_config_suggestion.
 */
const MODEL = "openai/gpt-6-astra";

const StrategyEnum = z.enum(["chegada", "prioridade", "alternado", "duracao"]);

const suggestionSchema = z.object({
  resumo: z.string(),
  filas: z.array(
    z.object({
      name: z.string(),
      name_en: z.string().nullable(),
      prefix: z.string(),
      color: z.string(),
      priority_enabled: z.boolean(),
      avg_duration_minutes: z.number(),
      motivo: z.string(),
    }),
  ),
  balcoes: z.array(
    z.object({
      name: z.string(),
      filas: z.array(z.string()),
      strategy: StrategyEnum.nullable(),
      priority: z.number().nullable(),
      normal: z.number().nullable(),
      motivo: z.string(),
    }),
  ),
  gabinetes: z.array(
    z.object({
      name: z.string(),
      filas: z.array(z.string()),
      strategy: StrategyEnum.nullable(),
      priority: z.number().nullable(),
      normal: z.number().nullable(),
      motivo: z.string(),
    }),
  ),
  clinica: z.object({
    strategy: StrategyEnum,
    priority: z.number(),
    normal: z.number(),
    motivo: z.string(),
  }),
  avisos: z.array(z.string()),
});

export type ConfigSuggestion = z.infer<typeof suggestionSchema>;

const input = z.object({ prompt: z.string().min(10).max(4000) });

const SYSTEM = `És consultor de gestão de filas de espera em clínicas portuguesas e configuras o QFlow.
Responde SEMPRE em português de Portugal.
Regras do QFlow que tens de respeitar:
- Cada fila tem um prefixo curto em maiúsculas (1 a 3 letras) usado nas senhas (ex.: C-047).
- As regras de ordenação possíveis são: "chegada" (só ordem de chegada),
  "prioridade" (prioritários primeiro), "alternado" (N prioritários por M normais,
  usa os campos priority e normal) e "duracao" (atendimentos mais curtos primeiro).
- Em "balcoes" e "gabinetes", o campo "filas" lista prefixos de filas, pela ordem de
  preferência de chamada. Deixa strategy/priority/normal a null quando o posto deve
  herdar a regra da clínica.
- Reaproveita nomes e prefixos que já existam na clínica em vez de duplicar.
- Cores em hexadecimal. Duração média em minutos, realista (5 a 40).
- Em "avisos" indica riscos, pressupostos e o que deve ser confirmado por uma pessoa.`;

export const suggestClinicConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const [{ data: roles }, { data: profile }] = await Promise.all([
      supabase.from("user_roles").select("role,org_id").eq("user_id", userId),
      supabase.from("profiles").select("org_id,active").eq("id", userId).maybeSingle(),
    ]);

    const roleNames = (roles ?? []).map((r) => r.role as string);
    const canManage = roleNames.some((r) =>
      ["super_admin", "org_admin", "chefe_turno"].includes(r),
    );
    const orgId = profile?.org_id ?? (roles ?? []).find((r) => r.org_id)?.org_id ?? null;
    if (!canManage || profile?.active === false) return { error: "forbidden" as const };
    if (!orgId) return { error: "org_required" as const };

    const key = process.env["LOVABLE_API_KEY"];
    if (!key) return { error: "ai_key_missing" as const };

    const [{ data: org }, { data: queues }, { data: desks }, { data: cabinets }] =
      await Promise.all([
        supabase
          .from("organizations")
          .select("name,queue_strategy,priority_ratio,modules_enabled")
          .eq("id", orgId)
          .maybeSingle(),
        supabase
          .from("queues")
          .select("name,prefix,color,priority_enabled,avg_duration_minutes,active")
          .eq("org_id", orgId),
        supabase.from("desks").select("name,queue_ids,queue_strategy,active").eq("org_id", orgId),
        supabase
          .from("cabinets")
          .select("name,queue_ids,queue_strategy,active")
          .eq("org_id", orgId),
      ]);

    const contexto = JSON.stringify(
      { clinica: org, filas: queues ?? [], balcoes: desks ?? [], gabinetes: cabinets ?? [] },
      null,
      1,
    );

    const runIdFetch = createLovableAiGatewayRunIdFetch();
    const lovable = createOpenAI({
      baseURL: "https://ai.gateway.lovable.dev/v1",
      apiKey: key,
      headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
      fetch: runIdFetch.fetch,
    });

    let suggestion: ConfigSuggestion;
    try {
      const result = streamText({
        model: lovable.responses(MODEL),
        system: SYSTEM,
        prompt: `Configuração atual da clínica (JSON):\n${contexto}\n\nNecessidades descritas pelo gestor de turno:\n${data.prompt}\n\nPropõe a configuração completa.`,
        output: Output.object({ schema: suggestionSchema }),
        providerOptions: {
          openai: {
            forceReasoning: true,
            reasoningEffort: "medium",
            reasoningSummary: "auto",
            store: false,
            include: ["reasoning.encrypted_content"],
          },
        },
      });
      suggestion = (await result.output) as ConfigSuggestion;
    } catch (error) {
      console.error("suggestClinicConfig", error);
      const message = error instanceof Error ? error.message : "ai_failed";
      return { error: message };
    }

    const { data: row, error } = await supabase
      .from("config_suggestions")
      .insert({
        org_id: orgId,
        prompt: data.prompt,
        suggestion,
        model: MODEL,
        created_by: userId,
      })
      .select("id,created_at,prompt,suggestion,status")
      .single();
    if (error) return { error: error.message };

    return { ok: true as const, row };
  });
