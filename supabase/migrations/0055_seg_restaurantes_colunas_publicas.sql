-- SEGURANÇA (checkpoint S1) — a chave anônima deixa de enxergar colunas internas
-- de `restaurantes`.
--
-- O problema: a policy "Anyone can read restaurant storefront" tem USING (true)
-- para {public}, e `anon` tinha GRANT SELECT no NÍVEL DA TABELA — que vale para
-- todas as colunas, inclusive `impressao_agente_token`. Com a anon key (pública,
-- embarcada no JS da vitrine) dava para ler o token do Assistente de Impressão de
-- qualquer loja e, com ele, listar pedidos pendentes (nome, telefone, endereço,
-- itens) e marcá-los como impressos, suprimindo a impressão na cozinha.
--
-- Revogar só a coluna não resolve: enquanto existe o GRANT de tabela, ele cobre
-- todas as colunas e o revoke de coluna não tem efeito. Por isso aqui o SELECT da
-- TABELA é revogado e devolvido coluna a coluna.
--
-- A lista abaixo é exatamente o `select` de `buscarRestaurantePorSlug`
-- (lib/queries/cardapio.ts) — o único caminho que lê `restaurantes` com a chave
-- anônima, na casca de servidor da vitrine e no client PostgREST da página.
-- `frete_fora_da_lista` NÃO entra aqui de propósito: a coluna nasce na 0054, que
-- está congelada e pode não existir quando esta migration rodar. A própria 0054
-- concede o grant dela.
--
-- Aditivo do ponto de vista de dados: nenhuma linha é lida, escrita ou alterada.

revoke all on public.restaurantes from anon;

grant select (
  id,
  nome,
  slug,
  logo_url,
  banner_url,
  banner_mobile_url,
  banner_promocional_url,
  banner_foco_x,
  banner_foco_y,
  banner_promo_foco_x,
  banner_promo_foco_y,
  telefone,
  endereco,
  endereco_bairro,
  endereco_cidade,
  taxa_entrega_padrao,
  frete_gratis_acima,
  facebook_pixel_id,
  google_tag_id,
  order_bump_max,
  layout_cardapio,
  cor_tema,
  imagem_grande,
  status_loja,
  horario_funcionamento,
  avaliacao_nota,
  avaliacao_qtd,
  aceita_entrega,
  aceita_retirada,
  pizza_calculo_preco
) on public.restaurantes to anon;

-- `frete_fora_da_lista` (0054) entra só se já existir. As duas migrations podem
-- rodar em qualquer ordem: se a 0054 vier antes, o `revoke all` acima apagaria o
-- grant dela e a vitrine quebraria ao ler a coluna — este bloco devolve. Se vier
-- depois, é a própria 0054 que concede.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'restaurantes'
       and column_name = 'frete_fora_da_lista'
  ) then
    execute 'grant select (frete_fora_da_lista) on public.restaurantes to anon';
  end if;
end $$;

comment on column public.restaurantes.impressao_agente_token is
  'Segredo do Assistente de Impressão. NUNCA conceder a anon: ficou legível pela chave pública até a migration 0055.';
