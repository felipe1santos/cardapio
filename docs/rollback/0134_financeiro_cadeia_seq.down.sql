-- Rollback da 0134 (rodar como dono do banco). Volta os gatilhos e a verificação da 0132 e tira a
-- coluna seq. ATENÇÃO: com a ordem por horário, a verificação pode voltar a acusar falso positivo
-- nos registros gravados na mesma transação.
begin;
create or replace function public.eventos_auditoria_encadear() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_ant text;
begin
  new.criado_em := now();
  perform pg_advisory_xact_lock(hashtextextended('eventos_auditoria:' || coalesce(new.restaurante_id::text, '-'), 0));
  select a.hash into v_ant from public.eventos_auditoria a
   where a.restaurante_id is not distinct from new.restaurante_id and a.hash is not null
   order by a.criado_em desc, a.id desc limit 1;
  new.hash_anterior := v_ant;
  new.hash := public.fin_sha256(coalesce(v_ant, '') || '|' || public.eventos_auditoria_conteudo(new));
  return new;
end $$;
create or replace function public.fin_lancamentos_antes_inserir() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_ant text;
begin
  new.criado_em := now();
  perform pg_advisory_xact_lock(hashtextextended('fin_lancamentos:' || new.restaurante_id::text, 0));
  select l.hash into v_ant from public.fin_lancamentos l where l.restaurante_id = new.restaurante_id order by l.id desc limit 1;
  new.hash_anterior := v_ant;
  new.hash := public.fin_sha256(concat_ws('|', coalesce(v_ant, ''), new.restaurante_id, new.grupo_id, new.linha, new.turno_id,
    new.carteira, new.entregador_id, new.tipo, new.valor_centavos, new.forma, new.origem, new.pedido_id, new.comanda_id,
    new.pagamento_id, new.referencia_id, new.motivo, new.usuario_id, new.usuario_nome, new.aprovacao_id,
    new.chave_idempotencia, to_char(new.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')));
  return new;
end $$;
drop index if exists public.eventos_auditoria_seq_uidx;
drop index if exists public.eventos_auditoria_loja_seq;
drop index if exists public.fin_lancamentos_seq_uidx;
drop index if exists public.fin_lancamentos_loja_seq;
alter table public.eventos_auditoria drop column if exists seq;
alter table public.fin_lancamentos drop column if exists seq;
drop sequence if exists public.eventos_auditoria_cadeia_seq;
drop sequence if exists public.fin_lancamentos_cadeia_seq;
-- Verificação da 0132 (ordem por horário).
create or replace function public.auditoria_verificar_cadeia(p_restaurante uuid)
returns table (tabela text, registro text, motivo text)
language plpgsql stable security definer set search_path = public as $$
declare r public.eventos_auditoria%rowtype; l public.fin_lancamentos%rowtype; v_ant text := null;
begin
  for r in select * from public.eventos_auditoria where restaurante_id = p_restaurante order by criado_em, id loop
    if r.hash_anterior is distinct from v_ant then
      tabela := 'eventos_auditoria'; registro := r.id::text; motivo := 'cadeia quebrada (registro removido ou fora de ordem)'; return next; return;
    end if;
    if r.hash <> public.fin_sha256(coalesce(v_ant, '') || '|' || public.eventos_auditoria_conteudo(r)) then
      tabela := 'eventos_auditoria'; registro := r.id::text; motivo := 'conteúdo alterado'; return next; return;
    end if;
    v_ant := r.hash;
  end loop;
  v_ant := null;
  for l in select * from public.fin_lancamentos where restaurante_id = p_restaurante order by id loop
    if l.hash_anterior is distinct from v_ant then
      tabela := 'fin_lancamentos'; registro := l.id::text; motivo := 'cadeia quebrada (lançamento removido ou fora de ordem)'; return next; return;
    end if;
    if l.hash <> public.fin_sha256(concat_ws('|', coalesce(v_ant, ''), l.restaurante_id, l.grupo_id, l.linha, l.turno_id,
      l.carteira, l.entregador_id, l.tipo, l.valor_centavos, l.forma, l.origem, l.pedido_id, l.comanda_id, l.pagamento_id,
      l.referencia_id, l.motivo, l.usuario_id, l.usuario_nome, l.aprovacao_id, l.chave_idempotencia,
      to_char(l.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'))) then
      tabela := 'fin_lancamentos'; registro := l.id::text; motivo := 'conteúdo alterado'; return next; return;
    end if;
    v_ant := l.hash;
  end loop;
end $$;
revoke execute on function public.auditoria_verificar_cadeia(uuid) from public, anon, authenticated;
grant execute on function public.auditoria_verificar_cadeia(uuid) to service_role;
-- Abertura automática como na 0115 (sem o aviso).
create or replace function public.caixa_turno_abre_na_entrega()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'entregue' and old.status is distinct from 'entregue' and new.entregador_id is not null then
    insert into public.caixa_turnos (restaurante_id, aberto_em, aberto_por_nome)
    values (new.restaurante_id, now(), 'Automático (1ª entrega)')
    on conflict (restaurante_id) where fechado_em is null do nothing;
  end if;
  return null;
end $$;

revoke execute on function public.caixa_turno_abre_na_entrega() from public, anon, authenticated;
do $$ begin
  if to_regclass('public.schema_migrations') is not null then
    delete from public.schema_migrations where name = '0134_financeiro_cadeia_seq.sql';
  end if;
end $$;
commit;
