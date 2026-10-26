-- manifest: Cadências de e-mail do PR1738 entram como módulo opcional oficial (doc75B, ADR0002), desligadas até instalação e escolha da empresa; tabelas nascem só na provisionadora fixa, com RLS/grants e LGPD, abertura com consentimento e descadastro sem sessão. Crédito: Marcelo (@lmarceloc).
-- A migration entrega funções, não tabelas para toda instalação. Não modifica MANIFEST histórico.
create or replace function public.fn_cadencias_provisionar()
returns void language plpgsql security definer set search_path = public, pg_temp as $cadencias$
begin
create table if not exists public.email_cadences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  status text not null default 'rascunho',
  configuracao jsonb not null default '{}'::jsonb,
  passos jsonb not null default '[]'::jsonb,
  -- Sobe a cada gravação de passos: a inscrição guarda o passo por id, e o
  -- worker confere que o id ainda existe na versão atual.
  versao integer not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_cadences_status_check check (status in ('rascunho','ativa','pausada')),
  constraint email_cadences_name_check check (btrim(name) <> ''),
  constraint email_cadences_passos_array check (jsonb_typeof(passos) = 'array'),
  constraint email_cadences_config_object check (jsonb_typeof(configuracao) = 'object')
);

create index if not exists idx_email_cadences_org_status
  on public.email_cadences (organization_id, status, updated_at desc);

comment on table public.email_cadences is
  'Cadência de e-mail (sequência por lead). configuracao/passos seguem o schema de lib/cadencias/schemas.ts.';

create table if not exists public.email_cadence_enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cadence_id uuid not null references public.email_cadences(id) on delete cascade,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  status text not null default 'ativa',
  motivo_parada text,
  origem text not null default 'manual',
  inscrito_por uuid references auth.users(id) on delete set null,
  rastreio_consentido boolean not null default false,
  consentimento_em timestamptz,
  envio_pendente_passo_id text,
  -- Id do PRÓXIMO passo a executar (null = não há mais passos: conclui).
  passo_atual_id text,
  proximo_em timestamptz not null default now(),
  -- Trava otimista da rodada: quem reivindica a linha grava até quando é dono.
  processando_ate timestamptz,
  ultimo_email_em timestamptz,
  ultimo_email_passo_id text,
  emails_enviados integer not null default 0,
  aberturas integer not null default 0,
  aberturas_ultimo_email integer not null default 0,
  cliques integer not null default 0,
  primeira_abertura_em timestamptz,
  ultima_abertura_em timestamptz,
  ultimo_clique_em timestamptz,
  tentativas integer not null default 0,
  ultimo_erro text,
  concluida_em timestamptz,
  parada_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_cadence_enrollments_status_check check (status in ('ativa','concluida','parada')),
  constraint email_cadence_enrollments_origem_check check (origem in ('manual','tag')),
  constraint email_cadence_enrollments_motivo_check check (
    motivo_parada is null or motivo_parada in (
      'respondeu','bounce','descadastro','ganho_ou_perdido','manual','sem_email','falha'
    )
  ),
  constraint email_cadence_enrollments_parada_consistente check (
    (status = 'parada') = (motivo_parada is not null)
  ),
  constraint email_cadence_enrollments_unica unique (cadence_id, lead_id)
);

alter table public.email_cadence_enrollments add column if not exists rastreio_consentido boolean not null default false;
alter table public.email_cadence_enrollments add column if not exists consentimento_em timestamptz;
alter table public.email_cadence_enrollments add column if not exists envio_pendente_passo_id text;
alter table public.email_cadence_enrollments add column if not exists aberturas_ultimo_email integer not null default 0;

-- A pergunta do worker: quais inscrições ativas já venceram.
create index if not exists idx_email_cadence_enrollments_vencidas
  on public.email_cadence_enrollments (proximo_em)
  where status = 'ativa';
create index if not exists idx_email_cadence_enrollments_lead
  on public.email_cadence_enrollments (organization_id, lead_id);
create index if not exists idx_email_cadence_enrollments_cadencia
  on public.email_cadence_enrollments (cadence_id, status, created_at desc);

