-- Etapa G — "Chamar garçom".
--
-- O cliente na mesa toca um botão; o salão precisa saber QUAL mesa chamou e HÁ QUANTO
-- TEMPO, sem que isso crie pedido, comanda ou qualquer efeito financeiro.
--
-- Por que funções no banco, como na 0067: assumir um chamado é uma corrida entre dois
-- garçons (os dois veem o aviso ao mesmo tempo) e o limite anti-spam precisa olhar o
-- estado no momento da gravação. `update ... where status = 'pendente'` resolve a
-- corrida; o limite precisa da mesma transação para não deixar dois chamados passarem.
--
-- A rota pública roda com service_role (o token opaco da URL é a credencial), então as
-- funções são SECURITY DEFINER e só service_role executa — igual à 0067.

create table if not exists public.chamados_mesa (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  mesa_id uuid not null references public.mesas(id) on delete cascade,
  -- Sessão é contexto, não dono: se ela encerrar, o chamado já atendido continua no
  -- histórico apontando a mesa.
  sessao_id uuid references public.sessoes_mesa(id) on delete set null,
  motivo text not null default 'garcom',
  status text not null default 'pendente',
  criado_em timestamptz not null default now(),
  assumido_por uuid references public.usuarios(id) on delete set null,
  assumido_por_nome text,
  assumido_em timestamptz,
  concluido_por uuid references public.usuarios(id) on delete set null,
  concluido_por_nome text,
  concluido_em timestamptz
);

alter table public.chamados_mesa drop constraint if exists chamados_mesa_motivo_check;
alter table public.chamados_mesa add constraint chamados_mesa_motivo_check
  check (motivo in ('garcom', 'conta', 'ajuda'));

alter table public.chamados_mesa drop constraint if exists chamados_mesa_status_check;
alter table public.chamados_mesa add constraint chamados_mesa_status_check
  check (status in ('pendente', 'assumido', 'concluido', 'expirado'));

-- Anti-spam estrutural: uma mesa não acumula dois chamados abertos do mesmo motivo.
-- O índice é a garantia; a função devolve o chamado que já existe em vez de falhar.
create unique index if not exists chamados_mesa_ativo_unq
  on public.chamados_mesa (mesa_id, motivo)
  where status in ('pendente', 'assumido');

create index if not exists idx_chamados_mesa_painel
  on public.chamados_mesa (restaurante_id, status, criado_em desc);

comment on table public.chamados_mesa is
  'Chamado de garçom feito pelo cliente na mesa. NÃO cria pedido nem comanda: é um aviso '
  'operacional com ciclo pendente → assumido → concluído.';

-- ── leitura ──────────────────────────────────────────────────────────────────
alter table public.chamados_mesa enable row level security;

drop policy if exists chamados_mesa_select on public.chamados_mesa;
create policy chamados_mesa_select on public.chamados_mesa
  for select to authenticated
  using (
    restaurante_id = public.auth_restaurante_id()
    and public.auth_papel() in ('dono', 'gerente', 'garcom')
  );

-- Escrita nunca pelo navegador: o cliente não tem login e o garçom passa pela rota, que
-- confere permissão e grava auditoria.
revoke all on public.chamados_mesa from authenticated, anon;
grant select on public.chamados_mesa to authenticated;

-- O salão escuta o aviso em tempo real; a tela tem releitura periódica como reserva.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chamados_mesa'
  ) then
    alter publication supabase_realtime add table public.chamados_mesa;
  end if;
end $$;

