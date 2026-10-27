# Conta de e-mail da organização e diagnóstico do domínio

Resgate de #3443/#3464 de @webtecnica. Fontes `9e71f1a016a92113a7cb2c46779c1950df34f939`, `01857f308a574e770b0d4a7669a40ed1bab99799` e `b488ed1a83c5040393f53e9ae0149a970c4029bc`. A composição explícita com a main `b8870b3dc0cceb04954966f3d141a22ae2a0992c` preserva a marca fresca e o saneamento dos logs de e-mail, os participantes, as propostas de campos e a retenção de mídia.

## Contrato

Em Configurações → Marca, o administrador conecta sua conta Resend com From verificado para envio. A conexão usa `fromAddress`, a mesma régua do envio, e exige permissão de consulta de domínios. O servidor resolve o tenant, papel, suporte somente leitura e MFA; o navegador não escolhe organização ou domínio da consulta. A conta é cifrada em tabela própria sem policies e sem privilégios do navegador; a projeção de tela contém somente From/last4. Erros de banco da conexão/desconexão não voltam em texto bruto.

Só ausência de linha permite o fallback da automação para o transporte da instalação. Falha de leitura, cifra ou dados interrompe a saída com motivo próprio. E-mails de sistema continuam no roteador da instalação. O diagnóstico parte do From conectado e dos registros oficiais da mesma conta, suporta Return-Path personalizado/TXT/MX/CNAME e distingue registro ausente de consulta inconclusiva. Estado verificado da Resend e DNS observado são apresentados separadamente; nenhum deles promete entrega na caixa.

## Banco real observado em 27/10/2026 UTC

Fonte medida: `86e09872c6eb0b744ff6a8ad644c8a73e811c817`. O baseline tem a main b887 inteira como prefixo byte exato, seguida somente pelo apêndice0795. Migrations9016/9017/9021 e catálogo frozen idênticos à main; a entrada+13 de `PROVA_PROPRIA` segue proposta não aplicada.

- PostgreSQL17.11 real, imagem `pgvector/pgvector:pg17`, amd64; container próprio limitado1Gi/CPU1, bind localhost e porta alocada pelo daemon.
- Prelude extraído mecanicamente de `scripts/test-db.sh`. ACLs de Supabase presentes antes do baseline. Vitest usa a configuração e o setupFile originais: banco novo por arquivo a partir de `inv_baseline`, sem substituir o reset.
- INSTALL estrito com `ON_ERROR_STOP=1`: PASS, **15/15 casos PASS**.
- Controle causal: `GRANT ALL` ao service_role no molde. Reprovaram exatamente o ACL CRUD restrito e a recusa de TRUNCATE: **2FAIL/13PASS**. Os12 callbacks originais do autor permanecem byte idênticos.
- UPDATE estrito sobre o banco existente com ACL excessivo: PASS, **15/15 casos PASS**. Marcador no banco confirma duas aplicações. Cleanup da fixture deixou zero contas e zero organizações próprias.
- A prova observada inclui zero grants diretos de qualquer privilégio para PUBLIC/anon/authenticated, inclusive os8 disponíveis noPG17. Depois dessa corrida foi preparada, no mesmo caso novo, a checagem de privilégio efetivo herdado:7 noPG15, mais MAINTAIN condicionado aoPG17. Essa assertiva adicional aguarda CI; não foi declarada executada no banco.
- A fixture de banco usa bytes artificiais; prova formato opaco/ACL/RLS, não AES. Unidades separadas cifram e decifram com a implementação real.

Hashes SHA256: baseline `bd8f5b12e3850dd8aa20d6260bbc71c8f10a03b6e4d593590fed3565496d5364`; migration0795 `4bb906e25241a93cc176533e0edebaf013d3fd3ac7ca8ae4cee0fbe548200cb5`; prelude `62afc1fa29248f8c5d9318b882489894aab92adb1d6716d7b2e39e4e06d3eb3c`. O invariante medido noPG tem SHA256 `6f4a5ce784abac93c256abf98bf81e165fffa76f140aaa0ff97a643d084e7892`.

A bancada foi removida às04:28:34Z. Porta33473 fechada, zero containers ativos, listeners alheios3480/53/22022 preservados; slot transferido explicitamente à frente9022. Não repetir banco por causa do instrumento textual que esperava nomes de propriedades sem aspas: esse erro pós-coleta foi preservado e resolvido por validação AST offline, sem modificar o artefato bruto.

## Tipos integrais

CLI Supabase **2.122.0**, schema public do banco combinado acima, duas gerações completas iguais,454936bytes cada. SHA256 bruto `6eaf8e4a280f44eba90a05521c9295570e5be68e47cead269e2d8fcde2c71912`. O arquivo inteiro foi formatado com a configuração Prettier do projeto e incorporado sem unir hunks: SHA256 `2adaec5a8f6bff1a90ab1a9107ef30ea368a28bfcc76f913206c4796697e4931`.

O parser TypeScript conferiu todas as tabelas/views/funções/enums/tipos compostos contra o canônico anterior, com a mesma formatação: só acrescenta `organization_resend_accounts`. Nenhum tipo anterior mudou ou desapareceu. `lead_field_proposals`, `conversation_participants`, retenção e `tags_do_contato` no retorno calculado da conversa e na função foram preservados.

## Provas leves e limites

No combinado b887:7arquivos/144casos de produto PASS;9arquivos/365casos de cercas, mapa e fragmento PASS; ESLint dos23arquivos tocados zero e diff-check zero. Dois casos novos reproduziram o retorno de erro bruto de banco antes da correção e agora passam. Os recortes são informados separadamente, sem somar sobreposições com corridas anteriores.

SDK real do cache6.33 enviou HTTP a receiver localhost próprio com chaves/destinatários sintéticos. Foram observados From/To/Reply-To/corpo e hashes Authorization distintos dos dois tenants; consulta de registros oficiais inclui Return-Path personalizado. Não é prova de entrega paga, caixa de correio, banco ou navegador. A versão canônica do candidato é a declarada no package/lock e precisa passar noCI com dependências instaladas por ele.

Permanecem pendentes: cinco checks finais do head publicado, assertiva efetiva7/8 noCI e prova visual real de descobrir o card pelo menu, conectar/recarregar sem chave, conferir diagnóstico, recusar erros, separar dois tenants e desconectar. Os PNGs devem ser produzidos somente após as assertivas do caso PASS. O transporte sintético precisa estar explícito, sem mock de DOM, sem alterar DNS/TLS globais e sem chave paga. Nenhum typecheck integral/build foi executado noMac. Nenhum Ready/auto/merge autorizado por este relatório.
