-- 0224 — Fonte "Estilo Takeat" e menu inferior em "Vermelho Takeat" em TODAS as lojas e como padrão (23/10/2026,
-- pedido do dono: "coloca tudo em produção para todas as lojas"). Cada loja pode trocar em Ajustes › Perfil da loja › Aparência.
-- Antes: menuzia já em takeat/takeat; db-doces, estancia-burger, firehouse, mama-pizza, nossa-cozinha, pizza-do-rosa,
-- ponto-400-hamburgueria, villa-lanches, w-lanches-reviver em vitrine_fonte='ifood' e vitrine_cor_rodape='loja'.
-- Rollback: alter table public.restaurantes alter column vitrine_fonte set default 'ifood';
--           alter table public.restaurantes alter column vitrine_cor_rodape set default 'loja';
--           update public.restaurantes set vitrine_fonte = 'ifood', vitrine_cor_rodape = 'loja' where slug <> 'menuzia';

alter table public.restaurantes alter column vitrine_fonte set default 'takeat';
alter table public.restaurantes alter column vitrine_cor_rodape set default 'takeat';
update public.restaurantes set vitrine_fonte = 'takeat', vitrine_cor_rodape = 'takeat'
  where vitrine_fonte is distinct from 'takeat' or vitrine_cor_rodape is distinct from 'takeat';
