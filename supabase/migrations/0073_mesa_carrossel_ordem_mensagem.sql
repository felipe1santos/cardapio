-- 0073 — Cardápio da mesa (QR): carrossel, ordem dos itens e mensagem da seleção.
--
-- Tudo aditivo e com padrão que preserva o comportamento atual (ver
-- feedback "default seguro"): sem carrossel continua o banner; sem ordem definida os
-- itens seguem a ordem de hoje; sem mensagem própria continua o texto padrão.
--
-- 1. restaurantes.mesa_carrossel_urls — imagens que passam sozinhas no topo do cardápio
--    da mesa. Vazio = mostra o banner da loja, como antes. No máximo 8.
-- 2. restaurantes.mesa_mensagem_selecao — texto do aviso "isto é só a sua seleção".
--    Null = texto padrão. No máximo 280 caracteres.
-- 3. itens_cardapio.posicao_mesa — ordem do item dentro da categoria no cardápio da
--    mesa. Null = depois dos ordenados, na ordem de sempre. Não mexe no delivery.
--
-- As duas colunas da loja só mudam pelo servidor (rota da gestão), como as outras do
-- salão: o gatilho de 0071 passa a protegê-las também.

alter table public.restaurantes
  add column if not exists mesa_carrossel_urls text[] not null default '{}'::text[],
  add column if not exists mesa_mensagem_selecao text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'restaurantes_mesa_carrossel_max') then
    alter table public.restaurantes
      add constraint restaurantes_mesa_carrossel_max check (cardinality(mesa_carrossel_urls) <= 8);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'restaurantes_mesa_mensagem_tamanho') then
    alter table public.restaurantes
      add constraint restaurantes_mesa_mensagem_tamanho check (mesa_mensagem_selecao is null or char_length(mesa_mensagem_selecao) <= 280);
  end if;
end $$;

comment on column public.restaurantes.mesa_carrossel_urls is
  'Imagens do carrossel do cardápio da mesa (QR). Vazio = banner da loja. Máximo 8.';
comment on column public.restaurantes.mesa_mensagem_selecao is
  'Aviso da seleção no cardápio da mesa. Null = texto padrão. Máximo 280 caracteres.';

alter table public.itens_cardapio
  add column if not exists posicao_mesa integer;

comment on column public.itens_cardapio.posicao_mesa is
  'Ordem do item dentro da categoria no cardápio da mesa (QR). Null = depois dos ordenados.';

-- Gatilho de 0071: as colunas novas do salão também só mudam pelo servidor.
create or replace function public.restaurantes_protege_salao()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Só o JWT de usuário é barrado. service_role (rotas) e conexão direta (migrations,
  -- scripts de operação) passam.
  if coalesce(auth.role(), '') in ('authenticated', 'anon') and (
       new.modulo_mesas_ativo is distinct from old.modulo_mesas_ativo
    or new.taxa_servico_padrao is distinct from old.taxa_servico_padrao
    or new.formas_pagamento_mesa is distinct from old.formas_pagamento_mesa
    or new.salao_garcom_recebe is distinct from old.salao_garcom_recebe
    or new.salao_garcom_transfere is distinct from old.salao_garcom_transfere
    or new.salao_caixa_desconto is distinct from old.salao_caixa_desconto
    or new.mesa_carrossel_urls is distinct from old.mesa_carrossel_urls
    or new.mesa_mensagem_selecao is distinct from old.mesa_mensagem_selecao
  ) then
    raise exception 'coluna_protegida' using errcode = '42501';
  end if;
  return new;
end $$;
