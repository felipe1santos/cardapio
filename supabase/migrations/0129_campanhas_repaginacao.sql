-- 0129 — Campanhas repaginadas (2026-10-01).
--
-- 1. restaurantes.mensagens_status: mensagens automáticas de status do pedido no WhatsApp
--    (liga/desliga geral, por tipo de pedido e por etapa; texto próprio da loja). NULO =
--    exatamente o que já saía (todas as etapas, textos padrão) — nada muda para loja que
--    não mexer. Leitura/escrita só pelo servidor (rota com sessão + service_role).
-- 2. campanha_modelos: modelos de mensagem reutilizáveis nas campanhas.
-- 3. campanhas_visao_geral(de, ate): números da Visão geral com atribuição de 72 h (mesmo
--    telefone, pedido não cancelado até 72 h depois do envio). Não mexe na função de
--    métricas da 0104 (12 h), que continua no relatório detalhado.
--
-- Aditiva. Rollback: docs/rollback/0129_campanhas_repaginacao.down.sql

alter table public.restaurantes add column if not exists mensagens_status jsonb;
alter table public.restaurantes drop constraint if exists restaurantes_mensagens_status_check;
alter table public.restaurantes add constraint restaurantes_mensagens_status_check
  check (mensagens_status is null or jsonb_typeof(mensagens_status) = 'object');
comment on column public.restaurantes.mensagens_status is 'Mensagens automáticas de status (0129). Nulo = padrão (tudo ligado, textos padrão).';

create table if not exists public.campanha_modelos (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 1 and 80),
  mensagem text not null default '' check (length(mensagem) <= 4096),
  imagem_url text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists campanha_modelos_loja on public.campanha_modelos (restaurante_id, criado_em desc);
alter table public.campanha_modelos enable row level security;
drop policy if exists "Gestores gerenciam modelos de campanha" on public.campanha_modelos;
create policy "Gestores gerenciam modelos de campanha" on public.campanha_modelos
  for all to authenticated
  using (restaurante_id = public.auth_restaurante_id() and public.auth_e_gestor())
  with check (restaurante_id = public.auth_restaurante_id() and public.auth_e_gestor());
grant select, insert, update, delete on public.campanha_modelos to authenticated;

