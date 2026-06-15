-- ============================================================================
-- Base de Clientes (admin): adiciona o campo "sexo", preenchido manualmente
-- pelo lojista na nova tela /admin/clientes. Não é coletado no checkout, mas
-- alimenta a segmentação de campanhas (ex.: export de compradores p/ Meta Ads).
-- ============================================================================

alter table clientes
  add column sexo text not null default '';

alter table clientes
  add constraint clientes_sexo_check check (sexo in ('', 'M', 'F'));
