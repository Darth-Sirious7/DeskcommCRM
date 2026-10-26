-- manifest: **A conversa SEM dono pode ser assumida por quem assume para si (#3479).** No modo "Só os seus" (`visibility_mode = 'own'`) o Atendente que cadastrava um contato novo e clicava em "Iniciar conversa" era recusado com "A conversa neste número está com outro atendente" — e não havia atendente nenhum. A conversa nasce de `fn_service_begin` (cadastro do contato e `open-with-contact`) com `assigned_to_user_id` nulo; o predicado do modo (`fn_can_view_conversation`) responde "não vejo" para dono nulo; e a guarda da 0685, que faz conversa fora da visibilidade responder como inexistente, recusava justamente o `claim` que daria dono a ela — dependência circular: a conversa só ficaria visível depois de assumida, e só era assumível se visível. A exceção entra no WHERE da definição vigente (0685): quando a linha está SEM dono e o dono NOVO é o próprio chamador, a assinatura é permitida mesmo fora da visibilidade. Não abre nada — só vale para dono novo = chamador, então conversa de colega continua respondendo zero linhas (o caso que a 0685 protege) e transferência para terceiro também (lá `p_to_user_id` não é `auth.uid()`). Service role segue pelo primeiro ramo. Idempotente (`create or replace`), assinatura e grants inalterados; apêndice espelhado no `baseline.sql`, antes do bloco da varredura de anon.

-- 0776 — assumir conversa livre no modo "Só os seus".
--
-- ─── O defeito que isto conserta ───────────────────────────────────────────
--
-- Issue #3479, medida em instalação self-host com a visibilidade em
-- "Só os seus" e o usuário com papel `agent`:
--
--   1. o Atendente cadastra um contato novo COM telefone;
--   2. `contacts.create` (best-effort) chama `ensureConversation` →
--      `fn_service_begin`, que INSERTA a conversa 1:1 com
--      `assigned_to_user_id` NULO — igual ao lead criado por "Novo Lead", que
--      nos modos restritos NASCE com o Atendente de responsável (`leads/route.ts`);
--   3. o Atendente clica em "Iniciar conversa": a rota `open-with-contact`
--      devolve o id da conversa existente (ou o `fn_service_begin` reabre a
--      fechada), e a tela chama `POST /conversations/:id/claim`;
--   4. o `claim` responde 0 linhas → 409 → a tela diz "A conversa neste número
--      está com outro atendente." — o dono é NULO: a frase é falsa;
--   5. e no modo `own` o Atendente também não ENXERGA a conversa (dono nulo não
--      passa em `fn_can_view_conversation`), então o Inbox abre vazio e só um
--      gerente/admin tira a conversa do limbo.
--
-- ─── A causa, na fonte ─────────────────────────────────────────────────────
--
-- A guarda da 0685 põe a visibilidade de quem chama no WHERE da leitura que
-- precede o UPDATE:
--
--   and (auth.uid() is null or public.fn_can_view_conversation(organization_id, assigned_to_user_id))
--
-- A regra está certa para o que ela foi escrita: conversa de COLEGA responde
-- como inexistente para quem não a enxerga, para as rotas nunca revelarem nem
-- a existência dela. O que ela não previu é a conversa SEM dono. No modo `own`
-- o predicado responde "não vejo" para dono nulo (é o que faz a fila sem dono
-- não poluir o Inbox de quem só quer os seus, decidido na 0035), então a
-- própria operação que daria dono à conversa — o `claim` — era a que a guarda
-- barrava. Dependência circular, e o sintoma que ela produz acusa o
-- atendente errado.
--
-- Consertar no chamador (TS) seria contorno: o Inbox já chama `claim` com
-- `expected_assignee: null` e leva 0 linhas; qualquer rota nova que assuma
-- conversa livre cairia na mesma parede. O predicado de escopo é do banco, e é
-- lá que a exceção tem de estar para valer em todas as rotas de uma vez.
--
-- ─── O que muda, exatamente ────────────────────────────────────────────────
--
-- Um termo a mais no WHERE, e ele se limita sozinho:
--
--   or (assigned_to_user_id is null and p_to_user_id = auth.uid())
--
-- Lido em português: "conversa sem dono pode ser assumida por quem assume para
-- si". Três propriedades que o desenho precisa ter, e tem:
--
--   • não vaza conversa de colega: o primeiro termo da linha é "sem dono". Se
--     houver dono, ou a visibilidade da 0685 deixa passar, ou continua zero
--     linhas como antes;
--   • não transforma a RPC em transferência: `p_to_user_id = auth.uid()` exige
--     que o dono NOVO seja o próprio chamador. `transfer` (dono novo =
--     terceiro) e `release` (`p_to_user_id` nulo) seguem exatamente como
--     estavam;
--   • não abre o modo `own` para a fila: `fn_can_view_conversation` NÃO muda.
--     O Atendente continua sem enxergar conversa sem dono na leitura; ele só
--     passa a poder TOMÁ-LA para si, e a leitura seguinte já a mostra.
--
-- Service role (`auth.uid()` nulo) segue pelo primeiro ramo, como antes.
--
-- ─── Compatibilidade ───────────────────────────────────────────────────────
--
-- `create or replace` com a MESMA assinatura e os MESMOS grants: quem chama
-- (`claim`, `transfer`, `release`, roteamento do worker, `assumir` da resposta
-- humana, MCP) não muda uma linha. Corpo idêntico ao da 0685 fora o termo do
-- WHERE e o comentário. Idempotente.

CREATE OR REPLACE FUNCTION public.fn_conversation_assign(p_organization_id uuid, p_conversation_id uuid, p_to_user_id uuid, p_reason text, p_expected_assignee uuid DEFAULT NULL::uuid, p_enforce_expected boolean DEFAULT false)
 RETURNS SETOF conversations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_from uuid;
  v_conv public.conversations%rowtype;
begin
  if not public.fn_support_write_allowed(p_organization_id) then raise exception 'support_readonly' using errcode='42501'; end if;
  if auth.uid() is not null
     and not public.fn_role_at_least(p_organization_id, 'agent') then
    raise exception 'caller_not_authorized_for_org'
      using hint = 'caller must be an active agent+ member of the organization';
  end if;

  if p_to_user_id is not null then
    if coalesce(public.fn_member_role_in_org(p_to_user_id, p_organization_id), 'none')
         not in ('agent','manager','admin') then
      raise exception 'assignee_not_eligible_member'
        using hint = 'target must be an active agent+ member of the organization';
    end if;
  end if;

  -- Conversa fora da visibilidade de quem chama responde como conversa
  -- inexistente (zero linhas). A regra fica no WHERE, com o dono da própria
  -- linha (reavaliado na versão nova se houver espera), nunca um valor do
  -- corpo. Service role (sem auth.uid) segue.
  --
  -- A EXCEÇÃO DA #3479: conversa SEM dono pode ser assumida por quem assume
  -- para si. Sem ela o modo "Só os seus" se morde: a conversa que nasceu do
  -- cadastro do contato tem dono nulo, o predicado do modo responde "não vejo"
  -- para dono nulo, e o claim — a operação que daria dono a ela — era recusado,
  -- com a tela dizendo "está com outro atendente" sobre uma conversa de
  -- ninguém. O termo se limita sozinho: exige dono nulo E dono novo =
  -- chamador, então conversa de colega (o caso que a 0685 protege), a
  -- transferência para terceiro e o release continuam respondendo zero linhas
  -- exatamente como antes.
  select assigned_to_user_id into v_from
    from public.conversations
   where id = p_conversation_id
     and organization_id = p_organization_id
     and (
       auth.uid() is null
       or public.fn_can_view_conversation(organization_id, assigned_to_user_id)
       or (assigned_to_user_id is null and p_to_user_id = auth.uid())
     )
   for no key update;

  if not found then
    return;
  end if;

  if p_enforce_expected and v_from is distinct from p_expected_assignee then
    return;
  end if;

  update public.conversations
     set assigned_to_user_id = p_to_user_id,
         -- Desnormalizado JUNTO com o dono, na mesma transação: nunca existe
         -- uma janela em que id e nome discordam. NULL junto com o id quando
         -- a atribuição é removida (release) — nunca sobra um nome órfão de
         -- dono nenhum. Lido de auth.users porque quem chama esta função
         -- (RPC) não necessariamente tem acesso ao Admin API — a definer
         -- resolve por dentro.
         assigned_to_user_name = case
           when p_to_user_id is null then null
           else (select raw_user_meta_data ->> 'full_name' from auth.users where id = p_to_user_id)
         end,
         assigned_at = case when p_to_user_id is null then null else now() end,
         assignee_kind = case when p_to_user_id is null then null else 'user' end,
         status = case when p_to_user_id is null then 'open' else 'claimed' end,
         status_changed_at = now(),
         unread_count_for_assignee = 0,
         bot_silenced_until = case
           when p_reason = 'routing'  then bot_silenced_until
           when p_to_user_id is null  then (case when last_handoff_at is null
                                                 then null
                                                 else bot_silenced_until end)
           else 'infinity'::timestamptz
         end,
         updated_at = now()
   where id = p_conversation_id
   returning * into v_conv;

  insert into public.conversation_assignment_events
    (organization_id, conversation_id, from_user_id, to_user_id, changed_by, reason)
  values
    (p_organization_id, p_conversation_id, v_from, p_to_user_id, auth.uid(), p_reason);

  return next v_conv;
end;
$function$;

revoke all     on function public.fn_conversation_assign(uuid, uuid, uuid, text, uuid, boolean) from public, anon;
grant  execute on function public.fn_conversation_assign(uuid, uuid, uuid, text, uuid, boolean) to authenticated, service_role;
