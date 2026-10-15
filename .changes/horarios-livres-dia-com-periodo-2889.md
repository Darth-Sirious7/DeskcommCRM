---
impacto: nada_mudou
secao: corrigido
titulo: A busca de horários livres com dia e período juntos cobre o período a partir do dia
---
Quando o agente mandava `dia` e `dias_a_frente` juntos para `crm_find_free_slots` — o que modelos GPT via OpenRouter fazem mesmo em pergunta aberta, com `dia` igual a hoje —, a busca olhava só aquele dia, e a resposta saía vazia com a agenda cheia de vagas. Agora o período começa no dia pedido (nunca antes de agora) e cobre pelo menos `dias_a_frente` dias inteiros (pode trazer o começo do dia seguinte); horários da véspera ficam de fora. `dia` sozinho continua recortando naquele dia. Diagnóstico e primeira versão do conserto: @webtecnica (#2921), a partir da issue #2889.
