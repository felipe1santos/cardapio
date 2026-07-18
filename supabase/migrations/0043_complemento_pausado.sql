-- Pausar/retomar complemento sem excluir: complemento pausado some da vitrine
-- mas continua cadastrado no admin. Aditivo e idempotente.

-- Complementos de um item (linhas dentro de um grupo do item).
alter table item_complementos add column if not exists pausado boolean not null default false;

-- Complementos de um preset reutilizável (aba "Grupos de complementos").
alter table preset_complemento_itens add column if not exists pausado boolean not null default false;

-- Preset inteiro pausado (reservado: permite pausar o grupo todo de uma vez).
alter table presets_complementos add column if not exists pausado boolean not null default false;
