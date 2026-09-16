# QFlow — correções e melhorias

Plano que responde ponto a ponto às tuas decisões.

## 1. Relógio único (fuso da aplicação)
Hoje o "dia de serviço" e as contagens usam o relógio do computador de quem está a usar. Passa tudo para o relógio do servidor, no fuso configurado na clínica (Europe/Lisbon por omissão).

- Todas as listas do dia, contadores e estatísticas passam a vir de funções no servidor.
- Os ecrãs (TV, receção, gabinete, turno, painéis) recebem também a hora do servidor e mostram-na, em vez de usarem a hora local.
- O relógio da TV sincroniza com o servidor e corrige desvios automaticamente.

## 2. Médico ligado a um gabinete
- O médico só vê senhas das filas atribuídas ao gabinete dele.
- Sem gabinete atribuído, o ecrã explica que falta atribuição e não mostra dados.
- A regra é aplicada também ao nível da base de dados, não só no ecrã.

## 3. Utilizadores criados previamente (sem registo público)
- Remove-se a criação de conta no ecrã de entrada e a atribuição automática de administrador ao primeiro utilizador.
- Passa a existir criação de utilizadores:
  - pelo gestor da plataforma (qualquer clínica);
  - pelo administrador da clínica (só a sua clínica, e só papéis abaixo do seu).
- Ao criar: nome, email, palavra-passe inicial, papel, balcão/gabinete. O utilizador pode depois alterar a palavra-passe.
- Desativar utilizador bloqueia o acesso imediatamente.

## 4. Senhas saltadas não se perdem
- "Saltar" deixa de apagar a prioridade: a senha volta à fila depois de N senhas (configurável por clínica, por omissão 3).
- Cada senha regista quantas vezes foi saltada; ao fim do limite (por omissão 3) passa a "Faltou" automaticamente.
- Uma senha marcada "Faltou" pode ser recuperada pela receção durante um período configurável.
- Histórico completo: cada chamada, salto e recuperação fica registado.

## 5. Acesso restrito
- Remove-se o acesso público de leitura às tabelas. A TV, o quiosque e a página de acompanhamento passam a ler só através de funções próprias com o token do equipamento ou o código da senha.
- A página de acompanhamento nunca devolve nome de doente nem número de utente.

## 7. Funções documentadas
Todas as funções da base de dados passam a ter descrição e um documento `docs/backend.md` com o que cada uma faz, quem pode chamar e o que devolve.

## 9. Balcões configuráveis
- Cada balcão define que filas atende e com que ordem de preferência (ex.: um balcão só faturação; outros atendem faturação e mais filas).
- A ordem de retirada de senhas segue essa preferência, depois prioritários, depois ordem de chegada.
- Tudo editável no painel de administração da clínica e pelo chefe de turno.

## 10. Fora do Google
- Quiosque, TV, acompanhamento e todas as áreas internas ficam marcadas como não indexáveis e bloqueadas no ficheiro de robôs. Só a página inicial pública fica visível.

## Outras decisões aplicadas
- Re-chamar mantém-se.
- Ordenação da fila: prioritários primeiro, depois ordem de chegada, com as saltadas a reentrar na posição definida no ponto 4.
- Sem convites por email.
- SMS fica para depois (nada é implementado agora).
- Senhas emitidas apenas no quiosque; a receção não emite.
- QR do talão: ao ler com o telemóvel abre a página de acompanhamento, que pede autorização de notificação e alerta em ecrã inteiro quando a senha é chamada.

## Estatísticas
- Administrador da clínica: novo separador com gráficos — senhas por dia, por fila, por balcão, tempos médios de espera e de atendimento, taxa de faltas, horas de maior movimento, com filtro de período.
- Gestor da plataforma: visão global — senhas por clínica, evolução no tempo, clínicas e equipamentos ativos, comparação entre clínicas.

## Notas técnicas
- Novas colunas em `tickets`: `skip_count`, `recall_count`, `last_skipped_at`; novas colunas em `organizations`: `skip_reinsert_after`, `max_skips`, `missed_recovery_minutes`; `desks.queue_ids` passa a lista ordenada com preferência.
- Nova tabela `ticket_events` (auditoria de emissão, chamada, salto, falta, recuperação, conclusão).
- Novas funções: `org_now()`, `org_day_bounds()`, `next_ticket_for_desk()`, `skip_ticket()`, `org_stats()`, `platform_stats()`; remoção de `bootstrap_access`.
- Criação de utilizadores por server function com verificação de papel antes de usar a API de administração.
- Remoção das políticas `anon SELECT` em `tickets`, `queues`, `desks`, `cabinets`, `call_log`, `organizations`; substituídas por funções com token.
- Estatísticas com Recharts (já disponível no projeto).
