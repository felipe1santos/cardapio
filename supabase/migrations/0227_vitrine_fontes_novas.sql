-- 0227 — Mais fontes para a vitrine (26/10/2026, pedido do dono), em Ajustes › Aparência › Fonte da vitrine:
--   * vitrine_fonte ganha 'dmsans' (DM Sans), 'nunito' (Nunito) e 'inter' (Inter) — todas já servidas pelo app
--     (public/fontes via app/fontes.css), sem Google Fonts.
-- Aditiva e neutra: só amplia o check; nenhuma loja muda até escolher. Nenhuma linha é convertida.
-- Rollback (se nenhuma loja usar as novas): recriar o check com ('atual', 'ifood', 'takeat').

alter table public.restaurantes drop constraint if exists restaurantes_vitrine_fonte_check;
alter table public.restaurantes add constraint restaurantes_vitrine_fonte_check
  check (vitrine_fonte in ('atual', 'ifood', 'takeat', 'dmsans', 'nunito', 'inter'));
