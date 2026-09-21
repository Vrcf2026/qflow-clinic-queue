# Regra de ordenação da fila configurável por clínica

## O que muda para quem usa

Cada clínica passa a escolher **como o sistema decide qual é a próxima senha**. Três opções:

1. **Ordem de chegada (FIFO)** — primeiro a chegar, primeiro a ser chamado. As senhas prioritárias
   não passam à frente.
2. **Prioritários primeiro** (comportamento atual, opção por omissão) — senhas prioritárias à frente,
   depois ordem de chegada.
3. **Atendimentos mais rápidos primeiro** — prioritários à frente e, a seguir, dá preferência às filas
   com duração média de atendimento mais curta (campo "duração média" de cada fila), para reduzir a
   espera geral. Empates resolvem-se pela ordem de chegada.

Quem pode alterar: **chefe de turno, administrador da clínica e super administrador**. O recepcionista
e o médico apenas vêem a regra em vigor, sem a poder mudar.

Onde aparece:
- **Turno**: novo cartão "Regra de ordenação da fila" com as três opções, uma frase a explicar cada uma
  e a indicação de quem a pode alterar.
- **Administração da clínica → Configurações**: a mesma escolha, junto às regras de saltos.
- **Receção / Gabinete / Quiosque / TV**: a regra escolhida é aplicada automaticamente — listas de
  espera, botão "Chamar próximo", posição na fila e tempo estimado do talão passam todos a seguir a
  mesma regra.

## Detalhes técnicos

### Base de dados (migração)
- `organizations.queue_strategy text not null default 'prioridade'` com
  `check (queue_strategy in ('fifo','prioridade','duracao'))`.
- Escrita já coberta pela política existente `org_update` (super admin ou org_admin). Para permitir o
  chefe de turno, alargar a política de update de `organizations` a `private.can_manage_org_config()`.
  Para evitar que o chefe de turno altere plano/módulos, a alteração passa por uma nova função
  `public.set_queue_strategy(p_strategy text)` (SECURITY DEFINER) que valida
  `private.can_manage_org_config()` e grava só esta coluna, registando o evento.
- Funções recriadas para aplicarem a regra, via helper `private.ticket_order_key(strategy, priority, sort_at, avg_minutes)`
  ou expressão equivalente em `ORDER BY`:
  - `next_ticket_for_desk` — mantém a ordem de preferência das filas do balcão; com `duracao`, entre as
    filas do balcão com senhas em espera escolhe a de menor `avg_duration_minutes`.
  - `issue_ticket` e `ticket_status` — cálculo de `position`/`wait_minutes` coerente com a regra.
  - `tv_state` e `device_context` — pré-visualização das próximas senhas pela mesma regra.
  - `my_access` e `device_context` devolvem `queue_strategy` para o ecrã aplicar a mesma ordem.

### Frontend
- `src/lib/qflow.ts`: tipo `QueueStrategy`, `QUEUE_STRATEGY_LABELS` + descrições, e
  `makeQueueOrder(strategy, queues)` que devolve o comparador (substitui o uso direto de `queueOrder`,
  que passa a ser o caso `prioridade`).
- `src/routes/_authenticated/org.recepcao.tsx` e `org.gabinete.tsx`: usam `makeQueueOrder` com a
  estratégia da sessão.
- `src/routes/_authenticated/org.turno.tsx`: cartão de escolha da regra (chama `set_queue_strategy`,
  botões desativados sem permissão) + `session.reload()`.
- `src/routes/_authenticated/org.dashboard.tsx`: mesma escolha no separador Configurações.
- `src/routes/quiosque.tsx` e `tv.tsx`: aplicam a ordem devolvida pelo servidor (nenhuma reordenação
  local divergente).
- `src/lib/ticket-actions.ts`: `setQueueStrategy()`.
- `docs/backend.md`: nova secção "Regra de ordenação da fila" e atualização de "Ordem de chamada".
