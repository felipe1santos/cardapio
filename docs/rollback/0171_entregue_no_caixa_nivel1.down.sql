-- Desfaz a 0171 (o livro-caixa já gravado fica: é imutável).
drop trigger if exists fin_entregue_no_caixa on public.pedidos;
drop function if exists public.fin_entregue_no_caixa();
