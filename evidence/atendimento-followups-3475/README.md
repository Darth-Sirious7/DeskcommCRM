# Atendimento e follow-ups — bancada #3475

Prova sintética observada em 26/10/2026, no produto `20f335eaede5c423a0fcc902d79eaabb103ea342`, build de produção `cyznjcUkNaQa9Fn5H6iU4`. Banco Supabase próprio (PG15), GoTrue e Realtime reais, `baseline.sql` aplicado nos modos install e update com `ON_ERROR_STOP=1`, bootstrap-owner e contas de teste. Os seis cenários selecionados passaram em rodadas separadas; [relatório consolidado](relatorio-consolidado.json) aponta para os relatórios originais sem alterar seus estados.

| Jornada | Medição | Relatório |
| --- | --- | --- |
| Dossiê (#3455) | Viewer sem botão/POST403; outra org404; manager cancela dormente/coletando pela fila, estado e timeline imediatos, banco/evento/reload e tick sem despertar | [básico](run-basico/relatorio.json) |
| Inbox (#3407) | Parar no dormente; uma ocorrência cancelled_manual, inscrição cancelled e sem relógio; reload carregado oferece Iniciar, sem Parar | [básico](run-basico/relatorio.json), [recheck carregado](reload-carregado/relatorio.json) |
| Pausa (#3430) | Bearer real em nome de atendente, receiver HTTP, carimbo de cinco minutos; token puro não pausa e token sem escopo403. Cinco minutos reais aguardados, depois automático na tela | [básico](run-basico/relatorio.json), [recheck carregado](reload-carregado/relatorio.json) |
| Assinatura (#3424) | Automação e Prospecção pelos produtores reais, HTTP com provider controlado, mensagem persistida, assinatura exata no receiver WAHA e corpo no Inbox | [assinatura/admin](run-assinatura-admin/relatorio.json) |
| Avisos (#3426) | Quatro controles: filtro recusa/aceita, mídia sem texto e âncora atual do agente. JOIN Realtime confirmado antes do INSERT, toast positivo e ausência negativa, decisão autenticada e branch do consumer Web Push | [diagnóstico3 — somente avisos passou nesta rodada](run-diagnostico-3/relatorio.json) |
| ACK (#3469) | Envio UI→receiver; HMAC inválido não altera, HMAC real; read→ACK2/1/-1 preserva status/horas, failed+ACK1 mantém falha, ACK2/3 recupera, erro tardio não regride. Banco, indicadores e reload; orgB intacta | [básico](run-basico/relatorio.json) |

As capturas dos estados cancelados, Parar antes/depois, pausa/retorno, assinatura nos dois produtores, toast e ACKs foram inspecionadas. `run-basico/inbox-dormente-parado.png` capturou a tela durante o carregamento; a ausência ali não é prova. O recheck `reload-carregado/` espera conversa, seção e seletor visíveis antes de conferir ausência e registrar a captura. A mensagem humana também está carregada no segundo registro. As imagens antigas ficam preservadas com esse limite.

## Bolha invisível: motor real e controle positivo

[Relatório](real-engine/relatorio.json), [conversa invisível](real-engine/invisible-inbox.png) e [controle legível](real-engine/valid-inbox.png). A entrada veio por webhook WAHA com HMAC real; a pós-entrada emitiu o despacho e `drainTick` criou o job. `claimJobs`, `withServiceJob`, `createInboundTurnHandler` e complete/fail da fila são os mesmos do worker, executados uma vez, sem abrir os demais loops. A prioridade e o horário apenas do job sintético foram antecipados para selecionar esse caso na bancada.

O receiver do modelo emitiu `send_message` com um único U+200E (codepoint8206). Na segunda requisição HTTP, observou o resultado `corpo_vazio`. O traço canônico gravou `is_dry_run=false`, ferramenta falhou e zero mensagens; nenhum HTTP de envio WAHA nem linha outbound foi criado. Para limitar a tentativa, o provider devolveu **HTTP400 intencional depois da observação**: por isso o traço do turno é failed/AI_APICallError. Isso comprova a recusa e não comprova reescrita autônoma pelo modelo.

O controle legível do mesmo handler completou: uma ferramenta aceita, uma mensagem `sent`, um HTTP WAHA e assinatura exata do agente, com a bolha visível. A primeira formulação do controle tinha UUID cru e foi corretamente vetada por `internal_vocabulary_leak`; o texto do receiver foi corrigido, sem modificar ou relaxar o produto. `real-engine-attempt2-invisible.json` conserva a tentativa anterior.

O Testar agente **não** foi usado como prova dessa guarda: `applyPreviewPolicy` intercepta a tool e devolve simulated antes do execute. `llm-invisible-preview-attempt4.json` registra essa observação. A bancada também precisou do seed canônico `seedPlatformPlaybook`, normalmente executado no boot do worker, sem mover ponteiro existente.

## Limites e precondições corrigidas

- Provider LLM e transporte WAHA são receivers HTTP controlados; não são modelo externo nem WhatsApp real. Não há stub de runtime, mock de SQL ou substituição do handler. Não se reivindica FCM/Push entregue: nenhum envelope criptográfico foi recebido/decifrado.
- Nos avisos, os quatro casos medem o INSERT/Realtime, a rota de decisão e o job Web Push. **Não medem os quatro despachos completos da IA via pós-entrada/handler.** A linha de engajamento anterior é uma fixture histórica persistida com `ai_actor_id`, status sent e carimbo do atendimento corrente; não se afirma que foi produzida pelo LLM nesta rodada. O par de engine real foi medido separadamente.
- Prospecção reserva `message_id` quando cria candidato: isso não significa envio. O preflight passou a exigir candidato new e ausência de mensagem correspondente. O início também exige admin, ferramenta crm_move_lead_stage e funil permitido; a fixture recebeu ator admin separado, nova versão publicada e duas etapas abertas. O manager usado nos negativos não foi promovido.
- A primeira rodada de avisos inseria antes do JOIN Realtime; a correção do runner aguarda confirmação Phoenix do servidor. As tentativas anteriores permanecem em `run-assinatura-avisos*` e não são apresentadas como verde. Nenhuma mudança de produto foi necessária nesta bancada.
- A prova foi no Supabase PG15 (piso suportado); invariantes PG17 são do CI. Não houve migration, baseline ou alteração de testes congelados. Não se reivindica instalação fresca com provedores externos nem a suíte E2E inteira.

Fontes preservadas por ancestry: @webtecnica (#3455, #3407, #3430, #3424, #3426) e @paulolimajr77 (#3469). Adaptações da manutenção e créditos estão no PR.

## Reproduzir e encerrar

O runner base está em `tests/qa/provar-atendimento-followups-3475.ts` com manifesto de exemplo e contrato ao lado. [Manifesto desta execução](manifesto-sintetico.json) contém só IDs e nomes de variáveis, sem senhas/tokens. O receiver e runner auxiliares usados no motor real estão como fontes textuais em `bancada/`; imports do runner partem de `scripts/qa/` na árvore servida. Não são um instalador nem abrem outros serviços.

[Marco de recursos liberados](bancada/recursos-liberados.json): app, receivers, Supabase, Redis, rede e volumes exclusivos encerrados/removidos por IDs/projeto exatos. Nenhum listener/contêiner/volume próprio restante; sete contêineres do curso permaneceram ativos. Não houve Docker local, prune, troca de contexto global, cópia/leitura de .env ou dados reais de cliente. A sessão com ambiente sintético em processo foi encerrada.
