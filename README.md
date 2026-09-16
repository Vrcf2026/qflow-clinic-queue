# Clinic Flow Manager

Constrói um sistema SaaS multi-tenant de gestão de senhas para clínicas em Portugal chamado "QFlow".

## Stack Técnica

- React + TypeScript + Vite

- Supabase (auth, base de dados, realtime, storage, RLS)

- Tailwind CSS

- shadcn/ui components

- React Router v6

- Supabase Realtime para atualizações em tempo real

---

## ESQUEMA DA BASE DE DADOS

### organizations

- id, name, slug, logo_url, primary_color, secondary_color

- plan (starter | pro | enterprise)

- modules_enabled: jsonb → { kiosk, tv, recepcao, gabinetes, iptv, sms, prioritarios, multi_balcao }

- tv_config: jsonb → { stream_url, m3u_url, active_channel, layout (video_esquerda | video_completo | sem_video), video_ratio, volume, silenciar_em_chamada }

- kiosk_languages: jsonb → { pt: true, en: false } — línguas ativas no quiosque

- voice_lang (pt | en)

- reset_time (ex: "08:00") — hora do reset diário de senhas

- timezone (default: Europe/Lisbon)

- created_at

### users (extends Supabase auth.users)

- id, org_id, name, email

- role: super_admin | org_admin | chefe_turno | rececionista | medico

- desk_id (nullable)

- cabinet_id (nullable)

- active (bool)

### queues

- id, org_id, name (PT), name_en (EN — para quiosque bilingue)

- prefix (C, E, P, R...)

- color, icon

- priority_enabled (bool)

- active (bool)

- order (int)

- avg_duration_minutes

### desks

- id, org_id, name (ex: Balcão 1)

- queue_ids: jsonb array

- active (bool)

### cabinets

- id, org_id, name (ex: Gabinete 1 | Dr. Silva)

- queue_ids: jsonb array

- active (bool)

### tickets

- id, org_id, queue_id

- number (int), full_ticket (ex: C-047)

- priority (bool)

- status: em_espera | chamado | em_atendimento | concluido | faltou

- patient_name (nullable)

- patient_utente (nullable)

- desk_id (nullable), cabinet_id (nullable)

- created_at, called_at, done_at

- device_origin: quiosque | qr | recepcao

- lang_used: pt | en — língua usada no quiosque ao emitir

### devices

- id, org_id, name, type: quiosque | tv

- token (uuid único)

- active (bool)

### call_log

- id, org_id, ticket_id, full_ticket

- called_by_user_id (nullable)

- called_by_device_id (nullable)

- desk_name, cabinet_name

- called_at

---

## AUTENTICAÇÃO E ROTAS

### Página de login — /login

- Email + password

- "Entrar com Google" (Supabase OAuth)

- Idioma: Português de Portugal

- Após login, redireciona conforme o papel:

  - super_admin → /admin

  - org_admin → /org/dashboard

  - chefe_turno → /org/turno

  - rececionista → /org/recepcao

  - medico → /org/gabinete

### Páginas de dispositivo (sem login — baseadas em token)

- /tv?token=xxx → painel TV

- /quiosque?token=xxx → quiosque

- Token validado na tabela devices, carrega configuração da org automaticamente

---

## PÁGINAS E MÓDULOS

### 1. QUIOSQUE — /quiosque?token=xxx

SELETOR DE IDIOMA (se org.kiosk_languages.en = true):

- Primeiro ecrã: dois botões grandes

  - 🇵🇹 Português

  - 🇬🇧 English

- Se apenas PT ativo, salta este ecrã diretamente

- A língua escolhida é guardada em lang_used no ticket

- Toda a interface muda para a língua escolhida

Passo 1 — Escolher serviço

PT: "O que pretende?"

EN: "What do you need?"

- Grelha com filas ativas: ícone, nome (PT ou EN conforme língua), pessoas em espera

Passo 2 — Prioridade (se ativo)

PT: "Tipo de atendimento" → Normal | Prioritário (idoso · grávida · deficiente)

EN: "Type of service" → Normal | Priority (elderly · pregnant · disability)

