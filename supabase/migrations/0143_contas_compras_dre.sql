-- 0143 — Financeiro Fase 5b: contas a pagar/receber, fornecedores, plano de contas, compras de insumos e DRE.
--
-- Tabelas só do servidor (RLS ligada SEM políticas; as rotas conferem "ver contas", "lançar", "marcar como pago"
-- e "ver DRE"). Valores em CENTAVOS. Nada se apaga: conta e compra só se cancelam (auditado); pagamento só se
-- estorna (lançamento oposto no livro-caixa, ligado ao original).
--
--   fin_fornecedores     cadastro reutilizável
--   fin_categorias       plano de contas simples e editável. grupo:
--                          despesa  → entra no DRE como despesa operacional
--                          insumo   → compra de insumo/embalagem: NÃO entra como despesa no DRE (já está no CMV)
--                          receita  → outras receitas (repasse de marketplace, venda avulsa)
--                          fora     → movimento de capital (aporte do sócio): fora do DRE
--   fin_contas           conta a pagar / a receber (status a_pagar → pago | cancelado; pago → a_pagar só por estorno)
--   fin_compras / fin_compra_itens   nota de compra de insumos (atualiza o custo do insumo; guarda quantidades
--                          para o estoque futuro, sem controlar estoque agora)
--
-- Carteiras do livro-caixa usadas: GAVETA (dinheiro do caixa do turno, exige caixa aberto) e EMPRESA (conta,
-- cartão da empresa, boletos). A contrapartida de despesa/receita vai para RESULTADO (base do DRE).
-- Rollback: docs/rollback/0143_contas_compras_dre.down.sql

-- ── fornecedores ───────────────────────────────────────────────────────────────────────────────
create table if not exists public.fin_fornecedores (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete restrict,
  nome text not null check (length(btrim(nome)) between 2 and 100),
  documento text check (documento is null or length(documento) <= 20),
  telefone text check (telefone is null or length(telefone) <= 20),
  observacao text check (observacao is null or length(observacao) <= 300),
  ativo boolean not null default true,
  criado_por_nome text,
  criado_em timestamptz not null default now()
);
create unique index if not exists fin_fornecedores_nome_uidx on public.fin_fornecedores (restaurante_id, public.cmv_chave(nome));

-- ── plano de contas ────────────────────────────────────────────────────────────────────────────
create table if not exists public.fin_categorias (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete restrict,
  nome text not null check (length(btrim(nome)) between 2 and 60),
  tipo text not null check (tipo in ('pagar', 'receber')),
  grupo text not null check (grupo in ('despesa', 'insumo', 'receita', 'fora')),
  padrao boolean not null default false,
  ativo boolean not null default true,
  ordem integer not null default 100,
  criado_em timestamptz not null default now()
);
create unique index if not exists fin_categorias_nome_uidx on public.fin_categorias (restaurante_id, tipo, public.cmv_chave(nome));

-- Padrões (idempotente): chamado pelo servidor na primeira vez que a loja abre Contas.
create or replace function public.fin_categorias_garantir(p_restaurante uuid) returns void
  language sql security definer set search_path = public as $$
  insert into public.fin_categorias (restaurante_id, nome, tipo, grupo, padrao, ordem)
  select p_restaurante, c.nome, c.tipo, c.grupo, true, c.ordem
    from (values
      ('Insumos', 'pagar', 'insumo', 10), ('Embalagens', 'pagar', 'insumo', 20), ('Pessoal', 'pagar', 'despesa', 30),
      ('Aluguel', 'pagar', 'despesa', 40), ('Contas de consumo', 'pagar', 'despesa', 50), ('Marketing', 'pagar', 'despesa', 60),
      ('Taxas e impostos', 'pagar', 'despesa', 70), ('Manutenção', 'pagar', 'despesa', 80), ('Outros', 'pagar', 'despesa', 90),
      ('Repasse de marketplace (iFood)', 'receber', 'receita', 10), ('Venda avulsa (fora do sistema)', 'receber', 'receita', 20),
      ('Outras receitas', 'receber', 'receita', 30), ('Aporte do sócio', 'receber', 'fora', 40)
    ) as c(nome, tipo, grupo, ordem)
  on conflict do nothing
