-- 0072 — Conta: desconto percentual, número da comanda, observação no pagamento,
-- pedido de cancelamento do garçom, e motivo obrigatório nas transferências.
--
-- O que muda e por quê:
--
-- 1. **Desconto percentual.** A conta só aceitava desconto em reais. "10% para o
--    aniversariante" obrigava o caixa a fazer a conta de cabeça — e, pior, a conta não
--    acompanhava: cancelou um item depois, o desconto em reais continuava o mesmo. O
--    percentual é guardado como percentual e recalculado em `comanda_totais()`.
-- 2. **Número da comanda.** A cozinha e o caixa falavam "a comanda da mesa 4", o que
--    deixa de identificar depois de uma transferência. Sequencial por loja, gerado no
--    banco (contador em `restaurantes`, sob trava de linha, sem corrida).
-- 3. **Observação no pagamento; fiado exige observação.** Fiado é dinheiro que NÃO
--    entrou: sem dizer de quem é, vira um buraco no caixa. Só fecha a conta com fiado
--    quem registrou para quem ficou devendo.
-- 4. **Ajuste de valores numa função.** Taxa e desconto eram `update` direto da rota,
--    sem trava: o desconto podia baixar o total para menos do que já tinha sido pago.
--    Agora é uma transação com FOR UPDATE, que recusa e audita com antes e depois.
-- 5. **Cancelar item/lançamento sem deixar a conta com pagamento maior que o total.**
--    Mesma trava, no item e no lançamento. Quem quer cancelar o que já foi pago estorna
--    primeiro — o estorno fica registrado.
-- 6. **Pedido de cancelamento.** O garçom não cancela o que já foi para a cozinha (é
--    decisão com efeito em conta e estoque), mas precisa de um caminho que não seja
--    gritar pelo salão. Ele SOLICITA, com motivo; a gestão aprova ou recusa. A conta não
--    fecha com pedido pendente.
-- 7. **Transferência com motivo.** Mesa e itens mudavam de lugar sem nenhum "por quê"
--    na trilha. As duas funções passam a exigir motivo e gravá-lo com os nomes das
--    mesas (não só os ids).
-- 8. **Fechar a conta encerra os chamados abertos da mesa**, como o cancelamento já
--    fazia: a mesa livre não pode continuar piscando "chamou o garçom".
--
-- Tudo idempotente. Nenhuma linha existente muda de valor: `desconto_tipo` nasce
-- 'valor' (o comportamento de hoje) e `numero` fica nulo nas comandas antigas.

-- ═══ colunas ═════════════════════════════════════════════════════════════════
alter table public.comandas add column if not exists desconto_tipo text not null default 'valor';
alter table public.comandas add column if not exists desconto_percentual numeric(5,2) not null default 0;
alter table public.comandas add column if not exists numero int;

alter table public.comandas drop constraint if exists comandas_desconto_tipo_check;
alter table public.comandas add constraint comandas_desconto_tipo_check
  check (desconto_tipo in ('valor', 'percentual'));
alter table public.comandas drop constraint if exists comandas_desconto_pct_check;
alter table public.comandas add constraint comandas_desconto_pct_check
  check (desconto_percentual >= 0 and desconto_percentual <= 100);

create unique index if not exists comandas_numero_unq
  on public.comandas (restaurante_id, numero) where numero is not null;

alter table public.restaurantes add column if not exists comanda_seq int not null default 0;

alter table public.pagamentos_comanda add column if not exists observacao text;

-- ═══ número da comanda ═══════════════════════════════════════════════════════
create or replace function public.comanda_numerar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.numero is null then
    -- O UPDATE trava a linha da loja: duas comandas abertas ao mesmo tempo esperam uma
    -- pela outra e nunca recebem o mesmo número.
    update public.restaurantes set comanda_seq = comanda_seq + 1
     where id = new.restaurante_id
    returning comanda_seq into new.numero;
  end if;
  return new;
end $$;

drop trigger if exists comanda_numerar on public.comandas;
create trigger comanda_numerar before insert on public.comandas
  for each row execute function public.comanda_numerar();

-- ═══ totais com desconto percentual ══════════════════════════════════════════
-- Desconto percentual incide sobre o CONSUMO (subtotal). A taxa de serviço continua
-- sobre o consumo cheio. Nos dois tipos o desconto nunca passa do valor da conta.
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
  c as (
    select taxa_servico_percentual as pct, desconto_tipo as tipo, desconto_valor as desc_valor,
           desconto_percentual as desc_pct
      from public.comandas where id = p_comanda
  ),
  pg as (
    select coalesce(sum(valor), 0)::numeric as pago
      from public.pagamentos_comanda where comanda_id = p_comanda and estornado_em is null
  ),
  bruto as (
    select round(base.sub, 2) as sub,
           round(base.sub * c.pct / 100, 2) as taxa,
           case when c.tipo = 'percentual' then round(base.sub * c.desc_pct / 100, 2)
                else c.desc_valor end as desc_pedido,
           pg.pago
      from base, c, pg
  ),
  calc as (
    select sub, taxa, least(desc_pedido, sub + taxa) as desc_aplicado, pago from bruto
  )
  select sub, taxa, desc_aplicado, round(sub + taxa - desc_aplicado, 2), pago,
         greatest(round(sub + taxa - desc_aplicado - pago, 2), 0)
    from calc
