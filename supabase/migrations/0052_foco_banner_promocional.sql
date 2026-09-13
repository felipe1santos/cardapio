-- ============================================================================
-- Ponto de foco do banner promocional.
--
-- A 0051 deu ponto de foco à capa da loja e à foto de categoria, mas o banner
-- promocional ficou de fora e é o que mais sofre com o recorte automático: ele
-- aparece como uma faixa muito mais larga que alta (≈3,2:1 no celular e ≈8,4:1
-- no desktop), então uma arte com o texto em cima ou embaixo perde justamente a
-- parte que anuncia a promoção.
--
-- Mesmo contrato da 0051: 0-100 em cada eixo, consumido como
-- `object-position: X% Y%`, e 50/50 é exatamente o `object-cover` centralizado
-- de hoje — aplicar isto não muda a aparência de nenhuma loja já cadastrada.
-- ============================================================================

alter table restaurantes
  add column if not exists banner_promo_foco_x numeric(5,2) not null default 50,
  add column if not exists banner_promo_foco_y numeric(5,2) not null default 50;

comment on column restaurantes.banner_promo_foco_x is
  'Ponto de foco horizontal do banner promocional, 0-100. 50 = centro (comportamento padrão).';
comment on column restaurantes.banner_promo_foco_y is
  'Ponto de foco vertical do banner promocional, 0-100. 50 = centro (comportamento padrão).';