$$;
revoke execute on function public.fin_categorias_garantir(uuid) from public, anon, authenticated;

-- ── contas a pagar / a receber ─────────────────────────────────────────────────────────────────
create table if not exists public.fin_contas (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete restrict,
  tipo text not null check (tipo in ('pagar', 'receber')),
  descricao text not null check (length(btrim(descricao)) between 3 and 200),
  fornecedor_id uuid references public.fin_fornecedores(id) on delete restrict,
  categoria_id uuid not null references public.fin_categorias(id) on delete restrict,
  valor_centavos bigint not null check (valor_centavos > 0 and valor_centavos <= 1000000000),
  vencimento date not null,
  forma_prevista text check (forma_prevista is null or forma_prevista in ('dinheiro', 'pix', 'boleto', 'transferencia', 'cartao', 'debito_automatico', 'outro')),
  observacao text check (observacao is null or length(observacao) <= 500),
  anexo_path text check (anexo_path is null or length(anexo_path) <= 300),
  anexo_nome text check (anexo_nome is null or length(anexo_nome) <= 120),
  -- Recorrência: a 1ª conta é a raiz da série (serie_id = id); as próximas são geradas pelo servidor
  -- (único por série + vencimento, então gerar de novo não duplica).
  recorrencia text not null default 'nenhuma' check (recorrencia in ('nenhuma', 'mensal', 'semanal')),
  serie_id uuid,
  recorrencia_encerrada_em timestamptz,
  origem text not null default 'manual' check (origem in ('manual', 'recorrencia', 'compra')),
  compra_id uuid,
  status text not null default 'a_pagar' check (status in ('a_pagar', 'pago', 'cancelado')),
  pago_em timestamptz,
  pago_carteira text check (pago_carteira is null or pago_carteira in ('gaveta', 'empresa')),
  pago_forma text,
  pago_por_nome text,
  pago_grupo_id uuid,
  pago_aprovado_por_nome text,
  cancelado_em timestamptz,
  cancelado_por_nome text,
  cancelado_motivo text check (cancelado_motivo is null or length(cancelado_motivo) <= 300),
  criado_por uuid,
  criado_por_nome text not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  chave_idempotencia text not null check (length(chave_idempotencia) between 8 and 120)
);
create unique index if not exists fin_contas_idem on public.fin_contas (restaurante_id, chave_idempotencia);
create unique index if not exists fin_contas_serie_venc on public.fin_contas (serie_id, vencimento) where serie_id is not null;
create index if not exists fin_contas_venc on public.fin_contas (restaurante_id, status, vencimento);

-- Nada se apaga; depois de paga ou cancelada, os campos de dinheiro congelam. Volta de "pago" para "a pagar" só
-- com o estorno (o servidor grava o lançamento oposto antes).
create or replace function public.fin_contas_guardar() returns trigger language plpgsql as $$
begin
  if public.fin_manutencao() then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    raise exception 'registro_imutavel: conta não se apaga; cancele' using errcode = '42501';
  end if;
  if new.restaurante_id <> old.restaurante_id or new.tipo <> old.tipo or new.criado_em <> old.criado_em
     or new.criado_por_nome <> old.criado_por_nome or new.chave_idempotencia <> old.chave_idempotencia then
    raise exception 'registro_imutavel: campo fixo da conta' using errcode = '42501';
  end if;
  if old.status = 'cancelado' and (new.status <> 'cancelado' or new.valor_centavos <> old.valor_centavos) then
    raise exception 'registro_imutavel: conta cancelada' using errcode = '42501';
  end if;
  if old.status = 'pago' and new.status = 'cancelado' then
    raise exception 'conta_paga: estorne o pagamento antes de cancelar' using errcode = '42501';
  end if;
  if old.status <> 'a_pagar' and (new.valor_centavos <> old.valor_centavos or new.vencimento <> old.vencimento
     or new.categoria_id <> old.categoria_id or new.descricao <> old.descricao or new.fornecedor_id is distinct from old.fornecedor_id) then
    raise exception 'registro_imutavel: conta paga ou cancelada não muda de valor' using errcode = '42501';
  end if;
  new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists fin_contas_guardar on public.fin_contas;
