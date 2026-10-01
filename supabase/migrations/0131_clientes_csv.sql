-- 0131 — Clientes: importar e exportar CSV (2026-10-01).
--
-- 1. clientes ganha os campos do modelo de importação (email, data de nascimento, UF,
--    observações) e a ORIGEM: nulo = cadastro de sempre (vitrine/checkout); 'importado' =
--    veio de um CSV (importacao_id diz de qual). Linhas existentes não mudam.
-- 2. clientes_importacoes: histórico (quem, quando, arquivo, quantidades) e idempotência —
--    `chave` única por loja: clique duplo ou internet caindo no meio não duplicam nada;
--    `lotes` guarda os lotes já gravados.
-- 3. clientes_importacao_alteracoes: o que cada importação criou ou mudou (com o valor de
--    antes), para "Desfazer importação" em até 7 dias.
-- Escrita só pelo servidor (service_role). Leitura: dono/gerente da própria loja.
--
-- Aditiva. Rollback: docs/rollback/0131_clientes_csv.down.sql

create table if not exists public.clientes_importacoes (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  chave text not null check (length(chave) between 8 and 80),
  usuario_id uuid,
  usuario_nome text not null default '',
  arquivo_nome text not null default '' check (length(arquivo_nome) <= 200),
  modo text not null check (modo in ('ignorar', 'completar', 'atualizar')),
  total_linhas integer not null default 0,
  criados integer not null default 0,
  atualizados integer not null default 0,
  ignorados integer not null default 0,
  erros integer not null default 0,
  lotes integer[] not null default '{}',
  status text not null default 'processando' check (status in ('processando', 'concluida', 'desfeita')),
  criado_em timestamptz not null default now(),
  concluido_em timestamptz,
  desfeita_em timestamptz,
  unique (restaurante_id, chave)
);
create index if not exists clientes_importacoes_loja on public.clientes_importacoes (restaurante_id, criado_em desc);

create table if not exists public.clientes_importacao_alteracoes (
  id bigint generated always as identity primary key,
  importacao_id uuid not null references public.clientes_importacoes(id) on delete cascade,
  cliente_id uuid not null,
  acao text not null check (acao in ('criado', 'atualizado')),
  antes jsonb
);
create index if not exists clientes_importacao_alteracoes_imp on public.clientes_importacao_alteracoes (importacao_id);

alter table public.clientes add column if not exists email text;
alter table public.clientes add column if not exists data_nascimento date;
alter table public.clientes add column if not exists endereco_uf text;
alter table public.clientes add column if not exists observacoes text;
alter table public.clientes add column if not exists origem text;
alter table public.clientes add column if not exists importacao_id uuid references public.clientes_importacoes(id) on delete set null;
alter table public.clientes drop constraint if exists clientes_origem_check;
alter table public.clientes add constraint clientes_origem_check check (origem is null or origem = 'importado');
create index if not exists clientes_importacao on public.clientes (importacao_id) where importacao_id is not null;

alter table public.clientes_importacoes enable row level security;
alter table public.clientes_importacao_alteracoes enable row level security;
revoke all on public.clientes_importacoes from anon, authenticated;
revoke all on public.clientes_importacao_alteracoes from anon, authenticated;
grant select on public.clientes_importacoes to authenticated;
drop policy if exists "Gestor vê as importações da loja" on public.clientes_importacoes;
create policy "Gestor vê as importações da loja" on public.clientes_importacoes
  for select to authenticated
  using (restaurante_id = public.auth_restaurante_id() and public.auth_e_gestor());

-- Telefones do arquivo que já existem na base (cadastro OU pedido, pela mesma chave de
-- telefone das campanhas) e os que pediram para sair. Só service_role (rota confere a loja).
create or replace function public.clientes_telefones_conhecidos(p_restaurante uuid, p_telefones text[])
returns table (telefone text, no_cadastro boolean, com_pedido boolean, descadastrado boolean)
language sql
stable
security definer
set search_path = public
as $$
  with t as (select distinct x tel, public.telefone_chave(x) k from unnest(p_telefones) x where public.telefone_chave(x) is not null)
  select t.tel,
         exists (select 1 from public.clientes c where c.restaurante_id = p_restaurante and c.telefone = t.tel),
         exists (select 1 from public.pedidos p where p.restaurante_id = p_restaurante and public.telefone_chave(p.cliente_telefone) = t.k),
         exists (select 1 from public.whatsapp_descadastros d where d.restaurante_id = p_restaurante and d.telefone_chave = t.k)
    from t
$$;
revoke execute on function public.clientes_telefones_conhecidos(uuid, text[]) from public, anon, authenticated;
grant execute on function public.clientes_telefones_conhecidos(uuid, text[]) to service_role;

-- Lote da importação: reservar (atômico — dois pedidos iguais, só um grava), liberar (se o
-- lote falhar, pode ser reenviado) e somar as quantidades.
create or replace function public.clientes_importacao_reservar_lote(p_id uuid, p_lote integer)
returns boolean language sql security definer set search_path = public as $$
  with u as (
    update public.clientes_importacoes set lotes = array_append(lotes, p_lote)
     where id = p_id and status = 'processando' and not (p_lote = any(lotes))
    returning 1)
  select exists (select 1 from u)
$$;
create or replace function public.clientes_importacao_liberar_lote(p_id uuid, p_lote integer)
returns void language sql security definer set search_path = public as $$
  update public.clientes_importacoes set lotes = array_remove(lotes, p_lote) where id = p_id
$$;
create or replace function public.clientes_importacao_somar(p_id uuid, p_criados integer, p_atualizados integer, p_ignorados integer, p_erros integer)
returns void language sql security definer set search_path = public as $$
  update public.clientes_importacoes
     set criados = criados + p_criados, atualizados = atualizados + p_atualizados,
         ignorados = ignorados + p_ignorados, erros = erros + p_erros
   where id = p_id
$$;
revoke execute on function public.clientes_importacao_reservar_lote(uuid, integer) from public, anon, authenticated;
revoke execute on function public.clientes_importacao_liberar_lote(uuid, integer) from public, anon, authenticated;
revoke execute on function public.clientes_importacao_somar(uuid, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.clientes_importacao_reservar_lote(uuid, integer) to service_role;
grant execute on function public.clientes_importacao_liberar_lote(uuid, integer) to service_role;
grant execute on function public.clientes_importacao_somar(uuid, integer, integer, integer, integer) to service_role;
