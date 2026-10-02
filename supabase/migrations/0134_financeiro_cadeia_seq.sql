-- 0134 — Corrente de assinaturas (auditoria e livro-caixa) em ordem de gravação.
--
-- Defeito achado no teste integrado: a 0132 ordenava a corrente da auditoria por `criado_em`, que é
-- now() — o horário do INÍCIO da transação. Dois eventos na mesma transação ficam com o mesmo
-- horário (desempate pelo id, aleatório) e duas transações simultâneas podem gravar "fora de ordem".
-- A verificação então acusava adulteração que não houve. O livro-caixa tinha o mesmo risco com
-- transações simultâneas (o id sai antes da trava).
--
-- Correção: cada registro ganha `seq`, tirado de uma sequência DEPOIS da trava da loja — é a ordem
-- real de gravação. O anterior é o de maior `seq` da loja; a verificação percorre por `seq`.
-- Os registros que já existem são re-selados nessa ordem (dono do banco, uma vez).
-- Rollback: docs/rollback/0134_financeiro_cadeia_seq.down.sql

create sequence if not exists public.eventos_auditoria_cadeia_seq;
create sequence if not exists public.fin_lancamentos_cadeia_seq;
alter table public.eventos_auditoria add column if not exists seq bigint;
alter table public.fin_lancamentos add column if not exists seq bigint;