create trigger fin_contas_guardar before update or delete on public.fin_contas
  for each row execute function public.fin_contas_guardar();
drop trigger if exists fin_contas_sem_truncate on public.fin_contas;
create trigger fin_contas_sem_truncate before truncate on public.fin_contas
  for each statement execute function public.fin_imutavel();

-- ── compras de insumos ─────────────────────────────────────────────────────────────────────────
create table if not exists public.fin_compras (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete restrict,
  fornecedor_id uuid references public.fin_fornecedores(id) on delete restrict,
  numero_nota text check (numero_nota is null or length(numero_nota) <= 40),
  data_compra date not null,
  total_centavos bigint not null check (total_centavos > 0 and total_centavos <= 1000000000),
  pagamento text not null check (pagamento in ('a_prazo', 'caixa', 'empresa')),
  conta_id uuid references public.fin_contas(id) on delete restrict,
  grupo_id uuid,
  observacao text check (observacao is null or length(observacao) <= 500),
  status text not null default 'ativa' check (status in ('ativa', 'cancelada')),
  cancelado_em timestamptz,
  cancelado_por_nome text,
  cancelado_motivo text,
  criado_por uuid,
  criado_por_nome text not null,
  criado_em timestamptz not null default now(),
  chave_idempotencia text not null check (length(chave_idempotencia) between 8 and 120)
);
create unique index if not exists fin_compras_idem on public.fin_compras (restaurante_id, chave_idempotencia);
alter table public.fin_contas drop constraint if exists fin_contas_compra_fk;
alter table public.fin_contas add constraint fin_contas_compra_fk foreign key (compra_id) references public.fin_compras(id) on delete restrict;

create table if not exists public.fin_compra_itens (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null references public.fin_compras(id) on delete restrict,
  restaurante_id uuid not null references public.restaurantes(id) on delete restrict,
  insumo_id uuid not null references public.cmv_insumos(id) on delete restrict,
  -- Quantidade na unidade informada (a de compra do insumo ou a base) e convertida para a unidade base
  -- (é o que o estoque futuro vai somar).
  quantidade numeric(14,4) not null check (quantidade > 0),
  unidade text not null check (length(unidade) between 1 and 12),
  quantidade_base numeric(18,4) not null check (quantidade_base > 0),
  valor_centavos bigint not null check (valor_centavos > 0 and valor_centavos <= 1000000000),
  custo_anterior_centavos bigint,
  custo_novo_centavos bigint not null,
  criado_em timestamptz not null default now()
);
create index if not exists fin_compra_itens_compra on public.fin_compra_itens (compra_id);
create index if not exists fin_compra_itens_insumo on public.fin_compra_itens (restaurante_id, insumo_id);

create or replace function public.fin_compras_guardar() returns trigger language plpgsql as $$
begin
  if public.fin_manutencao() then return coalesce(new, old); end if;
  if tg_table_name = 'fin_compra_itens' or tg_op = 'DELETE' then
    raise exception 'registro_imutavel: compra não se apaga nem se altera; cancele' using errcode = '42501';
  end if;
  -- fin_compras: só a passagem ativa → cancelada (e o vínculo com a conta gerada).
  if new.total_centavos <> old.total_centavos or new.restaurante_id <> old.restaurante_id or new.pagamento <> old.pagamento
     or new.data_compra <> old.data_compra or old.status = 'cancelada' then
    raise exception 'registro_imutavel: compra só pode ser cancelada' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists fin_compras_guardar on public.fin_compras;
create trigger fin_compras_guardar before update or delete on public.fin_compras
  for each row execute function public.fin_compras_guardar();
drop trigger if exists fin_compra_itens_guardar on public.fin_compra_itens;
create trigger fin_compra_itens_guardar before update or delete on public.fin_compra_itens
  for each row execute function public.fin_compras_guardar();
