---
impacto: capacidade_nova
secao: adicionado
titulo: A pausa agendada avisa na Central quando falha, e a janela marcada pode ter o horário corrigido
---

Quando o agendador das janelas de manutenção não consegue pausar ou retomar uma conexão no horário marcado, a Central passa a mostrar um aviso, um só por organização e não um por conexão. A próxima batida que funcionar fecha esse aviso sozinha. O detalhe técnico da falha fica no log do agendador. Uma janela que ainda não começou pode ter os dois horários corrigidos pela API, sem cancelar e criar de novo; a janela em andamento ou encerrada não muda, e a edição fica registrada na auditoria. As telas da janela de manutenção ganham a tradução em chinês. Nenhuma configuração nova, nenhum passo manual.

Contribuição de @webtecnica (#2845), a partir da issue #2388.
