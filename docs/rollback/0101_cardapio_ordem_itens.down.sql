-- Rollback da 0101 (ordem manual dos itens e reordenação atômica).
--
-- Seguro a qualquer momento: o código anterior (main bf8cbf8) não lê `itens_cardapio.posicao`
-- nem chama as funções. ANTES de rodar, volte o código (o código novo lê `posicao` no
-- select do cardápio e quebraria sem a coluna).
--
-- Perde-se apenas a ordem manual dos itens gravada depois da 0101; a ordem das CATEGORIAS
-- (`grupos_cardapio.posicao`) já existia e fica como está. Nenhum outro dado muda.

begin;
drop trigger if exists itens_cardapio_posicao_bi on public.itens_cardapio;
drop trigger if exists itens_cardapio_posicao_bu on public.itens_cardapio;
drop trigger if exists grupos_cardapio_posicao_bi on public.grupos_cardapio;
drop function if exists public.itens_cardapio_posicao_padrao();
drop function if exists public.grupos_cardapio_posicao_padrao();
drop function if exists public.cardapio_ordenar_itens(uuid, uuid, uuid[], uuid, text);
drop function if exists public.cardapio_ordenar_categorias(uuid, uuid[], uuid, text);
drop index if exists public.itens_cardapio_ordem_idx;
alter table public.itens_cardapio drop constraint if exists itens_cardapio_posicao_valida;
alter table public.itens_cardapio drop column if exists posicao;
delete from schema_migrations where name = '0101_cardapio_ordem_itens.sql';
commit;
