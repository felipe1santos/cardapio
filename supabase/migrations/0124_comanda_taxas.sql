-- 0124 — Várias taxas por conta (retoque visual, 2026-10-01).
--
-- Cada taxa (Couvert, Taxa de rolha, personalizada…) vira uma LINHA em comanda_taxas, com
-- nome, tipo (% do subtotal, valor fixo, ou valor por pessoa × quantidade) e o valor
-- calculado. A SOMA continua indo para a taxa manual da conta (comandas.taxa_extra_valor,
-- 0106) por comanda_taxa_extra_definir — assim comanda_totais, pagamento, fechamento,
-- pré-conta e recibo continuam fechando a conta exatamente como hoje (o recibo impresso
-- não muda: mostra a soma com os nomes juntos). A taxa de serviço (%) segue à parte.
--
-- Taxas padrão da loja (atalhos de um toque): restaurantes.taxas_padrao_mesa.
-- Aditiva. Rollback: docs/rollback/0124_comanda_taxas.down.sql
create table if not exists public.comanda_taxas (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  comanda_id uuid not null references public.comandas(id) on delete cascade,
  nome text not null check (char_length(btrim(nome)) between 2 and 40),
  tipo text not null check (tipo in ('percentual', 'fixo', 'por_pessoa')),
  base numeric(10,2) not null check (base >= 0 and base <= 9999.99),
  quantidade integer not null default 1 check (quantidade between 1 and 999),
  valor numeric(10,2) not null check (valor >= 0 and valor <= 9999.99),
  posicao smallint not null default 0,
  criado_por_nome text,
  criado_em timestamptz not null default now()
);
create index if not exists comanda_taxas_comanda_idx on public.comanda_taxas (comanda_id, posicao);

alter table public.comanda_taxas enable row level security;
drop policy if exists comanda_taxas_select on public.comanda_taxas;
create policy comanda_taxas_select on public.comanda_taxas
  for select to authenticated
  using (restaurante_id = public.auth_restaurante_id() and public.auth_papel() in ('dono', 'gerente', 'garcom', 'atendente'));
revoke all on public.comanda_taxas from anon, authenticated;
grant select on public.comanda_taxas to authenticated;

alter table public.restaurantes add column if not exists taxas_padrao_mesa jsonb not null default '[]'::jsonb;
alter table public.restaurantes drop constraint if exists restaurantes_taxas_padrao_mesa_check;
alter table public.restaurantes add constraint restaurantes_taxas_padrao_mesa_check
  check (jsonb_typeof(taxas_padrao_mesa) = 'array' and jsonb_array_length(taxas_padrao_mesa) <= 12);
grant select (taxas_padrao_mesa) on public.restaurantes to authenticated;

-- Troca a lista inteira de taxas da conta (valores já calculados pelo servidor) e grava a
-- soma como taxa manual da conta. Só o servidor (service_role) chama.
create or replace function public.comanda_taxas_definir(
  p_restaurante uuid, p_comanda uuid, p_taxas jsonb, p_ator uuid, p_ator_nome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_total numeric := 0;
  v_nomes text[] := '{}';
  v_nome text;
  t jsonb;
  i int := 0;
begin
  select status into v_status from public.comandas where id = p_comanda and restaurante_id = p_restaurante for update;
  if v_status is null then raise exception 'comanda_inexistente'; end if;
  if v_status <> 'aberta' then raise exception 'comanda_nao_aberta'; end if;
  if jsonb_typeof(coalesce(p_taxas, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_taxas, '[]'::jsonb)) > 12 then
    raise exception 'taxas_invalidas';
  end if;

  delete from public.comanda_taxas where comanda_id = p_comanda;
  for t in select * from jsonb_array_elements(coalesce(p_taxas, '[]'::jsonb)) loop
    insert into public.comanda_taxas (restaurante_id, comanda_id, nome, tipo, base, quantidade, valor, posicao, criado_por_nome)
    values (p_restaurante, p_comanda, btrim(t->>'nome'), t->>'tipo', round((t->>'base')::numeric, 2),
            coalesce((t->>'quantidade')::int, 1), round((t->>'valor')::numeric, 2), i, p_ator_nome);
    v_total := v_total + round((t->>'valor')::numeric, 2);
    v_nomes := v_nomes || btrim(t->>'nome');
    i := i + 1;
  end loop;

  if v_total > 9999.99 then raise exception 'taxa_extra_invalida'; end if;
  v_nome := case
    when i = 0 then null
    when i = 1 then v_nomes[1]
    when char_length(array_to_string(v_nomes, ' + ')) <= 40 then array_to_string(v_nomes, ' + ')
    else 'Taxas (' || i || ')'
  end;
  return public.comanda_taxa_extra_definir(p_restaurante, p_comanda, v_nome, v_total, p_ator, p_ator_nome)
         || jsonb_build_object('taxas', i);
end $$;

revoke all on function public.comanda_taxas_definir(uuid, uuid, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.comanda_taxas_definir(uuid, uuid, jsonb, uuid, text) to service_role;