drop trigger if exists fin_compras_sem_truncate on public.fin_compras;
create trigger fin_compras_sem_truncate before truncate on public.fin_compras for each statement execute function public.fin_imutavel();
drop trigger if exists fin_compra_itens_sem_truncate on public.fin_compra_itens;
create trigger fin_compra_itens_sem_truncate before truncate on public.fin_compra_itens for each statement execute function public.fin_imutavel();

-- ── configuração: limite de pagamento pela conta da empresa (acima: PIN de outra pessoa) ─────────
alter table public.fin_config add column if not exists limite_conta_centavos bigint not null default 30000
  check (limite_conta_centavos >= 0);

-- ── segurança ──────────────────────────────────────────────────────────────────────────────────
alter table public.fin_fornecedores enable row level security;
alter table public.fin_categorias enable row level security;
alter table public.fin_contas enable row level security;
alter table public.fin_compras enable row level security;
alter table public.fin_compra_itens enable row level security;
revoke all on public.fin_fornecedores, public.fin_categorias, public.fin_contas, public.fin_compras, public.fin_compra_itens
  from anon, authenticated;

-- Anexos (boleto, nota): bucket PRIVADO, sem políticas — só o servidor lê/grava; a tela recebe link assinado curto.
insert into storage.buckets (id, name, public) values ('financeiro-anexos', 'financeiro-anexos', false)
on conflict (id) do nothing;

-- ── DRE: resultado do período a partir do livro-caixa ──────────────────────────────────────────
-- Faturamento = recebimentos (+ troco devolvido, − estornos) fora das contrapartidas (mesma regra do Fluxo de
-- Caixa), por DATA da linha (fuso de São Paulo). Resultado = linhas da carteira RESULTADO (despesas, perdas,
-- diferenças de caixa, contas pagas/recebidas), por categoria.
create or replace function public.fin_dre_periodo(p_restaurante uuid, p_de date, p_ate date)
  returns table (chave text, tipo text, categoria_id uuid, valor_centavos bigint, linhas integer)
  language sql stable security definer set search_path = public as $$
  with lim as (
    select (p_de::timestamp at time zone 'America/Sao_Paulo') ini, ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo') fim
  ), l as (
    select x.* from public.fin_lancamentos x, lim
     where x.restaurante_id = p_restaurante and x.criado_em >= lim.ini and x.criado_em < lim.fim
  )
  select 'faturamento', null::text, null::uuid, coalesce(sum(valor_centavos), 0)::bigint, count(*)::int
    from l where tipo in ('recebimento', 'troco', 'estorno') and carteira not in ('empresa', 'resultado')
  union all
  select 'resultado', l.tipo, nullif(l.dados->>'categoria_id', '')::uuid, sum(l.valor_centavos)::bigint, count(*)::int
    from l where l.carteira = 'resultado'
   group by l.tipo, nullif(l.dados->>'categoria_id', '')
$$;
revoke execute on function public.fin_dre_periodo(uuid, date, date) from public, anon, authenticated;

-- ── permissões novas ───────────────────────────────────────────────────────────────────────────
-- "contas_pagar" passa a ser VER contas; lançar e marcar como pago ganham chaves próprias. Gerente de verdade
-- (cargo gerente) com acessos personalizados que já tinha "contas_pagar" ganha as duas (mantém o que fazia).
update public.usuarios u
   set acessos = jsonb_set(u.acessos, '{sensiveis}', coalesce(u.acessos->'sensiveis', '[]'::jsonb) || '["contas_lancar", "contas_marcar_pago"]'::jsonb)
  from public.restaurantes r
 where r.id = u.restaurante_id and r.financeiro_ativo and u.papel = 'gerente' and u.cargo = 'gerente' and u.acessos is not null
   and coalesce(u.acessos->'sensiveis', '[]'::jsonb) ? 'contas_pagar'
   and not coalesce(u.acessos->'sensiveis', '[]'::jsonb) ?| array['contas_lancar', 'contas_marcar_pago'];

