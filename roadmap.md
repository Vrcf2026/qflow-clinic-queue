# QFlow — tarefas

## Feito
- Relógio único do servidor (dia de serviço, estatísticas, horas)
- Médico limitado ao seu gabinete (regra na base de dados)
- Contas criadas só por administração (página de configuração inicial + criação na administração)
- Saltar com rasto, reentrada configurável e recuperação de faltas
- Sem leitura pública de dados (quiosque, TV e acompanhamento só por token)
- Estatísticas com gráficos (clínica e plataforma)
- Páginas internas fora do Google
- docs/backend.md

- Receção: filas do balcão definidas só pelo chefe de turno/administração; balcão fixo quando atribuído
- "Re-chamar" com registo próprio (recall_count + evento "rechamada") e novo anúncio de voz na TV
- Página /setup para a primeira conta de administração

## Por fazer
- Regra de ordenação da fila configurável: por clínica (predefinição) e por balcão/gabinete, incluindo rácio prioritários:normais (ex. 2:1), gerida só pelo chefe de turno ou superior
- Nota de turno do gabinete ainda não fica guardada
- Google: falta a configuração do lado da Google para o botão "Entrar com Google"
- Canal de vídeo da TV (endereço do stream/M3U) por preencher
- SMS (depois)
