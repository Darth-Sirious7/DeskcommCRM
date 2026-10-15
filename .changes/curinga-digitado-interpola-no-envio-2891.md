---
impacto: nada_mudou
secao: corrigido
titulo: Na Inbox, {{nome}} e {{primeiro_nome}} digitados à mão saem com o nome do cliente
---

Quem escrevia `{{primeiro_nome}}` à mão no campo de resposta de um contato com nome mandava o texto cru para o cliente: sem aviso e com o botão Enviar liberado. Só a resposta rápida trocava a variável pelo nome. Agora o texto digitado passa pela mesma troca no envio, com o nome da conversa para onde a mensagem vai. Variável desconhecida, como `{{codigo}}`, continua como foi escrita. A nota interna também continua como foi escrita, porque não vai ao cliente. Contato sem nome segue barrado pelo aviso de antes. Nenhuma configuração nova, nenhum passo manual.

Contribuição de @webtecnica (#2920), a partir da issue #2891.
