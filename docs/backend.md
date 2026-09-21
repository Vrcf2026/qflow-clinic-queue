# QFlow — como o backend funciona

Todas as decisões sensíveis (hora, ordem da fila, permissões) são tomadas no servidor.
O browser nunca decide o dia de serviço nem quem pode fazer o quê.

## Relógio e dia de serviço

- `org_clock()` / `my_access()` devolvem `server_now` e `day_start`.
- O ecrã calcula um desvio (`offsetMs`) entre o relógio do servidor e o do dispositivo e usa-o em todas as horas mostradas.
- `private.org_day_start(org)` calcula o início do dia de serviço a partir de `organizations.reset_time` no fuso `organizations.timezone`. A numeração das senhas reinicia em 001 por fila a cada dia de serviço.

## Papéis e acesso

- Papéis em `user_roles` (nunca no perfil): `super_admin`, `org_admin`, `chefe_turno`, `rececionista`, `medico`.
- `private.has_role`, `private.is_super_admin`, `private.current_org_id`, `private.can_manage_org_config` são usadas nas políticas RLS.
- `profiles.active = false` bloqueia imediatamente o acesso (deixa de haver org atual).
- Um médico só vê senhas das filas atribuídas ao seu gabinete — regra aplicada na RLS (`ticket_queue_visible`), não apenas no ecrã.
- Não existe registo público. As contas são criadas pelo `super_admin` ou por um `org_admin` através da função de servidor `createTeamMember`, que valida o papel do chamador antes de usar a API de administração de contas.

## Dispositivos sem sessão (quiosque e TV)

Só três funções são públicas, e todas exigem um token de dispositivo válido:

| Função | Para que serve |
| --- | --- |
| `device_context(token)` | Marca, módulos, configuração de TV, filas e relógio do servidor |
| `issue_ticket(token, fila, prioridade, idioma)` | Emite a senha, com contador diário do servidor |
| `tv_state(token)` | Estado das filas e chamadas recentes para o painel de TV |
| `ticket_status(id da senha)` | Página de acompanhamento no telemóvel |

As tabelas já não têm leitura pública: sem token não há dados.

## Ações de atendimento

Cada ação é uma função no servidor que valida permissão e grava histórico em `ticket_events`:

`call_ticket`, `start_service`, `finish_ticket`, `miss_ticket`, `skip_ticket`,
`recover_ticket`, `admit_ticket`, `reset_service_day`, `next_ticket_for_desk`.

- `finish_ticket` atualiza a duração média da fila (mistura 80% do histórico com 20% do atendimento real).
- `reset_service_day` fecha as senhas abertas do dia; a numeração reinicia na hora de reset.

## Saltar e faltas

- `skip_ticket` não apaga nem reescreve a emissão: muda apenas a chave de ordenação `sort_at`, e a senha volta à fila depois de `organizations.skip_reinsert_after` senhas (por omissão 3).
- Ao exceder `organizations.max_skips` (por omissão 3), a senha passa a falta.
- Uma falta pode ser recuperada na receção durante `organizations.missed_recovery_minutes` (por omissão 60 minutos), com `recover_ticket`.
- `tickets.skip_count` e `tickets.recall_count` guardam o rasto; `ticket_events` guarda o histórico completo.

## Ordem de chamada

A regra de ordenação é configurável por clínica e, se necessário, por posto.

| Regra (`queue_strategy`) | Como escolhe a próxima senha |
| --- | --- |
| `chegada` | Só ordem de chegada (`sort_at`); prioritários não passam à frente |
| `prioridade` | Prioritários primeiro, depois ordem de chegada (predefinição) |
| `alternado` | N prioritários por cada M normais (`organizations.priority_ratio`, ex. `{"priority":2,"normal":1}`); se um lado estiver vazio usa o outro |
| `duracao` | Entre as filas do posto, serve primeiro a de menor `queues.avg_duration_minutes`, depois prioridade e chegada |

- `organizations.queue_strategy` / `priority_ratio` são a predefinição da clínica.
- `desks.queue_strategy` / `cabinets.queue_strategy` (e os respetivos `priority_ratio`) substituem essa
  predefinição nesse posto; `NULL` herda a clínica.
- `private.effective_strategy(org, desk, cabinet)` devolve a regra em vigor e
  `private.pick_next(org, queue_ids, desk, cabinet)` devolve a próxima senha já segundo essa regra.
  `next_ticket_for_desk(desk, cabinet)` usa ambas; `issue_ticket`, `ticket_status` e `tv_state`
  calculam posição e próximas senhas com a mesma regra.
- Em `chegada`, `prioridade` e `alternado` a lista ordenada `desks.queue_ids` continua a ser a ordem de
  preferência de filas (a primeira é servida antes das seguintes).
