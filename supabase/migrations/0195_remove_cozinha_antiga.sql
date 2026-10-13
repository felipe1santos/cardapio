-- 0195 (13/10/2026): remove a "Cozinha" antiga — estações por QR/link sem login (/cozinha/<token>, 0029). A tela da
-- cozinha agora é o KDS (/admin/kds), com o usuário da cozinha (Equipe › cargo Cozinha). Autorizado pelo Felipe: nenhuma
-- estação em uso (Ponto 400 e Estância inclusive).
-- Antes de apagar, uma cópia das estações SEM o token (os tokens morrem aqui) fica em backup.estacoes_0195, fora da API
-- (o esquema backup não é exposto pelo PostgREST), para o rollback em docs/rollback/0195_remove_cozinha_antiga.down.sql.
create schema if not exists backup;
revoke all on schema backup from public, anon, authenticated;
create table backup.estacoes_0195 as
  select id, restaurante_id, nome, modo, ativo, ultimo_visto_em, criado_em from public.estacoes;
drop table public.estacoes;