create table if not exists public.email_cadence_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cadence_id uuid not null references public.email_cadences(id) on delete cascade,
  enrollment_id uuid not null references public.email_cadence_enrollments(id) on delete cascade,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  tipo text not null,
  passo_id text,
  ator_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint email_cadence_events_tipo_check check (tipo in (
    'inscrito','reinscrito','email_enviado','email_falhou','aberto','clicado',
    'descadastrou','ramo_sim','ramo_nao','tarefa_criada','parada','concluida','limite_diario_atingido'
  ))
);

alter table public.email_cadence_events alter column metadata drop not null;

create index if not exists idx_email_cadence_events_cadencia
  on public.email_cadence_events (cadence_id, created_at desc);
create index if not exists idx_email_cadence_events_inscricao
  on public.email_cadence_events (enrollment_id, created_at desc);

-- ═══ RLS ═══
-- SELECT aberto ao tenant; escrita só pelo servidor (service_role), que filtra
-- `organization_id` manualmente a partir de `requireRole()`.
alter table public.email_cadences enable row level security;
alter table public.email_cadence_enrollments enable row level security;
alter table public.email_cadence_events enable row level security;

drop policy if exists email_cadences_select on public.email_cadences;
create policy email_cadences_select on public.email_cadences
  for select to authenticated using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );

drop policy if exists email_cadence_enrollments_select on public.email_cadence_enrollments;
create policy email_cadence_enrollments_select on public.email_cadence_enrollments
  for select to authenticated using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );

drop policy if exists email_cadence_events_select on public.email_cadence_events;
create policy email_cadence_events_select on public.email_cadence_events
  for select to authenticated using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );

revoke all on public.email_cadences from anon, authenticated;
revoke all on public.email_cadence_enrollments from anon, authenticated;
revoke all on public.email_cadence_events from anon, authenticated;
grant select on public.email_cadences to authenticated;
grant select on public.email_cadence_enrollments to authenticated;
grant select on public.email_cadence_events to authenticated;
grant all on public.email_cadences to service_role;
grant all on public.email_cadence_enrollments to service_role;
grant all on public.email_cadence_events to service_role;

  -- Reaplicar restaura todas as proteções na mesma transação da instalação.
  perform public.fn_proteger_modulo_provisionado();
  insert into public.modulo_secoes_lgpd (modulo,tabela,ligacao,colunas,colunas_rotulo)
  values
    ('cadencias','email_cadence_enrollments','organization_id = $1 and contact_id = $2',array['ultimo_erro'],'{}'::text[]),
    ('cadencias','email_cadence_events','organization_id = $1 and lead_id in (select id from public.crm_leads where organization_id = $1 and contact_id = $2)',array['metadata'],'{}'::text[])
  on conflict (modulo,tabela) do update set ligacao=excluded.ligacao,colunas=excluded.colunas,colunas_rotulo=excluded.colunas_rotulo;
end $cadencias$;
revoke execute on function public.fn_cadencias_provisionar() from public,anon,authenticated;
grant execute on function public.fn_cadencias_provisionar() to service_role;

-- Escrita atômica da chave da empresa; não sobrescreve routing/branding etc.
create or replace function public.fn_cadencias_configurar(p_organization_id uuid,p_enabled boolean)
returns boolean language plpgsql set search_path=public,pg_temp as $configurar$
begin
  if p_enabled is null then raise exception 'cadencia_invalid_configuration'; end if;
  update public.organizations set settings=jsonb_set(coalesce(settings,'{}'::jsonb),'{cadencias}',
    (case when jsonb_typeof(settings->'cadencias')='object' then settings->'cadencias' else '{}'::jsonb end)
      || jsonb_build_object('enabled',p_enabled),true)
    where id=p_organization_id;
  return found;
end $configurar$;
revoke execute on function public.fn_cadencias_configurar(uuid,boolean) from public,anon,authenticated;
grant execute on function public.fn_cadencias_configurar(uuid,boolean) to service_role;

