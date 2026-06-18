-- ============================================================================
-- Tamanhos de item (ex.: marmitex P/M/G), cada um com preço próprio. Pensado
-- pra donos de marmitaria: o cliente escolhe um tamanho e o preço do item
-- passa a ser o do tamanho escolhido (substitui o preço base, não soma).
-- ============================================================================

create table tamanhos_item (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references itens_cardapio (id) on delete cascade,
  nome text not null,
  preco numeric(10, 2) not null default 0,
  posicao int not null default 0
);

create index tamanhos_item_item_id_idx on tamanhos_item (item_id);

alter table tamanhos_item enable row level security;

create policy "Anyone can read item tamanhos"
  on tamanhos_item for select
  using (true);

create policy "Tenant members manage their item tamanhos"
  on tamanhos_item for all
  using (
    exists (
      select 1 from itens_cardapio i
      where i.id = tamanhos_item.item_id
        and i.restaurante_id = auth_restaurante_id()
    )
  )
  with check (
    exists (
      select 1 from itens_cardapio i
      where i.id = tamanhos_item.item_id
        and i.restaurante_id = auth_restaurante_id()
    )
  );

grant select on tamanhos_item to anon, authenticated;
grant insert, update, delete on tamanhos_item to authenticated;

-- Tamanho escolhido pelo cliente, snapshot no pedido (preço já refletido em preco_unitario)
alter table pedido_itens
  add column tamanho_nome text not null default '';
