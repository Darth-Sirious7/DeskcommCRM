# Prova do preenchimento revisado do card — #3476

Banco dirigido e geração de tipos medidos em Postgres 17 próprio na VPS de
teste. Navegador e verificação integral ainda aguardam a faixa reservada. Não
iniciar Docker nem um segundo app na máquina compartilhada para esta prova.

Retomada em 26/10/2026: o CI identificou cinco erros de consumidores dos tipos
gerados e uma policy intermediária no baseline. Os consumidores agora estreitam
JSON sem cast e o teste da view acompanha a nulabilidade emitida pelo gerador,
mantendo a proibição do título pessoal. A criação intermediária da policy de
escrita saiu do baseline; a migration 0772 original e a definição final da 0807
permanecem intactas. A cerca correspondente e o teste da view passaram juntos
(24 casos em 2 arquivos). **O install/update do baseline com esse último delta,
a tipagem integral e a prova pela tela ainda estão pendentes.** A rodada de banco
descrita abaixo precede esse último ajuste do baseline.

A bancada própria na VPS recebeu o HEAD publicado, aplicou o baseline anterior
em instalação e reaplicação e executou o bootstrap do dono. O Turbopack compilou
em 120 segundos, mas a rodada foi encerrada durante o TypeScript por pressão de
memória. Outro build e testes do curso estavam em execução na mesma máquina.
Todos os processos e serviços desta bancada foram pausados; os do curso foram
preservados. Não há prova de build completo nem de UI nessa tentativa.

## Banco

O CI existente aplica o baseline em instalação e reaplicação e mede pg15 e pg17.
Os novos invariantes entram nele sem criar outro gate. Para a rodada dirigida
na VPS reservada, usar o mesmo comando do produto, com um worker:

```sh
TEST_DB_IMAGE=pgvector/pgvector:pg17 pnpm test:db \
  tests/invariants/propostas-de-campos-anonimizam-motivo.test.ts \
  tests/invariants/propostas-de-campos-rls-rbac.test.ts \
  tests/invariants/propostas-de-campos-update-com-dados.test.ts --maxWorkers=1
```

Medido em 2026-10-26: antes da 0807, **2 falhas e 8 sucessos**. O INSERT sem
RETURNING aceitou organização A com o negócio de B, e os dois motivos legados
continuaram legíveis após a 0797. Depois da 0807: **10 sucessos em 3 arquivos**,
com instalação e reaplicação do baseline sem erro e as três conferências do kit
(checkout, v1.89.0 e v1.63.0; 184 regras cada) verdes. O banco era novo e só tinha
fixtures sintéticas; foi removido ao terminar. Não é a suíte de banco inteira.
O mesmo SQL foi medido com o número local 0801 e renumerado para 0807 antes da
primeira publicação, por colisão com o PR #3485. A mudança é de nome e cabeçalho;
os comandos SQL medidos permanecem iguais.

A 0807 reaplica o vínculo do USING no WITH CHECK e limpa o motivo legado pelas
duas relações com contato já anonimizado. Não recria a cascata: a 0797 continua
sendo a definição final com ACL exclusiva do servidor. Ambas as migrations
anteriores permanecem intactas. O apêndice da 0807 vem depois da criação da
tabela 0772; não cria funções e pode ficar no fim do baseline.

- Anonimização: RPC formal como `service_role` e RPC da ficha como sessão
  autenticada administrativa; vínculo direto e `crm_lead_links`; vizinho na
  mesma organização e outro tenant; decisão preservada; retry sem efeito; ACL.
- RLS/RBAC: viewer lê sua proposta e não decide; manager decide a própria;
  ninguém lê ou decide a do outro tenant. O INSERT sem RETURNING verifica o
  vínculo entre organização e negócio sem esconder o problema por uma policy de SELECT.
- Atualização com dados: aplica a 0772 original, cria proposta, anonimiza e
  comprova o motivo legado ainda legível; aplica a correção forward e exige
  remoção pelos vínculos direto e secundário, com a linha, decisão e data da
  anonimização preservadas. Propostas de contatos vivos na mesma organização
  e noutra mantêm seus conteúdos. Este caso também é diagnóstico:
  somente trocar o corpo da função não cura linhas já anonimizadas.

## Tela e concorrência

Usar a bancada E2E canônica já preparada no ambiente reservado. A spec semeia
seu funil e usa os seeds canônicos de credenciais e token MCP; não ler ou copiar
valores de ambiente para a conversa. O destino deve ser local ao ambiente de teste.

```sh
pnpm exec playwright test tests/e2e/propostas-de-campos-do-card.spec.ts --workers=1
```

A chamada real a `/api/mcp` recebe a leitura textual controlada de um documento
sintético. A proposta nasce pela ferramenta de produção e o card permanece
intacto. O manager abre o card no quadro, confere trecho/atual/proposto, confirma
`1,234` sem mudar a escala, corrige outro caso para `9,876` e descarta um campo.
O viewer lê, não recebe botão e tem 403 no POST direto. Uma revisão velha recebe
409 após outra decisão e mantém o valor do card.

Dois casos usam uma trava de linha real para eliminar a sorte do escalonamento:
dois pedidos HTTP leem `pending` antes de disputar o UPDATE; só um pode vencer.
No outro, `vencePropostasDeCampo` executa de verdade numa transação enquanto o
POST ainda enxerga a versão anterior; ao liberar a expiração, confirmar dá 409.
As capturas ficam em `evidence/propostas-3476/`, e o CI as preserva também quando
a parte passa. Elas contêm apenas fixtures sintéticas.
Não se afirma prova de modelo lendo PDF; o seam medido é a entrada MCP.

## Tipos gerados e verificação completa

Medido com o CLI Supabase 2.122.0 já em cache na VPS. Essa versão gera TypeScript
no próprio processo pela conexão direta, conforme sua
[documentação de efeitos](https://github.com/supabase/cli/blob/v2.122.0/apps/cli/src/commands/gen/types/SIDE_EFFECTS.md).
O banco recebeu o baseline e as provas acima. Duas passadas de geração do schema
`public` produziram arquivos byte a byte idênticos. Comando de reprodução, na
pasta própria de teste e com o DSN do banco efêmero:

```sh
supabase gen types --db-url "$TEST_DB_CONN" --schema public \
  > /tmp/database-propostas-gerado.types.ts
```

Comparar a saída e substituir `lib/database.types.ts` pelo resultado do gerador,
com formatação mecânica pelo Prettier já instalado. A saída bruta permanece
guardada para comparação. Não montar tipos da nova tabela à mão nem gerar do
projeto remoto. A regeneração alcança a defasagem do arquivo anterior: 170 tabelas
descritas passam a 206 no schema real, e 146 funções passam a 247. O delta inclui
estruturas anteriores à proposta e requer avaliação na tipagem integral.

Depois que o slot do Mac for liberado: typecheck integral e lint; o CI mede a
suíte completa e build. Antes de sair do draft, reconciliar os resultados reais,
preservando o escopo autorizado das adições herdadas de invariantes: somente
+6/−0 e +20/−0 nos dois arquivos identificados, sem alterar assertivas anteriores.
