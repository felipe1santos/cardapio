-- 0161 — Impressão definitiva (08/10, autorizado pelo dono): lojas SÓ no assistente novo e largura
-- automática.
-- restaurantes.impressao_somente_nova: a loja não volta mais para o assistente antigo — a tela não
--   oferece a escolha nem o link "Usar impressão antiga", o servidor recusa o modo 'teste' e o token
--   do assistente antigo, e o modo não recua sozinho para o antigo. Ligada só nas lojas combinadas
--   (Ponto 400, Villa, Menuzia) pelo script de publicação, nunca por padrão.
-- impressao_dispositivos.largura_manual: a largura do papel vem do driver (diagnóstico do assistente:
--   80 mm → 576 pontos, 58 mm → 384; sem informação, 80 mm). Ajuste no Avançado (suporte) liga a
--   marca e a detecção deixa de mexer naquela impressora.
-- Aditiva. Rollback: docs/rollback/0161_impressao_somente_nova_largura_auto.down.sql
alter table public.restaurantes add column if not exists impressao_somente_nova boolean not null default false;
grant select (impressao_somente_nova) on public.restaurantes to authenticated;
alter table public.impressao_dispositivos add column if not exists largura_manual boolean not null default false;
