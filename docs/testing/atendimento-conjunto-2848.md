# Atendimento conjunto — integração do PR 2848

Fonte: @webtecnica, head `8d28e3762f867a45a30bf4d6f76e055b3f35c844`; escopo decidido na issue #2542. Destino: núcleo, porque autorização, conversas, atendimento humano e sua trilha pertencem à operação comum.

O convite concede leitura e resposta sem substituir o responsável. Não cria aceite pendente. Notificação e nova guarda de IA são as fatias posteriores que o mantenedor explicitou na issue. O viewer conserva sua leitura usual, sem poder convidar ou responder pela API.

## Integração revisada

- O convite e a remoção entram pelo cabeçalho do Inbox, na rota de participantes; o servidor resolve organização e ator pela sessão, valida o alvo ativo e audita os efeitos.
- A lista Minhas e seu contador incluem participação ativa. As consultas auxiliares filtram a organização resolvida no servidor.
- A convidada pode responder com a preferência de exigir Assumir ligada, sem trocar o dono. O vínculo vem da consulta de participantes, não da mera capacidade de ler a conversa.
- A leitura da lista passa pela sessão e pela RLS, inclusive no suporte somente leitura. Conversa pessoal continua ausente nesta porta.
- As portas de fechamento e alteração de status conferem a régua anterior ao convite antes de chamar a função de service role. Isso mantém o comportamento de quem já controlava a conversa e impede que a leitura nova conceda controle.
- Remover e sair têm porta pela tela. Falhas permanecem visíveis; remover não elimina o histórico do vínculo.

## Provas registradas em 26/10/2026

MEDIDO no recorte final: 54 casos em oito arquivos dirigidos verdes (rotas, compositor, remoção/saída pelo DOM, Minhas/contador, atomicidade, manifest e cobertura do E2E). Antes do conserto, quatro casos novos reproduziram em vermelho a recusa de leitura do suporte, a trava da resposta e o fechamento indevido por POST/PATCH; depois ficaram verdes. O lint dirigido dos arquivos de implementação e provas passou sem erros (dois avisos herdados).

As primeiras tentativas ampliadas foram interrompidas sob falta de capacidade local (exit 143); não foram usadas como prova. A repetição final acima passou. Os vizinhos do cabeçalho e da fila também passaram; o mapa encontrou somente o diretório `workers` ausente do checkout esparso, que foi materializado para repetir o controle. NÃO MEDIDO: suíte unitária integral, typecheck/build, banco e navegador reais neste head.

O novo invariante `participante-nao-herda-controle-da-conversa.test.ts` contém 16 casos planejados, com controles de dono/gestor, persistência de resposta sob JWT, escrita destrutiva, revogação, reentrada e isolamento. **Não foi executado.** Persistir mensagem em SQL não prova envio ao canal. O invariante herdado e o acréscimo protegido de nove linhas permanecem preservados conforme a decisão 203A; nenhum outro teste protegido foi alterado.

## Pendências de aceite

1. Integrar a forward-fix de schema: policy final após a 0726, restrições de UPDATE/DELETE sem ampliar controle, publicação da própria participação e toque da conversa na mesma transação. A migration proposta 9016 (`20261026221100`) e o bloco equivalente estão integrados ao baseline, ainda sem aplicação em banco. A alocação mediu todos os 60 PRs abertos; o maior número em voo era 9004 (PR 3472). A guarda local também mede refs históricas de forks e recusou a primeira proposta 9005: seu teto era 9015, por isso a proposta foi renumerada para 9016 com novo carimbo. O MANIFEST histórico não recebe linha.
2. Rodar baseline install/update e os invariantes herdado e novo, com sabotagem do ramo participante e da proteção de controle; confirmar equivalência da cadeia com o baseline.
3. Repetir testes dirigidos, lint e typecheck quando a bancada for liberada; gerar os tipos pelo schema aplicado.
4. Executar `tests/e2e/atendimento-conjunto.spec.ts` (registrada na parte 3 do CI, ainda NÃO EXECUTADA) para provar pela tela quatro contas sintéticas: gestor, convidada, colega sem convite e viewer; organização vizinha como controle. A convidada deve encontrar a conversa sem link, responder sem assumir, perder acesso ao sair/ser removida e recuperá-lo num novo convite. Conferir contador, auditoria, dono e entrega no canal controlado.
5. Provar convite e remoção entre duas sessões abertas, com o Realtime autenticado; perder o acesso não pode deixar a conversa antiga desenhada como atendimento ativo.

## Living System Checklist

Entrada: cabeçalho do Inbox e rota `/api/v1/conversations/[id]/participants`. Saída: participação lida pela RLS, Minhas/contador, histórico e compositor. Registro: `conversation.invited` e `conversation.participant_removed` em `api_audit_log`. Porta: conversa do Inbox existente. Anti-morte: reentrada no mesmo vínculo, refetch ao voltar à aba e ressincronização pelo Realtime, cuja prova real segue pendente. Configuração: convites no cabeçalho; visibilidade e preferência Assumir já existentes na organização. Continuidade IA/humano: o responsável é preservado; a fatia adicional de IA não está nesta entrega. Laço de retorno: falha de mutação fica na tela e nova leitura confirma o estado servidor. Mapa: `docs/architecture/atendimento-conjunto.architecture.json`.
