-- SP-A: foto no complemento + flag de quantidade no grupo. Aditivo e idempotente.

alter table item_complementos add column if not exists imagem_url text;
alter table preset_complemento_itens add column if not exists imagem_url text;

alter table grupos_item_complementos add column if not exists permite_quantidade boolean not null default false;
alter table presets_complementos add column if not exists permite_quantidade boolean not null default false;
