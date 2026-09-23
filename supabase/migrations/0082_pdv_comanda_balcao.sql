-- ============================================================================
-- 0082 — PDV v2: comanda de balcão (comanda avulsa) sobre o mesmo motor da mesa
--
-- Balcão deixa de ser "pedido solto" e vira uma comanda `tipo = 'balcao'`: nome
-- obrigatório, telefone opcional (snapshot, nunca vira cadastro em `clientes`),
-- senha sequencial permanente por loja, vários pedidos, pagamentos reais e
-- histórico — as mesmas funções de conta da mesa.
--
-- Tudo aditivo. Comanda existente continua `tipo = 'mesa'` (default) com mesa_id.
-- Código antigo continua funcionando com o banco novo: nada muda para quem não
-- insere `tipo = 'balcao'`.
--
-- Flag por loja: `restaurantes.pdv_v2` (default false). Sem ela ligada, o PDV segue
-- o fluxo antigo. Nenhuma loja real é ligada por esta migration.
-- ============================================================================

-- 1. comandas ------------------------------------------------------------------
alter table public.comandas add column if not exists tipo text not null default 'mesa';
alter table public.comandas drop constraint if exists comandas_tipo_check;
alter table public.comandas add constraint comandas_tipo_check check (tipo in ('mesa', 'balcao'));

alter table public.comandas alter column mesa_id drop not null;
alter table public.comandas drop constraint if exists comandas_tipo_mesa_check;
alter table public.comandas add constraint comandas_tipo_mesa_check
  check ((tipo = 'mesa' and mesa_id is not null) or (tipo = 'balcao' and mesa_id is null));

alter table public.comandas add column if not exists senha int;
alter table public.comandas add column if not exists cliente_nome text;
alter table public.comandas add column if not exists cliente_telefone text;
alter table public.comandas add column if not exists aberta_por uuid references public.usuarios(id) on delete set null;
alter table public.comandas add column if not exists aberta_por_nome text;
alter table public.comandas add column if not exists reaberta_em timestamptz;
alter table public.comandas add column if not exists reaberta_por_nome text;
alter table public.comandas add column if not exists reabertura_motivo text;
-- Idempotência do "Abrir": duplo clique não abre duas comandas.
alter table public.comandas add column if not exists chave_abertura text;

alter table public.comandas drop constraint if exists comandas_balcao_nome_check;
alter table public.comandas add constraint comandas_balcao_nome_check
  check (tipo <> 'balcao' or (cliente_nome is not null and length(btrim(cliente_nome)) between 1 and 60));
alter table public.comandas drop constraint if exists comandas_cliente_telefone_check;
alter table public.comandas add constraint comandas_cliente_telefone_check
  check (cliente_telefone is null or cliente_telefone ~ '^[0-9]{10,13}$');
alter table public.comandas drop constraint if exists comandas_senha_so_balcao_check;
alter table public.comandas add constraint comandas_senha_so_balcao_check
  check (tipo = 'balcao' or senha is null);

create unique index if not exists comandas_balcao_senha_unq
  on public.comandas (restaurante_id, senha) where tipo = 'balcao' and senha is not null;
create unique index if not exists comandas_chave_abertura_unq
  on public.comandas (restaurante_id, chave_abertura) where chave_abertura is not null;
create index if not exists idx_comandas_balcao_abertas
  on public.comandas (restaurante_id) where tipo = 'balcao' and status = 'aberta';

-- 2. restaurantes --------------------------------------------------------------
alter table public.restaurantes add column if not exists balcao_seq int not null default 0;
alter table public.restaurantes add column if not exists pdv_v2 boolean not null default false;

-- 0080: coluna nova de `restaurantes` não é visível ao painel sem grant explícito.
-- Só leitura: o navegador não liga a flag nem mexe no contador.
grant select (balcao_seq, pdv_v2) on public.restaurantes to authenticated;

-- 3. senha sequencial do balcão -------------------------------------------------
-- Mesmo padrão de `comanda_numerar` (0072): o UPDATE trava a linha da loja, então
-- dois balcões abertos juntos nunca recebem a mesma senha. Contador próprio, para
-- a senha sair 1, 2, 3… sem buracos causados por comandas de mesa. Nunca reinicia.
create or replace function public.comanda_numerar_balcao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tipo = 'balcao' and new.senha is null then
    update public.restaurantes set balcao_seq = balcao_seq + 1
     where id = new.restaurante_id
    returning balcao_seq into new.senha;
  end if;
  return new;
end $$;

drop trigger if exists comanda_numerar_balcao on public.comandas;
create trigger comanda_numerar_balcao
  before insert on public.comandas
  for each row execute function public.comanda_numerar_balcao();

-- 4. taxa de serviço: só a mesa herda o padrão do salão ------------------------
-- Antes, taxa 0 na abertura virava a taxa padrão da loja — no balcão isso cobraria
-- 10% de quem pediu um lanche para viagem. Balcão nasce e fica em 0 na abertura.
create or replace function public.comanda_herdar_taxa()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.tipo = 'balcao' then
      new.taxa_servico_percentual := 0;
    elsif coalesce(new.taxa_servico_percentual, 0) = 0 then
      select coalesce(r.taxa_servico_padrao, 0) into new.taxa_servico_percentual
        from public.restaurantes r where r.id = new.restaurante_id;
    end if;
  end if;
  return new;
end $$;
