# Turno de extensões e consulta de laudos — estado da prova

Referência: PR #3477, fonte `825512d5b5766c784018cb10cfef82b4dc36daf1` mais o
reparo de baseline e fixture descrito abaixo. Consumidor: `consulta-de-laudos`;
contrato em `docs/specs/extensoes-declarativas-v1.md`, seção “Gancho antes da IA”.
O host é genérico; categorias, perguntas e idiomas pertencem ao pacote.

## O que o CI mediu antes deste reparo

O [run 40381355864](https://github.com/melgarafael/DeskcommCRM/actions/runs/40381355864)
tem `head_sha=825512d5…` e executou a prévia
`3511916c99c377c71bec78ff56c79dcd5f5f00e4` sobre `028b40c118af…`.

- O **typecheck completo passou** no step `Typecheck` do
  [job 121778117144](https://github.com/melgarafael/DeskcommCRM/actions/runs/40381355864/job/121778117144).
  Isso encerra a dúvida sobre o TS2322 anterior nesse candidato, sem afirmar que
  um novo typecheck local foi executado depois deste reparo.
- Duas cercas reprovaram: o CHECK de `accepted_permissions` era recriado duas
  vezes no baseline, e a função da proposta 0800 estava depois da varredura de anon.
- Em pg15 e pg17, seis dos oito casos de
  `tests/invariants/extensoes-turno-consentimento.test.ts` falharam antes de medir
  seus efeitos: a fixture entregava um array JavaScript cru ao parâmetro JSONB;
  `pg` o serializava como array PostgreSQL, produzindo `22P02`. O replay integral
  ainda não foi provado por esses resultados.

## Reparo e verificação leve

A fixture agora serializa o aceite para JSONB, preservando o nulo e todas as
asserções. No baseline, a regra final fica num único bloco antes da varredura de
anon: a função conhece os **onze nomes** antes de conferir o CHECK. As migrations
0798/0800 mantêm o mesmo comportamento final; não há concessão nem backfill de
aceite. O bloco repetido do fim passou a apontar para essa definição única.

Em 26/10/2026, com um worker e sem paralelismo de arquivos, passaram **71 testes
em sete arquivos**, RC 0, em 5,69 s:

```sh
pnpm exec vitest run --maxWorkers 1 --no-file-parallelism \
  tests/unit/baseline-constraint-reconstruida.test.ts \
  tests/unit/varredura-anon-e-o-ultimo-bloco.test.ts \
  tests/unit/apendice-do-baseline-nao-diverge-da-cadeia.test.ts \
  tests/unit/apendice-do-baseline-espelha-a-migration.test.ts \
  lib/extensions/consentimento.test.ts \
  lib/agent-engine/agent/gancho-de-extensao.test.ts \
  lib/extensions/exemplo-turno-jornada.test.ts
```

ESLint do invariante alterado e `git diff --check`: RC 0. Essa rodada mede a
estrutura do baseline e os focos de unidade; **não é uma rodada verde de banco,
nem uma nova execução da suíte completa**.

## O que ainda precisa de prova real

O CI do reparo precisa executar os oito casos de banco, incluindo duas
organizações, viewer/admin, revisões, retry, atualização, leitura opcional e RPC
privada. O replay integral exige `psql -v ON_ERROR_STOP=1`, status 0, nenhum
ERROR/FATAL, aceite preservado e CHECK validado. O consumidor concede três nomes
(`turn.send`, `turn.handoff`, `turn.context`); onze é o tamanho do vocabulário,
não a quantidade de aceites desse pacote.

Continuam pendentes concorrência simultânea real, geração de
`lib/database.types.ts` pelo schema provado e jornada fresca pela tela. A jornada
deve medir instalação e aceite separado, patologia com passagem imediata,
biópsia/radiologia com apenas seus campos pendentes, saudação que não vira nome,
cinco idiomas, contexto com proveniência, atualização de quatro perguntas para
uma, reconfiguração, desativação/reativação, duas organizações e os dois caminhos
de provedor. Cada caso pelo agente precisa do par com o mesmo texto cru pela
função direta, conforme `docs/doctrine/prova-em-par.md`.

Os E2E genéricos de extensões não substituem essa jornada. Ainda não há evidência
visual nova de laudos para citar. O #3063 permanece aberto: a adaptação preserva
a contribuição e não anuncia a promessa cumprida antes do gancho na main e da
prova prevista nas decisões 139/167.
