-- 0101 — Ordem manual dos itens dentro da categoria (e ordem das categorias atômica).
--
-- O Gestor de Cardápio passa a ordenar os itens de cada categoria arrastando. A mesma
-- ordem vale na vitrine (delivery), no QR de visualização e no QR ativo da mesa. Até
-- aqui a ordem dos itens era a de criação (`criado_em`), sem coluna própria.
--
-- Aditiva e com padrão que preserva o comportamento atual (feedback "default seguro"):
--
-- 1. itens_cardapio.posicao — nasce preenchida com a ordem de HOJE: por loja e categoria,
--    `criado_em` e depois `id` (em produção não há dois itens da mesma categoria com o
--    mesmo `criado_em`, conferido antes desta migration). Nenhum dado existente muda.
-- 2. Gatilho: item novo (sem posição) entra no final da categoria; item que muda de
--    categoria vai para o final da nova. Favoritar, pausar ou editar não mexem na posição.
-- 3. Gatilho: categoria nova entra no final. Antes a tela mandava `quantidade de
--    categorias` como posição, o que colidia com uma existente quando havia buracos na
--    numeração (ex.: 0,1,4,6,7,8,10,11 → a nova recebia 8).
-- 4. Funções de reordenação (service_role, chamadas pela rota do Gestor): trancam as
--    linhas, exigem a lista COMPLETA e exata (nada ausente, repetido ou de outra loja
--    ou categoria), gravam 0..n-1 numa transação e registram auditoria. Uma aba com a
--    lista desatualizada recebe `ordem_desatualizada` e nenhum item some.
--
-- `grupos_cardapio.posicao_mesa` (0074) continua valendo como ordem PRÓPRIA do QR para a
-- loja que a configurou em Ajustes › Mesas; sem ela, o QR segue a ordem do Gestor.
--
-- Rollback (não apaga dado de ninguém; a coluna volta a ser ignorada pelo código antigo):
--   drop trigger if exists itens_cardapio_posicao_bi on public.itens_cardapio;
--   drop trigger if exists itens_cardapio_posicao_bu on public.itens_cardapio;
--   drop trigger if exists grupos_cardapio_posicao_bi on public.grupos_cardapio;
--   drop function if exists public.itens_cardapio_posicao_padrao();
--   drop function if exists public.grupos_cardapio_posicao_padrao();
--   drop function if exists public.cardapio_ordenar_itens(uuid, uuid, uuid[], uuid, text);
--   drop function if exists public.cardapio_ordenar_categorias(uuid, uuid[], uuid, text);
--   alter table public.itens_cardapio drop constraint if exists itens_cardapio_posicao_valida;
--   alter table public.itens_cardapio drop column if exists posicao;

-- ─── 1. coluna e ordem de hoje ───────────────────────────────────────────────
alter table public.itens_cardapio add column if not exists posicao integer;

with ordem as (
  select id, (row_number() over (partition by restaurante_id, grupo_id order by criado_em, id) - 1)::int as p
    from public.itens_cardapio
)
update public.itens_cardapio i
   set posicao = o.p
  from ordem o
 where o.id = i.id and i.posicao is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'itens_cardapio_posicao_valida') then
    alter table public.itens_cardapio
      add constraint itens_cardapio_posicao_valida check (posicao >= 0);
  end if;
end $$;

alter table public.itens_cardapio alter column posicao set not null;

create index if not exists itens_cardapio_ordem_idx
  on public.itens_cardapio (restaurante_id, grupo_id, posicao);

comment on column public.itens_cardapio.posicao is
  'Ordem do item dentro da categoria (Gestor de Cardápio). Vale na vitrine e nos QR. Desempate: criado_em, id.';

-- ─── 2. item novo no final; mudou de categoria, final da nova ────────────────
create or replace function public.itens_cardapio_posicao_padrao()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.posicao is null then
      select coalesce(max(posicao) + 1, 0) into new.posicao
        from public.itens_cardapio
       where restaurante_id = new.restaurante_id and grupo_id is not distinct from new.grupo_id;
    end if;
  elsif new.grupo_id is distinct from old.grupo_id and new.posicao is not distinct from old.posicao then
    select coalesce(max(posicao) + 1, 0) into new.posicao
      from public.itens_cardapio
     where restaurante_id = new.restaurante_id and grupo_id is not distinct from new.grupo_id and id <> new.id;
  end if;
  return new;
end $$;

drop trigger if exists itens_cardapio_posicao_bi on public.itens_cardapio;
create trigger itens_cardapio_posicao_bi
  before insert on public.itens_cardapio
  for each row execute function public.itens_cardapio_posicao_padrao();

drop trigger if exists itens_cardapio_posicao_bu on public.itens_cardapio;
create trigger itens_cardapio_posicao_bu
  before update of grupo_id on public.itens_cardapio
  for each row execute function public.itens_cardapio_posicao_padrao();

