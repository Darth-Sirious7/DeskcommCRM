# Task 1 — Contrato e interface das jornadas

Destino: infraestrutura de ensino. Implementação local; sem publicação, SSH, alteração no produto ou NAV_CATALOG.

## Contrato concreto para conteúdo/captura

`curso/jornada.ts` exporta `Nicho` como schema Zod estrito e tipo inferido e `validarJornadas(nichos: unknown[], modulos: {id: string; licoes: {id: string}[]}[], capturas: Record<string, unknown>): void`.

Nicho: `{id, titulo, resumo, jornadas}`. Jornada: `{id, titulo, empresa, contexto, resultado, tipo, nota, dependencias, montagem, cenas}`. `dependencias` é **string**, `tipo` é `roteiro-demonstrativo | execucao-observada`, `montagem` é array não vazio de `{modulo, licao, porque}`; `cenas` é array não vazio de `{id, titulo, cliente, operacao, valor, captura}`. Ids usam `[a-z0-9-]+`. Textos são não vazios. Cada objeto recusa campos desconhecidos. IDs são únicos no escopo nichos / jornadas de um nicho / cenas de uma jornada; cenas podem repetir nomes entre histórias.

`captura` é chave própria do manifesto, nunca URL. Foto é arquivo relativo dentro de `capturas/` (compatível com manifesto existente) ou `fotos/`, extensão png/webp/jpg/jpeg, sem segmentos `..`. `validarJornadas` verifica referência de foto e lição. O montador adicionalmente verifica existência física de **todas** as fotos publicadas (lições e jornadas) antes de escrever HTML; referência ausente interrompe montagem. Só entradas referenciadas pelas lições e jornadas entram no JSON público. O diretório demonstracoes pode estar ausente durante implementação, sem publicar fixture/placeholder.

Fábrica do renderer: `window.criarDemonstracoes({dados, esc, vista, figura, legenda})`, global no script estático concatenado antes de app.js. `dados` contém nichos, modulos e capturas. `vista` é o main; `esc` escapa texto, `figura(cap, opcoes)` e `legenda(cap)` são as funções originais. Retorna `{reconhecer(hashSemCerquilha), render(rota), posRender(rotaOuNull), entradasBusca(), titulo(rota)}`. Reconhecimento retorna null para rotas de curso; retorna catálogo para hash de jornada inválido. Rotas demo exigem ID da cena, não número: `#demo.<nicho>.<jornada>.<cena>`; demais `#acao`, `#acao.<nicho>`, `#montagem.<nicho>.<jornada>`.

## Interface e escolhas visuais

Entrada permanente no menu e na abertura. Catálogo por nicho, histórias com apresentar/montagem. Apresentação distingue cliente/operação/benefício, com linha do tempo clicável, anterior/próximo, links diretos, copiar com recado de sucesso/falha, tela cheia nativa com fallback ampliado, Escape e saída. Setas ignoram inputs, campos editáveis e modificadores. Trocar cena mantém tela cheia; sair da apresentação restaura navegação. Montagem descreve dependências e liga lições reais sem duplicá-las. Busca indexa nichos e histórias com o mesmo formato/pesos do curso.

Direção editorial: papel, oliva, tipografia e geometria anotada do curso existentes; composição assimétrica de narrativa e foto no desktop, empilhamento no celular, linha do tempo com rolagem interna, foco visível e respeito à redução de movimento. Fotos também usam o zoom original. Funções originais de módulo, lição, simulador e progresso preservadas; JSON de lições intocado.

## Evidência e validação

- Vermelho inicial: `pnpm exec vitest run curso/jornada.test.ts` falhou por import `./jornada` inexistente antes da implementação.
- Verde: `pnpm exec vitest run curso/jornada.test.ts curso/licoes.test.ts`: 2 arquivos, **83 testes passaram**. Contrato, IDs repetidos em cada escopo, schema estrito, foto/URL/chave herdada ausentes, lição ausente, vazio permitido, rotas, busca, links, fallback e clipboard.
- `pnpm exec tsx curso/montar.ts`: **61 módulos, 1097 capturas**, montagem integral sem nichos durante implementação, fotos físicas verificadas.
- `node --check curso/site/app.js`, `node --check curso/site/demonstracoes.js`, `git diff --check`: passaram.
- Chrome headless via Playwright (`/tmp/curso-jornada-visual.cjs`) com fixture privada em `/tmp/curso-jornada-fixture.html`, construída a partir do HTML real e fotos locais. Desktop 1440×1000 e celular 390×844. Catálogo→nicho→história→montagem→lição; setas anterior/próximo; seta em busca não muda cena; tela cheia/saída; recuperação de hash inválido. **Zero pageerrors, foto decodificada, zero overflow horizontal mobile.** Screenshots inspecionadas: `/tmp/curso-jornada-desktop.png`, `/tmp/curso-jornada-mobile.png`. A fixture não foi colocada no conteúdo público.
- Playwright inicialmente não encontrou seu Chromium empacotado; repetição usou Chrome instalado e passou. Não foi preciso instalar navegador/dependência.
- `pnpm lint`: exit 0, zero erros, 618 avisos na primeira rodada; o único aviso novo (fábrica consumida em outro script) foi removido expondo a função em window. `pnpm exec eslint curso/jornada.ts curso/jornada.test.ts curso/montar.ts curso/site/app.js curso/site/demonstracoes.js`: zero erros e zero avisos.
- Compatibilidade do recorte: `pnpm exec tsx curso/montar.ts inbox`: 1 módulo, 59 fotos; integral repetido: 61 módulos, 1097 fotos. O montador valida referências contra todos os módulos, e no recorte só inclui histórias cujas lições estão presentes.
- Typecheck: primeira execução atingiu heap padrão de 4GB (exit 134), sem diagnóstico TypeScript; `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck` **passou (exit 0)**. Após ajuste final do recorte, `pnpm exec tsc --noEmit -p /tmp/curso-task1-tsconfig.json` (extends tsconfig do projeto, include jornada.ts/montar.ts) também passou. Tentativa inicial de checagem avulsa sem config falhou apenas por opções/types/aliases ausentes; foi substituída por esse config herdado.

## Limitações e auto-revisão

A prova visual usa narrativa de teste e fotos reais existentes, não atesta fidelidade das histórias finais nem execução do motor de IA. Conteúdo final de dez nichos/trinta histórias e novas fotos ainda dependem das outras tarefas; reexecutar montagem e revisão visual final com esse conteúdo. Não houve alteração em banco, nenhuma integração externa ou mensagem a cliente. A tela estática tem entrada, saída e busca; falha de referência é devolvida ao autor pelo montador, sem publicar catálogo quebrado. Não há eventos operacionais de tenant nesta infraestrutura estática. Metadados privados/fixtures não são incluídos. Revisão própria conferiu compatibilidade dos caminhos `capturas/`, preservação de 61 módulos, escaping dos textos no app, rotas inválidas e saída do fallback após navegar.
