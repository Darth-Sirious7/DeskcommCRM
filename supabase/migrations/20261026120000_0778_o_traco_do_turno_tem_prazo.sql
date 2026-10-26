-- manifest: **O traço do turno ganha prazo (#3201, fatia 2 da #2869).** `agent_turn_traces` (0721) recebe uma linha por execução do agente e não aparecia em poda nenhuma — medido: `git grep -ln 'agent_turn_traces' origin/main` fora da própria feature, e `app/api/v1/cron/data-retention/route.ts` citando a tabela zero vezes. `fn_expurgar_traco_do_turno_vencido` entra no molde da 0587 (`security definer`, SEM seletor de linha, piso no corpo, lote com teto 10000, revogada de `public`/`anon`/`authenticated`, só `service_role`) com a **janela da telemetria da IA** (`AI_TELEMETRY_RETENTION_DAYS`, 400 / piso 100) e **nenhuma variável nova**. Índice de poda por `created_at`, `comment on column` do relógio dentro da guarda `to_regclass`. O leitor `/api/v1/ai/turn-traces` (mesmo commit) alcança exatamente esta janela: nada fica guardado sem quem leia. Idempotente; apêndice espelhado no `baseline.sql` antes da VARREDURA anon.

-- 0778 — o traço do turno tem prazo, e o prazo é o da telemetria da IA.
--
-- ═══ O DEFEITO MEDIDO ════════════════════════════════════════════════════════
--
-- A 0721 passou a gravar UMA linha por turno do agente em `agent_turn_traces`
-- (e uma por prévia). Nada apagava. Medido na main antes desta migration:
--
--     $ git grep -ln 'agent_turn_traces' -- supabase supabase/baseline.sql
--     (só a 0721 e o baseline, nenhuma função de expurgo)
--     $ grep -c 'agent_turn_traces' app/api/v1/cron/data-retention/route.ts
--     0
--
-- Numa instalação que atende, isso é uma linha por turno para sempre. É a MESMA
-- classe do #2140/#3415: dado append-only sem prazo.
--
-- ═══ A DECISÃO ABERTA NA ISSUE: janela própria ou a da telemetria? ═══════════
--
-- A DA TELEMETRIA DA IA, e o `AI_TELEMETRY_RETENTION_DAYS` é o único knob
-- (padrão 400, piso 100 — os mesmos números, e o mesmo `interpretarRetencao`,
-- que o cron já usa para as quatro tabelas da 0587).
--
-- O porquê, escrito onde o próximo leitor procura:
--
--   1. o traço É telemetria da IA. Uma linha por turno com os agregados do job
--      (tokens, custo, latência, skills) é a mesma natureza de `llm_calls` e
--      `skill_activations`, e nasce da mesma pergunta: "o que aconteceu?".
--      Dar-lhe vida diferente faria duas respostas possíveis para "quanto tempo
--      a IA guarda o que fez", e obrigaria quem instala a configurar mais um
--      número para o mesmo assunto;
--   2. o volume é MENOR que o das irmãs que já vivem nessa janela: `llm_calls`
--      é uma linha por chamada de modelo (várias por turno) e o traço é uma por
--      TURNO. A tabela que mais pesa continua sendo a que já estava aqui;
--   3. o padrão de 400 dias já é folgado em relação a quem lê: a tela que olha
--      mais para trás olha 90 dias (`MAX_RANGE_DAYS` de `ai/usage` e
--      `ai/evolution`), e o traço é lido para explicar um turno — dias, não
--      anos. Quem quiser menos aperta o knob que já existe (o piso de 100 é o
--      que impede o knob de virar apagador de investigação em curso).
--
-- O CUSTO declarado dessa escolha: não existe como guardar o traço por mais
-- tempo que as chamadas de LLM, nem por menos, sem separar os dois depois. Se a
-- tela do traço (fatia seguinte) provar que precisa de mais, o caminho é a
-- variável própria que a issue descreve — e esta função já tem o parâmetro
-- pronto (`p_retencao_dias`), então a separação é uma linha no cron.
--
-- ═══ O QUE ESTA PODA **NÃO** PRESERVA — e por que isso é seguro ═════════════
--
-- As irmãs da 0587 preservam alguma coisa (o último envio do número, as últimas
-- `windowSize` cópias, o último checkpoint da fronteira) porque um LEITOR
-- depende dela em qualquer idade. O traço não tem esse caso, e inventar uma
-- guarda aqui seria mentira com cara de zelo:
--
--   • nenhuma chave estrangeira aponta para `agent_turn_traces`;
--   • nenhum agregado é recalculado a partir dela depois da escrita (tokens,
--     custo e latência são somados no INSERT, dentro do turno);
--   • o único leitor é o de linha do tempo (`/api/v1/ai/turn-traces`), e ele
--     alcança exatamente a janela desta função — começar em
--     `now() - retenção` é o que garante que o expurgo nunca apaga o que o
--     leitor mostra (o par está medido em
--     `tests/unit/retencao-do-traco-do-turno.test.ts` e
--     `tests/invariants/traco-do-turno-tem-prazo.test.ts`);
--   • a linha é metadado: nome de ferramenta, estado, ids, código de erro e a
--     mensagem de erro TRUNCADA em 300 caracteres. Não há corpo de mensagem,
--     texto de cliente nem trecho de conhecimento — o expurgo aqui é de volume,
--     não de texto pessoal (o traço é imune ao problema do #1534/#1686).
--
-- ═══ POR QUE FUNÇÃO PRÓPRIA, E NÃO A QUINTA TABELA DA 0587 ══════════════════
--
-- `fn_expurgar_telemetria_de_ia_vencida` devolve a SOMA das quatro tabelas, e o
-- laço do cron para no primeiro lote incompleto — "soma < limite" só implica
-- "nenhuma encheu" porque todas falam o mesmo idioma de lote. Acrescentar a
-- quinta ali mudaria o corpo de uma função que já está aplicada em todo clone,
-- e o `tests/unit/retencao-das-tabelas-da-ia.test.ts` exige que o corpo do
-- baseline seja LITERALMENTE igual ao da migration 0587: reescrevê-lo
-- significaria editar história aplicada. Função irmã, mesmo par de parâmetros,
-- mesmo knob, mesma contagem no relatório — e a 0587 fica intacta.
--
-- Idempotente: `create index if not exists` com nome próprio da poda,
-- `create or replace function`, `revoke`/`grant` reemitidos, `comment on
-- column` guardado por `to_regclass` (a tabela nasce na 0721; num clone em que
-- ela não exista, o comentário — que é cosmético — não pode derrubar a
-- atualização). Nenhuma constraint nova, então não há dado a corrigir antes.

-- Índice de poda: o DELETE por idade é diário e cresceria com a tabela. O
-- índice que já existe começa por `organization_id` (0721), e esta poda não tem
-- seletor de organização — sem este, cada rodada varre a tabela inteira.
create index if not exists idx_agent_turn_traces_expurgo_created_at
  on public.agent_turn_traces (created_at);

-- O expurgo do traço do turno vencido. Mesma forma da família da 0587:
-- `security definer` SEM seletor de linha (nenhum parâmetro de organização,
-- contato, conversa ou id — o único predicado vindo de fora é a idade), piso
-- dentro do CORPO (vale para qualquer chamador, inclusive um `psql` na mão),
-- lote com teto de 10000 e revogação de `public`/`anon`/`authenticated`.
create or replace function public.fn_expurgar_traco_do_turno_vencido(
  p_retencao_dias int default null,
  p_limite int default null
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- 400 = o mesmo padrão de `AI_TELEMETRY_RETENTION_DAYS` (RETENCAO_TELEMETRIA_
  -- DE_IA_DIAS_PADRAO) e 100 = o mesmo piso (RETENCAO_TELEMETRIA_DE_IA_DIAS_
  -- PISO). Os números são repetidos aqui de propósito, como nas irmãs da 0587:
  -- a função vale para chamador que não passou pelo TypeScript (o `psql` da
  -- madrugada). O par SQL × TypeScript é medido em
  -- `tests/unit/retencao-do-traco-do-turno.test.ts`.
  v_dias int := greatest(coalesce(p_retencao_dias, 400), 100);
  v_limite int := least(greatest(coalesce(p_limite, 1000), 1), 10000);
  v_corte timestamptz := now() - make_interval(days => v_dias);
  v_apagadas int;
begin
  -- O corte fica no `where` ANTES do `limit` (a lição da 0167): filtrar depois
  -- faria um lote inteiro de linhas ainda válidas devolver 0 e o cron parar com
  -- backlog atrás.
  with vencidas as (
    select t.id from public.agent_turn_traces t
     where t.created_at < v_corte
     order by t.created_at limit v_limite
  )
  delete from public.agent_turn_traces t using vencidas v where t.id = v.id;
  get diagnostics v_apagadas = row_count;
  return v_apagadas;
end;
$$;
revoke execute on function public.fn_expurgar_traco_do_turno_vencido(int,int) from public, anon, authenticated;
grant  execute on function public.fn_expurgar_traco_do_turno_vencido(int,int) to service_role;

-- O relógio da poda é `created_at`, e quem lê o traço pergunta por ele. Dizer
-- isso na coluna é o que impede a próxima pessoa de indexar/filtrar por
-- `updated_at` (que muda no upsert de um turno repetido) achando que é o mesmo
-- eixo. Dentro da guarda: num clone sem a tabela da 0721 o comentário não pode
-- derrubar a atualização.
do $$
begin
  if to_regclass('public.agent_turn_traces') is not null then
    comment on column public.agent_turn_traces.created_at is
      'Quando o turno gravou o traço. É o relógio de fn_expurgar_traco_do_turno_vencido (0778) e o eixo do leitor /api/v1/ai/turn-traces — NÃO confundir com updated_at, que o upsert reescreve quando o mesmo job regrava.';
  end if;
end
$$;

notify pgrst, 'reload schema';
