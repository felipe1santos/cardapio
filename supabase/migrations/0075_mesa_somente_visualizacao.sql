-- 0075 — Cardápio da mesa (QR) em modo "somente visualização".
--
-- Ligado, o cliente só vê o cardápio: sem seleção, sem sacola, sem tamanho/adicionais.
-- Tocar num item abre a foto inteira e a descrição (e os sabores, na pizza). A rota da
-- seleção recusa gravar enquanto o modo está ligado.
--
-- Aditiva. Padrão false = tudo continua como hoje. Só muda pelo servidor (rota da gestão):
-- o gatilho do salão passa a proteger a coluna.

alter table public.restaurantes
  add column if not exists mesa_somente_visualizacao boolean not null default false;

comment on column public.restaurantes.mesa_somente_visualizacao is
  'Cardápio da mesa (QR) só para ver: sem seleção nem pedido pelo cliente. Padrão: false.';

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
    or new.mesa_somente_visualizacao is distinct from old.mesa_somente_visualizacao
  ) then
    raise exception 'coluna_protegida' using errcode = '42501';
  end if;
  return new;
end $$;