- Alterar a regra da clínica só é possível através de `public.set_queue_strategy(strategy, ratio)`, que
  valida `private.can_manage_org_config()` (chefe de turno, administrador da clínica, super
  administrador). A regra de cada posto é escrita nas tabelas `desks`/`cabinets`, cujas políticas exigem
  a mesma permissão.


## Estatísticas

- `org_stats(de, até)` — totais, por dia, por fila, por balcão e por hora, no fuso da clínica.
- `platform_stats(de, até)` — visão global da plataforma (só `super_admin`).

## Privacidade

- Nomes de doentes e números de utente só são visíveis a contas ativas da própria clínica.
- As páginas internas estão marcadas como não indexáveis e bloqueadas em `robots.txt`.

## Quem define as filas de cada balcão

A atribuição de filas a balcões e gabinetes (`desks.queue_ids`, `cabinets.queue_ids`)
é escrita apenas por quem passa `private.can_manage_org_config()`: chefe de turno,
administrador da clínica ou super administrador. O recepcionista lê essa
configuração e não a pode alterar; se o perfil tiver `desk_id` definido, também não
pode trocar de balcão no ecrã de receção. A ordem dos ids em `queue_ids` é a ordem
de preferência de chamada.

## Primeira conta

`createFirstAdmin` (src/lib/bootstrap.functions.ts, página /setup) cria o primeiro
super administrador e deixa de funcionar assim que existir qualquer papel atribuído.
Depois disso, as contas são criadas por `createTeamMember` (super_admin para
qualquer clínica; org_admin apenas na sua).

## Registo de auditoria (`audit_log`)

Rasto completo e **inalterável**: quem, quando, em que clínica e em que dia de serviço (turno).

- A tabela `public.audit_log` só tem política de leitura. Não existem políticas de inserção,
  alteração ou remoção, por isso nenhuma conta da aplicação pode escrever nem apagar registos;
  as linhas são criadas por gatilhos `SECURITY DEFINER` (`private.audit_write`).
- **Senhas**: o gatilho `audit_ticket_events` espelha cada `ticket_events` — emitida, chamada,
  rechamada, em atendimento, concluída, faltou, saltada, recuperada e admitida — guardando fila,
  posto, se era prioritária e o motivo.
- **Configuração**: os gatilhos em `queues`, `desks` e `cabinets` registam criações, remoções e
  alterações (nome, ativo, filas atribuídas, regra de ordenação, rácio, ordem, duração média) com os
  valores antes/depois; o gatilho em `organizations` regista alterações à configuração da clínica.
- **Leitura**: `public.audit_trail(p_from, p_to, p_org, p_entity, p_action, p_limit)` — chefe de turno
  e administrador da clínica vêem só a própria clínica; o super administrador vê todas e pode filtrar
  por clínica. Os filtros de data usam o fuso da clínica.
- **Onde aparece**: separador "Auditoria" na administração da clínica, secção "Registo de auditoria"
  no ecrã de Turno e secção global em "Plataforma" (com coluna de clínica).

## Assistente de configuração (IA)

O chefe de turno (ou a administração) escreve em texto livre como a clínica
funciona e o que precisa. O servidor lê a configuração atual (filas, balcões,
gabinetes, regra em vigor), envia-a ao modelo através do Lovable AI Gateway e
recebe uma proposta estruturada: filas (nome, prefixo, cor, duração média,
prioritários), balcões e gabinetes (filas por ordem de preferência e regra
própria ou herdada) e a regra da clínica, com o motivo de cada escolha e uma
lista de avisos a confirmar por uma pessoa.

- Função de servidor: `suggestClinicConfig` (`src/lib/config-assistant.functions.ts`).
  Valida o papel do chamador (super_admin, org_admin ou chefe_turno) antes de
  chamar o modelo. A chave da IA nunca sai do servidor.
- Tabela `config_suggestions`: guarda o pedido, a proposta, o modelo, o estado
  (`pendente`, `aplicada`, `descartada`), quem pediu e quem aplicou. Leitura
  restrita a super_admin e à própria clínica (chefe de turno/administração).
- Nada muda na configuração até alguém carregar em "Aplicar". A aplicação
  acontece em `public.apply_config_suggestion(p_id)` (SECURITY DEFINER), que
  valida `private.can_manage_org_config()`, cria filas em falta (por prefixo),
  atualiza as existentes, cria/atualiza balcões e gabinetes (por nome) com as
  filas pela ordem proposta e grava a regra da clínica. Todas estas alterações
  passam pelos gatilhos de auditoria, pelo que ficam no registo imutável.
- Onde: separador "Assistente IA" na administração da clínica e secção no ecrã
  "Turno". O rececionista e o médico não têm acesso.