-- ── gravações atômicas (tudo ou nada) ──────────────────────────────────────────────────────────
-- O servidor valida, confere permissão/aprovação e CALCULA (linhas do livro-caixa, custo novo); estas funções
-- gravam tudo numa transação só. Falha em qualquer passo desfaz o resto. Repetir a mesma chave não duplica.

-- Um grupo de linhas do livro-caixa (idempotente pela chave da loja).
create or replace function public.fin_lancar_grupo(p_restaurante uuid, p_turno uuid, p_chave text, p_origem text, p_usuario uuid, p_usuario_nome text,
  p_motivo text, p_aprovacao uuid, p_aprovado_por text, p_dispositivo text, p_linhas jsonb) returns uuid
  language plpgsql security definer set search_path = public as $$
declare v_grupo uuid; v_i int := 0; l jsonb;
begin
  select grupo_id into v_grupo from public.fin_lancamentos where restaurante_id = p_restaurante and chave_idempotencia = p_chave limit 1;
  if v_grupo is not null then return v_grupo; end if;
  v_grupo := gen_random_uuid();
  for l in select * from jsonb_array_elements(p_linhas) loop
    v_i := v_i + 1;
    insert into public.fin_lancamentos (restaurante_id, grupo_id, linha, turno_id, carteira, entregador_id, tipo, valor_centavos, forma, origem, pedido_id,
      comanda_id, pagamento_id, referencia_id, motivo, usuario_id, usuario_nome, aprovacao_id, aprovado_por_nome, chave_idempotencia, dispositivo, dados)
    values (p_restaurante, v_grupo, v_i, case when l->>'carteira' = 'gaveta' then p_turno else nullif(l->>'turno_id', '')::uuid end,
      l->>'carteira', nullif(l->>'entregador_id', '')::uuid, l->>'tipo', (l->>'valor_centavos')::bigint, nullif(l->>'forma', ''), p_origem,
      nullif(l->>'pedido_id', '')::uuid, nullif(l->>'comanda_id', '')::uuid, nullif(l->>'pagamento_id', '')::uuid, nullif(l->>'referencia_id', '')::bigint,
      left(p_motivo, 500), p_usuario, left(p_usuario_nome, 120), p_aprovacao, p_aprovado_por, p_chave, left(p_dispositivo, 200), l->'dados');
  end loop;
  return v_grupo;
end $$;
revoke execute on function public.fin_lancar_grupo(uuid, uuid, text, text, uuid, text, text, uuid, text, text, jsonb) from public, anon, authenticated;