-- ── re-selagem do que já existe (ordem: horário, id — a mesma da verificação antiga) ──────────
do $$
declare r public.eventos_auditoria%rowtype; l public.fin_lancamentos%rowtype; v_ant text; v_loja uuid; v_primeira boolean := true; v_hash text;
begin
  for r in select * from public.eventos_auditoria order by restaurante_id nulls first, criado_em, id loop
    if v_primeira or r.restaurante_id is distinct from v_loja then
      v_loja := r.restaurante_id; v_primeira := false; v_ant := null;
    end if;
    v_hash := public.fin_sha256(coalesce(v_ant, '') || '|' || public.eventos_auditoria_conteudo(r));
    update public.eventos_auditoria set seq = nextval('public.eventos_auditoria_cadeia_seq'), hash_anterior = v_ant, hash = v_hash where id = r.id;
    v_ant := v_hash;
  end loop;
  v_primeira := true;
  for l in select * from public.fin_lancamentos order by restaurante_id, id loop
    if v_primeira or l.restaurante_id is distinct from v_loja then
      v_loja := l.restaurante_id; v_primeira := false; v_ant := null;
    end if;
    v_hash := public.fin_sha256(concat_ws('|', coalesce(v_ant, ''), l.restaurante_id, l.grupo_id, l.linha, l.turno_id,
      l.carteira, l.entregador_id, l.tipo, l.valor_centavos, l.forma, l.origem, l.pedido_id, l.comanda_id,
      l.pagamento_id, l.referencia_id, l.motivo, l.usuario_id, l.usuario_nome, l.aprovacao_id,
      l.chave_idempotencia, to_char(l.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')));
    update public.fin_lancamentos set seq = nextval('public.fin_lancamentos_cadeia_seq'), hash_anterior = v_ant, hash = v_hash where id = l.id;
    v_ant := v_hash;
  end loop;
end $$;

alter table public.eventos_auditoria alter column seq set not null;
alter table public.fin_lancamentos alter column seq set not null;
create unique index if not exists eventos_auditoria_seq_uidx on public.eventos_auditoria (seq);
create index if not exists eventos_auditoria_loja_seq on public.eventos_auditoria (restaurante_id, seq desc);
create unique index if not exists fin_lancamentos_seq_uidx on public.fin_lancamentos (seq);
create index if not exists fin_lancamentos_loja_seq on public.fin_lancamentos (restaurante_id, seq desc);

-- ── gatilhos: seq e anterior tirados DEPOIS da trava ─────────────────────────────────────────
create or replace function public.eventos_auditoria_encadear() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_ant text;
begin
  new.criado_em := now();
  perform pg_advisory_xact_lock(hashtextextended('eventos_auditoria:' || coalesce(new.restaurante_id::text, '-'), 0));
  new.seq := nextval('public.eventos_auditoria_cadeia_seq');
  select a.hash into v_ant from public.eventos_auditoria a
   where a.restaurante_id is not distinct from new.restaurante_id order by a.seq desc limit 1;
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
  new.seq := nextval('public.fin_lancamentos_cadeia_seq');
  select l.hash into v_ant from public.fin_lancamentos l where l.restaurante_id = new.restaurante_id order by l.seq desc limit 1;
  new.hash_anterior := v_ant;
  new.hash := public.fin_sha256(concat_ws('|', coalesce(v_ant, ''), new.restaurante_id, new.grupo_id, new.linha, new.turno_id,
    new.carteira, new.entregador_id, new.tipo, new.valor_centavos, new.forma, new.origem, new.pedido_id, new.comanda_id,
    new.pagamento_id, new.referencia_id, new.motivo, new.usuario_id, new.usuario_nome, new.aprovacao_id,
    new.chave_idempotencia, to_char(new.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')));
  return new;
end $$;

-- A seq faz parte da ordem: mudá-la também é adulteração (o gatilho de imutabilidade já recusa).
create or replace function public.auditoria_verificar_cadeia(p_restaurante uuid)
returns table (tabela text, registro text, motivo text)
language plpgsql stable security definer set search_path = public as $$
declare r public.eventos_auditoria%rowtype; l public.fin_lancamentos%rowtype; v_ant text := null;
begin
  for r in select * from public.eventos_auditoria where restaurante_id = p_restaurante order by seq loop
    if r.hash_anterior is distinct from v_ant then
      tabela := 'eventos_auditoria'; registro := r.id::text; motivo := 'cadeia quebrada (registro removido ou fora de ordem)'; return next; return;
    end if;
    if r.hash <> public.fin_sha256(coalesce(v_ant, '') || '|' || public.eventos_auditoria_conteudo(r)) then
      tabela := 'eventos_auditoria'; registro := r.id::text; motivo := 'conteúdo alterado'; return next; return;
    end if;
    v_ant := r.hash;
  end loop;
  v_ant := null;
  for l in select * from public.fin_lancamentos where restaurante_id = p_restaurante order by seq loop
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

-- ── Caixa aberto sozinho pela 1ª entrega (0115) ─────────────────────────────────────────────
-- Continua abrindo (sem isso o dinheiro do motoboy ficaria fora de qualquer turno), mas com o
-- financeiro ligado o dono é avisado: é um caixa sem responsável e sem fundo de troco.
create or replace function public.caixa_turno_abre_na_entrega()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_turno uuid;
begin
  if new.status = 'entregue' and old.status is distinct from 'entregue' and new.entregador_id is not null then
    insert into public.caixa_turnos (restaurante_id, aberto_em, aberto_por_nome)
    values (new.restaurante_id, now(), 'Automático (1ª entrega)')
    on conflict (restaurante_id) where fechado_em is null do nothing
    returning id into v_turno;
    if v_turno is not null and exists (select 1 from public.restaurantes r where r.id = new.restaurante_id and r.financeiro_ativo) then
      insert into public.fin_alertas (restaurante_id, tipo, gravidade, mensagem, dados)
      values (new.restaurante_id, 'caixa_aberto_automatico', 'atencao',
        'O caixa estava fechado e foi aberto sozinho pela 1ª entrega do delivery, sem fundo de troco e sem responsável. Confira o caixa e registre o fundo (Reforço) se houver troco na gaveta.',
        jsonb_build_object('turno', v_turno, 'pedido', new.id));
    end if;
  end if;
  return null;
end $$;
revoke execute on function public.caixa_turno_abre_na_entrega() from public, anon, authenticated;
