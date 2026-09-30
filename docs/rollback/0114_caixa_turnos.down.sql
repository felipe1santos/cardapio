-- Rollback da 0114. Voltar o CÓDIGO antes. Os turnos são guardados em _backup antes de apagar.
create table if not exists public._backup_0114_caixa_turnos as select * from public.caixa_turnos;
drop index if exists public.pedidos_loja_entregue_em_idx;
drop index if exists public.fechamentos_caixa_turno_idx;
alter table public.fechamentos_caixa drop column if exists turno_id, drop column if exists registrado_por_nome, drop column if exists pedidos;
drop table if exists public.caixa_turnos;
