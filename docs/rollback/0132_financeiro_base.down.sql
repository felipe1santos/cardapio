-- Rollback da 0132 (rodar como dono do banco — as travas de imutabilidade deixam passar só ele).
-- ATENÇÃO: perde o livro-caixa, aprovações, alertas e sessões gravados depois dela. Exporte antes se houver dados.
begin;
drop trigger if exists solicitacoes_cancelamento_sem_autoaprovacao on public.solicitacoes_cancelamento;
drop function if exists public.cancelamento_sem_autoaprovacao();
drop trigger if exists pedidos_entregador_protegido on public.pedidos;
drop function if exists public.pedidos_entregador_protegido();
grant insert, update, delete on public.cupom_usos to authenticated;
alter table public.fechamentos_caixa drop constraint if exists fechamentos_caixa_entregador_id_fkey;
alter table public.fechamentos_caixa add constraint fechamentos_caixa_entregador_id_fkey
  foreign key (entregador_id) references public.entregadores(id) on delete cascade;
grant delete on public.entregadores to authenticated;
grant insert, update, delete on public.fechamentos_caixa to authenticated;

drop table if exists public.usuarios_sessoes;
drop function if exists public.usuario_verificar_pin(uuid, uuid, text);
drop function if exists public.usuario_definir_pin(uuid, text);
alter table public.usuarios drop column if exists pin_definido_em;
alter table public.usuarios drop column if exists pin_bloqueado_ate;
alter table public.usuarios drop column if exists pin_falhas;
alter table public.usuarios drop column if exists pin_hash;

drop function if exists public.auditoria_verificar_cadeia(uuid);
drop trigger if exists eventos_auditoria_sem_truncate on public.eventos_auditoria;
drop trigger if exists eventos_auditoria_imutavel on public.eventos_auditoria;
drop function if exists public.eventos_auditoria_imutavel();
drop trigger if exists z_eventos_auditoria_encadear on public.eventos_auditoria;
drop function if exists public.eventos_auditoria_encadear();
drop function if exists public.eventos_auditoria_conteudo(public.eventos_auditoria);
alter table public.eventos_auditoria drop column if exists hash;
alter table public.eventos_auditoria drop column if exists hash_anterior;

drop table if exists public.fin_alertas;
drop table if exists public.fin_aprovacoes;
drop table if exists public.fin_lancamentos;
drop function if exists public.fin_lancamentos_antes_inserir();
drop function if exists public.fin_imutavel();
drop function if exists public.fin_sha256(text);
drop table if exists public.fin_config;
drop function if exists public.fin_manutencao();
alter table public.restaurantes drop column if exists financeiro_ativo;
commit;
