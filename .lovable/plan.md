# Regra de ordenação da fila: por clínica e por posto

## O que muda para quem usa

Hoje já se escolhe **quais as filas** de cada balcão/gabinete (ex.: um balcão só de faturação).
Passa também a escolher-se **como cada posto decide a próxima senha**.

### Regra da clínica (predefinição)
No ecrã "Turno" e na administração, escolhe-se a regra usada por omissão em toda a clínica:

1. **Ordem de chegada** — primeiro a chegar, primeiro a ser chamado; prioritários não passam à frente.
2. **Prioritários primeiro** (predefinição atual) — prioritários à frente, depois ordem de chegada.
3. **Alternar prioritários / normais** — chama N prioritários por cada M normais (ex.: 2 prioritários,
   1 normal), para os normais não ficarem parados.
4. **Atendimentos mais rápidos primeiro** — entre as filas do posto, serve primeiro a fila com duração
   média mais curta; empates pela ordem de chegada.

### Regra por posto (balcão ou gabinete)
Cada balcão e cada gabinete pode:
- **Seguir a regra da clínica** (opção por omissão), ou
- **Ter a sua própria regra**, escolhida da mesma lista, com o seu próprio rácio prioritários:normais.

Exemplo pedido: "Balcão 2 só faturação" → filas do balcão = apenas Faturação; regra do balcão =
"Alternar prioritários / normais" com 2 prioritários por 1 normal. O "Balcão 1" pode continuar com a
regra da clínica.

Quem pode alterar: **chefe de turno, administrador da clínica e super administrador**. O recepcionista
e o médico apenas vêem a regra em vigor no seu posto, sem a poderem mudar (e continuam sem poder trocar
de balcão quando este está atribuído ao perfil).

Onde se vê o efeito: botão "Chamar próximo", lista de espera na receção e no gabinete, e a posição/tempo
estimado indicados no talão do quiosque e na página de acompanhamento.

## Detalhes técnicos

### Base de dados (migração)
- `organizations`: `queue_strategy text not null default 'prioridade'`
  (`check in ('chegada','prioridade','alternado','duracao')`),
  `priority_ratio jsonb not null default '{"priority":2,"normal":1}'`.
- `desks` e `cabinets`: `queue_strategy text null` (null = herda da clínica) com o mesmo check,
  `priority_ratio jsonb null`.
- Escrita coberta pelas políticas existentes de `desks`/`cabinets` (`can_manage_org_config`). Para
  `organizations`, nova função `public.set_queue_strategy(p_strategy text, p_ratio jsonb)` SECURITY
  DEFINER que valida `private.can_manage_org_config()` e grava só estas duas colunas (permite ao chefe
  de turno sem lhe abrir plano/módulos).
- Novo helper `private.effective_strategy(p_org uuid, p_desk uuid, p_cabinet uuid)` → `(strategy, ratio)`.
- `private.pick_next(p_org, p_queue_ids jsonb, p_strategy text, p_ratio jsonb)` devolve a próxima senha:
  - `chegada`: `sort_at ASC` (ignora prioridade);
  - `prioridade`: `priority DESC, sort_at ASC`;
  - `alternado`: conta as chamadas do dia no posto (`call_log`/`ticket_events`) e serve normal quando já
    saíram N prioritários seguidos, caso contrário prioritário; se o lado escolhido estiver vazio, usa o outro;
  - `duracao`: ordena as filas candidatas por `avg_duration_minutes ASC` e depois `priority DESC, sort_at ASC`.
  Nas regras 1, 2 e 4 a ordem das filas do posto continua a ser respeitada como preferência.
- Funções recriadas para usar o helper: `next_ticket_for_desk` (novo parâmetro opcional
  `p_cabinet_id`), `issue_ticket` e `ticket_status` (posição/tempo coerentes com a regra da clínica),
  `tv_state` (próximas senhas), `device_context` e `my_access` (devolvem a regra em vigor).

### Frontend
- `src/lib/qflow.ts`: `QueueStrategy`, `QUEUE_STRATEGY_LABELS`/descrições, `PriorityRatio`,
  `effectiveStrategy(org, post)` e `makeQueueOrder(strategy, ratio, queues)` (comparador usado nas listas).
- `src/lib/ticket-actions.ts`: `setQueueStrategy(strategy, ratio)` e `setPostStrategy(table, id, strategy, ratio)`.
- `src/routes/_authenticated/org.turno.tsx`: cartão "Regra de ordenação" da clínica + por cada balcão e
  gabinete, um seletor ("Seguir a clínica" ou regra própria) e, na regra alternada, os campos
  prioritários/normais. Controlos desativados para quem não pode gerir a configuração.
- `src/routes/_authenticated/org.dashboard.tsx`: mesma configuração no separador Configurações
  (predefinição da clínica) e nos cartões de Balcões/Gabinetes.
- `src/routes/_authenticated/org.recepcao.tsx` e `org.gabinete.tsx`: listas e "chamar próximo" seguem a
  regra do posto; mostram uma etiqueta com a regra em vigor (só leitura).
- `src/routes/quiosque.tsx`, `tv.tsx`, `espera.tsx`: usam a ordem/posição devolvida pelo servidor.
- `docs/backend.md`: secção "Ordem de chamada" reescrita com a regra da clínica, a regra por posto e o
  rácio prioritários:normais.