-- ─── 3. categoria nova no final ──────────────────────────────────────────────
-- Respeita a posição pedida só quando ela já é a última (importação em sequência);
-- qualquer valor que colidiria com uma categoria existente vai para o final.
create or replace function public.grupos_cardapio_posicao_padrao()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_max integer;
begin
  select max(posicao) into v_max from public.grupos_cardapio where restaurante_id = new.restaurante_id;
  if v_max is not null and (new.posicao is null or new.posicao <= v_max) then
    new.posicao := v_max + 1;
  end if;
  return new;
end $$;

drop trigger if exists grupos_cardapio_posicao_bi on public.grupos_cardapio;
create trigger grupos_cardapio_posicao_bi
  before insert on public.grupos_cardapio
  for each row execute function public.grupos_cardapio_posicao_padrao();

-- ─── 4. reordenação atômica ──────────────────────────────────────────────────
create or replace function public.cardapio_ordenar_itens(
  p_restaurante uuid, p_grupo uuid, p_itens uuid[], p_ator uuid, p_ator_nome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_atuais uuid[];
  v_n integer := coalesce(cardinality(p_itens), 0);
begin
  if p_restaurante is null or p_grupo is null then raise exception 'ordem_invalida'; end if;
  if v_n = 0 or v_n > 2000 or array_position(p_itens, null) is not null then raise exception 'ordem_invalida'; end if;
  if (select count(distinct x) from unnest(p_itens) x) <> v_n then raise exception 'ordem_repetida'; end if;

  perform 1 from public.grupos_cardapio where id = p_grupo and restaurante_id = p_restaurante for update;
  if not found then raise exception 'categoria_de_outra_loja'; end if;

  -- Tranca os itens da categoria: duas gravações simultâneas se enfileiram.
  select array_agg(id order by id) into v_atuais
    from (select id from public.itens_cardapio
           where restaurante_id = p_restaurante and grupo_id = p_grupo
           for update) t;

  -- Id que não é desta loja/categoria: recusa sem contar qual (não vira oráculo).
  if exists (select 1 from unnest(p_itens) x where x <> all (coalesce(v_atuais, '{}'::uuid[]))) then
    raise exception 'item_fora_da_categoria';
  end if;
  -- Faltou item (criado ou movido em outra aba): nada é gravado, a tela recarrega.
  if coalesce(cardinality(v_atuais), 0) <> v_n then raise exception 'ordem_desatualizada'; end if;

  update public.itens_cardapio i
     set posicao = o.ord - 1
    from unnest(p_itens) with ordinality as o(id, ord)
   where i.id = o.id and i.posicao is distinct from o.ord - 1;

  perform public.auditoria_registrar(p_restaurante, p_ator, p_ator_nome, 'cardapio.itens_ordenados', 'grupo_cardapio', p_grupo,
    jsonb_build_object('itens', v_n));
  return jsonb_build_object('itens', v_n);
end $$;

revoke all on function public.cardapio_ordenar_itens(uuid, uuid, uuid[], uuid, text) from public, anon, authenticated;

create or replace function public.cardapio_ordenar_categorias(
  p_restaurante uuid, p_grupos uuid[], p_ator uuid, p_ator_nome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_atuais uuid[];
  v_n integer := coalesce(cardinality(p_grupos), 0);
begin
  if p_restaurante is null then raise exception 'ordem_invalida'; end if;
  if v_n = 0 or v_n > 500 or array_position(p_grupos, null) is not null then raise exception 'ordem_invalida'; end if;
  if (select count(distinct x) from unnest(p_grupos) x) <> v_n then raise exception 'ordem_repetida'; end if;

  select array_agg(id order by id) into v_atuais
    from (select id from public.grupos_cardapio where restaurante_id = p_restaurante for update) t;

  if exists (select 1 from unnest(p_grupos) x where x <> all (coalesce(v_atuais, '{}'::uuid[]))) then
    raise exception 'categoria_de_outra_loja';
  end if;
  if coalesce(cardinality(v_atuais), 0) <> v_n then raise exception 'ordem_desatualizada'; end if;

  update public.grupos_cardapio g
     set posicao = o.ord - 1
    from unnest(p_grupos) with ordinality as o(id, ord)
   where g.id = o.id and g.posicao is distinct from o.ord - 1;

  perform public.auditoria_registrar(p_restaurante, p_ator, p_ator_nome, 'cardapio.categorias_ordenadas', 'restaurante', p_restaurante,
    jsonb_build_object('categorias', v_n));
  return jsonb_build_object('categorias', v_n);
end $$;

revoke all on function public.cardapio_ordenar_categorias(uuid, uuid[], uuid, text) from public, anon, authenticated;
