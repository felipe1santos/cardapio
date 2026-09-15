-- O que fazer quando o bairro do cliente não tem taxa cadastrada.
--
-- 'bloquear'    = lista fechada (comportamento vigente desde 2026-07-10): sem match
--                 de bairro e sem faixa de raio que cubra o endereço, o pedido é
--                 recusado. É o DEFAULT — nenhuma loja existente muda de comportamento.
-- 'taxa_padrao' = a loja aceita o pedido cobrando restaurantes.taxa_entrega_padrao.
--                 Só vale para loja que trabalha SÓ com bairros (sem raio): quando há
--                 raio, ele delimita a área e continua bloqueando fora dele ou quando
--                 o endereço não pôde ser localizado.
alter table public.restaurantes
  add column if not exists frete_fora_da_lista text not null default 'bloquear';

alter table public.restaurantes
  drop constraint if exists restaurantes_frete_fora_da_lista_check;

alter table public.restaurantes
  add constraint restaurantes_frete_fora_da_lista_check
  check (frete_fora_da_lista in ('bloquear', 'taxa_padrao'));
