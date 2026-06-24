-- ============================================================================
-- CEP do restaurante — usado para centralizar/biased o mapa de calor do
-- Dashboard na região da loja e calcular hotspots de entrega corretamente.
-- ============================================================================

alter table restaurantes
  add column cep text not null default '';
