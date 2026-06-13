-- Presença (heartbeat) e localização do entregador, enviadas pelo portal
-- /entregador/[token] — usadas no painel de Logística para mostrar se o
-- motoboy está com o app aberto ("online") e onde ele está no mapa.
alter table entregadores
  add column ultimo_acesso_em timestamptz,
  add column localizacao_lat double precision,
  add column localizacao_lng double precision,
  add column localizacao_atualizada_em timestamptz;
