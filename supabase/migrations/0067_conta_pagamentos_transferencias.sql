-- Etapa F — conta, pagamentos, transferências, cancelamentos e fechamento.
--
-- Por que funções no banco: transferir mesa, dividir um lançamento entre comandas,
-- registrar pagamento e fechar conta mexem em várias linhas que precisam mudar JUNTAS.
-- O supabase-js não abre transação; cada chamada é uma. Com a conta em jogo, "metade
-- aplicou" não é aceitável — então cada operação é uma função plpgsql, uma transação,
-- com trava de linha (FOR UPDATE) na comanda para dois garçons não se atropelarem.
--
-- As funções são SECURITY DEFINER e SÓ o service_role executa: quem chama é a rota de
-- servidor, que já conferiu sessão e permissão. Nada disto é RPC pública.
--
-- Dinheiro: nada é apagado. Pagamento errado vira ESTORNO (linha marcada), cancelamento
-- vira STATUS com motivo, e o total de fechamento fica gravado na comanda.

-- ── configuração da loja ─────────────────────────────────────────────────────
-- Default 0: nenhuma loja passa a cobrar taxa de serviço sem ligar. A loja que já usa o
-- PDV com comanda não vê o total mudar.
alter table public.restaurantes add column if not exists taxa_servico_padrao numeric(5,2) not null default 0;
alter table public.restaurantes drop constraint if exists restaurantes_taxa_servico_padrao_check;
alter table public.restaurantes add constraint restaurantes_taxa_servico_padrao_check
  check (taxa_servico_padrao >= 0 and taxa_servico_padrao <= 30);

alter table public.restaurantes add column if not exists formas_pagamento_mesa text[] not null
  default array['dinheiro', 'pix', 'credito', 'debito']::text[];

-- ── comanda ──────────────────────────────────────────────────────────────────
alter table public.comandas add column if not exists pessoas int;
alter table public.comandas add column if not exists responsavel_id uuid references public.usuarios(id) on delete set null;
alter table public.comandas add column if not exists responsavel_nome text;
alter table public.comandas add column if not exists observacoes text;
alter table public.comandas add column if not exists taxa_servico_percentual numeric(5,2) not null default 0;
alter table public.comandas add column if not exists desconto_valor numeric(10,2) not null default 0;
alter table public.comandas add column if not exists desconto_motivo text;
alter table public.comandas add column if not exists fechada_por uuid references public.usuarios(id) on delete set null;
alter table public.comandas add column if not exists fechada_por_nome text;
alter table public.comandas add column if not exists total_final numeric(10,2);
alter table public.comandas add column if not exists transferida_para uuid references public.comandas(id);

alter table public.comandas drop constraint if exists comandas_status_check;
alter table public.comandas add constraint comandas_status_check
  check (status in ('aberta', 'fechada', 'transferida'));
alter table public.comandas drop constraint if exists comandas_pessoas_check;
alter table public.comandas add constraint comandas_pessoas_check check (pessoas is null or pessoas between 1 and 99);
alter table public.comandas drop constraint if exists comandas_taxa_check;
alter table public.comandas add constraint comandas_taxa_check check (taxa_servico_percentual between 0 and 30);
alter table public.comandas drop constraint if exists comandas_desconto_check;
alter table public.comandas add constraint comandas_desconto_check check (desconto_valor >= 0);

-- Comanda nova herda a taxa de serviço padrão da loja. Gatilho, e não código: cobre o
-- painel do garçom E o PDV, sem depender de cada caminho lembrar.
create or replace function public.comanda_herdar_taxa()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' and coalesce(new.taxa_servico_percentual, 0) = 0 then
    select coalesce(r.taxa_servico_padrao, 0) into new.taxa_servico_percentual
      from public.restaurantes r where r.id = new.restaurante_id;
  end if;
  return new;
end $$;

drop trigger if exists comandas_herdar_taxa on public.comandas;
create trigger comandas_herdar_taxa before insert on public.comandas
  for each row execute function public.comanda_herdar_taxa();

-- ── item cancelado ───────────────────────────────────────────────────────────
alter table public.pedido_itens add column if not exists cancelado_em timestamptz;
alter table public.pedido_itens add column if not exists cancelado_motivo text;
alter table public.pedido_itens add column if not exists cancelado_por_nome text;

-- ── sessão transferida ───────────────────────────────────────────────────────
-- Quem ficou com o celular na URL da mesa antiga precisa saber que a mesa mudou — sem
-- ganhar acesso à nova. Guarda só o destino, e a rota pública mostra o NOME da mesa.
alter table public.sessoes_mesa add column if not exists transferida_para_mesa_id uuid references public.mesas(id);

