-- 0142 — Financeiro Fase 5: Precificação / CMV.
--
-- Tabelas só do servidor (RLS ligada SEM políticas: o navegador não lê custo; as rotas conferem
-- "ver custos" / "editar insumos" / "aplicar novo preço" no servidor). Valores de dinheiro em CENTAVOS;
-- custo por unidade base (g/ml/un) em numeric com frações de centavo — arredonda só no resultado final.
--
--   cmv_insumos              insumo da loja (compra → unidade base, aproveitamento, preparado/sub-receita)
--   cmv_insumo_componentes   receita de um insumo preparado (outros insumos + quantidade)
--   cmv_custos_historico     APPEND-ONLY: cada mudança de custo (antigo, novo, quem, quando, motivo)
--   cmv_fichas               ficha de custo de um alvo vendável: item, tamanho, sabor×tamanho (pizza),
--                            complemento, borda, massa
--   cmv_ficha_componentes    insumo + quantidade na unidade base
--   cmv_config / cmv_config_categoria   margem-alvo, margem baixa, custos variáveis, arredondamento
--   pedido_itens_custo       custo GUARDADO no momento em que a linha do pedido é gravada (gatilho)
--
-- Regras (detalhes em docs/financeiro/fase5-cmv.md):
--   custo por unidade base = custo da compra ÷ (quantidade comprada × unidades base por unidade de compra)
--                            ÷ aproveitamento (85% → ÷ 0,85)
--   insumo preparado        = soma dos componentes ÷ rendimento (na unidade base)
--   ficha                   = Σ quantidade × custo por unidade base
--   pizza com N sabores     = média do custo da ficha de cada sabor NAQUELE tamanho (fração 1/N cada)
-- Rollback: docs/rollback/0142_cmv_precificacao.down.sql

