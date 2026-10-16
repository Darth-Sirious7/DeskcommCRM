---
impacto: nada_mudou
secao: corrigido
titulo: Agente criado pelo corpo legado nasce com o modelo do provedor da instalação
---

Ao criar um agente sem informar o modelo, o DeskcommCRM gravava `anthropic/claude-sonnet-5` — o padrão histórico do produto — mesmo numa instalação configurada em OpenAI, OpenRouter ou Google. O agente nascia com um modelo que o provedor configurado não executa, e o desencontro só aparecia no primeiro atendimento. A escolha agora sai de um ponto único de resolução, na ordem: o modelo informado, o padrão da instalação quando ele se sustenta, a compatibilidade histórica da própria Anthropic e, por fim, o catálogo do provedor efetivo; sem um par válido, a criação é recusada com um erro claro em vez de gravar um modelo que aquele provedor não executa. O provedor, o modelo, a finalidade e a origem da configuração passam a ficar registrados no log estruturado, sem chave nem conteúdo de conversa. Contribuição de @webtecnica (#2955).
