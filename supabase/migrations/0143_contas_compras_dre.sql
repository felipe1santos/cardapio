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
alter table public.fin_config add column if not exists limite_conta_centavos bigint not null default 100000
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