-- ── normalização de nome (igual ao servidor: minúsculo, sem espaço nas pontas, sem acento) ──────
create or replace function public.cmv_chave(t text) returns text language sql immutable as $$
  select translate(lower(btrim(coalesce(t, ''))), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')
$$;

-- ── insumos ────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.cmv_insumos (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes (id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 1 and 80),
  unidade_compra text not null check (unidade_compra in ('kg', 'g', 'l', 'ml', 'un', 'pacote', 'caixa', 'duzia', 'fardo', 'saco', 'lata', 'garrafa')),
  quantidade_compra numeric(14, 4) not null default 1 check (quantidade_compra > 0),
  base_por_unidade numeric(14, 4) not null default 1 check (base_por_unidade > 0),
  unidade_base text not null check (unidade_base in ('g', 'ml', 'un')),
  custo_compra_centavos bigint not null default 0 check (custo_compra_centavos >= 0 and custo_compra_centavos <= 100000000),
  aproveitamento_pct numeric(5, 2) not null default 100 check (aproveitamento_pct > 0 and aproveitamento_pct <= 100),
  preparado boolean not null default false,
  rendimento_base numeric(14, 4) check (rendimento_base is null or rendimento_base > 0),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (not preparado or rendimento_base is not null)
);
create unique index if not exists cmv_insumos_nome_uidx on public.cmv_insumos (restaurante_id, public.cmv_chave(nome));

create table if not exists public.cmv_insumo_componentes (
  insumo_id uuid not null references public.cmv_insumos (id) on delete cascade,
  componente_id uuid not null references public.cmv_insumos (id) on delete restrict,
  quantidade_base numeric(14, 4) not null check (quantidade_base > 0),
  primary key (insumo_id, componente_id),
  check (insumo_id <> componente_id)
);

create table if not exists public.cmv_custos_historico (
  id bigint generated always as identity primary key,
  restaurante_id uuid not null references public.restaurantes (id) on delete cascade,
  insumo_id uuid not null references public.cmv_insumos (id) on delete restrict,
  custo_antigo_centavos bigint,
  custo_novo_centavos bigint not null,
  quantidade_compra numeric(14, 4) not null,
  base_por_unidade numeric(14, 4) not null,
  aproveitamento_pct numeric(5, 2) not null,
  motivo text check (motivo is null or length(motivo) <= 300),
  usuario_id uuid,
  usuario_nome text not null,
  criado_em timestamptz not null default now()
);
create index if not exists cmv_custos_historico_insumo_idx on public.cmv_custos_historico (insumo_id, criado_em desc);
-- Histórico é append-only, para todos os papéis da API (mesma trava do livro-caixa).
create or replace function public.cmv_historico_imutavel() returns trigger language plpgsql as $$
begin
  if public.fin_manutencao() then return coalesce(new, old); end if;
  raise exception 'historico_imutavel' using errcode = 'P0001';
end $$;
drop trigger if exists cmv_custos_historico_imutavel on public.cmv_custos_historico;
create trigger cmv_custos_historico_imutavel before update or delete on public.cmv_custos_historico
  for each row execute function public.cmv_historico_imutavel();
drop trigger if exists cmv_custos_historico_sem_truncate on public.cmv_custos_historico;
create trigger cmv_custos_historico_sem_truncate before truncate on public.cmv_custos_historico
  for each statement execute function public.cmv_historico_imutavel();

-- ── fichas ─────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.cmv_fichas (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes (id) on delete cascade,
  alvo_tipo text not null check (alvo_tipo in ('item', 'tamanho', 'sabor', 'complemento', 'borda', 'massa')),
  alvo_id uuid not null,
  -- só para 'sabor' (pizza): o tamanho da pizza (tamanhos_padrao_pizza)
  tamanho_padrao_id uuid,
  item_id uuid references public.itens_cardapio (id) on delete cascade,
  atualizado_em timestamptz not null default now(),
  atualizado_por_nome text,
  check ((alvo_tipo = 'sabor') = (tamanho_padrao_id is not null))
);
create unique index if not exists cmv_fichas_alvo_uidx on public.cmv_fichas (restaurante_id, alvo_tipo, alvo_id, coalesce(tamanho_padrao_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists cmv_fichas_item_idx on public.cmv_fichas (restaurante_id, item_id);

create table if not exists public.cmv_ficha_componentes (
  ficha_id uuid not null references public.cmv_fichas (id) on delete cascade,
  insumo_id uuid not null references public.cmv_insumos (id) on delete restrict,
  quantidade_base numeric(14, 4) not null check (quantidade_base > 0),
  primary key (ficha_id, insumo_id)
);
create index if not exists cmv_ficha_componentes_insumo_idx on public.cmv_ficha_componentes (insumo_id);

-- ── configuração ───────────────────────────────────────────────────────────────────────────────
create table if not exists public.cmv_config (
  restaurante_id uuid primary key references public.restaurantes (id) on delete cascade,
  margem_alvo_pct numeric(5, 2) not null default 65 check (margem_alvo_pct >= 0 and margem_alvo_pct < 95),
  margem_baixa_pct numeric(5, 2) not null default 30 check (margem_baixa_pct >= 0 and margem_baixa_pct < 100),
  custos_variaveis_pct numeric(5, 2) not null default 0 check (custos_variaveis_pct >= 0 and custos_variaveis_pct < 50),
  arredondamento text not null default '90' check (arredondamento in ('nenhum', '90', '99', '00', '50')),
  atualizado_em timestamptz not null default now()
);
create table if not exists public.cmv_config_categoria (
  restaurante_id uuid not null references public.restaurantes (id) on delete cascade,
  grupo_id uuid not null references public.grupos_cardapio (id) on delete cascade,
  margem_alvo_pct numeric(5, 2) not null check (margem_alvo_pct >= 0 and margem_alvo_pct < 95),
  primary key (restaurante_id, grupo_id)
);

-- ── custo guardado na venda ────────────────────────────────────────────────────────────────────
create table if not exists public.pedido_itens_custo (
  pedido_item_id uuid primary key references public.pedido_itens (id) on delete cascade,
  restaurante_id uuid not null references public.restaurantes (id) on delete cascade,
  pedido_id uuid not null references public.pedidos (id) on delete cascade,
  situacao text not null check (situacao in ('ok', 'parcial', 'sem_ficha', 'erro')),
  custo_unitario numeric(18, 6),           -- centavos, com fração (1 unidade da linha: item + adicionais)
  custo_unitario_centavos bigint,          -- arredondado
  detalhe jsonb not null default '{}'::jsonb,
  erro text,
  calculado_em timestamptz not null default now()
);
create index if not exists pedido_itens_custo_loja_idx on public.pedido_itens_custo (restaurante_id, calculado_em);

-- RLS ligada e sem políticas: só o servidor (service_role) lê e grava.
alter table public.cmv_insumos enable row level security;
alter table public.cmv_insumo_componentes enable row level security;
alter table public.cmv_custos_historico enable row level security;
alter table public.cmv_fichas enable row level security;
alter table public.cmv_ficha_componentes enable row level security;
alter table public.cmv_config enable row level security;
alter table public.cmv_config_categoria enable row level security;
alter table public.pedido_itens_custo enable row level security;
revoke all on public.cmv_insumos, public.cmv_insumo_componentes, public.cmv_custos_historico, public.cmv_fichas,
  public.cmv_ficha_componentes, public.cmv_config, public.cmv_config_categoria, public.pedido_itens_custo from public, anon, authenticated;

-- ── custo por unidade base de um insumo (centavos, com fração) ─────────────────────────────────
create or replace function public.cmv_custo_insumo(p_insumo uuid, p_nivel int default 0)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  i public.cmv_insumos%rowtype;
  v_total numeric := 0;
  c record;
begin
  if p_nivel > 5 then raise exception 'subreceita_profunda'; end if;
  select * into i from public.cmv_insumos where id = p_insumo;
  if i.id is null then return null; end if;
  if i.preparado then
    for c in select componente_id, quantidade_base from public.cmv_insumo_componentes where insumo_id = i.id loop
      v_total := v_total + c.quantidade_base * coalesce(public.cmv_custo_insumo(c.componente_id, p_nivel + 1), 0);
    end loop;
    return v_total / i.rendimento_base / (i.aproveitamento_pct / 100);
  end if;
  return i.custo_compra_centavos::numeric / (i.quantidade_compra * i.base_por_unidade) / (i.aproveitamento_pct / 100);
end $$;

create or replace function public.cmv_custo_ficha(p_ficha uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(fc.quantidade_base * public.cmv_custo_insumo(fc.insumo_id)), 0)
    from public.cmv_ficha_componentes fc where fc.ficha_id = p_ficha
$$;

-- ── custo de uma linha vendida (mesma leitura de nomes que o servidor usa para o preço) ─────────
create or replace function public.cmv_custo_linha(
  p_restaurante uuid, p_item uuid, p_tamanho text, p_sabores text, p_borda text, p_massa text, p_complementos jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  it record;
  v_tam uuid;
  v_ficha uuid;
  v_base numeric := null;
  v_extra numeric := 0;
  v_sit text := 'ok';
  v_det jsonb := '[]'::jsonb;
  v_sabores text[];
  v_sabor record;
  v_soma numeric := 0;
  v_n int := 0;
  v_faltou boolean := false;
  c jsonb;
  v_comp uuid;
  v_fc uuid;
begin
  select id, tipo_item into it from public.itens_cardapio where id = p_item;
  if it.id is null then return jsonb_build_object('situacao', 'sem_ficha', 'motivo', 'item_inexistente'); end if;

  if it.tipo_item = 'pizza' and coalesce(btrim(p_sabores), '') <> '' then
    select id into v_tam from public.tamanhos_padrao_pizza
     where restaurante_id = p_restaurante and public.cmv_chave(nome) = public.cmv_chave(p_tamanho) limit 1;
    -- Sabor legado cujo nome contém " / " vence a divisão (mesma regra do preço).
    if exists (select 1 from public.pizza_sabores where item_id = p_item and public.cmv_chave(nome) = public.cmv_chave(p_sabores)) then
      v_sabores := array[p_sabores];
    else
      v_sabores := string_to_array(p_sabores, ' / ');
    end if;
    foreach p_sabores in array v_sabores loop
      v_n := v_n + 1;
      select s.id, s.nome, f.id as ficha into v_sabor from public.pizza_sabores s
        left join public.cmv_fichas f on f.restaurante_id = p_restaurante and f.alvo_tipo = 'sabor' and f.alvo_id = s.id and f.tamanho_padrao_id = v_tam
       where s.item_id = p_item and public.cmv_chave(s.nome) = public.cmv_chave(p_sabores) limit 1;
      if v_sabor.ficha is null then
        v_faltou := true;
        v_det := v_det || jsonb_build_object('parte', 'sabor', 'nome', btrim(p_sabores), 'sem_ficha', true);
      else
        v_soma := v_soma + public.cmv_custo_ficha(v_sabor.ficha);
        v_det := v_det || jsonb_build_object('parte', 'sabor', 'nome', v_sabor.nome, 'fracao', '1/' || array_length(v_sabores, 1), 'custo', round(public.cmv_custo_ficha(v_sabor.ficha), 4));
      end if;
    end loop;
    if v_faltou then return jsonb_build_object('situacao', 'sem_ficha', 'detalhe', v_det); end if;
    v_base := v_soma / greatest(v_n, 1); -- fração 1/N de cada sabor
  else
    if coalesce(btrim(p_tamanho), '') <> '' then
      select f.id into v_ficha from public.tamanhos_item t
        join public.cmv_fichas f on f.restaurante_id = p_restaurante and f.alvo_tipo = 'tamanho' and f.alvo_id = t.id
       where t.item_id = p_item and public.cmv_chave(t.nome) = public.cmv_chave(p_tamanho) limit 1;
    end if;
    if v_ficha is null then
      select id into v_ficha from public.cmv_fichas where restaurante_id = p_restaurante and alvo_tipo = 'item' and alvo_id = p_item;
    end if;
    if v_ficha is null then return jsonb_build_object('situacao', 'sem_ficha'); end if;
    v_base := public.cmv_custo_ficha(v_ficha);
    v_det := v_det || jsonb_build_object('parte', 'item', 'custo', round(v_base, 4));
  end if;

  -- Borda e massa (pizza): ficha da loja pelo nome. Sem ficha: custo 0 e a linha fica "parcial".
  if coalesce(btrim(p_borda), '') <> '' then
    select f.id into v_fc from public.bordas_pizza b join public.cmv_fichas f on f.restaurante_id = p_restaurante and f.alvo_tipo = 'borda' and f.alvo_id = b.id
     where b.restaurante_id = p_restaurante and public.cmv_chave(b.nome) = public.cmv_chave(p_borda) limit 1;
    if v_fc is null then v_sit := 'parcial'; else v_extra := v_extra + public.cmv_custo_ficha(v_fc); end if;
  end if;
  v_fc := null;
  if coalesce(btrim(p_massa), '') <> '' then
    select f.id into v_fc from public.massas_pizza m join public.cmv_fichas f on f.restaurante_id = p_restaurante and f.alvo_tipo = 'massa' and f.alvo_id = m.id
     where m.restaurante_id = p_restaurante and public.cmv_chave(m.nome) = public.cmv_chave(p_massa) limit 1;
    if v_fc is not null then v_extra := v_extra + public.cmv_custo_ficha(v_fc); end if;
  end if;

  -- Adicionais: cada entrada do jsonb (repetida = quantidade). Sem ficha = custo 0 (anotado no detalhe).
  for c in select * from jsonb_array_elements(coalesce(p_complementos, '[]'::jsonb)) loop
    v_comp := null; v_fc := null;
    select ic.id into v_comp from public.item_complementos ic where ic.item_id = p_item and public.cmv_chave(ic.nome) = public.cmv_chave(c->>'nome') limit 1;
    if v_comp is not null then
      select id into v_fc from public.cmv_fichas where restaurante_id = p_restaurante and alvo_tipo = 'complemento' and alvo_id = v_comp;
    end if;
    if v_fc is null then
      v_det := v_det || jsonb_build_object('parte', 'adicional', 'nome', c->>'nome', 'sem_ficha', true);
    else
      v_extra := v_extra + public.cmv_custo_ficha(v_fc);
      v_det := v_det || jsonb_build_object('parte', 'adicional', 'nome', c->>'nome', 'custo', round(public.cmv_custo_ficha(v_fc), 4));
    end if;
  end loop;

  return jsonb_build_object('situacao', v_sit, 'custo', v_base + v_extra, 'detalhe', v_det);
end $$;
revoke execute on function public.cmv_custo_linha(uuid, uuid, text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.cmv_custo_insumo(uuid, int) from public, anon, authenticated;
revoke execute on function public.cmv_custo_ficha(uuid) from public, anon, authenticated;
grant execute on function public.cmv_custo_linha(uuid, uuid, text, text, text, text, jsonb) to service_role;
grant execute on function public.cmv_custo_insumo(uuid, int) to service_role;
grant execute on function public.cmv_custo_ficha(uuid) to service_role;

-- ── gatilho: guarda o custo vigente quando a linha do pedido é gravada ─────────────────────────
-- Nunca atrapalha o pedido: qualquer falha vira situacao 'erro' (com a mensagem) e o insert segue.
create or replace function public.cmv_guardar_custo_linha() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_rest uuid;
  r jsonb;
  v_custo numeric;
begin
  -- Loja SEM o financeiro (todas as lojas reais hoje): sai já, sem subtransação e sem gravar nada — o caminho
  -- do pedido fica igual ao de antes (só esta leitura por chave primária).
  if new.item_id is null then return null; end if;
  select p.restaurante_id into v_rest from public.pedidos p
    join public.restaurantes rr on rr.id = p.restaurante_id and rr.financeiro_ativo
   where p.id = new.pedido_id;
  if v_rest is null then return null; end if;
  begin
    r := public.cmv_custo_linha(v_rest, new.item_id, new.tamanho_nome, new.sabor_nome, new.borda_nome, new.massa_nome, new.complementos);
    v_custo := (r->>'custo')::numeric;
    insert into public.pedido_itens_custo (pedido_item_id, restaurante_id, pedido_id, situacao, custo_unitario, custo_unitario_centavos, detalhe)
    values (new.id, v_rest, new.pedido_id, r->>'situacao', v_custo, case when v_custo is null then null else round(v_custo)::bigint end, coalesce(r->'detalhe', '{}'::jsonb))
    on conflict (pedido_item_id) do nothing;
  exception when others then
    begin
      insert into public.pedido_itens_custo (pedido_item_id, restaurante_id, pedido_id, situacao, erro)
      values (new.id, coalesce(v_rest, (select restaurante_id from public.pedidos where id = new.pedido_id)), new.pedido_id, 'erro', left(sqlerrm, 300))
      on conflict (pedido_item_id) do nothing;
    exception when others then null; -- nem o registro do erro pode derrubar o pedido
    end;
  end;
  return null;
end $$;
drop trigger if exists cmv_guardar_custo_linha on public.pedido_itens;
create trigger cmv_guardar_custo_linha after insert on public.pedido_itens
  for each row execute function public.cmv_guardar_custo_linha();

-- ── permissões novas (custos_ver, precos_aplicar) ─────────────────────────────────────────────
-- Padrão do papel: dono e gerente. Gerente de verdade (cargo gerente) com acessos PERSONALIZADOS: ganha
-- "ver custos" se já editava custos, e "aplicar preço" se já podia editar custos E preços. Só loja com financeiro.
update public.usuarios u
   set acessos = jsonb_set(u.acessos, '{sensiveis}', coalesce(u.acessos->'sensiveis', '[]'::jsonb) || '["custos_ver"]'::jsonb)
  from public.restaurantes r
 where r.id = u.restaurante_id and r.financeiro_ativo and u.papel = 'gerente' and u.acessos is not null
   and coalesce(nullif(btrim(u.cargo), ''), 'gerente') = 'gerente'
   and coalesce(u.acessos->'sensiveis', '[]'::jsonb) ? 'custos_editar'
   and not coalesce(u.acessos->'sensiveis', '[]'::jsonb) ? 'custos_ver';
update public.usuarios u
   set acessos = jsonb_set(u.acessos, '{sensiveis}', coalesce(u.acessos->'sensiveis', '[]'::jsonb) || '["precos_aplicar"]'::jsonb)
  from public.restaurantes r
 where r.id = u.restaurante_id and r.financeiro_ativo and u.papel = 'gerente' and u.acessos is not null
   and coalesce(nullif(btrim(u.cargo), ''), 'gerente') = 'gerente'
   and coalesce(u.acessos->'sensiveis', '[]'::jsonb) ?& array['custos_editar', 'editar_precos']
   and not coalesce(u.acessos->'sensiveis', '[]'::jsonb) ? 'precos_aplicar';

-- ── gravações atômicas (tudo ou nada) ──────────────────────────────────────────────────────────
-- O servidor valida e calcula; estas funções gravam TUDO numa transação só (insumo + componentes +
-- histórico + auditoria; ficha + componentes + auditoria). Falha em qualquer passo desfaz o resto.
create or replace function public.fin_auditar(p_restaurante uuid, p_usuario uuid, p_nome text, p_acao text, p_entidade text, p_entidade_id uuid, p_dados jsonb)
  returns void language sql security definer set search_path = public as $$
  insert into public.eventos_auditoria (restaurante_id, ator, usuario_id, usuario_nome, acao, entidade, entidade_id, dados)
  values (p_restaurante, case when p_usuario is null then 'sistema' else 'usuario' end, p_usuario, coalesce(p_nome, '—'), p_acao, p_entidade, p_entidade_id, p_dados)
$$;
revoke execute on function public.fin_auditar(uuid, uuid, text, text, text, uuid, jsonb) from public, anon, authenticated;

create or replace function public.cmv_insumo_salvar(p_restaurante uuid, p_id uuid, p_linha jsonb, p_trocar_componentes boolean, p_componentes jsonb,
  p_historico jsonb, p_auditoria jsonb) returns uuid
  language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id;
begin
  if v_id is null then
    insert into public.cmv_insumos (restaurante_id, nome, unidade_compra, quantidade_compra, base_por_unidade, unidade_base, custo_compra_centavos,
      aproveitamento_pct, preparado, rendimento_base, atualizado_em)
    values (p_restaurante, p_linha->>'nome', p_linha->>'unidade_compra', (p_linha->>'quantidade_compra')::numeric, (p_linha->>'base_por_unidade')::numeric,
      p_linha->>'unidade_base', (p_linha->>'custo_compra_centavos')::bigint, (p_linha->>'aproveitamento_pct')::numeric, (p_linha->>'preparado')::boolean,
      nullif(p_linha->>'rendimento_base', '')::numeric, now())
    returning id into v_id;
  else
    update public.cmv_insumos set nome = p_linha->>'nome', unidade_compra = p_linha->>'unidade_compra', quantidade_compra = (p_linha->>'quantidade_compra')::numeric,
      base_por_unidade = (p_linha->>'base_por_unidade')::numeric, unidade_base = p_linha->>'unidade_base', custo_compra_centavos = (p_linha->>'custo_compra_centavos')::bigint,
      aproveitamento_pct = (p_linha->>'aproveitamento_pct')::numeric, preparado = (p_linha->>'preparado')::boolean,
      rendimento_base = nullif(p_linha->>'rendimento_base', '')::numeric, atualizado_em = now()
     where id = v_id and restaurante_id = p_restaurante;
    if not found then raise exception 'insumo_nao_encontrado' using errcode = 'P0002'; end if;
  end if;
  if p_trocar_componentes then
    delete from public.cmv_insumo_componentes where insumo_id = v_id;
    insert into public.cmv_insumo_componentes (insumo_id, componente_id, quantidade_base)
    select v_id, (c->>'componenteId')::uuid, (c->>'quantidadeBase')::numeric from jsonb_array_elements(coalesce(p_componentes, '[]'::jsonb)) c;
  end if;
  if p_historico is not null then
    insert into public.cmv_custos_historico (restaurante_id, insumo_id, custo_antigo_centavos, custo_novo_centavos, quantidade_compra, base_por_unidade,
      aproveitamento_pct, motivo, usuario_id, usuario_nome)
    values (p_restaurante, v_id, nullif(p_historico->>'custo_antigo_centavos', '')::bigint, (p_historico->>'custo_novo_centavos')::bigint,
      (p_historico->>'quantidade_compra')::numeric, (p_historico->>'base_por_unidade')::numeric, (p_historico->>'aproveitamento_pct')::numeric,
      p_historico->>'motivo', nullif(p_historico->>'usuario_id', '')::uuid, p_historico->>'usuario_nome');
  end if;
  perform public.fin_auditar(p_restaurante, nullif(p_auditoria->>'usuario_id', '')::uuid, p_auditoria->>'usuario_nome', p_auditoria->>'acao', 'insumo', v_id, p_auditoria->'dados');
  return v_id;
end $$;
revoke execute on function public.cmv_insumo_salvar(uuid, uuid, jsonb, boolean, jsonb, jsonb, jsonb) from public, anon, authenticated;

create or replace function public.cmv_ficha_salvar(p_restaurante uuid, p_tipo text, p_alvo uuid, p_tamanho uuid, p_item uuid, p_componentes jsonb, p_auditoria jsonb)
  returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from public.cmv_fichas where restaurante_id = p_restaurante and alvo_tipo = p_tipo and alvo_id = p_alvo
     and tamanho_padrao_id is not distinct from p_tamanho for update;
  if v_id is null then
    insert into public.cmv_fichas (restaurante_id, alvo_tipo, alvo_id, tamanho_padrao_id, item_id, atualizado_por_nome)
    values (p_restaurante, p_tipo, p_alvo, p_tamanho, p_item, p_auditoria->>'usuario_nome') returning id into v_id;
  else
    update public.cmv_fichas set atualizado_em = now(), atualizado_por_nome = p_auditoria->>'usuario_nome' where id = v_id;
  end if;
  delete from public.cmv_ficha_componentes where ficha_id = v_id;
  insert into public.cmv_ficha_componentes (ficha_id, insumo_id, quantidade_base)
  select v_id, (c->>'insumoId')::uuid, (c->>'quantidadeBase')::numeric from jsonb_array_elements(coalesce(p_componentes, '[]'::jsonb)) c;
  perform public.fin_auditar(p_restaurante, nullif(p_auditoria->>'usuario_id', '')::uuid, p_auditoria->>'usuario_nome', 'cmv.ficha_salva', 'ficha', v_id, p_auditoria->'dados');
  return v_id;
end $$;
revoke execute on function public.cmv_ficha_salvar(uuid, text, uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
