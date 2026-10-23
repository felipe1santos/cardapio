-- 0223 — Opções no estilo pedido.takeat.app (23/10/2026, pedido do dono), em Ajustes › Perfil da loja › Aparência:
--   * vitrine_fonte ganha 'takeat' (Poppins 400/500/600).
--   * vitrine_cor_rodape: 'loja' (padrão = como hoje) | 'takeat' (vermelho #C8131B no ícone ativo do menu inferior
--     e no botão "Ver sacola").
-- Aditiva e neutra: nenhuma loja muda até escolher. Nenhuma linha é convertida.
-- Rollback: alter table public.restaurantes drop column vitrine_cor_rodape;
--           (e, se nenhuma loja usar 'takeat') recriar o check de vitrine_fonte só com ('atual', 'ifood').

alter table public.restaurantes drop constraint if exists restaurantes_vitrine_fonte_check;
alter table public.restaurantes add constraint restaurantes_vitrine_fonte_check
  check (vitrine_fonte in ('atual', 'ifood', 'takeat'));

alter table public.restaurantes add column if not exists vitrine_cor_rodape text not null default 'loja'
  check (vitrine_cor_rodape in ('loja', 'takeat'));

-- restaurantes tem grant por coluna (0080): a vitrine (anon) lê; o painel (authenticated) grava a própria loja (RLS).
grant select (vitrine_cor_rodape) on public.restaurantes to anon, authenticated;
grant update (vitrine_cor_rodape) on public.restaurantes to authenticated;
