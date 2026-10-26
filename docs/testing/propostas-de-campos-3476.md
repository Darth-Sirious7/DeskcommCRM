# Prova do preenchimento revisado do card — #3476

Instrumentos preparados; execução de banco e navegador aguarda a faixa reservada.
Não iniciar Docker nem um segundo app na máquina compartilhada para esta prova.

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

- Anonimização: RPC formal como `service_role` e RPC da ficha como sessão
  autenticada administrativa; vínculo direto e `crm_lead_links`; vizinho na
  mesma organização e outro tenant; decisão preservada; retry sem efeito; ACL.
- RLS/RBAC: viewer lê sua proposta e não decide; manager decide a própria;
  ninguém lê ou decide a do outro tenant. O INSERT sem RETURNING verifica o
  vínculo entre organização e negócio sem esconder o problema por uma policy de SELECT.
- Atualização com dados: aplica a 0772 original, cria proposta, anonimiza e
  comprova o motivo legado ainda legível; aplica a correção forward e exige
  remoção do motivo com a linha preservada. Este caso também é diagnóstico:
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
As capturas vão ao output do Playwright e contêm apenas fixtures sintéticas.
Não se afirma prova de modelo lendo PDF; o seam medido é a entrada MCP.

## Tipos gerados e verificação completa

O CLI disponível na preparação é Supabase 2.95.4. Gerar de um Postgres 17 próprio
com o baseline deste head aplicado, usando a conexão local do ambiente reservado:

```sh
supabase gen types --db-url "$TEST_DB_CONN" --schema public \
  > /tmp/database-propostas-gerado.types.ts
```

Comparar a saída e substituir `lib/database.types.ts` somente pelo resultado do
gerador. Não montar tipos da nova tabela à mão nem gerar do projeto remoto.
O comando usa a credencial do ambiente, sem imprimi-la. A disponibilidade do
executor de geração deve ser conferida antes de iniciar o banco; não atualizar
CLI ou instalar dependências durante a faixa de outra entrega.

Depois que o slot do Mac for liberado: typecheck integral e lint; o CI mede a
suíte completa e build. Antes de sair do draft, reconciliar os resultados reais,
incluindo as adições herdadas de invariantes que seguem sob revisão do mantenedor.