-- Baixa (pagar/receber): livro-caixa + status da conta + auditoria.
create or replace function public.fin_conta_baixar(p_restaurante uuid, p_conta uuid, p_carteira text, p_forma text, p_turno uuid, p_chave text, p_linhas jsonb,
  p_usuario uuid, p_usuario_nome text, p_aprovacao uuid, p_aprovado_por text, p_dispositivo text, p_motivo text, p_auditoria jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare k record; v_grupo uuid;
begin
  select * into k from public.fin_contas where id = p_conta and restaurante_id = p_restaurante for update;
  if not found then raise exception 'conta_nao_encontrada' using errcode = 'P0002'; end if;
  if k.status = 'pago' then return jsonb_build_object('grupo', k.pago_grupo_id, 'repetido', true, 'aprovado_por', k.pago_aprovado_por_nome); end if;
  if k.status <> 'a_pagar' then raise exception 'conta_fechada'; end if;
  if p_carteira = 'gaveta' and not exists (select 1 from public.caixa_turnos t where t.id = p_turno and t.restaurante_id = p_restaurante and t.fechado_em is null) then
    raise exception 'caixa_fechado';
  end if;
  v_grupo := public.fin_lancar_grupo(p_restaurante, p_turno, p_chave, 'manual', p_usuario, p_usuario_nome, p_motivo, p_aprovacao, p_aprovado_por, p_dispositivo, p_linhas);
  update public.fin_contas set status = 'pago', pago_em = now(), pago_carteira = p_carteira, pago_forma = p_forma, pago_por_nome = p_usuario_nome,
    pago_grupo_id = v_grupo, pago_aprovado_por_nome = p_aprovado_por where id = p_conta;
  perform public.fin_auditar(p_restaurante, p_usuario, p_usuario_nome, p_auditoria->>'acao', 'conta', p_conta, p_auditoria->'dados');
  return jsonb_build_object('grupo', v_grupo, 'repetido', false, 'aprovado_por', p_aprovado_por);
end $$;
revoke execute on function public.fin_conta_baixar(uuid, uuid, text, text, uuid, text, jsonb, uuid, text, uuid, text, text, text, jsonb) from public, anon, authenticated;

-- Estorno da baixa: linhas opostas (ligadas às originais) + conta volta para "a pagar" + auditoria.
create or replace function public.fin_conta_estornar(p_restaurante uuid, p_conta uuid, p_turno uuid, p_usuario uuid, p_usuario_nome text, p_aprovacao uuid,
  p_aprovado_por text, p_dispositivo text, p_motivo text, p_auditoria jsonb) returns uuid
  language plpgsql security definer set search_path = public as $$
declare k record; v_grupo uuid; v_linhas jsonb;
begin
  select * into k from public.fin_contas where id = p_conta and restaurante_id = p_restaurante for update;
  if not found then raise exception 'conta_nao_encontrada' using errcode = 'P0002'; end if;
  if k.status <> 'pago' or k.pago_grupo_id is null then raise exception 'conta_nao_paga'; end if;
  if k.pago_carteira = 'gaveta' and not exists (select 1 from public.caixa_turnos t where t.id = p_turno and t.restaurante_id = p_restaurante and t.fechado_em is null) then
    raise exception 'caixa_fechado';
  end if;
  select jsonb_agg(jsonb_build_object('carteira', l.carteira, 'tipo', l.tipo, 'valor_centavos', -l.valor_centavos, 'forma', l.forma, 'entregador_id', l.entregador_id,
           'referencia_id', l.id, 'dados', coalesce(l.dados, '{}'::jsonb) || '{"estorno": true}'::jsonb) order by l.linha)
    into v_linhas from public.fin_lancamentos l where l.restaurante_id = p_restaurante and l.grupo_id = k.pago_grupo_id;
  if v_linhas is null then raise exception 'baixa_sem_lancamento'; end if;
  v_grupo := public.fin_lancar_grupo(p_restaurante, p_turno, left('conta:' || p_conta || ':estorno:' || k.pago_grupo_id, 120), 'manual', p_usuario, p_usuario_nome,
    p_motivo, p_aprovacao, p_aprovado_por, p_dispositivo, v_linhas);
  update public.fin_contas set status = 'a_pagar', pago_em = null, pago_carteira = null, pago_forma = null, pago_por_nome = null, pago_grupo_id = null,
    pago_aprovado_por_nome = null where id = p_conta;
  perform public.fin_auditar(p_restaurante, p_usuario, p_usuario_nome, 'contas.estornou_baixa', 'conta', p_conta, p_auditoria);
  return v_grupo;
end $$;
revoke execute on function public.fin_conta_estornar(uuid, uuid, uuid, uuid, text, uuid, text, text, text, jsonb) from public, anon, authenticated;

-- Cancelar conta (e, se pedido, as próximas da série) + auditoria.
create or replace function public.fin_conta_cancelar(p_restaurante uuid, p_conta uuid, p_serie boolean, p_usuario uuid, p_usuario_nome text, p_motivo text, p_auditoria jsonb)
  returns integer language plpgsql security definer set search_path = public as $$
declare k record; n integer := 0; m integer;
begin
  select * into k from public.fin_contas where id = p_conta and restaurante_id = p_restaurante for update;
  if not found then raise exception 'conta_nao_encontrada' using errcode = 'P0002'; end if;
  if k.status = 'pago' then raise exception 'conta_paga'; end if;
  if k.status = 'a_pagar' then
    update public.fin_contas set status = 'cancelado', cancelado_em = now(), cancelado_por_nome = p_usuario_nome, cancelado_motivo = left(p_motivo, 300) where id = p_conta;
    n := 1;
  end if;
  if p_serie and k.serie_id is not null then
    update public.fin_contas set recorrencia_encerrada_em = now() where id = k.serie_id and restaurante_id = p_restaurante;
    update public.fin_contas set status = 'cancelado', cancelado_em = now(), cancelado_por_nome = p_usuario_nome, cancelado_motivo = left(p_motivo, 300)
     where serie_id = k.serie_id and restaurante_id = p_restaurante and status = 'a_pagar' and vencimento >= k.vencimento;
    get diagnostics m = row_count; n := n + m;
  end if;
  perform public.fin_auditar(p_restaurante, p_usuario, p_usuario_nome, 'contas.cancelou', 'conta', p_conta, p_auditoria || jsonb_build_object('canceladas', n));
  return n;
end $$;
revoke execute on function public.fin_conta_cancelar(uuid, uuid, boolean, uuid, text, text, jsonb) from public, anon, authenticated;

-- Compra de insumos: nota + itens + (conta a pagar [+ baixa pela empresa] | saída do caixa) + custo dos insumos (com
-- histórico) + auditoria. Idempotente pela chave da nota.
create or replace function public.fin_compra_registrar(p_restaurante uuid, p jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare v_id uuid := (p->>'id')::uuid; v_conta uuid; v_grupo uuid; v_existe record; c jsonb; n integer := 0;
  v_usuario uuid := nullif(p->>'usuario_id', '')::uuid; v_nome text := p->>'usuario_nome';
begin
  select id, conta_id into v_existe from public.fin_compras where restaurante_id = p_restaurante and chave_idempotencia = p->>'chave';
  if found then return jsonb_build_object('id', v_existe.id, 'conta_id', v_existe.conta_id, 'repetido', true, 'atualizados', 0); end if;
  insert into public.fin_compras (id, restaurante_id, fornecedor_id, numero_nota, data_compra, total_centavos, pagamento, observacao, criado_por, criado_por_nome, chave_idempotencia)
  values (v_id, p_restaurante, nullif(p->>'fornecedor_id', '')::uuid, nullif(p->>'numero_nota', ''), (p->>'data_compra')::date, (p->>'total_centavos')::bigint,
    p->>'pagamento', nullif(p->>'observacao', ''), v_usuario, v_nome, p->>'chave');
  insert into public.fin_compra_itens (compra_id, restaurante_id, insumo_id, quantidade, unidade, quantidade_base, valor_centavos, custo_anterior_centavos, custo_novo_centavos)
  select v_id, p_restaurante, (i->>'insumo_id')::uuid, (i->>'quantidade')::numeric, i->>'unidade', (i->>'quantidade_base')::numeric, (i->>'valor_centavos')::bigint,
         nullif(i->>'custo_anterior_centavos', '')::bigint, (i->>'custo_novo_centavos')::bigint
    from jsonb_array_elements(p->'itens') i;
  if p->>'pagamento' = 'caixa' then
    if not exists (select 1 from public.caixa_turnos t where t.id = (p->>'turno_id')::uuid and t.restaurante_id = p_restaurante and t.fechado_em is null) then
      raise exception 'caixa_fechado';
    end if;
    v_grupo := public.fin_lancar_grupo(p_restaurante, (p->>'turno_id')::uuid, 'compra:' || v_id, 'manual', v_usuario, v_nome, p->>'motivo',
      nullif(p->>'aprovacao_id', '')::uuid, nullif(p->>'aprovado_por', ''), p->>'dispositivo', p->'linhas');
    update public.fin_compras set grupo_id = v_grupo where id = v_id;
  else
    v_conta := (p->'conta'->>'id')::uuid;
    insert into public.fin_contas (id, restaurante_id, tipo, descricao, fornecedor_id, categoria_id, valor_centavos, vencimento, forma_prevista, observacao, origem,
      compra_id, criado_por, criado_por_nome, chave_idempotencia)
    values (v_conta, p_restaurante, 'pagar', p->'conta'->>'descricao', nullif(p->>'fornecedor_id', '')::uuid, (p->'conta'->>'categoria_id')::uuid,
      (p->>'total_centavos')::bigint, (p->'conta'->>'vencimento')::date, nullif(p->'conta'->>'forma', ''), nullif(p->>'observacao', ''), 'compra', v_id, v_usuario, v_nome,
      'compra-conta:' || v_id);
    update public.fin_compras set conta_id = v_conta where id = v_id;
    if p->>'pagamento' = 'empresa' then
      v_grupo := public.fin_lancar_grupo(p_restaurante, null, 'conta:' || v_conta || ':baixa:compra', 'manual', v_usuario, v_nome, p->>'motivo',
        nullif(p->>'aprovacao_id', '')::uuid, nullif(p->>'aprovado_por', ''), p->>'dispositivo', p->'linhas');
      update public.fin_contas set status = 'pago', pago_em = now(), pago_carteira = 'empresa', pago_forma = nullif(p->'conta'->>'forma', ''), pago_por_nome = v_nome,
        pago_grupo_id = v_grupo, pago_aprovado_por_nome = nullif(p->>'aprovado_por', '') where id = v_conta;
    end if;
  end if;
  for c in select * from jsonb_array_elements(coalesce(p->'custos', '[]'::jsonb)) loop
    update public.cmv_insumos set custo_compra_centavos = (c->>'custo_novo_centavos')::bigint, atualizado_em = now()
     where id = (c->>'insumo_id')::uuid and restaurante_id = p_restaurante;
    insert into public.cmv_custos_historico (restaurante_id, insumo_id, custo_antigo_centavos, custo_novo_centavos, quantidade_compra, base_por_unidade, aproveitamento_pct,
      motivo, usuario_id, usuario_nome)
    values (p_restaurante, (c->>'insumo_id')::uuid, (c->>'custo_antigo_centavos')::bigint, (c->>'custo_novo_centavos')::bigint, (c->>'quantidade_compra')::numeric,
      (c->>'base_por_unidade')::numeric, (c->>'aproveitamento_pct')::numeric, left(p->>'motivo_historico', 300), v_usuario, v_nome);
    n := n + 1;
  end loop;
  perform public.fin_auditar(p_restaurante, v_usuario, v_nome, 'compras.registrou', 'compra', v_id, p->'auditoria' || jsonb_build_object('insumos_atualizados', n));
  return jsonb_build_object('id', v_id, 'conta_id', v_conta, 'repetido', false, 'atualizados', n);
end $$;
revoke execute on function public.fin_compra_registrar(uuid, jsonb) from public, anon, authenticated;

-- Cancelar compra a prazo ainda não paga: compra + conta juntas + auditoria.
create or replace function public.fin_compra_cancelar(p_restaurante uuid, p_compra uuid, p_usuario uuid, p_usuario_nome text, p_motivo text, p_dispositivo text)
  returns void language plpgsql security definer set search_path = public as $$
declare co record; k record;
begin
  select * into co from public.fin_compras where id = p_compra and restaurante_id = p_restaurante for update;
  if not found then raise exception 'compra_nao_encontrada' using errcode = 'P0002'; end if;
  if co.status = 'cancelada' then return; end if;
  if co.pagamento = 'caixa' then raise exception 'compra_paga'; end if;
  if co.conta_id is not null then
    select * into k from public.fin_contas where id = co.conta_id for update;
    if k.status = 'pago' then raise exception 'conta_paga'; end if;
    if k.status = 'a_pagar' then
      update public.fin_contas set status = 'cancelado', cancelado_em = now(), cancelado_por_nome = p_usuario_nome, cancelado_motivo = left('Compra cancelada: ' || p_motivo, 300)
       where id = co.conta_id;
    end if;
  end if;
  update public.fin_compras set status = 'cancelada', cancelado_em = now(), cancelado_por_nome = p_usuario_nome, cancelado_motivo = left(p_motivo, 300) where id = p_compra;
  perform public.fin_auditar(p_restaurante, p_usuario, p_usuario_nome, 'compras.cancelou', 'compra', p_compra,
    jsonb_build_object('motivo', p_motivo, 'total_centavos', co.total_centavos, 'dispositivo', p_dispositivo));
end $$;
revoke execute on function public.fin_compra_cancelar(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
