-- Sessão da mesa e seleção do cliente.
--
-- Três coisas que NÃO se confundem:
--
-- 1. `sessoes_mesa`  — o ciclo de atendimento: a mesa foi ocupada, tem gente sentada.
--                      Abrir sessão NÃO abre a conta e não conta como venda.
-- 2. `selecoes_mesa` — o rascunho do cliente, feito no celular dele pelo QR. É uma
--                      lista visual para mostrar ao garçom. NÃO é pedido, não vai para a
--                      cozinha, não movimenta estoque, não entra em faturamento.
-- 3. `comandas`      — a conta, que já existe desde a 0034. Nasce no PRIMEIRO lançamento
--                      oficial feito por um funcionário autenticado.
--
-- A seleção nunca vira pedido sozinha: o garçom lança manualmente. Por isso não existe
-- aqui nenhum gatilho, função ou coluna que transforme seleção em pedido.

create table if not exists public.sessoes_mesa (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  mesa_id uuid not null references public.mesas(id) on delete cascade,
  status text not null default 'aberta',
  aberta_em timestamptz not null default now(),
  encerrada_em timestamptz,
  -- Preenchidos pelo funcionário quando ele assume a mesa; o cliente não informa nada.
  pessoas int,
  responsavel_id uuid references public.usuarios(id) on delete set null,
  observacoes text,
  -- Nasce nulo: a conta só existe a partir do primeiro lançamento oficial.
  comanda_id uuid references public.comandas(id) on delete set null
);

alter table public.sessoes_mesa drop constraint if exists sessoes_mesa_status_check;
alter table public.sessoes_mesa add constraint sessoes_mesa_status_check
  check (status in ('aberta', 'encerrada'));

alter table public.sessoes_mesa drop constraint if exists sessoes_mesa_pessoas_check;
alter table public.sessoes_mesa add constraint sessoes_mesa_pessoas_check
  check (pessoas is null or (pessoas > 0 and pessoas <= 99));

-- No máximo uma sessão aberta por mesa (resolve a corrida do find-or-create, mesmo
-- padrão da comanda na 0034).
create unique index if not exists sessoes_mesa_aberta_unq
  on public.sessoes_mesa (restaurante_id, mesa_id) where status = 'aberta';
create index if not exists idx_sessoes_mesa_restaurante on public.sessoes_mesa (restaurante_id);

-- ── seleção do cliente ──────────────────────────────────────────────────────
-- Uma seleção por aparelho: a mesma mesa pode ter vários celulares, e misturar as
-- listas confundiria quem está mostrando a tela ao garçom.
create table if not exists public.selecoes_mesa (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  mesa_id uuid not null references public.mesas(id) on delete cascade,
  sessao_id uuid not null references public.sessoes_mesa(id) on delete cascade,
  -- Identificador do aparelho, gerado no próprio navegador. Não identifica pessoa.
  dispositivo uuid not null,
  versao int not null default 1,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index if not exists selecoes_mesa_dispositivo_unq
  on public.selecoes_mesa (sessao_id, dispositivo);
create index if not exists idx_selecoes_mesa_mesa on public.selecoes_mesa (restaurante_id, mesa_id);

create table if not exists public.selecao_itens (
  id uuid primary key default gen_random_uuid(),
  selecao_id uuid not null references public.selecoes_mesa(id) on delete cascade,
  item_id uuid references public.itens_cardapio(id) on delete set null,
  -- Snapshot: o cliente mostra ao garçom o que ele viu, mesmo se o preço mudar depois.
  nome_snapshot text not null,
  preco_snapshot numeric(10,2) not null default 0,
  quantidade int not null default 1,
  observacao text,
  -- Escolhas do configurador (tamanho, adicionais, ponto…), já resolvidas em texto.
  opcoes jsonb not null default '[]'::jsonb,
  criado_em timestamptz not null default now()
);

alter table public.selecao_itens drop constraint if exists selecao_itens_quantidade_check;
alter table public.selecao_itens add constraint selecao_itens_quantidade_check
  check (quantidade > 0 and quantidade <= 99);

create index if not exists idx_selecao_itens_selecao on public.selecao_itens (selecao_id);

-- ── acesso ──────────────────────────────────────────────────────────────────
alter table public.sessoes_mesa enable row level security;
alter table public.selecoes_mesa enable row level security;
alter table public.selecao_itens enable row level security;

-- Leitura para quem opera o salão; escrita só pelo servidor (a rota pública roda com
-- service_role depois de resolver o token, e o painel do garçom idem).
drop policy if exists sessoes_mesa_select on public.sessoes_mesa;
create policy sessoes_mesa_select on public.sessoes_mesa
  for select to authenticated
  using (
    restaurante_id = public.auth_restaurante_id()
    and public.auth_papel() in ('dono', 'gerente', 'garcom')
  );

drop policy if exists selecoes_mesa_select on public.selecoes_mesa;
create policy selecoes_mesa_select on public.selecoes_mesa
  for select to authenticated
  using (
    restaurante_id = public.auth_restaurante_id()
    and public.auth_papel() in ('dono', 'gerente', 'garcom')
  );

drop policy if exists selecao_itens_select on public.selecao_itens;
create policy selecao_itens_select on public.selecao_itens
  for select to authenticated
  using (
    exists (
      select 1 from public.selecoes_mesa s
       where s.id = selecao_itens.selecao_id
         and s.restaurante_id = public.auth_restaurante_id()
         and public.auth_papel() in ('dono', 'gerente', 'garcom')
    )
  );

grant select on public.sessoes_mesa to authenticated;
grant select on public.selecoes_mesa to authenticated;
grant select on public.selecao_itens to authenticated;

-- A chave anônima não toca em nada disto: a rota pública passa pelo servidor.
revoke all on public.sessoes_mesa from anon;
revoke all on public.selecoes_mesa from anon;
revoke all on public.selecao_itens from anon;

comment on table public.selecoes_mesa is
  'Rascunho do cliente no celular. NÃO é pedido: não vai à cozinha, não movimenta estoque, não entra em faturamento. Só o garçom lança o pedido oficial, manualmente.';