create or replace function public.campanhas_visao_geral(p_de timestamptz, p_ate timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_loja uuid := public.auth_restaurante_id(); v_res jsonb;
begin
  if v_loja is null or not public.auth_e_gestor() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > interval '400 days' then
    raise exception 'período inválido' using errcode = '22023';
  end if;

  with env as (
    -- Envios do período (pelo momento do envio).
    select e.id, e.campanha_id, e.status, e.enviado_em, e.entregue_em, e.lido_em, e.clicado_em, e.id_externo,
           coalesce(e.enviado_em, e.criado_em) quando, public.telefone_chave(e.telefone) k
      from public.campanha_envios e
     where e.restaurante_id = v_loja
       and coalesce(e.enviado_em, e.criado_em) between p_de and p_ate
  ), ok as (
    select * from env where status = 'enviado' and enviado_em is not null and k is not null
  ), ped as (
    select p.id, p.total, p.criado_em, public.telefone_chave(p.cliente_telefone) k
      from public.pedidos p
     where p.restaurante_id = v_loja and p.status <> 'cancelado'
       and p.criado_em >= p_de and p.criado_em <= p_ate + interval '72 hours'
  ), atr as (
    -- Cada pedido vai para o envio mais recente ao mesmo telefone nas 72 h anteriores.
    select distinct on (ped.id) ped.id pedido_id, ped.total, ped.criado_em, ped.k, ok.id envio_id, ok.campanha_id, ok.enviado_em
      from ped join ok on ok.k = ped.k and ped.criado_em >= ok.enviado_em and ped.criado_em < ok.enviado_em + interval '72 hours'
     order by ped.id, ok.enviado_em desc
  ), hist as (
    -- Último pedido do cliente ANTES do envio: separa recorrente (< 30 dias) de recuperado (≥ 30).
    select atr.pedido_id,
           (select max(p2.criado_em) from public.pedidos p2
             where p2.restaurante_id = v_loja and p2.status <> 'cancelado'
               and public.telefone_chave(p2.cliente_telefone) = atr.k and p2.criado_em < atr.enviado_em) anterior,
           atr.enviado_em
      from atr
  ), camp as (
    select c.id, c.nome, c.status, c.tipo_mensagem, c.incluir_link, c.imagem_url, c.mensagem,
           coalesce(c.agendado_em, c.criado_em) quando, c.total_destinatarios
      from public.campanhas c
     where c.restaurante_id = v_loja and c.id in (select distinct campanha_id from env)
  ), por as (
    select camp.id, camp.nome, camp.status, camp.tipo_mensagem, camp.imagem_url, camp.quando,
           (select count(*) from env where env.campanha_id = camp.id) contatos,
           (select count(*) from ok where ok.campanha_id = camp.id) enviadas,
           (select count(*) from ok where ok.campanha_id = camp.id and ok.lido_em is not null) lidas,
           (select count(*) from ok where ok.campanha_id = camp.id and (ok.entregue_em is not null or ok.lido_em is not null)) com_retorno,
           (select count(*) from atr where atr.campanha_id = camp.id) pedidos,
           (select count(distinct atr.envio_id) from atr where atr.campanha_id = camp.id) convertidos,
           (select coalesce(sum(atr.total), 0) from atr where atr.campanha_id = camp.id) receita
      from camp
  ), dias as (
    select d::date dia from generate_series((p_de at time zone 'America/Sao_Paulo')::date, (p_ate at time zone 'America/Sao_Paulo')::date, interval '1 day') d
  )
  select jsonb_build_object(
    'janela_horas', 72,
    'totais', jsonb_build_object(
      'receita', (select coalesce(sum(total), 0) from atr),
      'pedidos', (select count(*) from atr),
      'contatos', (select count(distinct k) from ok),
      'recorrentes', (select count(*) from hist where anterior is not null and anterior >= enviado_em - interval '30 days'),
      'recuperados', (select count(*) from hist where anterior is not null and anterior < enviado_em - interval '30 days'),
      'tentados', (select count(*) from env where status in ('enviado', 'erro', 'incerto')),
      'enviadas', (select count(*) from ok),
      -- Leitura: só existe quando o provedor devolve entrega/leitura (MESSAGES_UPDATE).
      'leitura_rastreada', (select count(*) from ok where id_externo is not null and (entregue_em is not null or lido_em is not null)) > 0,
      'lidas', (select count(*) from ok where lido_em is not null),
      'enviadas_rastreadas', (select count(*) from ok where id_externo is not null),
      -- Clique: só em campanha com link rastreável.
      'com_link', (select count(*) from ok join public.campanhas c on c.id = ok.campanha_id where c.incluir_link),
      'clicaram', (select count(*) from ok join public.campanhas c on c.id = ok.campanha_id where c.incluir_link and ok.clicado_em is not null),
      'minutos_para_pedir', (select round(avg(extract(epoch from (criado_em - enviado_em)) / 60)) from atr)
    ),
    'serie', (select coalesce(jsonb_agg(jsonb_build_object(
        'dia', dias.dia,
        'enviadas', (select count(*) from ok where (ok.enviado_em at time zone 'America/Sao_Paulo')::date = dias.dia),
        'pedidos', (select count(*) from atr where (atr.criado_em at time zone 'America/Sao_Paulo')::date = dias.dia),
        'receita', (select coalesce(sum(atr.total), 0) from atr where (atr.criado_em at time zone 'America/Sao_Paulo')::date = dias.dia)
      ) order by dias.dia), '[]'::jsonb) from dias),
    'envios', coalesce((select jsonb_agg(to_jsonb(por) order by por.quando desc) from por), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $$;
revoke execute on function public.campanhas_visao_geral(timestamptz, timestamptz) from public, anon;
grant execute on function public.campanhas_visao_geral(timestamptz, timestamptz) to authenticated, service_role;

-- Último envio de cada campanha (coluna "Enviada em" dos Agendamentos).
create or replace function public.campanhas_ultimo_envio()
returns table (campanha_id uuid, ultimo_envio timestamptz, enviadas bigint, falhas bigint)
language sql
stable
security definer
set search_path = public
as $$
  select e.campanha_id, max(e.enviado_em), count(*) filter (where e.status = 'enviado'), count(*) filter (where e.status in ('erro', 'incerto'))
    from public.campanha_envios e
   where e.restaurante_id = public.auth_restaurante_id() and public.auth_e_gestor()
   group by e.campanha_id
$$;
revoke execute on function public.campanhas_ultimo_envio() from public, anon;
grant execute on function public.campanhas_ultimo_envio() to authenticated, service_role;
