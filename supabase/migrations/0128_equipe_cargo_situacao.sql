-- 0128 — Equipe repaginada (2026-10-01).
--
-- usuarios.cargo: rótulo do cargo escolhido na tela (gerente, caixa, garcom, cozinha,
--   motoboy, atendente, personalizado). Só aparência e modelo de permissões — quem decide
--   o que a pessoa pode continua sendo papel + acessos (lib/acessos.ts).
-- usuarios.situacao: POR QUE o acesso está cortado (pausado, bloqueado, excluido). O corte em
--   si continua sendo `desativado_em` — RLS (auth_restaurante_id, 0060) e middleware já
--   barram por ele; nada novo para dar errado.
--
-- Sensível nova "taxa" (aplicar/remover taxas na conta). Antes não havia caixa para isso:
-- quem já tinha acessos preenchidos E podia mexer em taxa (gerente, ou quem tem "desconto" —
-- a taxa da conta segue a permissão de desconto do papel) ganha "taxa" agora, para não
-- perder o que fazia ontem. Garçom/cozinha/logística não aplicavam taxa: ficam como estão.
--
-- Aditiva. Rollback: docs/rollback/0128_equipe_cargo_situacao.down.sql
alter table public.usuarios add column if not exists cargo text;
alter table public.usuarios add column if not exists situacao text;
alter table public.usuarios drop constraint if exists usuarios_cargo_check;
alter table public.usuarios add constraint usuarios_cargo_check
  check (cargo is null or cargo in ('dono', 'gerente', 'caixa', 'garcom', 'cozinha', 'motoboy', 'atendente', 'personalizado'));
alter table public.usuarios drop constraint if exists usuarios_situacao_check;
alter table public.usuarios add constraint usuarios_situacao_check
  check (situacao is null or situacao in ('pausado', 'bloqueado', 'excluido'));
comment on column public.usuarios.cargo is 'Cargo exibido na Equipe (0128). Nulo = deduzido do papel.';
comment on column public.usuarios.situacao is 'Motivo do corte de acesso (0128). Vale junto com desativado_em.';

update public.usuarios
   set acessos = jsonb_set(acessos, '{sensiveis}', coalesce(acessos->'sensiveis', '[]'::jsonb) || '["taxa"]'::jsonb)
 where acessos is not null
   and not coalesce(acessos->'sensiveis', '[]'::jsonb) ? 'taxa'
   and (papel = 'gerente' or coalesce(acessos->'sensiveis', '[]'::jsonb) ? 'desconto');
