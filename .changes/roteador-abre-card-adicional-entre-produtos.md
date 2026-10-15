---
impacto: capacidade_nova
secao: alterado
titulo: O roteador abre um segundo card quando o cliente passa a falar de outro produto
---

Vale para quem já configurou funil de destino nas intenções do roteador, sem precisar fazer nada: na primeira atualização, o roteador deixa de transferir o card entre dois funis de produto e passa a abrir um segundo card. Antes, o cliente com negócio aberto em Consórcio que passava a falar de Investimentos tinha o card de Consórcio copiado e encerrado. Agora ele ganha um **segundo card** em Investimentos, e o de Consórcio continua como está: nada é encerrado e nada conta como perda. Funil de produto é o funil de destino de alguma intenção do mesmo roteador.

O cliente que já fechou um produto e fala de outro também ganha o card do novo. Quem já passou pelo funil de destino (ganhou ou perdeu lá) não ganha outro card ali, e o contato bloqueado (que pediu para parar) ou anonimizado não ganha card novo nenhum.

O card na Recepção, ou em qualquer funil que não é destino do roteador, continua sendo transferido para o funil do produto, como antes. O card novo leva só o título, o contato e a origem; etiquetas, campos, valor e responsável do outro produto não são copiados. Intenção sem funil de destino se comporta exatamente como antes.

Contribuição de @webtecnica (#2799), a partir do desenho e do patch de @InvestidorDiversificado na issue #2480.
