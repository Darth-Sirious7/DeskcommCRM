---
impacto: nada_mudou
secao: corrigido
titulo: A faixa de conexão caída mostra só os canais que o atendente pode ver
---

A faixa vermelha do topo anunciava a conexão caída do canal do outro setor para
quem o servidor já negava aquele canal: numa instalação com restrição de canal
por atendente, a lista de canais da tela devolvia apenas o canal do próprio
atendente, e a faixa mostrava o apelido e o número do canal alheio, na tela e
nos dados que a página entregava.

A causa era o caminho da leitura, não o componente: a faixa montava a lista por
uma consulta que atravessa a regra de acesso por organização, e por isso não
passava pela restrição que a listagem de canais já aplicava. Agora ela pergunta
pela mesma identidade do usuário que a listagem usa, e a regra de acesso é uma
só para os dois lugares.

Nada muda para quem administra: a visão completa continua completa. Para o
atendente com restrição, a faixa passa a falar apenas do que é dele — e quando
não há canal visível caído, a faixa não aparece.

Contribuição de @webtecnica (#3088).
