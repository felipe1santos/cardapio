-- 0133 — Financeiro Fase 2: Caixa.
--
-- Evolui `caixa_turnos` (0114) em vez de criar outro caixa:
--   1. colunas do turno: fundo de troco, status, contagem cega, esperado, diferença, pendências,
--      aprovação/justificativa da divergência, reabertura (só dono), aparelho de abertura/fechamento;
--   2. turno FECHADO é imutável — só a reabertura pelo dono (motivo obrigatório) muda a linha;
--   3. o livro-caixa (fin_lancamentos) não aceita lançamento em turno fechado;
--   4. com o financeiro ligado (restaurantes.financeiro_ativo), todo pagamento presencial
--      (pagamentos_comanda) vira lançamento no livro-caixa NA MESMA TRANSAÇÃO, e sem caixa aberto
--      o pagamento é recusado ('caixa_fechado'); o estorno vira lançamento de estorno.
--      Sem a flag, nada muda: os gatilhos saem na primeira linha.
--
-- Valores em centavos (bigint). Datas do servidor.
-- Rollback: docs/rollback/0133_financeiro_caixa.down.sql

-- ── 1. Turno ────────────────────────────────────────────────────────────────
alter table public.caixa_turnos
  add column if not exists status text not null default 'aberto',
  add column if not exists valor_inicial_centavos bigint not null default 0,
  add column if not exists contado_dinheiro_centavos bigint,
  add column if not exists contado_cartao_centavos bigint,
  add column if not exists esperado_dinheiro_centavos bigint,
  add column if not exists esperado_cartao_centavos bigint,
  add column if not exists diferenca_centavos bigint,
  add column if not exists diferenca_cartao_centavos bigint,
  add column if not exists pendencias jsonb,
  add column if not exists resumo jsonb,
  add column if not exists justificativa text,
  add column if not exists fechamento_aprovacao_id uuid references public.fin_aprovacoes(id) on delete restrict,
  add column if not exists fechamento_aprovado_por_nome text,
  add column if not exists dispositivo_abertura text,
  add column if not exists dispositivo_fechamento text,
  add column if not exists reaberto_por uuid,
  add column if not exists reaberto_por_nome text,
  add column if not exists reaberto_em timestamptz,
  add column if not exists reaberto_motivo text;

-- Turnos antigos já fechados ficam com status 'fechado'.
update public.caixa_turnos set status = 'fechado' where fechado_em is not null and status = 'aberto';

alter table public.caixa_turnos drop constraint if exists caixa_turnos_status_check;
alter table public.caixa_turnos add constraint caixa_turnos_status_check
  check (status in ('aberto', 'fechado', 'reaberto'));
alter table public.caixa_turnos drop constraint if exists caixa_turnos_status_coerente;
alter table public.caixa_turnos add constraint caixa_turnos_status_coerente
  check ((status = 'fechado') = (fechado_em is not null));
alter table public.caixa_turnos drop constraint if exists caixa_turnos_fundo_check;
alter table public.caixa_turnos add constraint caixa_turnos_fundo_check check (valor_inicial_centavos >= 0);
alter table public.caixa_turnos drop constraint if exists caixa_turnos_textos_check;
alter table public.caixa_turnos add constraint caixa_turnos_textos_check check (
  (justificativa is null or length(justificativa) <= 500) and (reaberto_motivo is null or length(reaberto_motivo) <= 500)
  and (dispositivo_abertura is null or length(dispositivo_abertura) <= 200) and (dispositivo_fechamento is null or length(dispositivo_fechamento) <= 200));

-- Turno fechado não muda. A única saída é a reabertura (status → 'reaberto', fechado_em → nulo,
-- com quem/quando/motivo), feita pelo servidor só para o dono. O dono do banco passa (manutenção).
create or replace function public.caixa_turno_fechado_imutavel() returns trigger
  language plpgsql set search_path = public as $$
begin
  -- Turno que já nasce fechado (importação, dado antigo): status acompanha.
  if tg_op = 'INSERT' then
    if new.fechado_em is not null and new.status = 'aberto' then new.status := 'fechado'; end if;
    return new;
  end if;
  if public.fin_manutencao() then
    if tg_op = 'UPDATE' and old.fechado_em is null and new.fechado_em is not null and new.status = 'aberto' then new.status := 'fechado'; end if;
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.fechado_em is not null or exists (select 1 from public.fin_lancamentos l where l.turno_id = old.id) then
      raise exception 'turno_imutavel' using errcode = '42501';
    end if;
    return old;
  end if;
  -- Turno aberto: livre (o fechamento antigo, das lojas sem a flag, só grava fechado_em — o
  -- status acompanha sozinho).
  if old.fechado_em is null then
    if new.fechado_em is not null then new.status := 'fechado'; end if;
    return new;
  end if;
  if new.fechado_em is null and new.status = 'reaberto' and new.reaberto_em is not null and new.reaberto_por is not null
     and coalesce(length(trim(new.reaberto_motivo)), 0) >= 3
     and new.restaurante_id = old.restaurante_id and new.aberto_em = old.aberto_em
     and new.valor_inicial_centavos = old.valor_inicial_centavos then
    return new;
  end if;
  raise exception 'turno_imutavel' using errcode = '42501';