$$;

-- Trava comum: depois de mexer no que a conta vale, o que já foi pago não pode passar
-- do novo total. Levanta dentro da transação de quem chamou, que desfaz tudo.
create or replace function public.comanda_conferir_pago(p_comanda uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare t record;
begin
  if p_comanda is null then return; end if;
  select * into t from public.comanda_totais(p_comanda);
  if t.pago > t.total then
    raise exception 'pagamento_excede_total:%', t.pago;
  end if;
end $$;

-- ═══ ajuste de taxa e desconto ═══════════════════════════════════════════════
-- NULL = não mexe naquele campo. Motivo obrigatório para desconto maior que zero.
create or replace function public.comanda_ajustar_valores(
  p_restaurante uuid, p_comanda uuid,
  p_taxa numeric, p_desconto_tipo text, p_desconto_valor numeric, p_desconto_percentual numeric,
  p_motivo text, p_ator uuid, p_ator_nome text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_antes record;
  v_padrao numeric;
  v_tipo text;
  v_valor numeric;
  v_pct numeric;
  v_taxa numeric;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  select status, taxa_servico_percentual, desconto_tipo, desconto_valor, desconto_percentual, desconto_motivo
    into v_antes
    from public.comandas where id = p_comanda and restaurante_id = p_restaurante for update;
  if v_antes.status is null then raise exception 'comanda_inexistente'; end if;
  if v_antes.status <> 'aberta' then raise exception 'comanda_nao_aberta'; end if;

  v_taxa := coalesce(p_taxa, v_antes.taxa_servico_percentual);
  if v_taxa < 0 or v_taxa > 30 then raise exception 'taxa_invalida'; end if;

  v_tipo := coalesce(p_desconto_tipo, v_antes.desconto_tipo);
  if v_tipo not in ('valor', 'percentual') then raise exception 'desconto_invalido'; end if;
  v_valor := case when v_tipo = 'valor' then coalesce(p_desconto_valor, v_antes.desconto_valor) else 0 end;
  v_pct := case when v_tipo = 'percentual' then coalesce(p_desconto_percentual, v_antes.desconto_percentual) else 0 end;
  if v_valor < 0 or v_pct < 0 or v_pct > 100 then raise exception 'desconto_invalido'; end if;
  if (v_valor > 0 or v_pct > 0) and v_motivo is null then raise exception 'motivo_obrigatorio'; end if;

  update public.comandas
     set taxa_servico_percentual = round(v_taxa, 2),
         desconto_tipo = v_tipo,
         desconto_valor = round(v_valor, 2),
         desconto_percentual = round(v_pct, 2),
         desconto_motivo = case when v_valor > 0 or v_pct > 0 then v_motivo else null end
   where id = p_comanda;

  perform public.comanda_conferir_pago(p_comanda);

  select coalesce(taxa_servico_padrao, 0) into v_padrao from public.restaurantes where id = p_restaurante;

  if round(v_taxa, 2) is distinct from v_antes.taxa_servico_percentual then
    insert into public.eventos_auditoria (restaurante_id, ator, usuario_id, usuario_nome, acao, entidade, entidade_id, dados)
    values (p_restaurante, 'usuario', p_ator, p_ator_nome,
            case when v_taxa = 0 then 'conta.removeu_taxa' else 'conta.alterou_taxa' end,
            'comanda', p_comanda,
            jsonb_build_object('de', v_antes.taxa_servico_percentual, 'para', round(v_taxa, 2),
                               'padrao_da_loja', v_padrao, 'motivo', v_motivo));
  end if;

  if v_tipo is distinct from v_antes.desconto_tipo
     or round(v_valor, 2) is distinct from v_antes.desconto_valor
     or round(v_pct, 2) is distinct from v_antes.desconto_percentual then
    insert into public.eventos_auditoria (restaurante_id, ator, usuario_id, usuario_nome, acao, entidade, entidade_id, dados)
    values (p_restaurante, 'usuario', p_ator, p_ator_nome, 'conta.desconto', 'comanda', p_comanda,
            jsonb_build_object(
              'de', case when v_antes.desconto_tipo = 'percentual' then v_antes.desconto_percentual || '%'
                         else 'R$ ' || v_antes.desconto_valor end,
              'para', case when v_tipo = 'percentual' then round(v_pct, 2) || '%' else 'R$ ' || round(v_valor, 2) end,
              'motivo', v_motivo));
  end if;

  return (select to_jsonb(t) from public.comanda_totais(p_comanda) t);
end $$;

-- ═══ pagamento com observação ════════════════════════════════════════════════
-- Mesmo corpo da 0067, mais a observação. Fiado sem observação é recusado.
create or replace function public.comanda_registrar_pagamento(
  p_restaurante uuid, p_comanda uuid, p_forma text, p_valor numeric, p_recebido numeric,
  p_chave text, p_ator uuid, p_ator_nome text, p_observacao text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_restante numeric;
  v_existente uuid;
  v_id uuid;
  v_troco numeric := 0;
  v_obs text := nullif(trim(coalesce(p_observacao, '')), '');
begin
  -- Mesma chave = mesmo pagamento. Clique duplo não cobra duas vezes.
  if p_chave is not null then
    select id into v_existente from public.pagamentos_comanda
     where restaurante_id = p_restaurante and chave_idempotencia = p_chave;
    if v_existente is not null then
      return jsonb_build_object('id', v_existente, 'idempotente', true);
    end if;
  end if;

  select status into v_status from public.comandas
   where id = p_comanda and restaurante_id = p_restaurante for update;
  if v_status is null then raise exception 'comanda_inexistente'; end if;
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
  if p_forma = 'fiado' and v_obs is null then raise exception 'fiado_sem_observacao'; end if;
  if p_valor is null or round(p_valor, 2) <= 0 then raise exception 'valor_invalido'; end if;

  select restante into v_restante from public.comanda_totais(p_comanda);
  if round(p_valor, 2) > v_restante then
    raise exception 'valor_acima_do_restante:%', v_restante;
  end if;

  if p_forma = 'dinheiro' and p_recebido is not null then
    if p_recebido < p_valor then raise exception 'recebido_menor_que_valor'; end if;
    v_troco := round(p_recebido - p_valor, 2);
  end if;

  begin
    insert into public.pagamentos_comanda
      (restaurante_id, comanda_id, forma, valor, valor_recebido, troco, chave_idempotencia,
       criado_por, criado_por_nome, observacao)
    values
      (p_restaurante, p_comanda, p_forma, round(p_valor, 2),
       case when p_forma = 'dinheiro' then round(p_recebido, 2) else null end,
       v_troco, p_chave, p_ator, p_ator_nome, left(v_obs, 200))
    returning id into v_id;
  exception when unique_violation then
    select id into v_existente from public.pagamentos_comanda
     where restaurante_id = p_restaurante and chave_idempotencia = p_chave;
    return jsonb_build_object('id', v_existente, 'idempotente', true);
  end;

  return jsonb_build_object('id', v_id, 'idempotente', false, 'troco', v_troco);
end $$;

drop function if exists public.comanda_registrar_pagamento(uuid, uuid, text, numeric, numeric, text, uuid, text);

-- ═══ pedido de cancelamento ══════════════════════════════════════════════════
create table if not exists public.solicitacoes_cancelamento (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  -- NULL = o lançamento inteiro.
  pedido_item_id uuid references public.pedido_itens(id) on delete cascade,
  motivo text not null,
  status text not null default 'pendente',
  solicitado_por uuid references public.usuarios(id) on delete set null,
  solicitado_por_nome text not null,
  solicitado_em timestamptz not null default now(),
  decidido_por uuid references public.usuarios(id) on delete set null,
  decidido_por_nome text,
  decidido_em timestamptz,
  decisao_obs text
);

alter table public.solicitacoes_cancelamento drop constraint if exists solicitacoes_cancelamento_status_check;
alter table public.solicitacoes_cancelamento add constraint solicitacoes_cancelamento_status_check
  check (status in ('pendente', 'aprovada', 'recusada'));
alter table public.solicitacoes_cancelamento drop constraint if exists solicitacoes_cancelamento_motivo_check;
alter table public.solicitacoes_cancelamento add constraint solicitacoes_cancelamento_motivo_check
  check (length(trim(motivo)) > 0);

-- Uma solicitação pendente por alvo: o garçom que toca duas vezes não cria duas.
create unique index if not exists solicitacoes_cancelamento_pendente_unq
  on public.solicitacoes_cancelamento (pedido_id, coalesce(pedido_item_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'pendente';
create index if not exists idx_solicitacoes_cancelamento_loja
  on public.solicitacoes_cancelamento (restaurante_id, status, solicitado_em desc);

alter table public.solicitacoes_cancelamento enable row level security;
drop policy if exists solicitacoes_cancelamento_select on public.solicitacoes_cancelamento;
create policy solicitacoes_cancelamento_select on public.solicitacoes_cancelamento
  for select to authenticated
  using (
    restaurante_id = public.auth_restaurante_id()
    and public.auth_papel() in ('dono', 'gerente', 'garcom', 'atendente')
  );
revoke all on public.solicitacoes_cancelamento from anon, authenticated;
grant select on public.solicitacoes_cancelamento to authenticated;

-- Alvo cancelado por QUALQUER caminho (gestão direto, Kanban, conta cancelada) resolve
-- a solicitação pendente: senão ela travaria o fechamento para sempre.
create or replace function public.solicitacoes_resolver_por_cancelamento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'pedidos' then
    if new.status = 'cancelado' and old.status is distinct from 'cancelado' then
      update public.solicitacoes_cancelamento
         set status = 'aprovada', decidido_em = now(),
             decidido_por_nome = coalesce(new.cancelado_por, 'Sistema'),
             decisao_obs = coalesce(decisao_obs, 'Cancelado por outro caminho')
       where pedido_id = new.id and status = 'pendente';
    end if;
  else
    if new.cancelado_em is not null and old.cancelado_em is null then
      update public.solicitacoes_cancelamento
         set status = 'aprovada', decidido_em = now(),
             decidido_por_nome = coalesce(new.cancelado_por_nome, 'Sistema'),
             decisao_obs = coalesce(decisao_obs, 'Cancelado por outro caminho')
       where pedido_item_id = new.id and status = 'pendente';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists solicitacoes_resolver_pedido on public.pedidos;
create trigger solicitacoes_resolver_pedido after update of status on public.pedidos
  for each row execute function public.solicitacoes_resolver_por_cancelamento();
drop trigger if exists solicitacoes_resolver_item on public.pedido_itens;
create trigger solicitacoes_resolver_item after update of cancelado_em on public.pedido_itens
  for each row execute function public.solicitacoes_resolver_por_cancelamento();

create or replace function public.cancelamento_solicitar(
  p_restaurante uuid, p_pedido uuid, p_item uuid, p_motivo text, p_ator uuid, p_ator_nome text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_comanda uuid;
  v_status_pedido text;
  v_canal text;
  v_id uuid;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  if v_motivo is null then raise exception 'motivo_obrigatorio'; end if;

  select comanda_id, status, canal into v_comanda, v_status_pedido, v_canal
    from public.pedidos where id = p_pedido and restaurante_id = p_restaurante;
  if v_comanda is null or v_canal <> 'mesa' then raise exception 'item_inexistente'; end if;
  if v_status_pedido = 'cancelado' then raise exception 'item_inexistente'; end if;
  perform 1 from public.comandas where id = v_comanda and status = 'aberta';
  if not found then raise exception 'comanda_nao_aberta'; end if;

  if p_item is not null then
    perform 1 from public.pedido_itens where id = p_item and pedido_id = p_pedido and cancelado_em is null;
    if not found then raise exception 'item_inexistente'; end if;
  end if;

  select id into v_id from public.solicitacoes_cancelamento
   where pedido_id = p_pedido and pedido_item_id is not distinct from p_item and status = 'pendente';
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'jaExistia', true);
  end if;

  begin
    insert into public.solicitacoes_cancelamento
      (restaurante_id, pedido_id, pedido_item_id, motivo, solicitado_por, solicitado_por_nome)
    values (p_restaurante, p_pedido, p_item, left(v_motivo, 200), p_ator, p_ator_nome)
    returning id into v_id;
  exception when unique_violation then
    select id into v_id from public.solicitacoes_cancelamento
     where pedido_id = p_pedido and pedido_item_id is not distinct from p_item and status = 'pendente';
    return jsonb_build_object('id', v_id, 'jaExistia', true);
  end;

  insert into public.eventos_auditoria (restaurante_id, ator, usuario_id, usuario_nome, acao, entidade, entidade_id, dados)
  values (p_restaurante, 'usuario', p_ator, p_ator_nome, 'conta.solicitou_cancelamento', 'comanda', v_comanda,
          jsonb_build_object('pedido_id', p_pedido, 'item_id', p_item, 'motivo', v_motivo));

  return jsonb_build_object('id', v_id, 'jaExistia', false);
end $$;

-- ═══ cancelar item (com a trava do pago) ═════════════════════════════════════
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
    update public.pedidos
       set status = 'cancelado', cancelado_motivo = 'outro', cancelado_observacao = p_motivo,
           cancelado_por = p_ator_nome, cancelado_em = now(), reimprimir = false
     where id = v_pedido;
  else
    perform public.pedido_recalcular(v_pedido);
  end if;

  perform public.comanda_conferir_pago(v_comanda);

  return jsonb_build_object('pedido', v_pedido, 'pedido_cancelado', v_restantes = 0);
end $$;

-- ═══ cancelar um lançamento inteiro ══════════════════════════════════════════
-- Antes era um `update` solto na rota, sem trava da comanda e sem conferir o pago.
create or replace function public.pedido_mesa_cancelar(
  p_restaurante uuid, p_pedido uuid, p_motivo text, p_ator uuid, p_ator_nome text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_comanda uuid;
  v_status text;
  v_numero int;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'motivo_obrigatorio'; end if;

  select comanda_id, status, numero into v_comanda, v_status, v_numero
    from public.pedidos where id = p_pedido and restaurante_id = p_restaurante and canal = 'mesa';
  if v_comanda is null then raise exception 'item_inexistente'; end if;

  perform 1 from public.comandas where id = v_comanda and status = 'aberta' for update;
  if not found then raise exception 'comanda_nao_aberta'; end if;

  select status into v_status from public.pedidos where id = p_pedido for update;
  if v_status in ('cancelado', 'entregue') then raise exception 'ja_cancelado'; end if;

  -- Mesma gravação do cancelamento do Kanban: status + motivo, nada apagado, e
  -- `reimprimir = false` para uma reimpressão pendente não sair depois de cancelado.
  update public.pedidos
     set status = 'cancelado', cancelado_motivo = 'outro', cancelado_observacao = p_motivo,
         cancelado_por = p_ator_nome, cancelado_em = now(), reimprimir = false
   where id = p_pedido;

  perform public.comanda_conferir_pago(v_comanda);

  insert into public.eventos_auditoria (restaurante_id, ator, usuario_id, usuario_nome, acao, entidade, entidade_id, dados)
  values (p_restaurante, 'usuario', p_ator, p_ator_nome, 'conta.cancelou_pedido', 'comanda', v_comanda,
          jsonb_build_object('pedido_id', p_pedido, 'numero', v_numero, 'de', v_status, 'para', 'cancelado',
                             'motivo', p_motivo));

  return jsonb_build_object('pedido', p_pedido, 'comanda', v_comanda);
end $$;

-- ═══ decidir um pedido de cancelamento ═══════════════════════════════════════
create or replace function public.cancelamento_decidir(
  p_restaurante uuid, p_solicitacao uuid, p_aprovar boolean, p_obs text, p_ator uuid, p_ator_nome text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s record;
  v_comanda uuid;
  v_alvo_vivo boolean;
begin
  select * into s from public.solicitacoes_cancelamento
   where id = p_solicitacao and restaurante_id = p_restaurante for update;
  if s.id is null then raise exception 'solicitacao_inexistente'; end if;
  if s.status <> 'pendente' then raise exception 'solicitacao_decidida'; end if;

  select comanda_id into v_comanda from public.pedidos where id = s.pedido_id;

  if p_aprovar then
    if s.pedido_item_id is not null then
      select exists (
        select 1 from public.pedido_itens i join public.pedidos p on p.id = i.pedido_id
         where i.id = s.pedido_item_id and i.cancelado_em is null and p.status <> 'cancelado'
      ) into v_alvo_vivo;
      if v_alvo_vivo then
        perform public.item_cancelar(p_restaurante, s.pedido_item_id,
                                     s.motivo || ' (pedido por ' || s.solicitado_por_nome || ')', p_ator_nome);
      end if;
    else
      select exists (select 1 from public.pedidos where id = s.pedido_id and status not in ('cancelado', 'entregue'))
        into v_alvo_vivo;
      if v_alvo_vivo then
        perform public.pedido_mesa_cancelar(p_restaurante, s.pedido_id,
                                            s.motivo || ' (pedido por ' || s.solicitado_por_nome || ')', p_ator, p_ator_nome);
      end if;
    end if;
  end if;

  -- O trigger pode ter resolvido a linha no cancelamento acima; a decisão explícita
  -- sobrescreve com quem decidiu de verdade.
  update public.solicitacoes_cancelamento
     set status = case when p_aprovar then 'aprovada' else 'recusada' end,
         decidido_por = p_ator, decidido_por_nome = p_ator_nome, decidido_em = now(),
         decisao_obs = nullif(trim(coalesce(p_obs, '')), '')
   where id = p_solicitacao;

  insert into public.eventos_auditoria (restaurante_id, ator, usuario_id, usuario_nome, acao, entidade, entidade_id, dados)
  values (p_restaurante, 'usuario', p_ator, p_ator_nome,
          case when p_aprovar then 'conta.aprovou_cancelamento' else 'conta.recusou_cancelamento' end,
          'comanda', v_comanda,
          jsonb_build_object('solicitacao_id', s.id, 'pedido_id', s.pedido_id, 'item_id', s.pedido_item_id,
                             'solicitado_por', s.solicitado_por_nome, 'motivo', s.motivo,
                             'observacao', nullif(trim(coalesce(p_obs, '')), '')));

  return jsonb_build_object('id', s.id, 'aprovada', p_aprovar);
end $$;

-- ═══ fechar a conta ══════════════════════════════════════════════════════════
create or replace function public.comanda_fechar(
  p_restaurante uuid, p_comanda uuid, p_ator uuid, p_ator_nome text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_mesa uuid;
  v_pendentes int;
  v_taxa_pct numeric;
  v_padrao numeric;
  t record;
begin
  select status, mesa_id, taxa_servico_percentual into v_status, v_mesa, v_taxa_pct from public.comandas
   where id = p_comanda and restaurante_id = p_restaurante for update;
  if v_status is null then raise exception 'comanda_inexistente'; end if;
  if v_status <> 'aberta' then raise exception 'comanda_nao_aberta'; end if;

  -- Pedido de cancelamento aberto é operação pendente: fechar agora cobraria (ou não)
  -- um item cuja sorte ninguém decidiu.
  select count(*) into v_pendentes
    from public.solicitacoes_cancelamento s join public.pedidos p on p.id = s.pedido_id
   where p.comanda_id = p_comanda and s.status = 'pendente';
  if v_pendentes > 0 then raise exception 'cancelamento_pendente:%', v_pendentes; end if;

  select * into t from public.comanda_totais(p_comanda);
  if t.restante > 0 then raise exception 'saldo_restante:%', t.restante; end if;

  update public.comandas
     set status = 'fechada', fechada_em = now(), fechada_por = p_ator,
         fechada_por_nome = p_ator_nome, total_final = t.total
   where id = p_comanda;

  update public.pedidos set pago = true where comanda_id = p_comanda and status <> 'cancelado';

  update public.selecoes_mesa s set encerrada_em = now()
    from public.sessoes_mesa sm
   where s.sessao_id = sm.id and sm.mesa_id = v_mesa and sm.status = 'aberta' and s.encerrada_em is null;
  update public.sessoes_mesa set status = 'encerrada', encerrada_em = now()
   where mesa_id = v_mesa and status = 'aberta';
  -- Mesa livre não continua "chamando o garçom".
  update public.chamados_mesa set status = 'expirado'
   where mesa_id = v_mesa and status in ('pendente', 'assumido');

  select coalesce(taxa_servico_padrao, 0) into v_padrao from public.restaurantes where id = p_restaurante;

  return jsonb_build_object(
    'total', t.total, 'pago', t.pago, 'subtotal', t.subtotal, 'taxa', t.taxa_servico, 'desconto', t.desconto,
    'taxa_percentual', v_taxa_pct, 'taxa_padrao', v_padrao,
    -- Como a taxa terminou: aceita como veio, removida ou alterada na mesa.
    'taxa_situacao', case when v_taxa_pct = 0 and v_padrao > 0 then 'removida'
                          when v_taxa_pct = v_padrao then case when v_padrao = 0 then 'sem_taxa' else 'aceita' end
                          else 'alterada' end);
end $$;

-- ═══ transferir a mesa inteira, com motivo ═══════════════════════════════════
create or replace function public.mesa_transferir(
  p_restaurante uuid, p_origem uuid, p_destino uuid, p_mesclar boolean, p_ator uuid, p_ator_nome text,
  p_motivo text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_comanda_origem uuid;
  v_comanda_destino uuid;
  v_destino_ativa boolean;
  v_destino_bloqueada timestamptz;
  v_destino_nome text;
  v_origem_nome text;
  v_sessao_origem uuid;
  v_sessao_destino uuid;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  if v_motivo is null then raise exception 'motivo_obrigatorio'; end if;
  if p_origem = p_destino then raise exception 'mesma_mesa'; end if;

  select nome into v_origem_nome from public.mesas where id = p_origem and restaurante_id = p_restaurante;
  select ativa, bloqueada_em, nome into v_destino_ativa, v_destino_bloqueada, v_destino_nome
    from public.mesas where id = p_destino and restaurante_id = p_restaurante;
  if v_destino_ativa is null then raise exception 'destino_inexistente'; end if;
  if v_destino_ativa = false then raise exception 'destino_inativo'; end if;
  if v_destino_bloqueada is not null then raise exception 'destino_bloqueado'; end if;

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
    if not coalesce(p_mesclar, false) then raise exception 'destino_ocupado'; end if;

    update public.pedidos set comanda_id = v_comanda_destino where comanda_id = v_comanda_origem;
    update public.pagamentos_comanda set comanda_id = v_comanda_destino where comanda_id = v_comanda_origem;
    update public.comandas
       set status = 'transferida', fechada_em = now(), transferida_para = v_comanda_destino,
           fechada_por = p_ator, fechada_por_nome = p_ator_nome
     where id = v_comanda_origem;
    update public.comandas d
       set pessoas = nullif(coalesce(d.pessoas, 0) + coalesce(o.pessoas, 0), 0),
           observacoes = nullif(concat_ws(' · ', d.observacoes, o.observacoes), '')
      from public.comandas o
     where d.id = v_comanda_destino and o.id = v_comanda_origem;
    -- Juntar contas pode baixar o total abaixo do pago (desconto em valor da conta de
    -- destino, por exemplo): a mesma trava das outras operações.
    perform public.comanda_conferir_pago(v_comanda_destino);
  else
    update public.comandas set mesa_id = p_destino where id = v_comanda_origem;
    v_comanda_destino := v_comanda_origem;
  end if;

  update public.pedidos
     set cliente_nome = case when cliente_nome = mesa then v_destino_nome else cliente_nome end,
         mesa = v_destino_nome
   where comanda_id = v_comanda_destino and mesa is distinct from v_destino_nome;

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
  -- Chamado da mesa de origem não segue pendurado numa mesa que ficou livre.
  update public.chamados_mesa set status = 'expirado'
   where mesa_id = p_origem and status in ('pendente', 'assumido');

  insert into public.eventos_auditoria (restaurante_id, ator, usuario_id, usuario_nome, acao, entidade, entidade_id, dados)
  values (p_restaurante, 'usuario', p_ator, p_ator_nome,
          case when v_comanda_destino = v_comanda_origem then 'mesa.transferiu' else 'mesa.mesclou' end,
          'comanda', v_comanda_destino,
          jsonb_build_object('mesa_origem', p_origem, 'mesa_destino', p_destino,
                             'de', v_origem_nome, 'para', v_destino_nome,
                             'comanda_origem', v_comanda_origem, 'motivo', v_motivo));

  return jsonb_build_object('comanda', v_comanda_destino, 'mesclou', v_comanda_destino <> v_comanda_origem);
end $$;

drop function if exists public.mesa_transferir(uuid, uuid, uuid, boolean, uuid, text);

-- ═══ transferir itens, com motivo ════════════════════════════════════════════
create or replace function public.itens_transferir(
  p_restaurante uuid, p_itens uuid[], p_destino uuid, p_ator uuid, p_ator_nome text,
  p_quantidades int[], p_motivo text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_comanda_destino uuid;
  v_destino_ativa boolean;
  v_destino_bloqueada timestamptz;
  v_destino_nome text;
  v_item uuid[] := '{}';
  v_pedido uuid[] := '{}';
  v_qtd_mover int[] := '{}';
  v_inteiro boolean[] := '{}';
  v_origens uuid[] := '{}';
  r record;
  v_movidos int := 0;
  v_ativos int;
  v_inteiros int;
  v_do_pedido int;
  v_pedido_destino uuid;
  i int;
  v_qtd int;
  v_linha record;
  v_origem uuid;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  if v_motivo is null then raise exception 'motivo_obrigatorio'; end if;
  if coalesce(array_length(p_itens, 1), 0) = 0 then raise exception 'nenhum_item'; end if;
  if p_quantidades is not null
     and coalesce(array_length(p_quantidades, 1), 0) <> array_length(p_itens, 1) then
    raise exception 'quantidades_incompativeis';
  end if;

  select ativa, bloqueada_em, nome into v_destino_ativa, v_destino_bloqueada, v_destino_nome
    from public.mesas where id = p_destino and restaurante_id = p_restaurante;
  if v_destino_ativa is null then raise exception 'destino_inexistente'; end if;
  if v_destino_ativa = false then raise exception 'destino_inativo'; end if;
  if v_destino_bloqueada is not null then raise exception 'destino_bloqueado'; end if;

  select id into v_comanda_destino from public.comandas
   where restaurante_id = p_restaurante and mesa_id = p_destino and status = 'aberta' for update;
  if v_comanda_destino is null then
    insert into public.comandas (restaurante_id, mesa_id) values (p_restaurante, p_destino)
    returning id into v_comanda_destino;
  end if;

  for i in 1 .. array_length(p_itens, 1) loop
    if p_itens[i] = any(v_item) then continue; end if;

    select it.id, it.pedido_id, it.quantidade, p.comanda_id
      into v_linha
      from public.pedido_itens it
      join public.pedidos p on p.id = it.pedido_id
      join public.comandas c on c.id = p.comanda_id
     where it.id = p_itens[i]
       and it.cancelado_em is null
       and p.restaurante_id = p_restaurante
       and p.status <> 'cancelado'
       and c.status = 'aberta';
    if v_linha.id is null then continue; end if;
    if v_linha.comanda_id = v_comanda_destino then continue; end if;

    v_qtd := case when p_quantidades is null then v_linha.quantidade else p_quantidades[i] end;
    if v_qtd is null or v_qtd >= v_linha.quantidade then
      v_qtd := v_linha.quantidade;
    elsif v_qtd < 1 then
      raise exception 'quantidade_invalida';
    end if;

    v_item := v_item || v_linha.id;
    v_pedido := v_pedido || v_linha.pedido_id;
    v_qtd_mover := v_qtd_mover || v_qtd;
    v_inteiro := v_inteiro || (v_qtd = v_linha.quantidade);
    if not (v_linha.comanda_id = any(v_origens)) then v_origens := v_origens || v_linha.comanda_id; end if;
  end loop;

  -- Comandas de origem travadas em ordem fixa, antes de mexer em qualquer linha delas.
  perform 1 from public.comandas where id = any(v_origens) order by id for update;

  for r in select distinct pid from unnest(v_pedido) as pid order by pid loop
    perform 1 from public.pedidos where id = r.pid for update;

    select count(*) into v_ativos from public.pedido_itens
     where pedido_id = r.pid and cancelado_em is null;
    select count(*) into v_inteiros
      from unnest(v_pedido, v_inteiro) as t(pid, inteiro)
     where t.pid = r.pid and t.inteiro;
    select coalesce(sum(t.qtd), 0) into v_do_pedido
      from unnest(v_pedido, v_qtd_mover) as t(pid, qtd)
     where t.pid = r.pid;

    if v_inteiros = v_ativos then
      update public.pedidos
         set comanda_id = v_comanda_destino,
             cliente_nome = case when cliente_nome = mesa then v_destino_nome else cliente_nome end,
             mesa = v_destino_nome
       where id = r.pid;
      v_movidos := v_movidos + v_do_pedido;
      continue;
    end if;

    insert into public.pedidos
      (restaurante_id, tipo, status, cliente_nome, forma_pagamento, subtotal, total, origem, canal, mesa,
       comanda_id, impresso, criado_por, criado_por_nome)
    select p.restaurante_id, p.tipo, p.status, v_destino_nome, p.forma_pagamento, 0, 0, p.origem, 'mesa',
           v_destino_nome, v_comanda_destino, true, p_ator, p_ator_nome
      from public.pedidos p where p.id = r.pid
    returning id into v_pedido_destino;

    update public.pedido_itens set pedido_id = v_pedido_destino
     where pedido_id = r.pid
       and id in (
         select t.it_id from unnest(v_item, v_pedido, v_inteiro) as t(it_id, pid, inteiro)
          where t.pid = r.pid and t.inteiro
       );

    for v_linha in
      select it.*, t.qtd as mover
        from unnest(v_item, v_pedido, v_qtd_mover, v_inteiro) as t(it_id, pid, qtd, inteiro)
        join public.pedido_itens it on it.id = t.it_id
       where t.pid = r.pid and not t.inteiro
    loop
      update public.pedido_itens set quantidade = quantidade - v_linha.mover where id = v_linha.id;
      insert into public.pedido_itens
        (pedido_id, item_id, nome, quantidade, preco_unitario, observacao, complementos,
         tamanho_nome, sabor_nome, borda_nome, massa_nome)
      values
        (v_pedido_destino, v_linha.item_id, v_linha.nome, v_linha.mover, v_linha.preco_unitario,
         v_linha.observacao, v_linha.complementos, v_linha.tamanho_nome, v_linha.sabor_nome,
         v_linha.borda_nome, v_linha.massa_nome);
    end loop;

    perform public.pedido_recalcular(r.pid);
    perform public.pedido_recalcular(v_pedido_destino);
    v_movidos := v_movidos + v_do_pedido;
  end loop;

  if v_movidos = 0 then raise exception 'nenhum_item_transferivel'; end if;

  -- Item que saiu de uma conta que já recebeu dinheiro não pode deixar a origem
  -- devendo negativo: estorne antes.
  foreach v_origem in array v_origens loop
    perform public.comanda_conferir_pago(v_origem);
  end loop;

  insert into public.eventos_auditoria (restaurante_id, ator, usuario_id, usuario_nome, acao, entidade, entidade_id, dados)
  values (p_restaurante, 'usuario', p_ator, p_ator_nome, 'mesa.transferiu_itens', 'comanda', v_comanda_destino,
          jsonb_build_object('mesa_destino', p_destino, 'para', v_destino_nome, 'itens', v_movidos,
                             'comandas_origem', to_jsonb(v_origens), 'motivo', v_motivo));

  return jsonb_build_object('comanda', v_comanda_destino, 'itens', v_movidos);
end $$;

drop function if exists public.itens_transferir(uuid, uuid[], uuid, uuid, text, int[]);

-- ── ninguém chama isto de fora ───────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'comanda_totais(uuid)',
    'comanda_conferir_pago(uuid)',
    'comanda_ajustar_valores(uuid,uuid,numeric,text,numeric,numeric,text,uuid,text)',
    'comanda_registrar_pagamento(uuid,uuid,text,numeric,numeric,text,uuid,text,text)',
    'cancelamento_solicitar(uuid,uuid,uuid,text,uuid,text)',
    'cancelamento_decidir(uuid,uuid,boolean,text,uuid,text)',
    'item_cancelar(uuid,uuid,text,text)',
    'pedido_mesa_cancelar(uuid,uuid,text,uuid,text)',
    'comanda_fechar(uuid,uuid,uuid,text)',
    'mesa_transferir(uuid,uuid,uuid,boolean,uuid,text,text)',
    'itens_transferir(uuid,uuid[],uuid,uuid,text,int[],text)',
    'comanda_numerar()',
    'solicitacoes_resolver_por_cancelamento()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
