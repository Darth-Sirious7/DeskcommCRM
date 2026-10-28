# Roteamento por remetente

Destino: núcleo. Identificação e seleção de agente são infraestrutura comum; com zero regras o comportamento anterior permanece inteiro.

CONFIRMADO pelo código: `ai_routers.config.sender_routes` aceita até 100 pares de `phone` (DDI, normalizado para E.164) e `agent_id`. O editor do roteador permite adicionar, remover e trocar a associação. O PATCH exige admin e valida agentes da mesma organização. Não há mudança de schema.

Com uma ou mais regras, o roteador opera exclusivamente por identidade: resolve o telefone do contato vinculado à conversa, filtrando organização, canal e sessão. Uma mensagem que afirma ser secretária não participa da escolha. Um número sem regra usa o fallback público obrigatório, diferente dos agentes reservados. Intenções, campanhas e sticky não alteram essa escolha. Regras são relidas a cada turno, inclusive follow-up. O cadastro de telefone deve ser mantido pela equipe; identificação pelo número não substitui autenticação adicional para ações sensíveis.

O teste de classificação de texto não simula a origem. Para validar, enviar mensagens a partir dos números de teste autorizados e examinar o agente efetivo da execução. Não liberar ao público sem testar também um remetente sem regra. Antes de desativar o roteador ou remover todas as regras, revisar as publicações do canal: volta o comportamento normal.

Living System Checklist:
1. Entrada: `loadActiveRouter` e vínculo tenant-aware conversations→contacts.
2. Saída: `resolveTurnAgent` escolhe a configuração publicada por ID e empresa.
3. Auditoria: PATCH existente `ai.router_updated`; decisão real em `ai_router_decisions` pelo inbound-turn, intenção `remetente_autorizado`.
4. Tela: editor Roteadores e execuções do agente. Falhas mantêm o mecanismo do worker.
5. Porta: Agente de IA → Roteadores, existente.
6. Anti-morte: retry/falha do job do turno, sem fallback genérico em erro de identidade.
7. Configuração: lista no editor e fallback público.
8. Continuidade: política operacional/handoff existente após seleção; nenhuma permissão de ferramenta é ampliada.
9. Retorno: operador revisa o agente escolhido e corrige a associação no editor para os próximos turnos.
10. Mapa: `docs/architecture/roteamento-remetente.architecture.json`.