end $$;
drop trigger if exists caixa_turno_fechado_imutavel on public.caixa_turnos;
create trigger caixa_turno_fechado_imutavel before insert or update or delete on public.caixa_turnos
  for each row execute function public.caixa_turno_fechado_imutavel();

-- ── 2. Livro-caixa não aceita lançamento em turno fechado ───────────────────
create or replace function public.fin_lancamento_turno_aberto() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.turno_id is null then return new; end if;
  if not exists (select 1 from public.caixa_turnos t where t.id = new.turno_id and t.restaurante_id = new.restaurante_id and t.fechado_em is null) then
    raise exception 'caixa_fechado' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists a_fin_lancamento_turno_aberto on public.fin_lancamentos;
create trigger a_fin_lancamento_turno_aberto before insert on public.fin_lancamentos
  for each row execute function public.fin_lancamento_turno_aberto();

-- ── 3. Pagamento presencial → livro-caixa (só com a flag) ───────────────────
create or replace function public.fin_carteira_da_forma(p_forma text) returns text
  language sql immutable as $$
  select case p_forma
    when 'dinheiro' then 'gaveta'
    when 'pix' then 'pix_conferir'
    when 'credito' then 'cartao'
    when 'debito' then 'cartao'
    else 'a_receber' end
$$;

create or replace function public.fin_pagamento_no_caixa() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_turno uuid;
  v_orig public.fin_lancamentos%rowtype;
  v_centavos bigint;
begin
  if not exists (select 1 from public.restaurantes r where r.id = new.restaurante_id and r.financeiro_ativo) then
    return new;
  end if;
  select id into v_turno from public.caixa_turnos
   where restaurante_id = new.restaurante_id and fechado_em is null limit 1;

  if tg_op = 'INSERT' then
    if v_turno is null then raise exception 'caixa_fechado' using errcode = 'P0001'; end if;
    v_centavos := round(new.valor * 100)::bigint;
    if v_centavos <= 0 then return new; end if;
    insert into public.fin_lancamentos (restaurante_id, grupo_id, linha, turno_id, carteira, tipo, valor_centavos, forma, origem,
      comanda_id, pagamento_id, usuario_id, usuario_nome, chave_idempotencia, dados)
    values (new.restaurante_id, gen_random_uuid(), 1, v_turno, public.fin_carteira_da_forma(new.forma), 'recebimento', v_centavos, new.forma,
      case when new.canal = 'balcao' then 'balcao' else 'mesa' end,
      new.comanda_id, new.id, new.criado_por, coalesce(nullif(trim(new.criado_por_nome), ''), 'Sistema'), 'pag:' || new.id,
      jsonb_build_object('recebido_centavos', round(coalesce(new.valor_recebido, new.valor) * 100)::bigint,
                         'troco_centavos', round(coalesce(new.troco, 0) * 100)::bigint, 'origem_tela', new.origem));
    return new;
  end if;

  -- UPDATE: estorno (estornado_em passou a ter valor).
  if old.estornado_em is null and new.estornado_em is not null then
    select * into v_orig from public.fin_lancamentos
     where restaurante_id = new.restaurante_id and pagamento_id = new.id and tipo = 'recebimento' order by id limit 1;
    if v_orig.id is null then return new; end if;   -- pagamento anterior ao financeiro: nada a estornar no livro
    if v_turno is null then raise exception 'caixa_fechado' using errcode = 'P0001'; end if;
    insert into public.fin_lancamentos (restaurante_id, grupo_id, linha, turno_id, carteira, tipo, valor_centavos, forma, origem,
      comanda_id, pagamento_id, referencia_id, motivo, usuario_id, usuario_nome, chave_idempotencia)
    values (new.restaurante_id, gen_random_uuid(), 1, v_turno, v_orig.carteira, 'estorno', -v_orig.valor_centavos, v_orig.forma, v_orig.origem,
      new.comanda_id, new.id, v_orig.id, left(new.estorno_motivo, 500), null,
      coalesce(nullif(trim(new.estornado_por_nome), ''), 'Sistema'), 'estorno:' || new.id);
  end if;
  return new;
end $$;
drop trigger if exists fin_pagamento_no_caixa on public.pagamentos_comanda;
create trigger fin_pagamento_no_caixa after insert or update of estornado_em on public.pagamentos_comanda
  for each row execute function public.fin_pagamento_no_caixa();
