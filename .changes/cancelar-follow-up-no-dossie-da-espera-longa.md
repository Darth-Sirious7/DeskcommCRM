---
impacto: capacidade_nova
secao: corrigido
titulo: Cancelar follow-up também no dossiê da espera longa e do roteiro em andamento
---

O dossiê de um acompanhamento passa a oferecer **Cancelar follow-up** também quando ele está numa espera longa (o nó Aguardar imune à resposta, que dorme até a data marcada) e quando é um roteiro de atendimento em andamento. Antes, esses dois casos apareciam na fila de Follow-ups com o botão e a rota aceitava o cancelamento, mas o dossiê — aberto justamente para decidir o que fazer com o acompanhamento — não tinha botão nenhum, e quem operava tinha de voltar para a fila. Agora o botão aparece nos mesmos status em que o cancelamento vale, e é a mesma ação de sempre: o acompanhamento vira Cancelado, não recebe mais mensagens e a espera longa não desperta na data marcada. Quem abriu o dossiê de um acompanhamento já encerrado continua sem o botão, e sem permissão de escrita ele também não aparece. Nada muda para quem só usa a fila.

Contribuição de @webtecnica (#3455, Refs #3434).