-- ═══ abrir ══════════════════════════════════════════════════════════════════
-- `p_janela_segundos` é a carência entre um chamado concluído e o próximo da mesma mesa:
-- sem ela, tocar o botão dez vezes seguidas enche o painel. Chamado abandonado (ninguém
-- concluiu) expira sozinho depois de `p_expira_minutos` e libera a mesa para chamar de novo.
create or replace function public.chamado_abrir(
  p_restaurante uuid, p_mesa uuid, p_sessao uuid, p_motivo text,
  p_janela_segundos int default 45, p_expira_minutos int default 30
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ativa boolean;
  v_bloqueada timestamptz;
  v_existente public.chamados_mesa;
  v_ultimo timestamptz;
  v_espera int;
  v_id uuid;
  v_criado timestamptz;
begin
  if coalesce(p_motivo, '') not in ('garcom', 'conta', 'ajuda') then raise exception 'motivo_invalido'; end if;

  select ativa, bloqueada_em into v_ativa, v_bloqueada
    from public.mesas where id = p_mesa and restaurante_id = p_restaurante;
  if v_ativa is null then raise exception 'mesa_inexistente'; end if;
  if v_ativa = false or v_bloqueada is not null then raise exception 'mesa_indisponivel'; end if;

  -- Trava a mesa: dois celulares na mesma mesa tocando junto não abrem dois chamados.
  perform 1 from public.mesas where id = p_mesa for update;

  -- Antes de qualquer decisão, o que ficou pendurado vira 'expirado'. Assim a mesa não
  -- fica presa a um chamado que ninguém concluiu.
  update public.chamados_mesa
     set status = 'expirado'
   where mesa_id = p_mesa
     and status in ('pendente', 'assumido')
     and criado_em < now() - make_interval(mins => greatest(p_expira_minutos, 1));

  select * into v_existente from public.chamados_mesa
   where mesa_id = p_mesa and motivo = p_motivo and status in ('pendente', 'assumido')
   limit 1;
  if v_existente.id is not null then
    -- Já existe um chamado aberto: devolve ele. Não é erro para o cliente — é "já
    -- avisamos, o garçom está vindo".
    return jsonb_build_object(
      'id', v_existente.id, 'status', v_existente.status, 'criado_em', v_existente.criado_em,
      'ja_existia', true, 'espere_segundos', 0
    );
  end if;

  select max(coalesce(concluido_em, criado_em)) into v_ultimo
    from public.chamados_mesa where mesa_id = p_mesa and motivo = p_motivo;
  if v_ultimo is not null then
    v_espera := greatest(p_janela_segundos, 0) - floor(extract(epoch from (now() - v_ultimo)))::int;
    if v_espera > 0 then raise exception 'muito_rapido:%', v_espera; end if;
  end if;

  begin
    insert into public.chamados_mesa (restaurante_id, mesa_id, sessao_id, motivo)
    values (p_restaurante, p_mesa, p_sessao, p_motivo)
    returning id, criado_em into v_id, v_criado;
  exception when unique_violation then
    -- Corrida perdida: o chamado do outro celular vale.
    select * into v_existente from public.chamados_mesa
     where mesa_id = p_mesa and motivo = p_motivo and status in ('pendente', 'assumido') limit 1;
    return jsonb_build_object(
      'id', v_existente.id, 'status', v_existente.status, 'criado_em', v_existente.criado_em,
      'ja_existia', true, 'espere_segundos', 0
    );
  end;

  insert into public.eventos_auditoria (restaurante_id, ator, usuario_nome, acao, entidade, entidade_id, dados)
  values (p_restaurante, 'sistema', 'cliente da mesa', 'chamado.criou', 'chamado', v_id,
          jsonb_build_object('mesa_id', p_mesa, 'motivo', p_motivo));

  return jsonb_build_object('id', v_id, 'status', 'pendente', 'criado_em', v_criado,
                            'ja_existia', false, 'espere_segundos', 0);
end $$;

-- ═══ assumir ════════════════════════════════════════════════════════════════
-- `where status = 'pendente'` é a corrida resolvida: o segundo garçom não sobrescreve o
-- primeiro, ele recebe 'ja_assumido' com o nome de quem pegou.
create or replace function public.chamado_assumir(
  p_restaurante uuid, p_chamado uuid, p_ator uuid, p_ator_nome text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_quem text;
  v_status text;
  v_mesa uuid;
begin
  update public.chamados_mesa
     set status = 'assumido', assumido_por = p_ator, assumido_por_nome = p_ator_nome, assumido_em = now()
   where id = p_chamado and restaurante_id = p_restaurante and status = 'pendente'
  returning mesa_id into v_mesa;

  if v_mesa is null then
    select status, coalesce(assumido_por_nome, '') into v_status, v_quem
      from public.chamados_mesa where id = p_chamado and restaurante_id = p_restaurante;
    if v_status is null then raise exception 'chamado_inexistente'; end if;
    if v_status = 'assumido' then raise exception 'ja_assumido:%', v_quem; end if;
    raise exception 'chamado_encerrado';
  end if;

  insert into public.eventos_auditoria (restaurante_id, ator, usuario_id, usuario_nome, acao, entidade, entidade_id, dados)
  values (p_restaurante, 'usuario', p_ator, p_ator_nome, 'chamado.assumiu', 'chamado', p_chamado,
          jsonb_build_object('mesa_id', v_mesa, 'de', 'pendente', 'para', 'assumido'));

  return jsonb_build_object('id', p_chamado, 'status', 'assumido');
end $$;

-- ═══ concluir ═══════════════════════════════════════════════════════════════
create or replace function public.chamado_concluir(
  p_restaurante uuid, p_chamado uuid, p_ator uuid, p_ator_nome text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_mesa uuid;
  v_de text;
  v_status text;
begin
  select status into v_de from public.chamados_mesa
   where id = p_chamado and restaurante_id = p_restaurante;
  if v_de is null then raise exception 'chamado_inexistente'; end if;

  update public.chamados_mesa
     set status = 'concluido', concluido_por = p_ator, concluido_por_nome = p_ator_nome,
         concluido_em = now(),
         -- Garçom que concluiu sem assumir antes fica registrado como quem atendeu.
         assumido_por = coalesce(assumido_por, p_ator),
         assumido_por_nome = coalesce(assumido_por_nome, p_ator_nome),
         assumido_em = coalesce(assumido_em, now())
   where id = p_chamado and restaurante_id = p_restaurante and status in ('pendente', 'assumido')
  returning mesa_id into v_mesa;

  if v_mesa is null then
    select status into v_status from public.chamados_mesa where id = p_chamado;
    raise exception 'chamado_encerrado:%', coalesce(v_status, '');
  end if;

  insert into public.eventos_auditoria (restaurante_id, ator, usuario_id, usuario_nome, acao, entidade, entidade_id, dados)
  values (p_restaurante, 'usuario', p_ator, p_ator_nome, 'chamado.concluiu', 'chamado', p_chamado,
          jsonb_build_object('mesa_id', v_mesa, 'de', v_de, 'para', 'concluido'));

  return jsonb_build_object('id', p_chamado, 'status', 'concluido');
end $$;

-- ── ninguém chama isto de fora ───────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'chamado_abrir(uuid,uuid,uuid,text,int,int)',
    'chamado_assumir(uuid,uuid,uuid,text)',
    'chamado_concluir(uuid,uuid,uuid,text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