-- ── pagamentos ───────────────────────────────────────────────────────────────
create table if not exists public.pagamentos_comanda (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  comanda_id uuid not null references public.comandas(id) on delete cascade,
  forma text not null,
  -- Quanto este pagamento ABATE da conta.
  valor numeric(10,2) not null,
  -- Dinheiro: o que o cliente entregou. O troco é a diferença.
  valor_recebido numeric(10,2),
  troco numeric(10,2) not null default 0,
  chave_idempotencia text,
  criado_por uuid references public.usuarios(id) on delete set null,
  criado_por_nome text not null,
  criado_em timestamptz not null default now(),
  estornado_em timestamptz,
  estornado_por_nome text,
  estorno_motivo text
);

alter table public.pagamentos_comanda drop constraint if exists pagamentos_forma_check;
alter table public.pagamentos_comanda add constraint pagamentos_forma_check
  check (forma in ('dinheiro', 'pix', 'credito', 'debito', 'vale', 'fiado'));
alter table public.pagamentos_comanda drop constraint if exists pagamentos_valor_check;
alter table public.pagamentos_comanda add constraint pagamentos_valor_check check (valor > 0);
alter table public.pagamentos_comanda drop constraint if exists pagamentos_recebido_check;
alter table public.pagamentos_comanda add constraint pagamentos_recebido_check
  check (valor_recebido is null or valor_recebido >= valor);

create index if not exists idx_pagamentos_comanda on public.pagamentos_comanda (comanda_id);
create unique index if not exists pagamentos_chave_unq
  on public.pagamentos_comanda (restaurante_id, chave_idempotencia) where chave_idempotencia is not null;

alter table public.pagamentos_comanda enable row level security;
drop policy if exists pagamentos_select on public.pagamentos_comanda;
create policy pagamentos_select on public.pagamentos_comanda
  for select to authenticated
  using (restaurante_id = public.auth_restaurante_id() and public.auth_papel() in ('dono', 'gerente', 'garcom'));
revoke all on public.pagamentos_comanda from anon, authenticated;
grant select on public.pagamentos_comanda to authenticated;

-- ═══ totais: UMA conta, num lugar só ════════════════════════════════════════
-- A tela, o pagamento e o fechamento leem daqui. Calcular em dois lugares (SQL e
-- TypeScript) é pedir para o total da tela divergir do total cobrado.
create or replace function public.comanda_totais(p_comanda uuid)
returns table (subtotal numeric, taxa_servico numeric, desconto numeric, total numeric, pago numeric, restante numeric)
language sql stable security definer set search_path = public as $$
  with base as (
    select coalesce(sum(i.preco_unitario * i.quantidade), 0)::numeric as sub
      from public.pedidos p
      join public.pedido_itens i on i.pedido_id = p.id
     where p.comanda_id = p_comanda
       and p.status <> 'cancelado'
       and i.cancelado_em is null
  ),
  c as (select taxa_servico_percentual as pct, desconto_valor as desc_valor from public.comandas where id = p_comanda),
  pg as (
    select coalesce(sum(valor), 0)::numeric as pago
      from public.pagamentos_comanda where comanda_id = p_comanda and estornado_em is null
  ),
  calc as (
    select round(base.sub, 2) as sub,
           round(base.sub * c.pct / 100, 2) as taxa,
           -- Desconto nunca passa do valor da conta: conta negativa não existe.
           least(c.desc_valor, round(base.sub + base.sub * c.pct / 100, 2)) as desc_aplicado,
           pg.pago
      from base, c, pg
  )
  select sub, taxa, desc_aplicado, round(sub + taxa - desc_aplicado, 2), pago,
         greatest(round(sub + taxa - desc_aplicado - pago, 2), 0)
    from calc
$$;

-- Recalcula os valores de um pedido a partir dos itens não cancelados. Usado depois de
-- cancelar ou transferir item — o pedido não pode continuar dizendo um total que não tem.
create or replace function public.pedido_recalcular(p_pedido uuid)
returns void language sql security definer set search_path = public as $$
  update public.pedidos p
     set subtotal = t.sub,
         total = greatest(round(t.sub + p.taxa_entrega - p.desconto, 2), 0)
    from (
      select coalesce(round(sum(preco_unitario * quantidade), 2), 0) as sub
        from public.pedido_itens where pedido_id = p_pedido and cancelado_em is null
    ) t
   where p.id = p_pedido
