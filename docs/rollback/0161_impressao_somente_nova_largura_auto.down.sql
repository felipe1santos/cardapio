-- Rollback da 0161. Os tokens do assistente antigo invalidados não voltam (gerar de novo na tela).
revoke select (impressao_somente_nova) on public.restaurantes from authenticated;
alter table public.restaurantes drop column if exists impressao_somente_nova;
alter table public.impressao_dispositivos drop column if exists largura_manual;
