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

1. Senhas prioritárias primeiro.
2. Depois a ordem de chegada, usando `sort_at` (senhas saltadas reentram mais atrás).
3. Nos balcões, `desks.queue_ids` é uma lista **ordenada**: a primeira fila da lista é servida antes das seguintes. Configurável na administração e pelo chefe de turno.

## Estatísticas

- `org_stats(de, até)` — totais, por dia, por fila, por balcão e por hora, no fuso da clínica.
- `platform_stats(de, até)` — visão global da plataforma (só `super_admin`).

## Privacidade

- Nomes de doentes e números de utente só são visíveis a contas ativas da própria clínica.
- As páginas internas estão marcadas como não indexáveis e bloqueadas em `robots.txt`.
