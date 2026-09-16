-- Policies antigas que davam TUDO a qualquer membro da loja.
--
-- Enquanto toda loja tinha só o dono, "Tenant members manage X" (FOR ALL, só por
-- restaurante) era inofensivo. A tela de Equipe passou a criar garçons, e o painel fala
-- direto com o PostgREST: com o próprio JWT, pelo console do navegador, um garçom
-- ALTERAVA PREÇO DE ITEM e FECHAVA A LOJA. Provado na stack local antes desta migration.
-- O middleware não ajuda aqui — ele protege rota, não chamada direta ao banco.
--
-- Estratégia conservadora: NÃO reescrevo nenhuma condição à mão. Cada policy mantém o
-- USING/WITH CHECK original e ganha um `and auth_papel() in (...)`. O dono está em todas
-- as listas, então as 7 lojas de produção (só donos) não mudam em nada.
--
-- Catálogo e frete têm TAMBÉM uma policy de leitura pública (`using true`) — policies
-- permissivas somam, então restringir a FOR ALL não tira a leitura de ninguém: garçom
-- continua enxergando o cardápio para lançar pedido; só não escreve.

do $$
declare
  alvo record;
  pol record;
  papeis text;
  novo_using text;
  novo_check text;
begin
  for alvo in
    select * from (values
      -- Catálogo: `cardapio.editar` = dono, gerente.
      ('itens_cardapio',            'dono,gerente'),
      ('grupos_cardapio',           'dono,gerente'),
      ('item_complementos',         'dono,gerente'),
      ('grupos_item_complementos',  'dono,gerente'),
      ('tamanhos_item',             'dono,gerente'),
      ('pizza_sabores',             'dono,gerente'),
      ('pizza_sabor_precos',        'dono,gerente'),
      ('presets_complementos',      'dono,gerente'),
      ('preset_complemento_itens',  'dono,gerente'),
      ('order_bumps',               'dono,gerente'),
      ('bordas_pizza',              'dono,gerente'),
      ('massas_pizza',              'dono,gerente'),
      ('tamanhos_padrao_pizza',     'dono,gerente'),
      ('tamanhos_padrao_marmita',   'dono,gerente'),
      -- Frete é Ajustes: `ajustes.editar` = dono.
      ('taxas_entrega_bairro',      'dono'),
      ('taxas_entrega_raio',        'dono'),
      -- Marketing e fidelidade: dono, gerente.
      ('cupons',                    'dono,gerente'),
      ('cupom_usos',                'dono,gerente'),
      ('campanhas',                 'dono,gerente'),
      ('campanha_envios',           'dono,gerente'),
      ('campanhas_fidelidade',      'dono,gerente'),
      ('fidelidade_progresso',      'dono,gerente'),
      ('fidelidade_recompensas',    'dono,gerente'),
      -- Logística: quem despacha precisa ver entregador; o atendente despacha pelo Kanban.
      ('entregadores',              'dono,gerente,logistica,atendente'),
      ('fechamentos_caixa',         'dono,gerente,logistica'),
      -- Configuração de operação.
      ('estacoes',                  'dono,gerente'),
      ('impressoras',               'dono'),
      -- Códigos de verificação do cliente: quem trabalha é o servidor.
      ('cliente_codigos',           'dono')
    ) as t(tabela, lista)
  loop
    papeis := (select string_agg(quote_literal(p), ', ') from unnest(string_to_array(alvo.lista, ',')) p);

    for pol in
      select policyname, qual, with_check
        from pg_policies
       where schemaname = 'public'
         and tablename = alvo.tabela
         and cmd = 'ALL'
    loop
      -- Idempotência: se já passou por aqui, não empilha a condição de novo.
      if coalesce(pol.qual, '') like '%auth_papel()%' then
        continue;
      end if;

      novo_using := format('(%s) and public.auth_papel() in (%s)', pol.qual, papeis);
      novo_check := format('(%s) and public.auth_papel() in (%s)', coalesce(pol.with_check, pol.qual), papeis);

      execute format('alter policy %I on public.%I using (%s) with check (%s)',
        pol.policyname, alvo.tabela, novo_using, novo_check);
    end loop;
  end loop;
end $$;

-- `restaurantes`: a policy de UPDATE deixava qualquer membro mudar status da loja, taxa,
-- horário e o resto. Abrir/fechar a loja pelo Kanban é operação de delivery — fica com
-- dono, gerente e atendente. Garçom, cozinha e logística não mexem na loja.
do $$
declare
  pol record;
begin
  for pol in
    select policyname, qual, with_check
      from pg_policies
     where schemaname = 'public' and tablename = 'restaurantes' and cmd = 'UPDATE'
  loop
    if coalesce(pol.qual, '') like '%auth_papel()%' then
      continue;
    end if;
    execute format(
      'alter policy %I on public.restaurantes using ((%s) and public.auth_papel() in (''dono'', ''gerente'', ''atendente'')) with check ((%s) and public.auth_papel() in (''dono'', ''gerente'', ''atendente''))',
      pol.policyname, pol.qual, coalesce(pol.with_check, pol.qual));
  end loop;
end $$;