$$;

-- ═══ pagamento ══════════════════════════════════════════════════════════════
create or replace function public.comanda_registrar_pagamento(
  p_restaurante uuid, p_comanda uuid, p_forma text, p_valor numeric, p_recebido numeric,
  p_chave text, p_ator uuid, p_ator_nome text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_restante numeric;
  v_existente uuid;
  v_id uuid;
  v_troco numeric := 0;
begin
  -- Mesma chave = mesmo pagamento. Clique duplo não cobra duas vezes.
  if p_chave is not null then
    select id into v_existente from public.pagamentos_comanda
     where restaurante_id = p_restaurante and chave_idempotencia = p_chave;
    if v_existente is not null then
      return jsonb_build_object('id', v_existente, 'idempotente', true);
    end if;
  end if;

  -- Trava a comanda: dois garçons recebendo o "restante" ao mesmo tempo não podem
  -- cobrar a mesma diferença duas vezes.
  select status into v_status from public.comandas
   where id = p_comanda and restaurante_id = p_restaurante for update;
  if v_status is null then raise exception 'comanda_inexistente'; end if;
  -- De novo, já com a trava: a mesma chave enviada em paralelo esperou o primeiro envio
  -- terminar e agora enxerga o pagamento dele. Sem isto, recusaria por "acima do restante".
  if p_chave is not null then
    select id into v_existente from public.pagamentos_comanda
     where restaurante_id = p_restaurante and chave_idempotencia = p_chave;
    if v_existente is not null then
      return jsonb_build_object('id', v_existente, 'idempotente', true);
    end if;
  end if;
  if v_status <> 'aberta' then raise exception 'comanda_nao_aberta'; end if;

  if p_forma not in ('dinheiro', 'pix', 'credito', 'debito', 'vale', 'fiado') then
    raise exception 'forma_invalida';
  end if;
  -- Arredonda ANTES de validar: 0,004 vira 0,00 e é recusado aqui, não na constraint.
  if p_valor is null or round(p_valor, 2) <= 0 then raise exception 'valor_invalido'; end if;

  select restante into v_restante from public.comanda_totais(p_comanda);
  -- Sem folga: tudo é numeric com 2 casas, então a comparação é exata. Um centavo acima
  -- do que falta já é receber além da conta.
  if round(p_valor, 2) > v_restante then
    raise exception 'valor_acima_do_restante:%', v_restante;
  end if;

  if p_forma = 'dinheiro' and p_recebido is not null then
    if p_recebido < p_valor then raise exception 'recebido_menor_que_valor'; end if;
    v_troco := round(p_recebido - p_valor, 2);
  end if;

  -- Rede de segurança: se ainda assim duas gravações com a mesma chave colidirem, o índice
  -- único barra a segunda e devolvemos o pagamento que ganhou.
  begin
    insert into public.pagamentos_comanda
      (restaurante_id, comanda_id, forma, valor, valor_recebido, troco, chave_idempotencia, criado_por, criado_por_nome)
    values
      (p_restaurante, p_comanda, p_forma, round(p_valor, 2),
       case when p_forma = 'dinheiro' then round(p_recebido, 2) else null end,
       v_troco, p_chave, p_ator, p_ator_nome)
    returning id into v_id;
  exception when unique_violation then
    select id into v_existente from public.pagamentos_comanda
     where restaurante_id = p_restaurante and chave_idempotencia = p_chave;
    return jsonb_build_object('id', v_existente, 'idempotente', true);
  end;

  return jsonb_build_object('id', v_id, 'idempotente', false, 'troco', v_troco);
end $$;

create or replace function public.comanda_estornar_pagamento(
  p_restaurante uuid, p_pagamento uuid, p_motivo text, p_ator_nome text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_comanda uuid;
  v_status text;
begin
  select comanda_id into v_comanda from public.pagamentos_comanda
   where id = p_pagamento and restaurante_id = p_restaurante and estornado_em is null;
  if v_comanda is null then raise exception 'pagamento_inexistente'; end if;

  select status into v_status from public.comandas where id = v_comanda for update;
  if v_status <> 'aberta' then raise exception 'comanda_nao_aberta'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'motivo_obrigatorio'; end if;

  update public.pagamentos_comanda
     set estornado_em = now(), estornado_por_nome = p_ator_nome, estorno_motivo = p_motivo
   where id = p_pagamento;
end $$;

-- ═══ fechamento ═════════════════════════════════════════════════════════════
create or replace function public.comanda_fechar(
  p_restaurante uuid, p_comanda uuid, p_ator uuid, p_ator_nome text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_mesa uuid;
  t record;
begin
  select status, mesa_id into v_status, v_mesa from public.comandas
   where id = p_comanda and restaurante_id = p_restaurante for update;
  if v_status is null then raise exception 'comanda_inexistente'; end if;
  if v_status <> 'aberta' then raise exception 'comanda_nao_aberta'; end if;

  select * into t from public.comanda_totais(p_comanda);
  -- Não existe regra hoje que autorize fechar devendo. Com saldo, não fecha.
  if t.restante > 0 then raise exception 'saldo_restante:%', t.restante; end if;

  update public.comandas
     set status = 'fechada', fechada_em = now(), fechada_por = p_ator,
         fechada_por_nome = p_ator_nome, total_final = t.total
   where id = p_comanda;

  -- Pedido da comanda paga fica pago (é o que o Kanban e os relatórios leem).
  update public.pedidos set pago = true where comanda_id = p_comanda and status <> 'cancelado';

  -- A mesa libera: a sessão acaba e o rascunho que sobrou dos clientes encerra.
  update public.selecoes_mesa s set encerrada_em = now()
    from public.sessoes_mesa sm
   where s.sessao_id = sm.id and sm.mesa_id = v_mesa and sm.status = 'aberta' and s.encerrada_em is null;
  update public.sessoes_mesa set status = 'encerrada', encerrada_em = now()
   where mesa_id = v_mesa and status = 'aberta';

  return jsonb_build_object('total', t.total, 'pago', t.pago);
end $$;

-- ═══ transferir a mesa inteira ══════════════════════════════════════════════
create or replace function public.mesa_transferir(
  p_restaurante uuid, p_origem uuid, p_destino uuid, p_mesclar boolean, p_ator uuid, p_ator_nome text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_comanda_origem uuid;
  v_comanda_destino uuid;
  v_destino_ativa boolean;
  v_destino_bloqueada timestamptz;
  v_destino_nome text;
  v_sessao_origem uuid;
  v_sessao_destino uuid;
begin
  if p_origem = p_destino then raise exception 'mesma_mesa'; end if;

  select ativa, bloqueada_em, nome into v_destino_ativa, v_destino_bloqueada, v_destino_nome
    from public.mesas where id = p_destino and restaurante_id = p_restaurante;
  if v_destino_ativa is null then raise exception 'destino_inexistente'; end if;
  if v_destino_ativa = false then raise exception 'destino_inativo'; end if;
  if v_destino_bloqueada is not null then raise exception 'destino_bloqueado'; end if;

  -- Trava as duas comandas numa ordem fixa (por id) para dois garçons trocando as mesmas
  -- mesas em sentidos opostos não entrarem em deadlock.
  perform 1 from public.comandas
   where restaurante_id = p_restaurante and mesa_id in (p_origem, p_destino) and status = 'aberta'
   order by id for update;

  select id into v_comanda_origem from public.comandas
   where restaurante_id = p_restaurante and mesa_id = p_origem and status = 'aberta';
  if v_comanda_origem is null then raise exception 'origem_sem_comanda'; end if;

  select id into v_comanda_destino from public.comandas
   where restaurante_id = p_restaurante and mesa_id = p_destino and status = 'aberta';

  select id into v_sessao_origem from public.sessoes_mesa where mesa_id = p_origem and status = 'aberta';
  select id into v_sessao_destino from public.sessoes_mesa where mesa_id = p_destino and status = 'aberta';

  if v_comanda_destino is not null then
    -- Destino ocupado: nunca sobrescreve em silêncio. Só junta com confirmação explícita.
    if not coalesce(p_mesclar, false) then raise exception 'destino_ocupado'; end if;

    update public.pedidos set comanda_id = v_comanda_destino where comanda_id = v_comanda_origem;
    update public.pagamentos_comanda set comanda_id = v_comanda_destino where comanda_id = v_comanda_origem;
    -- A comanda de origem não some: fica marcada como transferida, apontando o destino.
    update public.comandas
       set status = 'transferida', fechada_em = now(), transferida_para = v_comanda_destino,
           fechada_por = p_ator, fechada_por_nome = p_ator_nome
     where id = v_comanda_origem;
    update public.comandas d
       set pessoas = nullif(coalesce(d.pessoas, 0) + coalesce(o.pessoas, 0), 0),
           observacoes = nullif(concat_ws(' · ', d.observacoes, o.observacoes), '')
      from public.comandas o
     where d.id = v_comanda_destino and o.id = v_comanda_origem;
  else
    -- Destino livre: a comanda inteira muda de mesa, com histórico e pagamentos.
    update public.comandas set mesa_id = p_destino where id = v_comanda_origem;
    v_comanda_destino := v_comanda_origem;
  end if;

  -- O nome da mesa gravado no pedido é o que a cozinha lê no painel e na reimpressão:
  -- depois da troca, o prato tem que ir para a mesa NOVA. O cliente_nome dos lançamentos
  -- de mesa é o próprio nome da mesa, e acompanha; nome digitado por gente fica como está.
  update public.pedidos
     set cliente_nome = case when cliente_nome = mesa then v_destino_nome else cliente_nome end,
         mesa = v_destino_nome
   where comanda_id = v_comanda_destino and mesa is distinct from v_destino_nome;

  -- Sessão da mesa antiga: encerra e aponta a mesa nova (a tela do cliente avisa).
  if v_sessao_origem is not null then
    update public.selecoes_mesa set encerrada_em = now()
     where sessao_id = v_sessao_origem and encerrada_em is null;
    update public.sessoes_mesa
       set status = 'encerrada', encerrada_em = now(), transferida_para_mesa_id = p_destino
     where id = v_sessao_origem;
  end if;
  if v_sessao_destino is null then
    insert into public.sessoes_mesa (restaurante_id, mesa_id, comanda_id)
    values (p_restaurante, p_destino, v_comanda_destino);
  else
    update public.sessoes_mesa set comanda_id = v_comanda_destino where id = v_sessao_destino;
  end if;

  insert into public.eventos_auditoria (restaurante_id, ator, usuario_id, usuario_nome, acao, entidade, entidade_id, dados)
  values (p_restaurante, 'usuario', p_ator, p_ator_nome,
          case when v_comanda_destino = v_comanda_origem then 'mesa.transferiu' else 'mesa.mesclou' end,
          'comanda', v_comanda_destino,
          jsonb_build_object('mesa_origem', p_origem, 'mesa_destino', p_destino, 'comanda_origem', v_comanda_origem));

  return jsonb_build_object('comanda', v_comanda_destino, 'mesclou', v_comanda_destino <> v_comanda_origem);
end $$;

-- ═══ transferir itens específicos ═══════════════════════════════════════════
create or replace function public.itens_transferir(
  p_restaurante uuid, p_itens uuid[], p_destino uuid, p_ator uuid, p_ator_nome text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_comanda_destino uuid;
  v_destino_ativa boolean;
  v_destino_bloqueada timestamptz;
  v_destino_nome text;
  r record;
  v_novo uuid;
  v_movidos int := 0;
  v_ativos int;
  v_selecionados int;
begin
  if coalesce(array_length(p_itens, 1), 0) = 0 then raise exception 'nenhum_item'; end if;

  select ativa, bloqueada_em, nome into v_destino_ativa, v_destino_bloqueada, v_destino_nome
    from public.mesas where id = p_destino and restaurante_id = p_restaurante;
  if v_destino_ativa is null then raise exception 'destino_inexistente'; end if;
  if v_destino_ativa = false then raise exception 'destino_inativo'; end if;
  if v_destino_bloqueada is not null then raise exception 'destino_bloqueado'; end if;

  -- Destino sem conta aberta ganha uma agora (mesmo padrão do primeiro lançamento).
  select id into v_comanda_destino from public.comandas
   where restaurante_id = p_restaurante and mesa_id = p_destino and status = 'aberta' for update;
  if v_comanda_destino is null then
    insert into public.comandas (restaurante_id, mesa_id) values (p_restaurante, p_destino)
    returning id into v_comanda_destino;
  end if;

  -- Por pedido de origem: todos os itens ativos selecionados → move o pedido inteiro;
  -- só parte → nasce um pedido no destino com esses itens, e os dois são recalculados.
  for r in
    select p.id as pedido_id, p.comanda_id, p.status, p.origem, p.canal, count(*) as sel
      from public.pedido_itens i
      join public.pedidos p on p.id = i.pedido_id
      join public.comandas c on c.id = p.comanda_id
     where i.id = any(p_itens)
       and i.cancelado_em is null
       and p.restaurante_id = p_restaurante
       and p.status <> 'cancelado'
       and c.status = 'aberta'
     group by p.id
     order by p.id
  loop
    if r.comanda_id = v_comanda_destino then continue; end if;
    perform 1 from public.comandas where id = r.comanda_id for update;

    select count(*) into v_ativos from public.pedido_itens where pedido_id = r.pedido_id and cancelado_em is null;
    v_selecionados := r.sel;

    if v_selecionados = v_ativos then
      -- Nome da mesa acompanha: é o que a cozinha lê para saber onde servir.
      update public.pedidos
         set comanda_id = v_comanda_destino,
             cliente_nome = case when cliente_nome = mesa then v_destino_nome else cliente_nome end,
             mesa = v_destino_nome
       where id = r.pedido_id;
    else
      -- `impresso = true`: o item já foi produzido na cozinha para a mesa de origem.
      -- Reimprimir no destino faria a cozinha preparar de novo.
      insert into public.pedidos
        (restaurante_id, tipo, status, cliente_nome, forma_pagamento, subtotal, total, origem, canal, mesa, comanda_id, impresso,
         criado_por, criado_por_nome)
      select p.restaurante_id, p.tipo, p.status, v_destino_nome, p.forma_pagamento, 0, 0, p.origem, 'mesa', v_destino_nome,
             v_comanda_destino, true, p_ator, p_ator_nome
        from public.pedidos p where p.id = r.pedido_id
      returning id into v_novo;

      update public.pedido_itens set pedido_id = v_novo
       where pedido_id = r.pedido_id and id = any(p_itens) and cancelado_em is null;

      perform public.pedido_recalcular(r.pedido_id);
      perform public.pedido_recalcular(v_novo);
    end if;
    v_movidos := v_movidos + v_selecionados;
  end loop;

  if v_movidos = 0 then raise exception 'nenhum_item_transferivel'; end if;

  insert into public.eventos_auditoria (restaurante_id, ator, usuario_id, usuario_nome, acao, entidade, entidade_id, dados)
  values (p_restaurante, 'usuario', p_ator, p_ator_nome, 'mesa.transferiu_itens', 'comanda', v_comanda_destino,
          jsonb_build_object('mesa_destino', p_destino, 'itens', v_movidos));

  return jsonb_build_object('comanda', v_comanda_destino, 'itens', v_movidos);
end $$;

-- ═══ cancelar item ══════════════════════════════════════════════════════════
create or replace function public.item_cancelar(
  p_restaurante uuid, p_item uuid, p_motivo text, p_ator_nome text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_pedido uuid;
  v_comanda uuid;
  v_restantes int;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'motivo_obrigatorio'; end if;

  select i.pedido_id, p.comanda_id into v_pedido, v_comanda
    from public.pedido_itens i join public.pedidos p on p.id = i.pedido_id
   where i.id = p_item and p.restaurante_id = p_restaurante and i.cancelado_em is null and p.status <> 'cancelado';
  if v_pedido is null then raise exception 'item_inexistente'; end if;

  perform 1 from public.comandas where id = v_comanda and status = 'aberta' for update;
  if not found then raise exception 'comanda_nao_aberta'; end if;

  update public.pedido_itens
     set cancelado_em = now(), cancelado_motivo = p_motivo, cancelado_por_nome = p_ator_nome
   where id = p_item;

  select count(*) into v_restantes from public.pedido_itens where pedido_id = v_pedido and cancelado_em is null;
  if v_restantes = 0 then
    -- Último item do lançamento: o pedido inteiro passa a cancelado, com o mesmo motivo,
    -- e some da tela da cozinha pelo fluxo que já existe (status).
    update public.pedidos
       set status = 'cancelado', cancelado_motivo = 'outro', cancelado_observacao = p_motivo,
           cancelado_por = p_ator_nome, cancelado_em = now(), reimprimir = false
     where id = v_pedido;
  else
    perform public.pedido_recalcular(v_pedido);
  end if;

  return jsonb_build_object('pedido', v_pedido, 'pedido_cancelado', v_restantes = 0);
end $$;

-- ── ninguém chama isto de fora ───────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'comanda_totais(uuid)',
    'pedido_recalcular(uuid)',
    'comanda_registrar_pagamento(uuid,uuid,text,numeric,numeric,text,uuid,text)',
    'comanda_estornar_pagamento(uuid,uuid,text,text)',
    'comanda_fechar(uuid,uuid,uuid,text)',
    'mesa_transferir(uuid,uuid,uuid,boolean,uuid,text)',
    'itens_transferir(uuid,uuid[],uuid,uuid,text)',
    'item_cancelar(uuid,uuid,text,text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
