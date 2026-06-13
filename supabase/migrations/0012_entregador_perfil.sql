-- Perfil do entregador: foto, modelo da moto e placa, exibidos no painel de
-- Logística (ícone "perfil" no card do entregador).
alter table entregadores
  add column foto_url text,
  add column veiculo text not null default '',
  add column placa text not null default '';