-- Funções compilam mesmo antes da instalação (ADR0002 D7).
create or replace function public.fn_cadencia_registrar_abertura(p_enrollment_id uuid,p_organization_id uuid,p_passo_id text)
returns boolean language plpgsql set search_path = public,pg_temp as $abertura$
declare v_inscricao record;
begin
  if to_regclass('public.email_cadence_enrollments') is null then return false; end if;
  if not exists(select 1 from public.modulos_instalados where modulo='cadencias' and estado='ativo')
    or not exists(select 1 from public.organizations where id=p_organization_id and public.fn_org_operante(id) and settings->'cadencias'->'enabled'='true'::jsonb) then return false; end if;
  update public.email_cadence_enrollments e set aberturas=e.aberturas+1,
    aberturas_ultimo_email=e.aberturas_ultimo_email+case when e.ultimo_email_passo_id=p_passo_id then 1 else 0 end,
    primeira_abertura_em=coalesce(e.primeira_abertura_em,now()),ultima_abertura_em=now()
  where e.id=p_enrollment_id and e.organization_id=p_organization_id and e.rastreio_consentido
    and e.motivo_parada is distinct from 'descadastro'
    and exists(select 1 from public.contacts c where c.id=e.contact_id and c.organization_id=p_organization_id and not c.is_anonymized)
  returning * into v_inscricao;
  if not found then return false; end if;
  insert into public.email_cadence_events(organization_id,cadence_id,enrollment_id,lead_id,tipo,passo_id)
  values(p_organization_id,v_inscricao.cadence_id,v_inscricao.id,v_inscricao.lead_id,'aberto',p_passo_id);
  return true;
end $abertura$;
revoke execute on function public.fn_cadencia_registrar_abertura(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.fn_cadencia_registrar_abertura(uuid,uuid,text) to service_role;

-- O link continua válido depois de concluir/pausar/desligar: registra a supressão
-- na própria inscrição de origem e interrompe as outras ativas do mesmo contato.
-- Contagem + eventos em uma transação; clique repetido não cria evento extra.
create or replace function public.fn_cadencia_descadastrar(p_enrollment_id uuid,p_organization_id uuid)
returns integer language plpgsql set search_path=public,pg_temp as $descadastro$
declare v_contato uuid; v_linha record; v_total integer := 0;
begin
  if to_regclass('public.email_cadence_enrollments') is null then return 0; end if;
  select contact_id into v_contato from public.email_cadence_enrollments
    where id=p_enrollment_id and organization_id=p_organization_id;
  if not found then return 0; end if;
  for v_linha in
    update public.email_cadence_enrollments set status='parada',motivo_parada='descadastro',
      rastreio_consentido=false,processando_ate=null,parada_em=now(),updated_at=now()
    where organization_id=p_organization_id and contact_id=v_contato
      and (status='ativa' or id=p_enrollment_id) and motivo_parada is distinct from 'descadastro'
    returning id,cadence_id,lead_id
  loop
    insert into public.email_cadence_events(organization_id,cadence_id,enrollment_id,lead_id,tipo)
      values(p_organization_id,v_linha.cadence_id,v_linha.id,v_linha.lead_id,'descadastrou');
    v_total := v_total+1;
  end loop;
  return v_total;
end $descadastro$;
revoke execute on function public.fn_cadencia_descadastrar(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fn_cadencia_descadastrar(uuid,uuid) to service_role;

-- A anonimização revoga rastreio e encerra filas antes do próximo envio.
create or replace function public.fn_cadencias_redigir_titular()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $redacao$
begin
  if new.is_anonymized and not old.is_anonymized and to_regclass('public.email_cadence_enrollments') is not null then
    update public.email_cadence_enrollments set status='parada',motivo_parada='sem_email',
      rastreio_consentido=false,ultimo_erro=null,processando_ate=null,parada_em=now()
    where organization_id=new.organization_id and contact_id=new.id;
  end if;
  return new;
end $redacao$;
revoke execute on function public.fn_cadencias_redigir_titular() from public,anon,authenticated,service_role;
drop trigger if exists trg_cadencias_redigir_titular on public.contacts;
create trigger trg_cadencias_redigir_titular after update of is_anonymized on public.contacts
for each row execute function public.fn_cadencias_redigir_titular();

do $reaplicar$ begin
  if exists(select 1 from public.modulos_instalados where modulo='cadencias') then
    perform public.fn_cadencias_provisionar();
  end if;
end $reaplicar$;