Passo 3 — Senha emitida

- Número grande (ex: C-047)

- PT: "Está em Xº lugar · ~Y minutos de espera"

- EN: "You are Xth in line · ~Y minutes wait"

- Dois botões:

  - PT: "QR para telemóvel" / EN: "QR to mobile"

  - PT: "Imprimir talão" / EN: "Print ticket"

- Talão impresso em 80mm inclui: logo, nome da org, serviço (na língua usada), número, posição, espera estimada, QR code, data e hora

- Reset automático ao início ao fim de 20 segundos

### 2. PAINEL TV — /tv?token=xxx

Ecrã inteiro, fundo escuro (#07101f).

Layout conforme org.tv_config.layout:

- video_esquerda: vídeo 65% esquerda | filas 35% direita | ticker em baixo

- sem_video: filas centradas grandes | ticker em baixo

Zona de vídeo (se módulo iptv ativo E stream configurado):

- Elemento <video> com suporte HLS (hls.js via CDN)

- Seletor de canal (overlay discreto no canto inferior do vídeo)

- Canais carregados do org.tv_config.m3u_url — parsing M3U no cliente

- Silencia automaticamente durante anúncio de chamada se silenciar_em_chamada = true

Zona de filas:

- Todas as filas ativas com: nome da fila, senha atual em atendimento, próximas 2 senhas

- Atualização em tempo real via Supabase Realtime

Overlay de chamada (quando há nova chamada):

- Ecrã inteiro por 6 segundos

- Número grande + destino (Balcão 2 / Gabinete 3)

- Anúncio por voz (Web Speech API):

  PT: "Senha C-047, dirija-se ao Balcão 2"

  EN: "Ticket C-047, please go to Desk 2" (se lang_used do ticket = en)

- Desaparece e volta à vista normal

Ticker (barra inferior):

- Formato: "C-047 · Balcão 2 · 14:32"

Relógio canto superior direito, logo da org canto superior esquerdo.

### 3. RECEÇÃO — /org/recepcao

Dois painéis.

Painel esquerdo — Gestão de chamadas:

- Próxima senha em destaque (azul) — full_ticket, nome da fila, pessoas em espera

- Botão principal "Chamar C-047"

- Ações secundárias: Saltar | Re-chamar | Faltou

- Lista de filas com contagem e cor (verde <5, âmbar 5-9, vermelho 10+)

Painel direito — Admissão:

- Ticket mais recente pendente de admissão (status=em_espera, patient_name=null)

- Campos: Nome do doente, Nº de utente (opcional)

- Botão "Confirmar admissão"

- Lista das últimas 10 chamadas com ticket, nome, estado

Seletor de balcão (se módulo multi_balcao ativo):

- Barra superior com balcão atual

- Pode mudar de balcão

### 4. GABINETE / MÉDICO — /org/gabinete

Interface minimalista e focada.

Esquerda — Fila de doentes:

- Cartão "Em consulta agora" (tom roxo) — nome do doente + ticket + hora de entrada

  - Botão "Consulta concluída"

  - Botão "Faltou"

- Lista de espera — nome + ticket + espera estimada

  - Se patient_name for null, mostra só o número do ticket

- Botão principal "Chamar [nome]"

Direita — Estatísticas:

- Atendidos hoje, Em espera, Faltaram

- Campo de nota de turno (opcional)

Atualização em tempo real.

### 5. CHEFE DE TURNO — /org/turno

Vista de gestão do turno:

- Ativar/desativar filas individualmente

- Gestão de balcões — atribuir filas, ativar/desativar

- Gestão de gabinetes — atribuir filas (se módulo ativo)

- Vista geral ao vivo — todas as filas, em atendimento, em espera

- Botão de reset manual — reinicia contadores do dia

- Painel de módulos (só visualização — ativar/desativar é org_admin)

### 6. ORG ADMIN — /org/dashboard

Gestão completa da organização.

Separadores:

- Visão geral — estatísticas do dia em tempo real

- Filas — criar/editar/apagar filas, prefixo, cor, ícone, prioridade, duração média, nome em inglês

- Balcões — criar/editar balcões, atribuir filas

- Gabinetes — criar/editar gabinetes (se módulo ativo)

- Utilizadores — convidar utilizadores, atribuir papel e balcão/gabinete

- Dispositivos — gerar tokens para quiosque/TV, nomear dispositivos, revogar tokens

- Personalização — logo, cores, nome da clínica

- Configuração TV — URL do stream, URL M3U, layout, lista de canais, silenciar em chamada

- Módulos — ativar/desativar cada módulo desta org

- Configurações — hora de reset, idioma de voz, fuso horário, línguas do quiosque (PT | EN | ambas)

### 7. SUPER ADMIN — /admin

Gestão global da plataforma (apenas super_admin):

- Lista de organizações — criar nova org, ver todas

- Por org: ativar/desativar módulos, ver estatísticas, aceder como org_admin

- Estatísticas globais — total de senhas hoje em todas as orgs, orgs ativas

- Vista de dispositivos — todos os dispositivos em todas as orgs

---

## TEMPO REAL

Canal Supabase Realtime por org: `org:{org_id}`

Eventos:

- ticket:novo — nova senha emitida

- ticket:chamado — senha chamada (dispara overlay TV + voz)

- ticket:concluido — marcado como concluído

- ticket:faltou — marcado como faltou

- ticket:admitido — nome do doente associado

TV e Quiosque subscrevem em modo leitura.

Receção e Gabinete subscrevem com escrita.

---

## PÁGINA DE ACOMPANHAMENTO — /espera?ticket=ID

Página móvel simples (sem login):

- Número da senha, nome da fila

- Posição atual na fila (atualização em tempo real)

- Espera estimada

- "Será notificado quando for chamado" — pede permissão para notificação push

- Quando chamado: alerta ecrã inteiro + notificação push

- Língua conforme ticket.lang_used (PT ou EN)

- Logo e cores da org

---

## DESIGN

- Interface limpa e clínica — superfícies brancas, tipografia forte

- Cor primária da org (default #1a6fc4)

- Quiosque: botões grandes para toque (mínimo 80px altura), alto contraste

- TV: fundo escuro (#07101f), texto claro, números de senha muito grandes

- Receção/Gabinete/Admin: dashboard SaaS limpo e funcional

- Totalmente responsivo

- Idioma base: Português de Portugal (pt-PT) em toda a plataforma exceto quiosque que é configurável

- Datas e horas em Europe/Lisbon

---

## POLÍTICAS RLS (Supabase)

- Utilizadores só lêem/escrevem dados da sua org (org_id)

- Médicos só vêem tickets das filas do seu gabinete

- Rececionistas só podem chamar/admitir tickets, não alteram configurações

- Chefes de turno podem gerir filas e balcões mas não módulos nem utilizadores

- Tokens de dispositivo (quiosque/TV) só lêem dados da sua org

- Super admin ignora todas as políticas RLS de org

---

## NOTAS IMPORTANTES

- Contadores de senhas reiniciam diariamente à hora definida em org.reset_time

- Senhas reiniciam em 001 por fila a cada dia

- Senhas prioritárias passam para o início da fila (inseridas na posição 1)

- avg_duration_minutes atualiza automaticamente com base nos tempos reais de conclusão

- Parsing M3U: faz fetch do URL, analisa o texto, extrai nomes e URLs dos canais, apresenta como lista selecionável

- Streams HLS: usa hls.js para compatibilidade com Chrome

- Voz: Web Speech API (window.speechSynthesis), voz pt-PT, fallback para en se pt não disponível

- O anúncio de voz usa a língua do ticket (lang_used) — PT para doentes que usaram o quiosque em PT, EN para quem usou em inglês

- Impressão de talão: window.print() com div oculto estilizado para papel térmico 80mm

Começa pelo schema Supabase, depois o fluxo de autenticação, depois constrói módulo a módulo por esta ordem:

Login → Painel TV → Quiosque → Receção → Gabinete → Chefe de Turno → Org Admin → Super Admin

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/8e5e5869-f88c-4ed3-b7f1-cff55a568d21).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
