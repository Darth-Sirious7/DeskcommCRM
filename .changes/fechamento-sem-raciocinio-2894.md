---
impacto: nada_mudou
secao: corrigido
titulo: O agente passa a salvar o resumo do atendimento quando o modelo raciocina antes de responder
---

Com modelos que pensam antes de responder (o raciocínio estendido da Anthropic), o fechamento do turno reenviava o raciocínio assinado numa chamada sem ferramentas, e a API recusa essa chamada, segundo o relato de quem contribuiu. O resumo do atendimento não era salvo. O raciocínio deixa de ser reenviado nessa chamada. Contribuição de @stivanellidrop-dotcom.
