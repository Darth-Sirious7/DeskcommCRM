---
impacto: nada_mudou
secao: corrigido
titulo: O status da mensagem no WhatsApp não volta mais para trás, e bolha só com caractere invisível não sai
---

Avisos de entrega do WhatsApp que chegavam fora de ordem ou repetidos podiam fazer uma mensagem já lida aparecer como entregue, ou uma entregue aparecer como enviada. Agora o status só anda para a frente, e a hora de entrega e a de leitura são gravadas uma vez só.

Quando o WhatsApp devolve erro para uma mensagem que já tinha sido aceita, ela vira falha com a explicação certa, na bolha da conversa, em vez de voltar a "enviando" e disparar o alerta de "não chegou ao cliente". Uma resposta da IA feita só de caractere invisível deixa de sair como bolha em branco.

Uma confirmação posterior de entrega ou leitura continua corrigindo uma falha anterior. Um aviso de mensagem pendente ou apenas aceita pelo servidor não apaga a falha.

Não há nada a configurar na VPS (spec 28).

Contribuição de @paulolimajr77 (#3469), com adaptação da manutenção para preservar a recuperação por confirmação de entrega.
