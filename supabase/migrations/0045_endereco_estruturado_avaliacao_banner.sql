-- Endereço estruturado da loja (rua/número/etc separados, pra exibir
-- bairro/cidade na vitrine e permitir o mapa de ajuste do PIN em Ajustes >
-- Loja). O campo `endereco` (texto livre) continua existindo e passa a ser
-- recomposto automaticamente a partir destes campos — todo o resto do
-- sistema (recibo, frete, checkout) continua lendo só essa string, sem
-- mudança de contrato. Aditivo e idempotente.
alter table restaurantes add column if not exists endereco_rua text;
alter table restaurantes add column if not exists endereco_numero text;
alter table restaurantes add column if not exists endereco_complemento text;
alter table restaurantes add column if not exists endereco_bairro text;
alter table restaurantes add column if not exists endereco_cidade text;
alter table restaurantes add column if not exists endereco_estado text;

-- Nota de avaliação exibida na vitrine (⭐ 4,9 · 912 avaliações). Preenchida
-- manualmente pelo dono — o sistema não coleta avaliações de clientes hoje.
alter table restaurantes add column if not exists avaliacao_nota numeric(2,1);
alter table restaurantes add column if not exists avaliacao_qtd integer;

-- Banner promocional exibido dentro do cardápio da vitrine (separado do
-- banner_url, que é a capa/hero do topo).
alter table restaurantes add column if not exists banner_promocional_url text;
